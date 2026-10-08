// Hashtag Watches: CRUD + the scheduled job that turns new public posts into Signals.
import HashtagWatch from '../../models/HashtagWatch.js';
import Signal from '../../models/Signal.js';
import IgHashtagQuota, { IG_WEEKLY_HASHTAG_LIMIT } from '../../models/IgHashtagQuota.js';
import TenantSettings from '../../models/TenantSettings.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { runAsSystem, runWithTenant } from '../../utils/tenantContext.js';
import { getEffectivePlan, isUnlimited } from '../billing/planResolver.js';
import { consumeQuota, limitError } from '../billing/quotaService.js';
import { getCredentials } from '../integrations/vaultService.js';
import { recordAudit } from '../audit/auditService.js';
import { findHashtagId, recentMedia, MetaError } from '../integrations/meta/metaClient.js';
import { detectIntent } from '../leads/discovery/intentDetector.js';
import { matchService } from '../leads/discovery/serviceMatcher.js';
import { looksLikePromptInjection } from '../leads/normalize.js';
import { extractPublicContacts, extractHashtags, dataCompleteness } from './extract.js';

const RUN_NOW_COOLDOWN_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------- CRUD

async function assertWatchLimit(tenantId, excludeId = null) {
  const plan = await getEffectivePlan(tenantId);
  const limit = plan.limits?.hashtagWatches;
  if (isUnlimited(limit)) return;
  const filter = { isActive: true };
  if (excludeId) filter._id = { $ne: excludeId };
  if ((await HashtagWatch.countDocuments(filter)) >= limit) throw limitError('hashtagWatches', limit, plan.name);
}

async function assertPlatformInPlan(tenantId, platform) {
  const plan = await getEffectivePlan(tenantId);
  if (plan.code !== 'unconfigured' && !(plan.connectors || []).includes(platform)) {
    throw new ApiError(402, `${platform.toLowerCase()} is not included in your ${plan.name} plan. Please upgrade.`, [{ code: 'PLAN_FEATURE', field: 'platform', message: platform }]);
  }
}

export async function listWatches() {
  const items = await HashtagWatch.find({}).sort({ createdAt: -1 }).limit(100).populate('createdBy', 'name');
  return items.map((w) => w.toJSON());
}

export async function createWatch(auth, data) {
  await assertPlatformInPlan(auth.tenantId, data.platform);
  if (data.isActive !== false) await assertWatchLimit(auth.tenantId);
  const watch = await HashtagWatch.create({ ...data, createdBy: auth.userId, nextRunAt: new Date() });
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'hashtag_watch.created', targetType: 'HashtagWatch', targetId: watch._id, metadata: { hashtags: watch.hashtags } });
  return watch.toJSON();
}

export async function updateWatch(auth, id, data) {
  const watch = await HashtagWatch.findById(id);
  if (!watch) throw ApiError.notFound('Watch not found');
  if (data.isActive === true && !watch.isActive) await assertWatchLimit(auth.tenantId, watch._id);
  for (const [k, v] of Object.entries(data)) watch.set(k, v);
  if (data.hashtags) watch.hashtagIds = {}; // look ids up again
  if (data.scheduleHours || data.isActive) watch.nextRunAt = new Date(Math.min(watch.nextRunAt?.getTime() || Date.now(), Date.now() + watch.scheduleHours * 3600_000));
  await watch.save();
  return watch.toJSON();
}

export async function deleteWatch(auth, id) {
  const r = await HashtagWatch.deleteOne({ _id: id });
  if (!r.deletedCount) throw ApiError.notFound('Watch not found');
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'hashtag_watch.deleted', targetType: 'HashtagWatch', targetId: id });
  return { deleted: true };
}

/** "Run now" — at most once per 15 minutes per watch. */
export async function runWatchNow(id) {
  const now = Date.now();
  const watch = await HashtagWatch.findOneAndUpdate(
    { _id: id, isActive: true, $or: [{ lastRunAt: null }, { lastRunAt: { $lt: new Date(now - RUN_NOW_COOLDOWN_MS) } }] },
    { $set: { nextRunAt: new Date(now) } },
    { new: true }
  );
  if (!watch) throw new ApiError(429, 'This watch ran less than 15 minutes ago (or is paused). Please wait.');
  return watch.toJSON();
}

