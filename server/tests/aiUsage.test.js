// PHASE 26 — AI usage & cost dashboards: company report (time zone, breakdowns, filters), permissions,
// isolation, monthly budget (alerts once, hard stop), and the super admin's platform-wide view.
import './helpers/setupEnv.js';
import './helpers/aiEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import ModelPricing from '../src/models/ModelPricing.js';
import AiUsageLog from '../src/models/AiUsageLog.js';
import UsageCounter from '../src/models/UsageCounter.js';
import Notification from '../src/models/Notification.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { DEFAULT_MODEL_PRICING } from '../src/config/aiOptions.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { setAiTransport } from '../src/services/ai/providers.js';
import { zonedParts, zonedMidnight, zonedDayKey } from '../src/utils/zonedTime.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';
import { createAdmin, loginAdmin, adminBearer } from './helpers/adminHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const TZ = 'Asia/Karachi';
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}
const counter = async (tenantId, metric) => (await sys(() => UsageCounter.findOne({ tenantId, metric })))?.count || 0;

// fake AI provider (never a real call)
const fake = { calls: 0 };
const OUT = { language: 'English', summary: 'Wants a website.', facts: [], statedRequirement: { service: null, location: null, budget: null, timeline: null, size: null }, instructionsDetected: false };
setAiTransport(async () => {
  fake.calls += 1;
  return { status: 200, json: () => ({ choices: [{ message: { content: JSON.stringify(OUT) } }], usage: { prompt_tokens: 400, completion_tokens: 100 } }) };
});

/** Seed usage rows directly (exact dates/costs) — raw insert so createdAt is kept as given. */
async function seed(tenantId, rows) {
  const base = { provider: 'OPENAI', model: 'gpt-test', requestType: 'LEAD_SCORING', keySource: 'TENANT', inputTokens: 100, outputTokens: 50, totalTokens: 150, estimatedCostUsd: 0.01, status: 'SUCCESS', errorCode: null, attempts: 1, durationMs: 1000, targetType: null, targetId: null, userId: null };
  await AiUsageLog.collection.insertMany(rows.map((r) => ({ ...base, ...r, tenantId: oid(tenantId) })));
}

