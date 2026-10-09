// Website audit of a lead's public homepage (spec A8 + 23.8 SSRF).
//
//  - EVERY request goes through SafeFetch: only http/https, ports 80/443, public IPs only (checked again
//    after DNS and on every redirect), size/time limits. The lead's URL is untrusted input.
//  - Polite: robots.txt is respected, at most ~11 requests per audit, our bot name is sent.
//  - Only facts are stored (title, tags found, timings…), never the page content.
//  - Synchronous with a hard time budget; one audit at a time per lead; per-company rate limit on the route.
import env from '../../config/env.js';
import Lead from '../../models/Lead.js';
import WebsiteAudit from '../../models/WebsiteAudit.js';
import TenantSettings from '../../models/TenantSettings.js';
import ApiError from '../../utils/ApiError.js';
import { buildPagination } from '../../utils/queryBuilder.js';
import { safeFetch, validateUrl, SafeFetchError } from '../../utils/safeFetch.js';
import { scopeFilter } from '../leads/leadService.js';
import { recordAudit } from '../audit/auditService.js';
import { extractFacts, robotsDisallowsHome } from './htmlFacts.js';
import { runChecks, summarize } from './auditChecks.js';

const USER_AGENT = `LeadFlowAuditBot/1.0 (+${String(env.CLIENT_URL).split(',')[0]})`;
const BUDGET_MS = 25_000;
const MAX_LINKS = 8;
const HTML_TYPES = ['text/html', 'application/xhtml+xml'];

// Tests replace the network; production = SafeFetch.
let fetcher = (url, opts) => safeFetch(url, opts);
let checkUrl = (url) => validateUrl(url);
export function setAuditFetcher(fn, { validate } = {}) {
  fetcher = fn;
  if (validate) checkUrl = validate;
}

const FRIENDLY = {
  BLOCKED_ADDRESS: 'This website address points to a private/internal network and cannot be checked.',
  BLOCKED_PORT: 'Only standard web ports (80/443) can be checked.',
  BLOCKED_PROTOCOL: 'Only http/https websites can be checked.',
  BLOCKED_CREDENTIALS: 'Website addresses with a username/password are not allowed.',
  DNS_FAILED: 'The website address could not be found (domain does not exist?).',
  TIMEOUT: 'The website did not answer in time.',
  TOO_LARGE: 'The homepage is too large to check.',
  BLOCKED_CONTENT_TYPE: 'The address does not return a web page.',
  TOO_MANY_REDIRECTS: 'The website redirects too many times.',
  INVALID_URL: 'The website address is not valid.',
};
const friendly = (err) => (err instanceof SafeFetchError ? FRIENDLY[err.code] || 'The website could not be reached.' : 'The website could not be reached.');

async function timed(fn) {
  const t = Date.now();
  const r = await fn();
  return { r, ms: Date.now() - t };
}

/** Does http://host/ end up on https? true / false / null (unknown) */
async function probeHttpRedirect(host, deadline) {
  if (Date.now() > deadline) return null;
  try {
    const res = await fetcher(`http://${host}/`, { headers: { 'user-agent': USER_AGENT }, maxRedirects: 2, timeoutMs: 5000, maxBytes: 64 * 1024 });
    return /^https:\/\//i.test(res.url || '');
  } catch {
    return null; // couldn't test (e.g. port 80 closed) → we say nothing about it
  }
}

async function checkLinks(links, deadline) {
  const broken = [];
  let checked = 0;
  for (const url of links.slice(0, MAX_LINKS)) {
    if (Date.now() > deadline) break;
    try {
      let res = await fetcher(url, { method: 'HEAD', headers: { 'user-agent': USER_AGENT }, timeoutMs: 5000, maxBytes: 64 * 1024, maxRedirects: 3 });
      if ([405, 501].includes(res.status)) res = await fetcher(url, { headers: { 'user-agent': USER_AGENT }, timeoutMs: 5000, maxBytes: 64 * 1024, maxRedirects: 3 });
      checked += 1;
      if ([404, 410].includes(res.status) || res.status >= 500) broken.push({ url, status: res.status });
    } catch (err) {
      if (err instanceof SafeFetchError && ['BLOCKED_ADDRESS', 'BLOCKED_PORT', 'BLOCKED_PROTOCOL'].includes(err.code)) continue; // redirect to a forbidden place: skip, never follow
      checked += 1; // timeouts etc. are not counted as broken (could be our side)
    }
  }
  return { broken, checked };
}

