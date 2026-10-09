// PHASE 24 — ANALYTICS: funnel per source from real records, honest comparisons (no winner without enough
// data), revenue + AI cost per source, outreach reply rates, permissions, tenant isolation.
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import Lead from '../src/models/Lead.js';
import LeadActivity from '../src/models/LeadActivity.js';
import AiUsageLog from '../src/models/AiUsageLog.js';
import OutreachMessage from '../src/models/OutreachMessage.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem, runWithTenant } from '../src/utils/tenantContext.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}
const AN = '/api/v1/analytics';
const day = (d) => d.toISOString().slice(0, 10);

describe('Analytics', () => {
  let owner, sales, viewer, other;
  const ids = { CSV: [], GOOGLE_WEB: [], WEBHOOK: [] };
  const get = (u, url) => request(app).get(url).set(bearer(u.token));

  // n leads of one source; the first `contacted` get MESSAGE_SENT, first `replied` MESSAGE_REPLIED, first `converted` CONVERTED
  async function seed(tenantId, userId, source, n, contacted, replied, converted, createdAt = new Date()) {
    await runWithTenant({ tenantId }, async () => {
      const docs = await Lead.insertMany(Array.from({ length: n }, (_, i) => ({ name: `${source} lead ${i}`, source, status: i < converted ? 'CONVERTED' : 'NEW', score: i < converted ? 80 : 20, createdBy: userId, matchedKeyword: source === 'CSV' ? 'need website' : null })));
      await Lead.collection.updateMany({ _id: { $in: docs.map((d) => d._id) } }, { $set: { createdAt } });
      const acts = [];
      docs.forEach((d, i) => {
        if (i < contacted) acts.push({ leadId: d._id, type: 'MESSAGE_SENT', actorId: userId });
        if (i < replied) acts.push({ leadId: d._id, type: 'MESSAGE_REPLIED', actorId: userId });
      });
      if (acts.length) await LeadActivity.insertMany(acts);
      ids[source]?.push(...docs.map((d) => String(d._id)));
    });
  }

  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'growth');
    sales = await inviteAndAccept(owner, 'SALES');
    viewer = await inviteAndAccept(owner, 'VIEWER');
    other = await registerTenant();
    await seed(owner.tenant.id, owner.user.id, 'CSV', 40, 20, 10, 8);
    await seed(owner.tenant.id, owner.user.id, 'GOOGLE_WEB', 40, 20, 2, 0);
    await seed(owner.tenant.id, owner.user.id, 'WEBHOOK', 5, 5, 5, 5);
    await seed(owner.tenant.id, owner.user.id, 'INSTAGRAM', 6, 3, 1, 0, new Date(Date.now() - 200 * 86400000)); // old period
  });
  after(stopTestDb);

  it('who may see analytics: company-wide roles only (Sales 403, Viewer 200); bad ranges 400', async () => {
    assert.equal((await get(sales, `${AN}/overview`)).status, 403);
    assert.equal((await get(viewer, `${AN}/overview`)).status, 200);
    assert.equal((await get(owner, `${AN}/overview?from=2026-02-01&to=2026-02-31`)).status, 400);
    assert.equal((await get(owner, `${AN}/overview?from=2024-01-01&to=2026-01-01`)).status, 400, 'max 366 days');
    assert.equal((await get(owner, `${AN}/overview?from=2026-01-01&to=2025-01-01`)).status, 400);
  });

  let data;
  it('funnel per source is counted from real records (sent / replied activities, converted)', async () => {
    const r = await get(owner, `${AN}/overview`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    data = r.body.data;
    const csv = data.bySource.find((x) => x.key === 'CSV');
    assert.deepEqual([csv.leads, csv.contacted, csv.replied, csv.converted, csv.qualified], [40, 20, 10, 8, 8]);
    assert.equal(csv.conversionRate.rate, 20);
    assert.equal(csv.replyRate.rate, 50);
    assert.ok(!data.bySource.some((x) => x.key === 'INSTAGRAM'), 'leads from 200 days ago are outside the default 90 days');
    assert.equal(data.totals.leads, 85);
    assert.equal(data.byKeyword[0].key, 'need website');
    assert.ok(data.series.reduce((s, w) => s + w.leads, 0) === 85);
  });

  it('honest comparison: conversion → CLEAR winner (CSV); reply rate 50% vs 10% on 20 people → NO clear winner; tiny source ignored', () => {
    assert.equal(data.comparison.conversion.status, 'CLEAR');
    assert.equal(data.comparison.conversion.best, 'CSV');
    assert.equal(data.comparison.reply.status, 'NO_CLEAR_WINNER');
    assert.equal(data.comparison.reply.best, null);
    const webhook = data.bySource.find((x) => x.key === 'WEBHOOK');
    assert.equal(webhook.conversionRate.rate, 100);
    assert.equal(webhook.enoughData, false, '5 of 5 converted sounds great — but 5 leads prove nothing yet');
  });

  it('old period with little data → NOT_ENOUGH_DATA (never a fake "best source")', async () => {
    const from = day(new Date(Date.now() - 210 * 86400000));
    const to = day(new Date(Date.now() - 190 * 86400000));
    const r = (await get(owner, `${AN}/overview?from=${from}&to=${to}`)).body.data;
    assert.equal(r.totals.leads, 6);
    assert.equal(r.comparison.conversion.status, 'NOT_ENOUGH_DATA');
  });

  it('revenue per source follows lead → client → payments; AI cost per source and per qualified lead', async () => {
    const leadId = ids.CSV[0];
    const client = (await request(app).post(`/api/v1/clients/from-lead/${leadId}`).set(bearer(owner.token))).body.data.client;
    const inv = (await request(app).post('/api/v1/invoices').set(bearer(owner.token)).send({ clientId: client.id, lines: [{ description: 'Website', quantity: '1', unitPrice: '50000' }] })).body.data.invoice;
    await request(app).post(`/api/v1/invoices/${inv.id}/issue`).set(bearer(owner.token)).send({});
    await request(app).post(`/api/v1/invoices/${inv.id}/payments`).set(bearer(owner.token)).send({ amount: '50000', method: 'CASH' });
    await runWithTenant({ tenantId: owner.tenant.id }, () =>
      AiUsageLog.insertMany(ids.CSV.slice(0, 4).map((id) => ({ provider: 'OPENAI', model: 'test-model', requestType: 'LEAD_SCORING', keySource: 'TENANT', status: 'SUCCESS', estimatedCostUsd: 0.5, targetType: 'Lead', targetId: id })))
    );
    const r = (await get(owner, `${AN}/overview`)).body.data;
    const csv = r.bySource.find((x) => x.key === 'CSV');
    assert.equal(csv.revenue.USD ?? csv.revenue.PKR, 5000000);
    assert.equal(csv.aiCostUsd, 2);
    assert.equal(csv.aiCostPerQualifiedUsd, 0.25, '$2 / 8 qualified');
    assert.equal(r.totals.aiCostUsd, 2);
  });

  it('outreach: reply rate by channel with a sample-size flag', async () => {
    await runWithTenant({ tenantId: owner.tenant.id }, () =>
      OutreachMessage.insertMany([
        ...Array.from({ length: 12 }, (_, i) => ({ leadId: ids.GOOGLE_WEB[i], channel: 'EMAIL', origin: 'AI_GENERATED', status: i < 3 ? 'REPLIED' : 'SENT', openDraft: false, sentAt: new Date(), repliedAt: i < 3 ? new Date() : null, createdBy: owner.user.id, body: 'x' })),
        ...Array.from({ length: 3 }, (_, i) => ({ leadId: ids.GOOGLE_WEB[20 + i], channel: 'LINKEDIN', origin: 'MANUAL', status: 'REPLIED', openDraft: false, sentAt: new Date(), repliedAt: new Date(), createdBy: owner.user.id, body: 'x' })),
      ])
    );
    const r = (await get(owner, `${AN}/outreach`)).body.data;
    const email = r.byChannel.find((x) => x.key === 'EMAIL');
    assert.equal(email.sent, 12);
    assert.equal(email.replyRate.rate, 25);
    assert.equal(email.enoughData, true);
    const li = r.byChannel.find((x) => x.key === 'LINKEDIN');
    assert.equal(li.replyRate.rate, 100);
    assert.equal(li.enoughData, false, '3 messages are not enough to judge');
    assert.equal(r.totals.sent, 15);
  });

  it('isolation: another company sees only its own (empty) numbers', async () => {
    const r = (await get(other, `${AN}/overview`)).body.data;
    assert.equal(r.totals.leads, 0);
    assert.deepEqual(r.bySource, []);
    assert.equal((await get(other, `${AN}/outreach`)).body.data.totals.sent, 0);
  });
});
