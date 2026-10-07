// PHASE 4 — SUPER ADMIN PANEL TESTS
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import AuditLog from '../src/models/AuditLog.js';
import Plan from '../src/models/Plan.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { totpAt, currentStep } from '../src/services/superAdmin/totp.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { createAdmin, loginAdmin, adminBearer } from './helpers/adminHelpers.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const API = '/api/v1/super-admin';

describe('Super admin login with mandatory MFA', () => {
  before(startTestDb);
  after(stopTestDb);

  it('wrong password and unknown email give the same answer', async () => {
    const admin = await createAdmin();
    const wrong = await request(app).post(`${API}/auth/login`).send({ email: admin.email, password: 'Wrong1234567' });
    const unknown = await request(app).post(`${API}/auth/login`).send({ email: 'nobody@platform.test', password: 'Wrong1234567' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.message, unknown.body.message);
  });

  it('first login forces MFA setup — no access token yet', async () => {
    const admin = await createAdmin();
    const res = await request(app).post(`${API}/auth/login`).send({ email: admin.email, password: admin.password });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.step, 'MFA_SETUP');
    assert.ok(res.body.data.secret);
    assert.match(res.body.data.otpauthUrl, /^otpauth:\/\/totp\//);
    assert.equal(res.body.data.accessToken, undefined);
  });

  it('wrong MFA code is rejected', async () => {
    const admin = await createAdmin();
    const step1 = await request(app).post(`${API}/auth/login`).send({ email: admin.email, password: admin.password });
    const good = totpAt(step1.body.data.secret, currentStep());
    const bad = good === '000000' ? '111111' : '000000';
    const res = await request(app).post(`${API}/auth/mfa`).send({ mfaToken: step1.body.data.mfaToken, code: bad });
    assert.equal(res.status, 401);
  });

  it('correct code completes setup; later logins ask for the code only (secret never shown again)', async () => {
    const admin = await createAdmin();
    await loginAdmin(admin);
    assert.ok(admin.token);

    const again = await request(app).post(`${API}/auth/login`).send({ email: admin.email, password: admin.password });
    assert.equal(again.body.data.step, 'MFA_REQUIRED');
    assert.equal(again.body.data.secret, undefined);
  });

  it('the same MFA code cannot be used twice (replay)', async () => {
    const admin = await createAdmin();
    await loginAdmin(admin);
    const usedCode = totpAt(admin.secret, admin.lastStep);
    const step1 = await request(app).post(`${API}/auth/login`).send({ email: admin.email, password: admin.password });
    const res = await request(app).post(`${API}/auth/mfa`).send({ mfaToken: step1.body.data.mfaToken, code: usedCode });
    assert.equal(res.status, 401);
  });

  it('admin profile never contains password hash or MFA secret', async () => {
    const admin = await createAdmin();
    await loginAdmin(admin);
    const res = await request(app).get(`${API}/auth/me`).set(adminBearer(admin));
    assert.equal(res.status, 200);
    const json = JSON.stringify(res.body);
    for (const s of ['passwordHash', 'mfaSecretEnc', 'mfaPendingSecretEnc', 'ciphertext', 'lastTotpStep']) {
      assert.ok(!json.includes(s), `leaks ${s}`);
    }
  });

  it('the half-way "MFA token" cannot be used as a real admin token', async () => {
    const admin = await createAdmin();
    const step1 = await request(app).post(`${API}/auth/login`).send({ email: admin.email, password: admin.password });
    const res = await request(app).get(`${API}/dashboard`).set({ Authorization: `Bearer ${step1.body.data.mfaToken}` });
    assert.equal(res.status, 401);
  });

  it('5 wrong passwords lock the admin account', async () => {
    const admin = await createAdmin();
    for (let i = 0; i < 5; i += 1) {
      await request(app).post(`${API}/auth/login`).send({ email: admin.email, password: 'Wrong1234567' });
    }
    const res = await request(app).post(`${API}/auth/login`).send({ email: admin.email, password: admin.password });
    assert.equal(res.status, 401);
  });
});

describe('Admin and tenant tokens are completely separate', () => {
  let admin, owner;
  before(async () => {
    await startTestDb();
    admin = await loginAdmin(await createAdmin());
    owner = await registerTenant();
  });
  after(stopTestDb);

  it('no token → 401 on admin routes', async () => {
    assert.equal((await request(app).get(`${API}/dashboard`)).status, 401);
  });

  it('a tenant OWNER token cannot open the super admin panel', async () => {
    const res = await request(app).get(`${API}/tenants`).set(bearer(owner.token));
    assert.equal(res.status, 401);
  });

  it('an admin token cannot be used as a tenant user token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(adminBearer(admin));
    assert.equal(res.status, 401);
  });
});

