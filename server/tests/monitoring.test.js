// PHASE 30 — System page (super admin only, no personal data in metrics), index creation, and the
// permanent erasure of a deleted company (dry run, confirmations, what is kept, other companies untouched).
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Lead from '../src/models/Lead.js';
import User from '../src/models/User.js';
import Tenant from '../src/models/Tenant.js';
import Subscription from '../src/models/Subscription.js';
import AuditLog from '../src/models/AuditLog.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { ensureIndexes } from '../src/config/indexes.js';
import { runAlertCheck } from '../src/monitoring/monitorService.js';
import { purgeDeletedTenants, purgeableModels } from '../src/services/superAdmin/tenantPurgeService.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';
import { createAdmin, loginAdmin, adminBearer } from './helpers/adminHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
const SA = '/api/v1/super-admin';

describe('Monitoring & data erasure', () => {
  let admin, gone, stays, goneSlug;
  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    admin = await loginAdmin(await createAdmin());
    gone = await registerTenant({ companyName: 'Gone Ltd' });
    stays = await registerTenant({ companyName: 'Stays Ltd' });
    await inviteAndAccept(gone, 'SALES');
    for (const u of [gone, stays]) await request(app).post('/api/v1/leads').set(bearer(u.token)).send({ name: `${u.tenant.name} lead`, email: 'x@lead.pk', source: 'MANUAL' });
    goneSlug = gone.tenant.slug;
  });
  after(stopTestDb);

  it('System page: super admin only; real numbers; route patterns never contain ids', async () => {
    assert.equal((await request(app).get(`${SA}/system`).set(bearer(gone.token))).status, 401);
    const leadId = (await request(app).get('/api/v1/leads').set(bearer(stays.token))).body.data.items[0].id;
    await request(app).get(`/api/v1/leads/${leadId}`).set(bearer(stays.token));
    const r = await request(app).get(`${SA}/system`).set(adminBearer(admin));
    assert.equal(r.status, 200);
    const d = r.body.data;
    assert.equal(d.db.status, 'connected');
    assert.ok(d.http.requests > 0);
    assert.ok(Number.isFinite(d.memory.rssMb));
    assert.ok(!JSON.stringify(d).includes(leadId), 'no ids in metrics');
    assert.ok(!JSON.stringify(d).includes('x@lead.pk'), 'no personal data');
    assert.ok(Array.isArray(await runAlertCheck()));
  });

  it('ensureIndexes creates every index and reports nothing failed', async () => {
    const r = await ensureIndexes();
    assert.deepEqual(r.failed, []);
    assert.ok(r.ok.includes('User') && r.ok.includes('RefreshToken'));
  });

  it('erasure is refused for an active company; dry run changes nothing; needs slug + ERASE', async () => {
    const P = `${SA}/tenants/${gone.tenant.id}/purge`;
    assert.equal((await request(app).post(P).set(adminBearer(admin)).send({ confirmSlug: goneSlug })).status, 400, 'still active');
    assert.equal((await request(app).post(P).set(bearer(gone.token)).send({ confirmSlug: goneSlug })).status, 401);
    const del = await request(app).delete(`${SA}/tenants/${gone.tenant.id}`).set(adminBearer(admin)).send({ confirmSlug: goneSlug, reason: 'Customer asked to close the account' });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    const list = (await request(app).get(`${SA}/deleted-tenants`).set(adminBearer(admin))).body.data.items;
    assert.ok(list.some((t) => t.id === gone.tenant.id && !t.purgedAt), 'deleted company is listed');
    const dry = await request(app).post(P).set(adminBearer(admin)).send({ confirmSlug: goneSlug });
    assert.equal(dry.status, 200, JSON.stringify(dry.body));
    assert.equal(dry.body.data.dryRun, true);
    assert.equal(dry.body.data.counts.Lead, 1);
    assert.equal(dry.body.data.counts.User, 2);
    assert.equal(await sys(() => Lead.countDocuments({ tenantId: gone.tenant.id })), 1, 'dry run deleted nothing');
    assert.equal((await request(app).post(P).set(adminBearer(admin)).send({ confirmSlug: goneSlug, dryRun: false })).status, 400, 'ERASE missing');
    assert.equal((await request(app).post(P).set(adminBearer(admin)).send({ confirmSlug: 'wrong-slug', dryRun: false, confirm: 'ERASE' })).status, 400);
  });

  it('real erasure: company data gone, billing + audit kept, tombstone left, other company untouched, idempotent', async () => {
    const P = `${SA}/tenants/${gone.tenant.id}/purge`;
    const r = await request(app).post(P).set(adminBearer(admin)).send({ confirmSlug: goneSlug, dryRun: false, confirm: 'ERASE' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.data.total >= 3);
    assert.equal(await sys(() => Lead.countDocuments({ tenantId: gone.tenant.id, deletedAt: { $not: { $type: 'string' } } })), 0);
    assert.equal(await sys(() => User.countDocuments({ tenantId: gone.tenant.id })), 0);
    assert.equal(await sys(() => Subscription.countDocuments({ tenantId: gone.tenant.id })), 1, 'billing record kept');
    const t = await sys(() => Tenant.findOne({ _id: gone.tenant.id, deletedAt: { $ne: null } }).lean());
    assert.equal(t.name, 'Deleted company');
    assert.ok(t.purgedAt);
    assert.ok(await sys(() => AuditLog.exists({ action: 'tenant.purged', tenantId: gone.tenant.id })));
    assert.equal(await sys(() => Lead.countDocuments({ tenantId: stays.tenant.id })), 1, 'other company untouched');
    assert.equal((await request(app).get('/api/v1/leads').set(bearer(stays.token))).status, 200);
    const again = await request(app).post(P).set(adminBearer(admin)).send({ confirmSlug: goneSlug, dryRun: false, confirm: 'ERASE' });
    assert.equal(again.body.data.alreadyPurged, true);
    assert.ok(!purgeableModels().some((m) => ['AuditLog', 'Subscription', 'PlatformInvoice', 'Tenant'].includes(m.modelName)));
  });

  it('automatic purge (PURGE_DELETED_TENANTS_AFTER_DAYS): only companies deleted long enough ago', async () => {
    const x = await registerTenant({ companyName: 'Old Ltd' });
    await sys(() => Tenant.updateOne({ _id: x.tenant.id }, { $set: { deletedAt: new Date(Date.now() - 40 * 86400000), status: 'CANCELLED' } }));
    const y = await registerTenant({ companyName: 'Recent Ltd' });
    await sys(() => Tenant.updateOne({ _id: y.tenant.id }, { $set: { deletedAt: new Date(Date.now() - 5 * 86400000), status: 'CANCELLED' } }));
    assert.deepEqual(await purgeDeletedTenants(0), { purged: 0 }, 'off by default');
    assert.deepEqual(await purgeDeletedTenants(30), { purged: 1 });
    assert.equal(await sys(() => User.countDocuments({ tenantId: x.tenant.id })), 0);
    assert.equal(await sys(() => User.countDocuments({ tenantId: y.tenant.id })), 1);
  });
});