export async function getIgHashtagUsage() {
  const meta = await getCredentials('META_GRAPH', { purpose: 'hashtag-usage' }).catch(() => null);
  const igUserId = meta?.config?.igUserId;
  const used = igUserId ? await IgHashtagQuota.find({ igUserId }).sort({ firstQueriedAt: 1 }).limit(100) : [];
  return {
    limit: IG_WEEKLY_HASHTAG_LIMIT,
    used: used.length,
    hashtags: used.map((u) => ({ hashtag: u.hashtag, freesUpAt: new Date(u.firstQueriedAt.getTime() + 7 * 24 * 3600_000) })),
    connected: Boolean(igUserId),
  };
}

// ---------------------------------------------------------------- the job

/** Instagram's rule: max 30 unique hashtags per account per rolling 7 days. Reserve a slot first. */
async function reserveIgHashtag(igUserId, hashtag) {
  if (await IgHashtagQuota.exists({ igUserId, hashtag })) return true; // already counted this week
  if ((await IgHashtagQuota.countDocuments({ igUserId })) >= IG_WEEKLY_HASHTAG_LIMIT) return false;
  try {
    await IgHashtagQuota.create({ igUserId, hashtag });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  return true;
}

const containsWord = (text, word) => new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu').test(text);

/** One post → one Signal (skipped if we already have it). */
async function saveSignal(watch, hashtag, media, settings) {
  const caption = String(media.caption || '').slice(0, 5000);
  const d = settings.discovery || {};
  const intent = detectIntent(caption, {
    keywords: [...(d.keywords || []), ...(watch.keywords || [])],
    intentPhrases: d.intentPhrases || [],
    hashtags: d.hashtags || [],
    negativeKeywords: d.negativeKeywords || [],
  });
  const matchedLocation = watch.locations?.length ? watch.locations.find((l) => containsWord(caption, l)) || null : null;
  // only real instagram.com links are kept (the link is shown to users)
  const postUrl = typeof media.permalink === 'string' && /^https:\/\/(www\.)?instagram\.com\//.test(media.permalink) ? media.permalink.slice(0, 2048) : null;
  const contacts = extractPublicContacts(caption).map((c) => ({
    ...c, provenance: 'POST_TEXT', provenanceUrl: postUrl, publiclyStatedByAuthor: true, capturedAt: new Date(),
  }));
  const completeness = dataCompleteness({ authorProvided: false, contactCount: contacts.length });

  let status = 'NEEDS_REVIEW'; // Instagram never tells us WHO posted → a person must look (A28)
  let filterReason = null;
  if (intent.negativeKeyword) {
    status = 'FILTERED';
    filterReason = `Contains negative keyword "${intent.negativeKeyword}"`;
  } else if (watch.locations?.length && !matchedLocation) {
    status = 'FILTERED';
    filterReason = 'None of the watch locations is mentioned';
  }

  try {
    await Signal.create({
      source: 'INSTAGRAM',
      externalId: String(media.id),
      watchId: watch._id,
      capture: {
        platform: 'INSTAGRAM',
        postId: String(media.id),
        postType: String(media.media_type || 'POST').toLowerCase(),
        postUrl,
        hashtagsUsed: extractHashtags(caption),
        captionSnippet: caption.slice(0, 1000),
        postTimestamp: media.timestamp ? new Date(media.timestamp) : null,
        engagement: { likes: Number.isFinite(media.like_count) ? media.like_count : null, comments: Number.isFinite(media.comments_count) ? media.comments_count : null },
        author: { status: 'NOT_PROVIDED_BY_SOURCE' },
        contacts,
        watchId: watch._id,
        dataCompleteness: completeness.level,
        completenessReasons: completeness.reasons,
      },
      fullPublicText: caption,
      matchedHashtag: hashtag,
      matchedKeyword: intent.matchedKeyword,
      matchedIntentPhrase: intent.matchedIntentPhrase,
      matchedLocation,
      negativeKeyword: intent.negativeKeyword,
      filterReason,
      intentLevel: intent.intentLevel,
      matchedService: matchService(caption, settings.services || []),
      hasPublicContact: contacts.length > 0,
      suspectedInjection: looksLikePromptInjection(caption),
      status,
    });
    return { created: true, high: intent.intentLevel === 'HIGH' && status !== 'FILTERED' };
  } catch (err) {
    if (err.code === 11000) return { created: false }; // already seen this post
    throw err;
  }
}

export async function processWatch(watch) {
  return runWithTenant({ tenantId: watch.tenantId }, async () => {
    const result = { postsSeen: 0, signals: 0, highIntent: 0, errors: [] };
    let status = 'OK';
    try {
      await assertPlatformInPlan(watch.tenantId, watch.platform);
      const meta = await getCredentials('META_GRAPH', { purpose: `hashtag-watch:${watch._id}` });
      if (!meta?.config?.igUserId) throw new MetaError('Connect Instagram in Settings → Integrations first');
      const { userAccessToken } = meta.secrets;
      const { igUserId } = meta.config;
      const settings = (await TenantSettings.findOne({}))?.toObject() || {};

      for (const hashtag of watch.hashtags) {
        try {
          if (!(await reserveIgHashtag(igUserId, hashtag))) {
            result.errors.push(`#${hashtag}: Instagram's limit of 30 different hashtags per 7 days is reached`);
            continue;
          }
          await consumeQuota(watch.tenantId, 'discoverySearches', 1); // each hashtag check = 1 search from the plan
          let tagId = watch.hashtagIds?.get?.(hashtag);
          if (!tagId) {
            tagId = await findHashtagId(igUserId, userAccessToken, hashtag);
            if (!tagId) {
              result.errors.push(`#${hashtag}: not found on Instagram`);
              continue;
            }
            await HashtagWatch.updateOne({ _id: watch._id }, { $set: { [`hashtagIds.${hashtag}`]: tagId } });
          }
          const posts = await recentMedia(tagId, igUserId, userAccessToken, watch.maxResultsPerHashtag);
          result.postsSeen += posts.length;
          for (const media of posts) {
            if (!media?.id) continue;
            const r = await saveSignal(watch, hashtag, media, settings);
            if (r.created) result.signals += 1;
            if (r.high) result.highIntent += 1;
          }
        } catch (err) {
          if (err.statusCode === 402) {
            result.errors.push('Monthly discovery searches used up — upgrade your plan');
            break;
          }
          if (err instanceof MetaError && err.reconnect) throw err;
          result.errors.push(`#${hashtag}: ${err instanceof MetaError ? err.message : 'unexpected error'}`);
          if (!(err instanceof MetaError)) logger.error({ err: err.message, watchId: String(watch._id) }, 'hashtag query failed');
        }
      }
      if (result.errors.length) status = result.signals || result.postsSeen ? 'PARTIAL' : 'FAILED';
    } catch (err) {
      status = 'FAILED';
      result.errors.push(err instanceof MetaError || err.statusCode ? err.message : 'Unexpected error');
      if (!(err instanceof MetaError) && !err.statusCode) logger.error({ err: err.message, watchId: String(watch._id) }, 'hashtag watch failed');
    }

    await HashtagWatch.updateOne(
      { _id: watch._id },
      {
        $set: { lastRunAt: new Date(), lastRunStatus: status, lastError: result.errors.join(' · ').slice(0, 300) || null, lockedUntil: null },
        $inc: { 'totals.runs': 1, 'totals.postsSeen': result.postsSeen, 'totals.signals': result.signals, 'totals.highIntent': result.highIntent },
      }
    );
    return { status, ...result };
  });
}

/** Atomically takes one due watch (safe with several servers). */
export async function claimDueWatch(now = new Date()) {
  return runAsSystem('watch:claim', async () => {
    const candidates = await HashtagWatch.find({ isActive: true, nextRunAt: { $lte: now }, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] }).select('_id scheduleHours').limit(1);
    if (!candidates.length) return null;
    const c = candidates[0];
    return HashtagWatch.findOneAndUpdate(
      { _id: c._id, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
      { $set: { lockedUntil: new Date(now.getTime() + LOCK_MS), nextRunAt: new Date(now.getTime() + c.scheduleHours * 3600_000) } },
      { new: true }
    );
  });
}
