// PHASE 3 — ROLES (RBAC), INVITATIONS & CROSS-TENANT TESTS
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Tenant from '../src/models/Tenant.js';
import Invitation from '../src/models/Invitation.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { GOOD_PASSWORD, uniqueEmail, bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const asSystem = (fn) => runAsSystem('test', fn);
const tokenFromUrl = (url) => new URL(url).searchParams.get('token');

describe('Invitations', () => {
  let owner;
  before(async () => {
    await startTestDb();
    owner = await registerTenant();
  });
  after(stopTestDb);

  it('owner can invite an ADMIN; accepted user joins the SAME company with that role', async () => {
    const admin = await inviteAndAccept(owner, 'ADMIN');
    assert.equal(admin.user.role, 'ADMIN');
    assert.equal(admin.user.tenantId, owner.user.tenantId);
  });

  it('nobody can invite a TENANT_OWNER', async () => {
    const res = await request(app).post('/api/v1/invitations').set(bearer(owner.token)).send({ email: uniqueEmail(), role: 'TENANT_OWNER' });
    assert.equal(res.status, 400);
  });

  it('an ADMIN cannot invite another ADMIN (no privilege escalation)', async () => {
    const admin = await inviteAndAccept(owner, 'ADMIN');
    const res = await request(app).post('/api/v1/invitations').set(bearer(admin.token)).send({ email: uniqueEmail(), role: 'ADMIN' });
    assert.equal(res.status, 403);
  });

  it('accepting cannot change the role (role comes from the invite)', async () => {
    const inv = await request(app).post('/api/v1/invitations').set(bearer(owner.token)).send({ email: uniqueEmail(), role: 'VIEWER' });
    const res = await request(app)
      .post('/api/v1/invitations/accept')
      .send({ token: tokenFromUrl(inv.body.data.inviteUrl), name: 'Sneaky', password: GOOD_PASSWORD, role: 'ADMIN' });
    assert.equal(res.status, 400);
  });

  it('an invite link works only ONCE', async () => {
    const inv = await request(app).post('/api/v1/invitations').set(bearer(owner.token)).send({ email: uniqueEmail(), role: 'SALES' });
    const token = tokenFromUrl(inv.body.data.inviteUrl);
    const first = await request(app).post('/api/v1/invitations/accept').send({ token, name: 'A', password: GOOD_PASSWORD });
    const second = await request(app).post('/api/v1/invitations/accept').send({ token, name: 'B', password: GOOD_PASSWORD });
    assert.equal(first.status, 201);
    assert.equal(second.status, 400);
  });

  it('an expired invite does not work', async () => {
    const inv = await request(app).post('/api/v1/invitations').set(bearer(owner.token)).send({ email: uniqueEmail(), role: 'SALES' });
    await asSystem(() => Invitation.updateOne({ _id: inv.body.data.invitation.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } }));
    const res = await request(app)
      .post('/api/v1/invitations/accept')
      .send({ token: tokenFromUrl(inv.body.data.inviteUrl), name: 'Late', password: GOOD_PASSWORD });
    assert.equal(res.status, 400);
  });

  it('a revoked invite does not work', async () => {
    const inv = await request(app).post('/api/v1/invitations').set(bearer(owner.token)).send({ email: uniqueEmail(), role: 'SALES' });
    const del = await request(app).delete(`/api/v1/invitations/${inv.body.data.invitation.id}`).set(bearer(owner.token));
    assert.equal(del.status, 200);
    const res = await request(app)
      .post('/api/v1/invitations/accept')
      .send({ token: tokenFromUrl(inv.body.data.inviteUrl), name: 'X', password: GOOD_PASSWORD });
    assert.equal(res.status, 400);
  });

  it('cannot invite an email that already has an account', async () => {
    const res = await request(app).post('/api/v1/invitations').set(bearer(owner.token)).send({ email: owner.email, role: 'SALES' });
    assert.equal(res.status, 409);
  });

  it('invite token is not stored in plain text', async () => {
    const inv = await request(app).post('/api/v1/invitations').set(bearer(owner.token)).send({ email: uniqueEmail(), role: 'SALES' });
    assert.equal(inv.body.data.invitation.tokenHash, undefined);
    const raw = tokenFromUrl(inv.body.data.inviteUrl);
    assert.equal(await asSystem(() => Invitation.findOne({ tokenHash: raw })), null);
  });
});

