// PHASE 16 — WEBSITE AUDIT (network replaced by a fake; the SSRF address check is the REAL one)
import './helpers/setupEnv.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import ModelPricing from '../src/models/ModelPricing.js';
import Lead from '../src/models/Lead.js';
import AiAnalysis from '../src/models/AiAnalysis.js';
import WebsiteAudit from '../src/models/WebsiteAudit.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { DEFAULT_MODEL_PRICING } from '../src/config/aiOptions.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { validateUrl } from '../src/utils/safeFetch.js';
import { setAuditFetcher } from '../src/services/websiteAudit/websiteAuditService.js';
import { setAiTransport } from '../src/services/ai/providers.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}

const GOOD = `<html lang="en"><head><title>Good Bakery — Fresh bread in Lahore</title>
<meta name="description" content="Good Bakery bakes fresh bread and cakes every day in Gulberg, Lahore. Order online today.">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta property="og:title" content="Good Bakery">
<script type="application/ld+json">{}</script></head><body><h1>Good Bakery</h1><a href="/menu">Menu</a>
<a href="tel:+923001112223">Call us</a><a href="/order">Order online</a><footer>© 2026</footer></body></html>`;
const BAD = `<html><head><title>Home</title></head><body><a href="/about">About</a><a href="/old">Old page</a><p>Copyright 2015</p></body></html>`;

// fake web: host → { path → response }
const sites = {};
const calls = [];
let delayMs = 0;
const resp = (status, body = '', url, headers = {}) => ({ status, url, headers, text: () => body });
setAuditFetcher(
  async (url, opts) => {
    calls.push({ url, ua: opts.headers?.['user-agent'], method: opts.method || 'GET' });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const u = new URL(url);
    const site = sites[u.host];
    if (!site) return resp(404, '', url);
    if (u.protocol === 'http:' && site.redirectHttp) return resp(200, '', `https://${u.host}/`);
    const r = site[u.pathname];
    return r ? resp(r.status ?? 200, r.body ?? '', url) : resp(404, '', url);
  },
  {
    // REAL SafeFetch address rules; only the DNS lookup is faked (tests have no internet)
    validate: (u) => validateUrl(u, { resolve: async (host) => (host === 'rebind.example' ? [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]) }),
  }
);
sites['goodbakery.pk'] = { redirectHttp: true, '/': { body: GOOD }, '/robots.txt': { body: 'User-agent: *\nDisallow: /admin' }, '/menu': {}, '/order': {} };
sites['badbakery.pk'] = { '/': { body: BAD }, '/about': {}, '/old': { status: 404 } };
sites['private.pk'] = { '/': { body: GOOD }, '/robots.txt': { body: 'User-agent: *\nDisallow: /' } };
sites['down.pk'] = { '/': { status: 503 } };

const aiCalls = [];
setAiTransport(async (url, req) => {
  aiCalls.push(req);
  return { status: 200, json: () => ({ choices: [{ message: { content: JSON.stringify({ subject: null, body: 'Hi, I noticed your homepage has no mobile viewport tag, so it may not display well on phones. We can help.', personalization: [{ statement: 'Your site may not work well on phones', quote: 'No mobile viewport tag found' }] }) } }], usage: { prompt_tokens: 400, completion_tokens: 80 } }) };
});