describe('Tenant management', () => {
  let admin, ownerA, salesA, ownerB;
  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    admin = await loginAdmin(await createAdmin());
    ownerA = await registerTenant({ companyName: 'Alpha Homes' });
    salesA = await inviteAndAccept(ownerA, 'SALES');
    ownerB = await registerTenant({ companyName: 'Beta Foods' });
  });
  after(stopTestDb);

  it('dashboard shows platform totals', async () => {
    const res = await request(app).get(`${API}/dashboard`).set(adminBearer(admin));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.totalTenants, 2);
    assert.equal(res.body.data.totalUsers, 3);
  });

  it('lists ALL companies with user counts', async () => {
    const res = await request(app).get(`${API}/tenants`).set(adminBearer(admin));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 2);
    const alpha = res.body.data.items.find((t) => t.name === 'Alpha Homes');
    assert.equal(alpha.userCount, 2);
  });

  it('new signups automatically get the Free Trial plan', async () => {
    const res = await request(app).get(`${API}/tenants/${ownerA.tenant.id}`).set(adminBearer(admin));
    assert.equal(res.body.data.tenant.planId.code, 'free-trial');
    assert.equal(res.body.data.owner.email, ownerA.email);
  });

  it('search treats special characters literally (no regex injection)', async () => {
    const res = await request(app).get(`${API}/tenants`).query({ search: '.*' }).set(adminBearer(admin));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 0);
    const alpha = await request(app).get(`${API}/tenants`).query({ search: 'alp' }).set(adminBearer(admin));
    assert.equal(alpha.body.data.items.length, 1);
  });

  it('suspending a company requires a reason', async () => {
    const res = await request(app).patch(`${API}/tenants/${ownerB.tenant.id}/status`).set(adminBearer(admin)).send({ status: 'SUSPENDED' });
    assert.equal(res.status, 400);
  });

  it('suspend → all its users are blocked; reactivate → they work again; both audit-logged', async () => {
    const url = `${API}/tenants/${ownerA.tenant.id}/status`;
    const suspend = await request(app).patch(url).set(adminBearer(admin)).send({ status: 'SUSPENDED', reason: 'Payment overdue' });
    assert.equal(suspend.status, 200);
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(salesA.token))).status, 403);

    const reactivate = await request(app).patch(url).set(adminBearer(admin)).send({ status: 'ACTIVE', reason: 'Paid' });
    assert.equal(reactivate.status, 200);
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(salesA.token))).status, 200);

    const logs = await request(app)
      .get(`${API}/audit-logs`)
      .query({ tenantId: ownerA.tenant.id, action: 'tenant.status_changed' })
      .set(adminBearer(admin));
    assert.equal(logs.body.data.items.length, 2);
    assert.ok(logs.body.data.items.some((l) => l.metadata.reason === 'Payment overdue' && l.metadata.to === 'SUSPENDED'));
  });

  it('unknown tenant id → 404, malformed id → 400', async () => {
    assert.equal((await request(app).get(`${API}/tenants/64b7f0c2a1b2c3d4e5f60718`).set(adminBearer(admin))).status, 404);
    assert.equal((await request(app).get(`${API}/tenants/not-an-id`).set(adminBearer(admin))).status, 400);
  });

  it('can assign an active plan, but not an inactive one', async () => {
    const plans = (await request(app).get(`${API}/plans`).set(adminBearer(admin))).body.data.items;
    const growth = plans.find((p) => p.code === 'growth');
    const ok = await request(app).patch(`${API}/tenants/${ownerB.tenant.id}/plan`).set(adminBearer(admin)).send({ planId: growth.id });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.tenant.planId.code, 'growth');

    await request(app).patch(`${API}/plans/${growth.id}`).set(adminBearer(admin)).send({ isActive: false });
    const bad = await request(app).patch(`${API}/tenants/${ownerA.tenant.id}/plan`).set(adminBearer(admin)).send({ planId: growth.id });
    assert.equal(bad.status, 400);
  });

  it('delete needs the exact slug typed; after delete the company is locked out', async () => {
    const victim = await registerTenant({ companyName: 'Gamma Ltd' });
    const url = `${API}/tenants/${victim.tenant.id}`;
    const wrong = await request(app).delete(url).set(adminBearer(admin)).send({ confirmSlug: 'wrong', reason: 'test' });
    assert.equal(wrong.status, 400);

    const ok = await request(app).delete(url).set(adminBearer(admin)).send({ confirmSlug: victim.tenant.slug, reason: 'Requested by customer' });
    assert.equal(ok.status, 200);
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(victim.token))).status, 403);
    assert.equal((await request(app).get(url).set(adminBearer(admin))).status, 404);
  });

  it('audit logs cannot be edited or deleted', async () => {
    await assert.rejects(() => AuditLog.updateOne({}, { $set: { action: 'hidden' } }), { name: 'AuditImmutableError' });
    await assert.rejects(() => AuditLog.deleteMany({}), { name: 'AuditImmutableError' });
    const log = await AuditLog.findOne({});
    log.action = 'changed';
    await assert.rejects(() => log.save(), { name: 'AuditImmutableError' });
  });

  it('tenant security events (like role changes) also reach the audit log', async () => {
    await request(app).patch(`/api/v1/users/${salesA.user.id}/role`).set(bearer(ownerA.token)).send({ role: 'VIEWER' });
    await new Promise((r) => setTimeout(r, 100)); // audit write is fire-and-forget
    const logs = await request(app)
      .get(`${API}/audit-logs`)
      .query({ action: 'security.role_changed' })
      .set(adminBearer(admin));
    assert.ok(logs.body.data.items.length >= 1);
  });
});

