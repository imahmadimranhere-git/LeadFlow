// Discovery: settings → source-specific queries → connector search → normalise → intent/negative
// filter → duplicate check → CANDIDATES for a human to review → import selected as leads.
// Runs are processed in the background by jobs/discoveryRunner.js.
import mongoose from '../../../config/mongoose.js';
import DiscoveryRun from '../../../models/DiscoveryRun.js';
import DiscoveryCandidate from '../../../models/DiscoveryCandidate.js';
import Lead from '../../../models/Lead.js';
import TenantSettings from '../../../models/TenantSettings.js';
import ApiError from '../../../utils/ApiError.js';
import logger from '../../../config/logger.js';
import { runWithTenant, runAsSystem } from '../../../utils/tenantContext.js';
import { buildPagination } from '../../../utils/queryBuilder.js';
import { consumeQuota, releaseQuota } from '../../billing/quotaService.js';
import { getEffectivePlan } from '../../billing/planResolver.js';
import { recordAudit } from '../../audit/auditService.js';
import { normalizeWebsite, normalizeSocial, looksLikePromptInjection } from '../normalize.js';
import { createLead } from '../leadService.js';
import { detectIntent } from './intentDetector.js';
import { matchService } from './serviceMatcher.js';
import { getConnector, listCapabilities } from './connectors/registry.js';
import { ConnectorError } from './connectors/BaseConnector.js';

export const MAX_QUERIES_PER_RUN = 10;
const STALE_AFTER_MS = 10 * 60 * 1000;

// Pages on these sites are not the business's own website (a profile, a listing, a forum thread)
const PLATFORM_DOMAINS = new Set([
  'facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com', 'pinterest.com',
  'reddit.com', 'quora.com', 'medium.com', 'yelp.com', 'tripadvisor.com', 'olx.com.pk', 'zameen.com', 'graana.com',
  'google.com', 'maps.google.com', 'wikipedia.org', 'indeed.com', 'rozee.pk', 'fiverr.com', 'upwork.com', 'yellowpages.com',
]);
const SOCIAL_DOMAINS = new Set(['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'tiktok.com']);
const isPlatform = (domain) => Boolean(domain) && [...PLATFORM_DOMAINS].some((p) => domain === p || domain.endsWith(`.${p}`));

// ---------------------------------------------------------------- sources & queries

export async function listSources(auth) {
  const plan = await getEffectivePlan(auth.tenantId);
  const allowed = new Set(plan.connectors || []);
  const unconfigured = plan.code === 'unconfigured';
  return listCapabilities().map((c) => ({ ...c, inPlan: unconfigured || allowed.has(c.source) }));
}

export async function suggestQueries(source) {
  const connector = getConnector(source);
  if (!connector) throw ApiError.badRequest('Unknown source');
  const settings = await TenantSettings.findOne({});
  return connector.buildQueries(settings?.toObject() || {}, { max: MAX_QUERIES_PER_RUN });
}

// ---------------------------------------------------------------- runs

export async function createRun(auth, { source, queries }) {
  const connector = getConnector(source);
  if (!connector || !connector.getCapabilities().available) throw ApiError.badRequest('This source is not available yet');

  const plan = await getEffectivePlan(auth.tenantId);
  if (plan.code !== 'unconfigured' && !(plan.connectors || []).includes(source)) {
    throw new ApiError(402, `The ${source.replace('_', ' ').toLowerCase()} source is not included in your ${plan.name} plan. Please upgrade.`, [{ code: 'PLAN_FEATURE', field: 'source', message: source }]);
  }
  try {
    await connector.authenticate(); // fail fast: e.g. "connect Brave Search first"
  } catch (err) {
    if (err instanceof ConnectorError) throw ApiError.badRequest(err.message);
    throw err;
  }

  // duplicates (case / extra spaces) removed — the FIRST version the person typed is kept
  const seen = new Set();
  const unique = queries.filter((q) => {
    const k = q.query.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  await consumeQuota(auth.tenantId, 'discoverySearches', unique.length); // 1 query = 1 search from the plan
  try {
    const run = await DiscoveryRun.create({ source, queries: unique, createdBy: auth.userId });
    await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'discovery.run_created', targetType: 'DiscoveryRun', targetId: run._id, metadata: { source, queries: unique.length } });
    return run.toJSON();
  } catch (err) {
    await releaseQuota(auth.tenantId, 'discoverySearches', unique.length);
    if (err.code === 11000) throw ApiError.conflict('A discovery run is already in progress — wait for it to finish or cancel it');
    throw err;
  }
}

export async function listRuns({ page, limit }) {
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    DiscoveryRun.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('createdBy', 'name'),
    DiscoveryRun.countDocuments({}),
  ]);
  return { items: items.map((r) => r.toJSON()), total };
}

export async function getRun(id) {
  const run = await DiscoveryRun.findById(id).populate('createdBy', 'name');
  if (!run) throw ApiError.notFound('Run not found');
  return run.toJSON();
}