describe('Website audit', () => {
  let owner, sales, viewer, other, good, bad;
  const mk = async (u, body) => (await request(app).post('/api/v1/leads').set(bearer(u.token)).send(body)).body.data.lead.id;
  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    await ModelPricing.insertMany(DEFAULT_MODEL_PRICING);
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'growth');
    sales = await inviteAndAccept(owner, 'SALES');
    viewer = await inviteAndAccept(owner, 'VIEWER');
    other = await registerTenant();
    await request(app).patch('/api/v1/settings/services').set(bearer(owner.token)).send({ services: [{ name: 'Website Development' }, { name: 'SEO' }, { name: 'Plot Sales' }] });
    good = await mk(owner, { name: 'Good Bakery', website: 'https://goodbakery.pk' });
    bad = await mk(owner, { name: 'Bad Bakery', website: 'http://badbakery.pk', evidence: 'Bakery in Lahore' });
  });
  after(stopTestDb);
  beforeEach(() => {
    calls.length = 0;
    delayMs = 0;
  });
  const audit = (u, id) => request(app).post(`/api/v1/leads/${id}/website-audit`).set(bearer(u.token)).send();

  it('a good website is reported as GOOD (no invented problems); robots.txt read first; our bot name is sent', async () => {
    const res = await audit(owner, good);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const a = res.body.data.audit;
    assert.equal(a.status, 'COMPLETED');
    assert.equal(a.looksGood, true);
    assert.match(a.summary, /looks good/);
    assert.ok(a.score >= 90);
    assert.deepEqual(a.potentialServices, []);
    assert.equal(calls[0].url, 'https://goodbakery.pk/robots.txt');
    assert.ok(calls.every((c) => /^LeadFlowAuditBot\/1\.0/.test(c.ua)));
    assert.ok(calls.length <= 11, 'polite: few requests');
    assert.ok(!JSON.stringify(a).includes('<html'), 'the page itself is never stored');
  });

  it('a weak website: each issue has observed evidence; services from YOUR list; recommendations', async () => {
    const res = await audit(owner, bad);
    const a = res.body.data.audit;
    assert.equal(a.status, 'COMPLETED');
    assert.equal(a.looksGood, false);
    const failed = a.checks.filter((c) => c.status === 'FAIL').map((c) => c.id);
    for (const id of ['https', 'description', 'viewport', 'brokenLinks']) assert.ok(failed.includes(id), id);
    assert.match(a.checks.find((c) => c.id === 'brokenLinks').evidence, /\/old \(404\)/);
    assert.deepEqual(a.potentialServices.sort(), ['SEO', 'Website Development']);
    assert.ok(!a.potentialServices.includes('Plot Sales'));
  });

  it('robots.txt says "no bots" → we do not open the homepage', async () => {
    const id = await mk(owner, { name: 'Private', website: 'https://private.pk' });
    const res = await audit(owner, id);
    assert.equal(res.body.data.audit.status, 'BLOCKED_BY_ROBOTS');
    assert.deepEqual(calls.map((c) => c.url), ['https://private.pk/robots.txt']);
  });

  it('SSRF: private IPs, localhost, odd ports and DNS that mixes in a private IP are refused BEFORE any request', async () => {
    const id = await mk(owner, { name: 'Internal' });
    for (const site of ['http://127.0.0.1', 'http://169.254.169.254/latest/meta-data', 'http://localhost', 'http://10.0.0.1', 'https://rebind.example', 'http://goodbakery.pk:8080']) {
      await sys(() => Lead.updateOne({ _id: id }, { $set: { website: site } }));
      const res = await audit(owner, id);
      assert.equal(res.body.data.audit.status, 'FAILED', site);
      assert.match(res.body.data.audit.error, /private|internal|ports/i, site);
    }
    assert.equal(calls.length, 0);
  });

  it('website down (HTTP 503) → FAILED with a clear reason; lead without website → 400', async () => {
    const id = await mk(owner, { name: 'Down', website: 'https://down.pk' });
    const res = await audit(owner, id);
    assert.equal(res.body.data.audit.status, 'FAILED');
    assert.match(res.body.data.audit.error, /503/);
    const none = await mk(owner, { name: 'No site' });
    assert.equal((await audit(owner, none)).status, 400);
  });

  it('one audit at a time per lead (double click → 409)', async () => {
    delayMs = 60;
    const [a, b] = await Promise.all([audit(owner, good), audit(owner, good)]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
  });

  it('RBAC / isolation: Viewer cannot run audits; Sales cannot audit a colleague\'s lead; other company 404; list scoped', async () => {
    assert.equal((await audit(viewer, good)).status, 403);
    assert.equal((await audit(sales, good)).status, 404);
    assert.equal((await audit(other, good)).status, 404);
    assert.equal((await request(app).get(`/api/v1/leads/${good}/website-audits`).set(bearer(other.token))).status, 404);
    assert.equal((await request(app).get('/api/v1/website-audits').set(bearer(other.token))).body.data.items.length, 0);
    assert.equal((await request(app).get('/api/v1/website-audits').set(bearer(sales.token))).body.data.items.length, 0, 'none of their leads');
    const list = await request(app).get('/api/v1/website-audits').set(bearer(owner.token));
    assert.ok(list.body.data.items.length >= 3);
    assert.equal(list.body.data.items[0].checks, undefined, 'list is light');
  });

  it('scoring: the audit feeds "Website condition" and the score is refreshed with NO AI call', async () => {
    const factors = Object.fromEntries(['explicitBuyerIntent', 'businessRelevance', 'serviceMatch', 'publicActivity', 'evidenceStrength'].map((k) => [k, { value: 3, reason: 'r', quote: null, source: 'AI', unsupported: false }]));
    await sys(() => AiAnalysis.create({ tenantId: owner.tenant.id, leadId: bad, type: 'LEAD_SCORE', status: 'COMPLETED', inputHash: 'x', result: { factors, intent: 'LOW', leadType: 'GENERAL_PROSPECT', potentialService: null, recommendedAction: null } }));
    await sys(() => Lead.updateOne({ _id: bad }, { $set: { score: 1 } }));
    const before = aiCalls.length;
    await audit(owner, bad);
    const lead = await sys(() => Lead.findById(bad));
    assert.notEqual(lead.score, 1);
    const s = await request(app).get(`/api/v1/leads/${bad}/ai/score`).set(bearer(owner.token));
    assert.ok(s.body.data.analysis.breakdown.factors.websiteCondition.value >= 5, 'weak site = bigger opportunity');
    assert.equal(aiCalls.length, before);
  });

  it('messages: OBSERVED audit findings go to the AI as data, and a statement quoting them counts as verified', async () => {
    await request(app).put('/api/v1/integrations/OPENAI').set(bearer(owner.token)).send({ credentials: { apiKey: `sk-${'a'.repeat(40)}` } });
    const res = await request(app).post('/api/v1/messages/generate').set(bearer(owner.token)).send({ leadId: bad, channel: 'GENERAL' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(aiCalls.at(-1).body.messages[1].content, /<data name="website_audit">[\s\S]*No mobile viewport tag found/);
    assert.equal(res.body.data.message.claims[0].verified, true);
    assert.equal(await sys(() => WebsiteAudit.countDocuments({ running: true })), 0);
  });
});
