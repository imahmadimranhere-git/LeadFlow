// PHASE 6 — SUBSCRIPTIONS, PLAN LIMITS, PAYMENTS & WEBHOOKS
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Tenant from '../src/models/Tenant.js';
import Subscription from '../src/models/Subscription.js';
import PlatformInvoice from '../src/models/PlatformInvoice.js';
import Payment from '../src/models/Payment.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem, runWithTenant } from '../src/utils/tenantContext.js';
import { runBillingCycle } from '../src/services/billing/subscriptionService.js';
import { consumeQuota } from '../src/services/billing/quotaService.js';
import { registerProvider } from '../src/services/billing/providers/index.js';
import { signWebhook, verifyWebhookSignature } from '../src/utils/webhookSignature.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { createAdmin, loginAdmin, adminBearer } from './helpers/adminHelpers.js';
import { bearer, registerTenant, inviteAndAccept, uniqueEmail } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
const ADMIN = '/api/v1/super-admin';
const DAY = 24 * 60 * 60 * 1000;

async function planByCode(code) {
  return Plan.findOne({ code });
}
async function subOf(tenantId) {
  return sys(() => Subscription.findOne({ tenantId }));
}
async function checkout(owner, code, billingCycle = 'MONTHLY') {
  const plan = await planByCode(code);
  return request(app).post('/api/v1/billing/checkout').set(bearer(owner.token)).send({ planId: String(plan._id), billingCycle });
}
async function adminPay(admin, invoiceId, method = 'BANK_TRANSFER') {
  return request(app).post(`${ADMIN}/invoices/${invoiceId}/mark-paid`).set(adminBearer(admin)).send({ method, reference: 'TXN-123' });
}

describe('Subscriptions: trial, checkout and manual payment', () => {
  let admin, owner;
  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    admin = await loginAdmin(await createAdmin());
    owner = await registerTenant();
  });
  after(stopTestDb);

  it('signup starts a TRIAL subscription on the Free Trial plan', async () => {
    const res = await request(app).get('/api/v1/billing').set(bearer(owner.token));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.subscription.status, 'TRIALING');
    assert.equal(res.body.data.plan.code, 'free-trial');
  });

  it('usage shows the plan limits (1 of 2 users)', async () => {
    const res = await request(app).get('/api/v1/billing/usage').set(bearer(owner.token));
    const users = res.body.data.rows.find((r) => r.metric === 'users');
    assert.equal(users.used, 1);
    assert.equal(users.limit, 2);
  });

  it('a SALES user cannot open billing', async () => {
    const sales = await inviteAndAccept(owner, 'SALES');
    assert.equal((await request(app).get('/api/v1/billing').set(bearer(sales.token))).status, 403);
  });

  it('checkout: price comes from the PLAN, never from the browser', async () => {
    const plan = await planByCode('starter');
    const cheat = await request(app)
      .post('/api/v1/billing/checkout')
      .set(bearer(owner.token))
      .send({ planId: String(plan._id), billingCycle: 'MONTHLY', amountMinor: 1 });
    assert.equal(cheat.status, 400, 'extra amount field must be rejected');

    const res = await checkout(owner, 'starter');
    assert.equal(res.status, 201);
    assert.equal(res.body.data.invoice.amountMinor, 2900);
    assert.equal(res.body.data.invoice.currency, 'USD');
    assert.equal(res.body.data.checkout.type, 'MANUAL');
    assert.ok(res.body.data.checkout.instructions);
  });

  it('double-click on checkout returns the SAME invoice (no duplicates)', async () => {
    const [a, b] = await Promise.all([checkout(owner, 'starter'), checkout(owner, 'starter')]);
    assert.equal(a.body.data.invoice.number, b.body.data.invoice.number);
    const open = await sys(() => PlatformInvoice.countDocuments({ tenantId: owner.tenant.id, status: 'OPEN' }));
    assert.equal(open, 1);
  });

  it('choosing another plan voids the old open invoice', async () => {
    const res = await checkout(owner, 'growth', 'YEARLY');
    assert.equal(res.body.data.invoice.amountMinor, 79000);
    const open = await sys(() => PlatformInvoice.find({ tenantId: owner.tenant.id, status: 'OPEN' }));
    assert.equal(open.length, 1);
    assert.equal(open[0].billingCycle, 'YEARLY');
  });

  it('hidden or inactive plans cannot be bought', async () => {
    assert.equal((await checkout(owner, 'enterprise')).status, 400);
    const starter = await planByCode('starter');
    await Plan.updateOne({ _id: starter._id }, { $set: { isActive: false } });
    assert.equal((await checkout(owner, 'starter')).status, 400);
    await Plan.updateOne({ _id: starter._id }, { $set: { isActive: true } });
  });

  it('admin "mark as paid" activates the plan; clicking twice records ONE payment', async () => {
    const res = await checkout(owner, 'starter');
    const invoiceId = res.body.data.invoice.id;
    const [p1, p2] = await Promise.all([adminPay(admin, invoiceId), adminPay(admin, invoiceId)]);
    assert.equal(p1.status, 200);
    assert.equal(p2.status, 200);
    assert.equal(await sys(() => Payment.countDocuments({ invoiceId })), 1);

    const sub = await subOf(owner.tenant.id);
    assert.equal(sub.status, 'ACTIVE');
    assert.equal(String(sub.planId), String((await planByCode('starter'))._id));
    assert.ok(sub.currentPeriodEnd.getTime() > Date.now() + 27 * DAY);
    assert.equal((await Tenant.findById(owner.tenant.id)).status, 'ACTIVE');
  });

  it('a paid invoice cannot be voided', async () => {
    const paid = await sys(() => PlatformInvoice.findOne({ tenantId: owner.tenant.id, status: 'PAID' }));
    const res = await request(app).post(`${ADMIN}/invoices/${paid._id}/void`).set(adminBearer(admin)).send({ reason: 'test' });
    assert.equal(res.status, 409);
  });

  it('super admin dashboard shows MRR from active subscriptions', async () => {
    const res = await request(app).get(`${ADMIN}/dashboard`).set(adminBearer(admin));
    assert.equal(res.body.data.mrr.USD, 2900);
    assert.equal(res.body.data.revenue30d.USD, 2900);
  });
});