describe('Role permissions', () => {
  let owner, admin, manager, sales, viewer;
  before(async () => {
    await startTestDb();
    owner = await registerTenant();
    admin = await inviteAndAccept(owner, 'ADMIN');
    manager = await inviteAndAccept(owner, 'MANAGER');
    sales = await inviteAndAccept(owner, 'SALES');
    viewer = await inviteAndAccept(owner, 'VIEWER');
  });
  after(stopTestDb);

  it('session tells the UI which permissions the user has (owner vs sales)', async () => {
    const ownerMe = await request(app).get('/api/v1/auth/me').set(bearer(owner.token));
    const salesMe = await request(app).get('/api/v1/auth/me').set(bearer(sales.token));
    assert.ok(ownerMe.body.data.permissions.includes('billing:manage'));
    assert.ok(!salesMe.body.data.permissions.includes('users:read'));
    assert.ok(salesMe.body.data.permissions.includes('leads:read:own'));
  });

  it('SALES and VIEWER cannot see the team list', async () => {
    for (const u of [sales, viewer]) {
      const res = await request(app).get('/api/v1/users').set(bearer(u.token));
      assert.equal(res.status, 403);
    }
  });

  it('VIEWER and MANAGER cannot invite people', async () => {
    for (const u of [viewer, manager]) {
      const res = await request(app).post('/api/v1/invitations').set(bearer(u.token)).send({ email: uniqueEmail(), role: 'VIEWER' });
      assert.equal(res.status, 403);
    }
  });

  it('MANAGER can view the team but cannot change roles', async () => {
    assert.equal((await request(app).get('/api/v1/users').set(bearer(manager.token))).status, 200);
    const res = await request(app).patch(`/api/v1/users/${sales.user.id}/role`).set(bearer(manager.token)).send({ role: 'VIEWER' });
    assert.equal(res.status, 403);
  });

  it('ADMIN can promote a user to MANAGER but NOT to ADMIN', async () => {
    const ok = await request(app).patch(`/api/v1/users/${viewer.user.id}/role`).set(bearer(admin.token)).send({ role: 'MANAGER' });
    assert.equal(ok.status, 200);
    const bad = await request(app).patch(`/api/v1/users/${sales.user.id}/role`).set(bearer(admin.token)).send({ role: 'ADMIN' });
    assert.equal(bad.status, 403);
  });

  it('ADMIN cannot change the OWNER', async () => {
    const res = await request(app).patch(`/api/v1/users/${owner.user.id}/status`).set(bearer(admin.token)).send({ status: 'DISABLED' });
    assert.equal(res.status, 403);
  });

  it('nobody can change their OWN role', async () => {
    const res = await request(app).patch(`/api/v1/users/${owner.user.id}/role`).set(bearer(owner.token)).send({ role: 'ADMIN' });
    assert.equal(res.status, 403);
  });

  it('extra fields in a role update are rejected (mass assignment)', async () => {
    const res = await request(app)
      .patch(`/api/v1/users/${sales.user.id}/role`)
      .set(bearer(owner.token))
      .send({ role: 'VIEWER', tenantId: '64b7f0c2a1b2c3d4e5f60718' });
    assert.equal(res.status, 400);
  });

  it('a DISABLED user is kicked out immediately and cannot log in', async () => {
    const victim = await inviteAndAccept(owner, 'SALES');
    const res = await request(app).patch(`/api/v1/users/${victim.user.id}/status`).set(bearer(owner.token)).send({ status: 'DISABLED' });
    assert.equal(res.status, 200);
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(victim.token))).status, 401);
    const login = await request(app).post('/api/v1/auth/login').send({ email: victim.email, password: victim.password });
    assert.equal(login.status, 401);
  });
});

describe('Cross-tenant protection through the API', () => {
  let ownerA, salesA, ownerB;
  before(async () => {
    await startTestDb();
    ownerA = await registerTenant({ companyName: 'Company A' });
    salesA = await inviteAndAccept(ownerA, 'SALES');
    ownerB = await registerTenant({ companyName: 'Company B' });
  });
  after(stopTestDb);

  it('Company B owner sees ONLY Company B users', async () => {
    const res = await request(app).get('/api/v1/users').set(bearer(ownerB.token));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 1);
    assert.equal(res.body.data.items[0].email, ownerB.email);
  });

  it('Company B owner cannot change a Company A user (gets 404, not 403)', async () => {
    const role = await request(app).patch(`/api/v1/users/${salesA.user.id}/role`).set(bearer(ownerB.token)).send({ role: 'VIEWER' });
    const status = await request(app).patch(`/api/v1/users/${salesA.user.id}/status`).set(bearer(ownerB.token)).send({ status: 'DISABLED' });
    assert.equal(role.status, 404);
    assert.equal(status.status, 404);
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(salesA.token))).status, 200);
  });

  it('Company B owner cannot revoke Company A invitations', async () => {
    const inv = await request(app).post('/api/v1/invitations').set(bearer(ownerA.token)).send({ email: uniqueEmail(), role: 'SALES' });
    const res = await request(app).delete(`/api/v1/invitations/${inv.body.data.invitation.id}`).set(bearer(ownerB.token));
    assert.equal(res.status, 404);
  });

  it('a SUSPENDED company is locked out (token and login)', async () => {
    const victim = await registerTenant({ companyName: 'Late Payer' });
    await Tenant.updateOne({ _id: victim.tenant.id }, { $set: { status: 'SUSPENDED' } });
    assert.equal((await request(app).get('/api/v1/auth/me').set(bearer(victim.token))).status, 403);
    const login = await request(app).post('/api/v1/auth/login').send({ email: victim.email, password: victim.password });
    assert.equal(login.status, 403);
  });
});