export async function cancelRun(auth, id) {
  const run = await DiscoveryRun.findOneAndUpdate(
    { _id: id, status: { $in: ['QUEUED', 'RUNNING'] } },
    { $set: { status: 'CANCELLED', finishedAt: new Date(), activeLock: false } },
    { new: true }
  );
  if (!run) throw ApiError.conflict('This run is not running');
  const pending = run.queries.filter((q) => q.status === 'PENDING').length;
  if (pending) await releaseQuota(auth.tenantId, 'discoverySearches', pending);
  return run.toJSON();
}

// ---------------------------------------------------------------- background processing

/** Atomically takes the oldest queued run (safe with several workers/servers). */
export async function claimNextRun(workerId) {
  return runAsSystem('discovery:claim', () =>
    DiscoveryRun.findOneAndUpdate(
      { status: 'QUEUED' },
      { $set: { status: 'RUNNING', workerId, startedAt: new Date(), heartbeatAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    )
  );
}

/** Runs left RUNNING by a crashed server are marked failed and their unused searches refunded. */
export async function recoverStaleRuns() {
  return runAsSystem('discovery:recover', async () => {
    const stale = await DiscoveryRun.find({ status: 'RUNNING', heartbeatAt: { $lt: new Date(Date.now() - STALE_AFTER_MS) } }).limit(50);
    for (const run of stale) {
      const r = await DiscoveryRun.updateOne(
        { _id: run._id, status: 'RUNNING' },
        { $set: { status: 'FAILED', error: 'Interrupted (server restart) — unused searches were refunded', finishedAt: new Date(), activeLock: false } }
      );
      const pending = run.queries.filter((q) => q.status === 'PENDING').length;
      if (r.modifiedCount && pending) await runWithTenant({ tenantId: run.tenantId }, () => releaseQuota(run.tenantId, 'discoverySearches', pending));
    }
    return stale.length;
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function processCandidate(run, query, raw, connector, settings) {
  const n = connector.normalize(raw);
  if (!n?.url || !/^https?:\/\//i.test(n.url) || !n.title) return 'skipped';

  const domain = normalizeWebsite(n.url);
  const platform = isPlatform(domain);
  const text = `${n.title}\n${n.snippet}`;
  const d = settings.discovery || {};
  const intent = detectIntent(text, d);

  let status = 'NEW';
  let duplicateOf = null;
  if (intent.negativeKeyword) status = 'FILTERED';
  else if (!platform && domain) {
    const existing = await Lead.findOne({ websiteNormalized: domain }).select('_id');
    if (existing) {
      status = 'DUPLICATE';
      duplicateOf = existing._id;
    }
  } else if (platform) {
    const social = normalizeSocial(n.url);
    const existing = social && (await Lead.findOne({ socialNormalized: social }).select('_id'));
    if (existing) {
      status = 'DUPLICATE';
      duplicateOf = existing._id;
    }
  }

  try {
    await DiscoveryCandidate.create({
      runId: run._id,
      source: run.source,
      title: n.title,
      url: n.url,
      domain,
      snippet: n.snippet,
      searchQuery: query.query,
      matchedKeyword: intent.matchedKeyword,
      matchedIntentPhrase: intent.matchedIntentPhrase,
      matchedHashtag: intent.matchedHashtag,
      negativeKeyword: intent.negativeKeyword,
      intentLevel: intent.intentLevel,
      matchedService: matchService(text, settings.services || []),
      isPlatformPage: platform,
      suspectedInjection: looksLikePromptInjection(n.title, n.snippet),
      status,
      duplicateOf,
    });
  } catch (err) {
    if (err.code === 11000) return 'skipped'; // same URL already found in this run
    throw err;
  }
  return { status, high: intent.intentLevel === 'HIGH' && status === 'NEW' };
}

/** Processes one claimed run to the end. Never throws (errors are stored on the run). */
export async function processRun(run) {
  const startedAt = Date.now();
  await runWithTenant({ tenantId: run.tenantId }, async () => {
    const connector = getConnector(run.source);
    const settingsDoc = await TenantSettings.findOne({});
    const settings = settingsDoc?.toObject() || {};
    const stats = { results: 0, candidates: 0, duplicates: 0, filtered: 0, highIntent: 0 };
    let fatal = null;

    try {
      await connector.authenticate();
    } catch (err) {
      fatal = err instanceof ConnectorError ? err.message : 'Could not start this source';
    }

    for (let i = 0; i < run.queries.length && !fatal; i += 1) {
      const fresh = await DiscoveryRun.findById(run._id).select('status');
      if (!fresh || fresh.status !== 'RUNNING') return; // cancelled by the user

      const query = run.queries[i];
      let qStatus = 'DONE';
      let qError = null;
      let resultCount = 0;
      try {
        let results;
        try {
          results = await connector.search(query.query);
        } catch (err) {
          if (!(err instanceof ConnectorError) || !err.retryable) throw err;
          await sleep(3000); // one polite retry
          results = await connector.search(query.query);
        }
        resultCount = results.length;
        stats.results += results.length;
        for (const raw of results) {
          const r = await processCandidate(run, query, raw, connector, settings);
          if (r === 'skipped') continue;
          stats.candidates += 1;
          if (r.status === 'DUPLICATE') stats.duplicates += 1;
          if (r.status === 'FILTERED') stats.filtered += 1;
          if (r.high) stats.highIntent += 1;
        }
      } catch (err) {
        qStatus = 'FAILED';
        qError = err instanceof ConnectorError ? err.message : 'Unexpected error';
        if (err instanceof ConnectorError && err.fatal) fatal = err.message;
        if (!(err instanceof ConnectorError)) logger.error({ err: err.message, runId: String(run._id) }, 'discovery query failed');
      }

      await DiscoveryRun.updateOne(
        { _id: run._id },
        { $set: { [`queries.${i}.status`]: qStatus, [`queries.${i}.resultCount`]: resultCount, [`queries.${i}.error`]: qError, stats, heartbeatAt: new Date() } }
      );
      if (i < run.queries.length - 1 && connector.delayBetweenQueriesMs) await sleep(connector.delayBetweenQueriesMs);
    }

    // Refund searches that never ran (fatal error)
    const after = await DiscoveryRun.findById(run._id).select('queries status');
    const pending = after.queries.filter((q) => q.status === 'PENDING').length;
    if (pending) {
      await releaseQuota(run.tenantId, 'discoverySearches', pending);
      await DiscoveryRun.updateOne({ _id: run._id }, { $set: Object.fromEntries(after.queries.map((q, i) => [q.status === 'PENDING' ? `queries.${i}.status` : null, 'SKIPPED']).filter(([k]) => k)) });
    }

    await DiscoveryRun.updateOne(
      { _id: run._id, status: 'RUNNING' },
      { $set: { status: fatal ? 'FAILED' : 'COMPLETED', error: fatal, stats, finishedAt: new Date(), activeLock: false } }
    );
    logger.info({ runId: String(run._id), ms: Date.now() - startedAt, stats, fatal }, 'discovery run finished');
  }).catch(async (err) => {
    logger.error({ err: err.message, runId: String(run._id) }, 'discovery run crashed');
    await runAsSystem('discovery:fail', () =>
      DiscoveryRun.updateOne({ _id: run._id, status: 'RUNNING' }, { $set: { status: 'FAILED', error: 'Unexpected error', finishedAt: new Date(), activeLock: false } })
    );
  });
}

// ---------------------------------------------------------------- candidates

export async function listCandidates(runId, { page, limit, status, intentLevel }) {
  const filter = { runId };
  if (status) filter.status = status;
  if (intentLevel) filter.intentLevel = intentLevel;
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    DiscoveryCandidate.find(filter).sort({ intentLevel: 1, createdAt: 1 }) /* alphabetical: HIGH < MEDIUM < NONE → strongest first */.skip(skip).limit(limit),
    DiscoveryCandidate.countDocuments(filter),
  ]);
  return { items: items.map((c) => c.toJSON()), total };
}

/** Human-approved import: each chosen candidate becomes a lead with full "why discovered" data. */
export async function importCandidates(auth, ids) {
  const candidates = await DiscoveryCandidate.find({ _id: { $in: ids.map((i) => new mongoose.Types.ObjectId(i)) }, status: { $in: ['NEW', 'FILTERED'] } });
  const result = { imported: 0, duplicates: 0, failed: 0, limitReached: false };

  for (const c of candidates) {
    // claim it first so two clicks can't import the same candidate twice
    const claimed = await DiscoveryCandidate.findOneAndUpdate({ _id: c._id, status: { $in: ['NEW', 'FILTERED'] } }, { $set: { status: 'IMPORTED' } });
    if (!claimed) continue;
    const social = c.isPlatformPage && SOCIAL_DOMAINS.has(c.domain) ? c.url : null;
    try {
      const lead = await createLead(auth, {
        name: c.title.slice(0, 150),
        website: c.isPlatformPage ? null : c.url,
        socialProfileUrl: social,
        source: c.source,
        sourceUrl: c.url,
        searchQuery: c.searchQuery,
        matchedKeyword: c.matchedKeyword,
        matchedIntentPhrase: c.matchedIntentPhrase,
        matchedHashtag: c.matchedHashtag,
        evidenceSnippet: c.snippet || null,
        requiredService: c.matchedService,
        force: false,
      });
      await DiscoveryCandidate.updateOne({ _id: c._id }, { $set: { leadId: lead._id } });
      result.imported += 1;
    } catch (err) {
      if (err.statusCode === 409) {
        const dupId = err.details?.duplicates?.find((d) => d.visible)?.id || null;
        await DiscoveryCandidate.updateOne({ _id: c._id }, { $set: { status: 'DUPLICATE', duplicateOf: dupId } });
        result.duplicates += 1;
      } else {
        await DiscoveryCandidate.updateOne({ _id: c._id }, { $set: { status: c.status } }); // give it back
        if (err.statusCode === 402) {
          result.limitReached = true;
          break;
        }
        result.failed += 1;
      }
    }
  }
  return result;
}

export async function dismissCandidates(ids) {
  const r = await DiscoveryCandidate.updateMany({ _id: { $in: ids }, status: { $in: ['NEW', 'FILTERED', 'DUPLICATE'] } }, { $set: { status: 'DISMISSED' } });
  return { dismissed: r.modifiedCount };
}