describe('Billing lifecycle (scheduled job)', () => {
  let admin;
  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    admin = await loginAdmin(await createAdmin());
  });
  after(stopTestDb);

  it('trial ends → PAST_DUE (still usable) → grace ends → SUSPENDED (owner: billing only, others: blocked)', async () => {
    const owner = await registerTenant();
    const sales = await inviteAndAccept(owner, 'SALES');
    await sys(() => Subscription.updateOne({ tenantId: owner.tenant.id }, { $set: { trialEndsAt: new Date(Date.now() - DAY) } }));

    await sys(() => runBillingCycle(new Date()));
    assert.equal((await subOf(owner.tenant.id)).status, 'PAST_DUE');
    assert.equal((await request(app).get('/api/v1/users').set(bearer(owner.token))).status, 200, 'grace period = still usable');

    await sys(() => Subscription.updateOne({ tenantId: owner.tenant.id }, { $set: { graceEndsAt: new Date(Date.now() - 1000) } }));
    await sys(() => runBillingCycle(new Date()));
    assert.equal((await subOf(owner.tenant.id)).status, 'SUSPENDED');

    const me = await request(app).get('/api/v1/auth/me').set(bearer(owner.token));
    assert.equal(me.status, 200);
    assert.equal(me.body.data.access, 'BILLING_ONLY');
    assert.equal((await request(app).get('/api/v1/users').set(bearer(owner.token))).status, 402);
    assert.equal((await request(app).get('/api/v1/billing').set(bearer(owner.token))).status, 200);
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(sales.token))).status, 403);

    // owner pays → everything unlocks
    const inv = await checkout(owner, 'starter');
    await adminPay(admin, inv.body.data.invoice.id);
    assert.equal((await request(app).get('/api/v1/users').set(bearer(owner.token))).status, 200);
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(sales.token))).status, 200);
  });

  it('paying does NOT lift a suspension made by the platform admin', async () => {
    const owner = await registerTenant();
    const inv = await checkout(owner, 'starter');
    await request(app).patch(`${ADMIN}/tenants/${owner.tenant.id}/status`).set(adminBearer(admin)).send({ status: 'SUSPENDED', reason: 'Fraud check' });
    await adminPay(admin, inv.body.data.invoice.id);
    const tenant = await Tenant.findById(owner.tenant.id);
    assert.equal(tenant.status, 'SUSPENDED');
    assert.equal(tenant.suspensionType, 'ADMIN');
  });

  it('period ends → ONE renewal invoice (even if the job runs twice) → paying extends the period', async () => {
    const owner = await registerTenant();
    const first = await checkout(owner, 'starter');
    await adminPay(admin, first.body.data.invoice.id);
    const periodEnd = new Date(Date.now() - 1000);
    await sys(() => Subscription.updateOne({ tenantId: owner.tenant.id }, { $set: { currentPeriodEnd: periodEnd } }));

    await sys(() => runBillingCycle(new Date()));
    await sys(() => runBillingCycle(new Date()));
    const renewals = await sys(() => PlatformInvoice.find({ tenantId: owner.tenant.id, kind: 'RENEWAL' }));
    assert.equal(renewals.length, 1);
    assert.equal((await subOf(owner.tenant.id)).status, 'PAST_DUE');

    await adminPay(admin, renewals[0]._id);
    const sub = await subOf(owner.tenant.id);
    assert.equal(sub.status, 'ACTIVE');
    assert.equal(sub.currentPeriodStart.getTime(), periodEnd.getTime());
    assert.ok(sub.currentPeriodEnd > new Date());
  });

  it('cancel at period end → CANCELLED and locked out when the period ends', async () => {
    const owner = await registerTenant();
    const inv = await checkout(owner, 'starter');
    await adminPay(admin, inv.body.data.invoice.id);
    assert.equal((await request(app).post('/api/v1/billing/cancel').set(bearer(owner.token)).send({ reason: 'Too expensive' })).status, 200);
    await sys(() => Subscription.updateOne({ tenantId: owner.tenant.id }, { $set: { currentPeriodEnd: new Date(Date.now() - 1000) } }));
    await sys(() => runBillingCycle(new Date()));
    assert.equal((await subOf(owner.tenant.id)).status, 'CANCELLED');
    const login = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: owner.password });
    assert.equal(login.status, 403);
  });

  it('admin can override a subscription (e.g. Enterprise deal), but not with a past date', async () => {
    const owner = await registerTenant();
    const ent = await planByCode('enterprise');
    const url = `${ADMIN}/tenants/${owner.tenant.id}/subscription`;
    const past = await request(app).post(url).set(adminBearer(admin)).send({
      planId: String(ent._id), status: 'ACTIVE', billingCycle: 'YEARLY', currentPeriodEnd: '2020-01-01', reason: 'deal',
    });
    assert.equal(past.status, 400);
    const ok = await request(app).post(url).set(adminBearer(admin)).send({
      planId: String(ent._id), status: 'ACTIVE', billingCycle: 'YEARLY',
      currentPeriodEnd: new Date(Date.now() + 365 * DAY).toISOString(), reason: 'Signed enterprise contract',
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.subscription.planId.code, 'enterprise');
    assert.equal((await Tenant.findById(owner.tenant.id)).status, 'ACTIVE');
  });
});