async function doAudit(rawUrl) {
  const deadline = Date.now() + BUDGET_MS;
  let requests = 0;
  const start = await checkUrl(rawUrl); // SSRF check before anything else (throws SafeFetchError)
  const home = new URL('/', start.url).toString();

  // 1) robots.txt — be a polite bot
  try {
    requests += 1;
    const r = await fetcher(new URL('/robots.txt', start.url).toString(), { headers: { 'user-agent': USER_AGENT }, timeoutMs: 5000, maxBytes: 100 * 1024 });
    if (r.status === 200 && robotsDisallowsHome(r.text?.() ?? '')) return { blocked: true, requests };
  } catch {
    /* no robots.txt → allowed */
  }

  // 2) the homepage
  requests += 1;
  const { r: page, ms } = await timed(() => fetcher(home, { headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' }, timeoutMs: 15_000, maxBytes: 1_500_000, maxRedirects: 3, allowedContentTypes: HTML_TYPES }));
  if (page.status >= 400) return { httpStatus: page.status, finalUrl: page.url, requests, unreachable: true };
  const finalUrl = page.url || home;
  const html = page.text();
  const facts = extractFacts(html, finalUrl);

  // 3) does http:// go to https://?
  let httpRedirectsToHttps = null;
  if (/^https:/i.test(finalUrl)) {
    requests += 1;
    httpRedirectsToHttps = await probeHttpRedirect(new URL(finalUrl).host, deadline);
  }

  // 4) a few internal links
  const { broken, checked } = await checkLinks(facts.internalLinks, deadline);
  requests += checked;

  const checks = runChecks(facts, { finalUrl, responseMs: ms, htmlBytes: Buffer.byteLength(html), httpRedirectsToHttps, linksChecked: checked, brokenLinks: broken, now: new Date() });
  return { checks, finalUrl, httpStatus: page.status, responseMs: ms, requests };
}

export async function auditLead(auth, leadId, { url } = {}) {
  const lead = await Lead.findOne({ _id: leadId, ...scopeFilter(auth) });
  if (!lead) throw ApiError.notFound('Lead not found');
  const target = url || lead.website;
  if (!target) throw ApiError.badRequest('This lead has no website. Add it to the lead first.');

  await WebsiteAudit.updateMany({ leadId: lead._id, running: true, createdAt: { $lt: new Date(Date.now() - 2 * 60 * 1000) } }, { $set: { running: false, status: 'FAILED', error: 'Interrupted' } });
  let audit;
  try {
    audit = await WebsiteAudit.create({ leadId: lead._id, url: String(target).slice(0, 2048), createdBy: auth.userId });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('This website is being checked right now — please wait.');
    throw err;
  }

  try {
    const r = await doAudit(target);
    if (r.blocked) {
      audit.set({ status: 'BLOCKED_BY_ROBOTS', summary: 'The website asks automated tools not to visit it (robots.txt) — we respected that. Check it yourself in a browser.', requests: r.requests });
    } else if (r.unreachable) {
      audit.set({ status: 'FAILED', httpStatus: r.httpStatus, finalUrl: r.finalUrl, error: `The homepage answered with HTTP ${r.httpStatus}.`, requests: r.requests });
    } else {
      const settings = await TenantSettings.findOne({}).select('services');
      const s = summarize(r.checks, (settings?.services || []).map((x) => x.name));
      audit.set({ status: 'COMPLETED', finalUrl: r.finalUrl, httpStatus: r.httpStatus, responseMs: r.responseMs, checks: r.checks, requests: r.requests, ...s });
    }
  } catch (err) {
    audit.set({ status: 'FAILED', error: friendly(err) });
  }
  audit.running = false;
  await audit.save();
  if (audit.status === 'COMPLETED' && lead.score !== null) {
    const { rescoreLeadFromSaved } = await import('../ai/scoring/leadScoring.js');
    await rescoreLeadFromSaved(lead._id); // "website condition" factor changed → new score, no AI cost
  }
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'website_audit.run', targetType: 'Lead', targetId: lead._id, metadata: { status: audit.status, host: safeHost(target) } });
  return audit.toJSON();
}

const safeHost = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
};

export async function latestAuditFor(leadId) {
  return WebsiteAudit.findOne({ leadId, status: 'COMPLETED' }).sort({ createdAt: -1 });
}

export async function listLeadAudits(auth, leadId) {
  const lead = await Lead.findOne({ _id: leadId, ...scopeFilter(auth) }).select('_id');
  if (!lead) throw ApiError.notFound('Lead not found');
  const items = await WebsiteAudit.find({ leadId: lead._id, running: false }).sort({ createdAt: -1 }).limit(5);
  return items.map((a) => a.toJSON());
}

export async function listAudits(auth, { page, limit }) {
  const { skip } = buildPagination(page, limit);
  let filter = { running: false };
  if (Object.keys(scopeFilter(auth)).length) {
    const mine = await Lead.find(scopeFilter(auth)).select('_id').limit(5000);
    filter = { ...filter, leadId: { $in: mine.map((l) => l._id) } };
  }
  const [items, total] = await Promise.all([
    WebsiteAudit.find(filter).select('-checks -issues -recommendations').sort({ createdAt: -1 }).skip(skip).limit(limit).populate('leadId', 'name'),
    WebsiteAudit.countDocuments(filter),
  ]);
  return { items: items.map((a) => a.toJSON()), total };
}