describe('Plans', () => {
  let admin;
  const validPlan = () => ({
    code: `test-${Date.now()}`,
    name: 'Test Plan',
    currency: 'PKR',
    priceMonthlyMinor: 500000,
    priceYearlyMinor: 5000000,
    limits: { users: 5, leadsPerMonth: 500, discoverySearchesPerMonth: 50, aiRequestsPerMonth: 500, aiTokensPerMonth: 100000, hashtagWatches: 2, storageMb: 500, exportsPerMonth: 10 },
    connectors: ['CSV', 'INSTAGRAM'],
    erpModules: ['SALES'],
  });

  before(async () => {
    await startTestDb();
    admin = await loginAdmin(await createAdmin());
  });
  after(stopTestDb);

  it('creates a plan with limits (prices stored as whole numbers)', async () => {
    const res = await request(app).post(`${API}/plans`).set(adminBearer(admin)).send(validPlan());
    assert.equal(res.status, 201);
    assert.equal(res.body.data.plan.priceMonthlyMinor, 500000);
    assert.equal(res.body.data.plan.isActive, true);
  });

  it('rejects negative or decimal prices', async () => {
    for (const price of [-1, 10.5]) {
      const res = await request(app).post(`${API}/plans`).set(adminBearer(admin)).send({ ...validPlan(), priceMonthlyMinor: price });
      assert.equal(res.status, 400, `accepted price ${price}`);
    }
  });

  it('rejects unknown fields and unknown connectors', async () => {
    const extra = await request(app).post(`${API}/plans`).set(adminBearer(admin)).send({ ...validPlan(), hacked: true });
    const conn = await request(app).post(`${API}/plans`).set(adminBearer(admin)).send({ ...validPlan(), connectors: ['SCRAPE_EVERYTHING'] });
    assert.equal(extra.status, 400);
    assert.equal(conn.status, 400);
  });

  it('rejects a duplicate plan code', async () => {
    const body = validPlan();
    await request(app).post(`${API}/plans`).set(adminBearer(admin)).send(body);
    const res = await request(app).post(`${API}/plans`).set(adminBearer(admin)).send(body);
    assert.equal(res.status, 409);
  });

  it('partial limit update keeps the other limits; code cannot be changed', async () => {
    const created = await request(app).post(`${API}/plans`).set(adminBearer(admin)).send(validPlan());
    const id = created.body.data.plan.id;
    const res = await request(app).patch(`${API}/plans/${id}`).set(adminBearer(admin)).send({ limits: { users: 50 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.plan.limits.users, 50);
    assert.equal(res.body.data.plan.limits.leadsPerMonth, 500);

    const code = await request(app).patch(`${API}/plans/${id}`).set(adminBearer(admin)).send({ code: 'new-code' });
    assert.equal(code.status, 400);
  });
});