describe('Plan limits', () => {
  let owner, tinyPlan;
  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    tinyPlan = await Plan.create({
      ...DEFAULT_PLANS[1], code: 'tiny', name: 'Tiny',
      limits: { ...DEFAULT_PLANS[1].limits, leadsPerMonth: 5, aiRequestsPerMonth: -1 },
    });
    owner = await registerTenant();
    await sys(() => Subscription.updateOne({ tenantId: owner.tenant.id }, { $set: { planId: tinyPlan._id } }));
  });
  after(stopTestDb);

  const asOwner = (fn) => runWithTenant({ tenantId: owner.tenant.id }, fn);

  it('RACE: 20 parallel requests with 5 slots left → exactly 5 succeed', async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => asOwner(() => consumeQuota(owner.tenant.id, 'leads'))));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const blocked = results.filter((r) => r.status === 'rejected' && r.reason.statusCode === 402).length;
    assert.equal(ok, 5);
    assert.equal(blocked, 15);
  });

  it('limit error is 402 with a clear upgrade message', async () => {
    await assert.rejects(() => asOwner(() => consumeQuota(owner.tenant.id, 'leads')), (err) => {
      assert.equal(err.statusCode, 402);
      assert.match(err.message, /upgrade/i);
      assert.equal(err.errors[0].code, 'PLAN_LIMIT_REACHED');
      return true;
    });
  });

  it('unlimited (-1) never blocks', async () => {
    for (let i = 0; i < 30; i += 1) await asOwner(() => consumeQuota(owner.tenant.id, 'aiRequests'));
  });

  it('usage page reflects consumed quota', async () => {
    const res = await request(app).get('/api/v1/billing/usage').set(bearer(owner.token));
    const leads = res.body.data.rows.find((r) => r.metric === 'leads');
    assert.equal(leads.used, 5);
    assert.equal(leads.limit, 5);
  });

  it('users limit: Free Trial allows 2 users — 1 invite OK, the next is blocked', async () => {
    const other = await registerTenant(); // free-trial: users = 2
    const ok = await request(app).post('/api/v1/invitations').set(bearer(other.token)).send({ email: uniqueEmail(), role: 'SALES' });
    assert.equal(ok.status, 201);
    const blocked = await request(app).post('/api/v1/invitations').set(bearer(other.token)).send({ email: uniqueEmail(), role: 'SALES' });
    assert.equal(blocked.status, 402);
  });
});