describe('AI usage & cost', () => {
  let owner, admin, manager, sales, other, budgetCo, superAdmin, leadId;
  const get = (u, url) => request(app).get(url).set(bearer(u.token));
  const R = '/api/v1/ai/usage';
  const now = new Date();
  const today = zonedDayKey(now, TZ);
  const p = zonedParts(now, TZ);
  const todayStart = zonedMidnight(p.year, p.month, p.day, TZ);
  const yesterday = zonedDayKey(new Date(todayStart.getTime() - 3600_000), TZ);

  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    await ModelPricing.insertMany(DEFAULT_MODEL_PRICING);
    await Plan.updateOne({ code: 'growth' }, { $set: { features: ['platform-ai'] } }); // fake platform key from aiEnv.js
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'growth');
    admin = await inviteAndAccept(owner, 'ADMIN');
    manager = await inviteAndAccept(owner, 'MANAGER');
    sales = await inviteAndAccept(owner, 'SALES');
    other = await registerTenant();
    budgetCo = await registerTenant();
    await usePlan(budgetCo.tenant.id, 'growth');
    superAdmin = await loginAdmin(await createAdmin());
    await request(app).patch('/api/v1/settings/general').set(bearer(owner.token)).send({ timezone: TZ });
    leadId = (await request(app).post('/api/v1/leads').set(bearer(owner.token)).send({ name: 'Cost lead', source: 'MANUAL' })).body.data.lead.id;

    await seed(owner.tenant.id, [
      // today (company time): 3 requests — 2 by the owner (one failed), 1 background job on the platform key
      { createdAt: new Date(todayStart.getTime() + 60_000), userId: oid(owner.user.id), estimatedCostUsd: 0.02, targetType: 'Lead', targetId: oid(leadId) },
      { createdAt: new Date(todayStart.getTime() + 120_000), userId: oid(owner.user.id), requestType: 'MESSAGE_GENERATION', status: 'FAILED', errorCode: 'RATE_LIMITED', attempts: 3, estimatedCostUsd: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0 },
      { createdAt: new Date(todayStart.getTime() + 180_000), keySource: 'PLATFORM', provider: 'ANTHROPIC', model: 'claude-test', estimatedCostUsd: 0.03, targetType: 'Lead', targetId: oid(leadId) },
      // one minute BEFORE local midnight → yesterday, even though in UTC it may be the same date
      { createdAt: new Date(todayStart.getTime() - 60_000), userId: oid(admin.user.id), requestType: 'REPLY_GENERATION', estimatedCostUsd: 0.04 },
    ]);
    // the other company keeps the default time zone (UTC) → use "now", which is "today" in every zone's own clock
    await seed(other.tenant.id, [{ createdAt: new Date(), estimatedCostUsd: 9 }]);
  });
  after(stopTestDb);

  it('who can see it: owner + admin yes; manager, sales 403; another company sees only its own', async () => {
    assert.equal((await get(owner, `${R}/summary`)).status, 200);
    assert.equal((await get(admin, `${R}/report?from=${yesterday}&to=${today}`)).status, 200);
    assert.equal((await get(manager, `${R}/summary`)).status, 403);
    assert.equal((await get(sales, `${R}/report?from=${yesterday}&to=${today}`)).status, 403);
    const o = (await get(other, `${R}/summary`)).body.data;
    assert.equal(o.today.requests, 1);
    assert.equal(o.today.costUsd, 9);
  });

  it('summary: "today" follows the company time zone; budget NONE; plan quota rows', async () => {
    const s = (await get(owner, `${R}/summary`)).body.data;
    assert.equal(s.timezone, TZ);
    assert.equal(s.today.requests, 3, 'the row one minute before local midnight is yesterday');
    assert.equal(s.today.failed, 1);
    assert.equal(s.today.costUsd, 0.05);
    assert.equal(s.budget.level, 'NONE');
    assert.equal(s.quota.aiRequests.unlimited, false);
    assert.ok(s.quota.aiTokens.limit > 0);
  });

  it('report: totals, breakdowns that add up, people, key split, errors, daily series, top leads', async () => {
    const r = (await get(owner, `${R}/report?from=${yesterday}&to=${today}`)).body.data;
    assert.equal(r.totals.requests, 4);
    assert.equal(r.totals.costUsd, 0.09);
    assert.equal(r.totals.failureRate, 25);
    assert.equal(r.totals.retries, 2, 'one request needed 3 attempts');
    assert.equal(r.byType.reduce((s, x) => s + x.requests, 0), 4);
    assert.equal(Math.round(r.byType.reduce((s, x) => s + x.costShare, 0)), 100);
    assert.deepEqual(r.byKey.map((k) => [k.key, k.costUsd]).sort(), [['PLATFORM', 0.03], ['TENANT', 0.06]]);
    assert.ok(r.byModel.some((m) => m.provider === 'ANTHROPIC' && m.model === 'claude-test'));
    const names = r.byUser.map((u) => u.name);
    assert.ok(names.includes('System (background job)'), 'requests without a person are shown honestly');
    assert.equal(r.byUser.find((u) => u.userId === owner.user.id).requests, 2);
    assert.deepEqual(r.errors, [{ code: 'RATE_LIMITED', count: 1 }]);
    assert.deepEqual(r.daily.map((d) => [d.day, d.requests]), [[yesterday, 1], [today, 3]]);
    assert.equal(r.topLeads[0].name, 'Cost lead');
    assert.equal(r.topLeads[0].costUsd, 0.05);
  });

  it('report + list validation; list filters', async () => {
    assert.equal((await get(owner, `${R}/report?from=${today}&to=${yesterday}`)).status, 400);
    assert.equal((await get(owner, `${R}/report?from=2024-01-01&to=${today}`)).status, 400, 'max 366 days');
    assert.equal((await get(owner, `${R}/report?from=${today}`)).status, 400);
    assert.equal((await get(owner, `${R}?status[$ne]=SUCCESS`)).status, 400);
    assert.equal((await get(owner, `${R}?requestType=HACK`)).status, 400);
    const failed = (await get(owner, `${R}?status=FAILED`)).body.data.items;
    assert.equal(failed.length, 1);
    assert.equal(failed[0].errorCode, 'RATE_LIMITED');
    assert.equal((await get(owner, `${R}?userId=${admin.user.id}`)).body.data.items.length, 1);
    assert.equal((await get(owner, `${R}?keySource=PLATFORM`)).body.data.items.length, 1);
    assert.equal((await get(owner, `${R}?from=${today}&to=${today}`)).body.data.items.length, 3, 'day filter in company time');
  });

  it('budget settings are validated (no negative budget, alert 50–100%)', async () => {
    const S = '/api/v1/settings/ai';
    assert.equal((await request(app).patch(S).set(bearer(owner.token)).send({ monthlyBudgetUsd: -1 })).status, 400);
    assert.equal((await request(app).patch(S).set(bearer(owner.token)).send({ budgetAlertPercent: 40 })).status, 400);
    assert.equal((await request(app).patch(S).set(bearer(sales.token)).send({ monthlyBudgetUsd: 5 })).status, 403);
    const r = await request(app).patch(S).set(bearer(owner.token)).send({ monthlyBudgetUsd: 0 });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.settings.ai.monthlyBudgetUsd, null, '0 = no budget');
  });

  it('budget: WARN alert once, EXCEEDED alert once, then hard stop → 402 with no AI call and no quota used', async () => {
    const b = budgetCo;
    const lead = (await request(app).post('/api/v1/leads').set(bearer(b.token)).send({ name: 'Budget lead', source: 'MANUAL', evidence: 'Need a new website for my bakery in Lahore' })).body.data.lead.id;
    const run = () => request(app).post(`/api/v1/leads/${lead}/ai/evidence-facts`).set(bearer(b.token)).send({ force: true });
    const first = await run();
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const c = first.body.data.analysis.usage.costUsd;
    assert.ok(c > 0);
    // budget = 2.2 × one request: after 2 requests = 91% (WARN), after 3 = 136% (EXCEEDED)
    await request(app).patch('/api/v1/settings/ai').set(bearer(b.token)).send({ monthlyBudgetUsd: c * 2.2, budgetAlertPercent: 80 });
    assert.equal((await run()).status, 200);
    const alerts = () => sys(() => Notification.find({ tenantId: b.tenant.id, type: 'AI_BUDGET' }).lean());
    assert.equal((await alerts()).length, 1);
    assert.match((await alerts())[0].title, /90\.9% of the/);
    assert.equal((await run()).status, 200, 'no hard stop → still works');
    assert.equal((await alerts()).length, 2);
    assert.equal((await run()).status, 200);
    assert.equal((await alerts()).length, 2, 'no repeated alerts in the same month');
    const s = (await get(b, `${R}/summary`)).body.data;
    assert.equal(s.budget.level, 'EXCEEDED');
    assert.equal(s.budget.remainingUsd, 0);

    await request(app).patch('/api/v1/settings/ai').set(bearer(b.token)).send({ budgetHardStop: true });
    const calls = fake.calls;
    const reqs = await counter(b.tenant.id, 'aiRequests');
    const stopped = await run();
    assert.equal(stopped.status, 402);
    assert.equal(stopped.body.errors[0].code, 'AI_BUDGET_REACHED');
    assert.equal(fake.calls, calls, 'the AI provider was not called');
    assert.equal(await counter(b.tenant.id, 'aiRequests'), reqs, 'no plan quota used');
    await request(app).patch('/api/v1/settings/ai').set(bearer(b.token)).send({ monthlyBudgetUsd: c * 100 });
    assert.equal((await run()).status, 200, 'raising the budget unblocks');
  });

  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const utcToday = new Date().toISOString().slice(0, 10);
  it('super admin: all companies, platform-key cost, one company filter; company token refused', async () => {
    const A = '/api/v1/super-admin/ai-usage';
    assert.equal((await get(owner, `${A}?from=${yesterday}&to=${today}`)).status, 401);
    assert.equal((await request(app).get(`${A}?from=${today}&to=${yesterday}`).set(adminBearer(superAdmin))).status, 400);
    const r = await request(app).get(`${A}?from=${monthAgo}&to=${utcToday}`).set(adminBearer(superAdmin));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = r.body.data;
    assert.ok(d.totals.activeTenants >= 3);
    assert.ok(d.byTenant.some((t) => t.tenantId === other.tenant.id && t.costUsd === 9));
    assert.ok(d.byKey.some((k) => k.key === 'PLATFORM' && k.platformCostUsd > 0));
    assert.ok(d.platformKeyThisMonth.costUsd > 0);
    const one = (await request(app).get(`${A}?from=${monthAgo}&to=${utcToday}&tenantId=${other.tenant.id}`).set(adminBearer(superAdmin))).body.data;
    assert.equal(one.totals.requests, 1);
    assert.equal(one.byTenant.length, 1);
  });
});