describe('Payment webhooks', () => {
  const SECRET = 'whsec_test_secret_value';
  let owner, invoice;

  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    // A stand-in for a real gateway adapter (e.g. Safepay) — same interface a real one implements
    registerProvider({
      name: 'SAFEPAY',
      supportsWebhooks: true,
      async createCheckout() {
        return { type: 'REDIRECT', url: 'https://example.test/pay' };
      },
      verifyWebhook(raw, headers) {
        verifyWebhookSignature({ rawBody: raw.toString('utf8'), header: headers['x-signature'], secret: SECRET });
        const e = JSON.parse(raw.toString('utf8'));
        return { id: e.id, type: e.type, invoiceNumber: e.invoice, providerPaymentId: e.payment_id, amountMinor: e.amount, currency: e.currency };
      },
    });
    owner = await registerTenant();
    invoice = (await checkout(owner, 'starter')).body.data.invoice;
  });
  after(stopTestDb);

  const send = (body, { signature, provider = 'safepay' } = {}) => {
    const raw = JSON.stringify(body);
    return request(app)
      .post(`/api/v1/webhooks/payments/${provider}`)
      .set('Content-Type', 'application/json')
      .set('x-signature', signature ?? signWebhook(SECRET, raw))
      .send(raw);
  };
  const event = (overrides = {}) => ({
    id: `evt_${Math.random().toString(36).slice(2)}`, type: 'payment.succeeded', invoice: invoice.number,
    payment_id: 'pay_001', amount: 2900, currency: 'USD', ...overrides,
  });

  it('rejects a forged signature', async () => {
    const res = await send(event(), { signature: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` });
    assert.equal(res.status, 400);
    assert.equal((await sys(() => PlatformInvoice.findById(invoice.id))).status, 'OPEN');
  });

  it('rejects an old (replayed) signature timestamp', async () => {
    const body = event();
    const raw = JSON.stringify(body);
    const old = signWebhook(SECRET, raw, Math.floor(Date.now() / 1000) - 3600);
    assert.equal((await send(body, { signature: old })).status, 400);
  });

  it('rejects a payment amount that does not match the invoice', async () => {
    const res = await send(event({ amount: 100, payment_id: 'pay_cheap' }));
    assert.equal(res.status, 400);
    assert.equal((await sys(() => PlatformInvoice.findById(invoice.id))).status, 'OPEN');
  });

  it('a valid signed event pays the invoice', async () => {
    const res = await send(event({ id: 'evt_real_1' }));
    assert.equal(res.status, 200);
    assert.equal((await sys(() => PlatformInvoice.findById(invoice.id))).status, 'PAID');
    assert.equal((await subOf(owner.tenant.id)).status, 'ACTIVE');
  });

  it('the same event delivered again is ignored (no double payment)', async () => {
    const res = await send(event({ id: 'evt_real_1' }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.duplicate, true);
    assert.equal(await sys(() => Payment.countDocuments({ invoiceId: invoice.id })), 1);
  });

  it('unknown providers and the manual provider have no webhook endpoint', async () => {
    assert.equal((await send(event(), { provider: 'nope' })).status, 404);
    assert.equal((await send(event(), { provider: 'manual' })).status, 404);
  });
});
