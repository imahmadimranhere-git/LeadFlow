// PHASE 2 — MULTI-TENANT ISOLATION TESTS (the most important tests in the project)
import './helpers/setupEnv.js';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from '../src/config/mongoose.js';
import tenantScopePlugin from '../src/models/plugins/tenantScope.js';
import softDeletePlugin from '../src/models/plugins/softDelete.js';
import { runWithTenant, runAsSystem } from '../src/utils/tenantContext.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';

// A test-only model that behaves like any real business model (leads, invoices...)
const itemSchema = new mongoose.Schema(
  { name: String, secret: { type: String, private: true } },
  { timestamps: true }
);
itemSchema.plugin(tenantScopePlugin);
itemSchema.plugin(softDeletePlugin);
const Item = mongoose.model('IsolationTestItem', itemSchema);

const TENANT_A = new mongoose.Types.ObjectId();
const TENANT_B = new mongoose.Types.ObjectId();
const asA = (fn) => runWithTenant({ tenantId: TENANT_A }, fn);
const asB = (fn) => runWithTenant({ tenantId: TENANT_B }, fn);
const asSystem = (fn) => runAsSystem('test cleanup', fn);

let aDoc;

describe('Tenant isolation', () => {
  before(startTestDb);
  after(stopTestDb);

  beforeEach(async () => {
    await asSystem(() => Item.deleteMany({ deletedAt: { $exists: true } }));
    aDoc = await asA(() => Item.create({ name: 'A lead', secret: 'a-secret' }));
    await asA(() => Item.create({ name: 'A lead 2' }));
    await asB(() => Item.create({ name: 'B lead' }));
  });

  it('create() automatically stamps the current tenantId', async () => {
    assert.equal(String(aDoc.tenantId), String(TENANT_A));
  });

  it('Tenant B cannot LIST Tenant A records', async () => {
    const list = await asB(() => Item.find());
    assert.equal(list.length, 1);
    assert.ok(list.every((d) => String(d.tenantId) === String(TENANT_B)));
  });

  it('Tenant B cannot READ a Tenant A record even with its exact id (IDOR)', async () => {
    const found = await asB(() => Item.findById(aDoc._id));
    assert.equal(found, null);
  });

  it('Tenant B cannot UPDATE a Tenant A record', async () => {
    const result = await asB(() => Item.updateOne({ _id: aDoc._id }, { $set: { name: 'hacked' } }));
    assert.equal(result.modifiedCount, 0);
    const fresh = await asA(() => Item.findById(aDoc._id));
    assert.equal(fresh.name, 'A lead');
  });

  it('Tenant B cannot DELETE Tenant A records (even deleteMany({}))', async () => {
    const result = await asB(() => Item.deleteMany({}));
    assert.equal(result.deletedCount, 1); // only its own record
    assert.equal(await asA(() => Item.countDocuments()), 2);
  });

  it('counts are per tenant', async () => {
    assert.equal(await asA(() => Item.countDocuments()), 2);
    assert.equal(await asB(() => Item.countDocuments()), 1);
  });

  it('spoofing tenantId in the filter does not leak other tenant data', async () => {
    const list = await asA(() => Item.find({ tenantId: TENANT_B }));
    assert.ok(list.every((d) => String(d.tenantId) === String(TENANT_A)));
    const viaOr = await asA(() => Item.find({ $or: [{ tenantId: TENANT_B }] }));
    assert.equal(viaOr.length, 0);
  });

  it('aggregations are automatically scoped to the tenant', async () => {
    const rows = await asB(() => Item.aggregate([{ $group: { _id: '$tenantId', n: { $sum: 1 } } }]));
    assert.equal(rows.length, 1);
    assert.equal(String(rows[0]._id), String(TENANT_B));
  });

  it('a query WITHOUT tenant context fails (never returns everything)', async () => {
    await assert.rejects(() => Item.find(), { name: 'TenantContextError' });
  });

  it('cannot move a record to another tenant via update', async () => {
    await assert.rejects(
      () => asA(() => Item.updateOne({ _id: aDoc._id }, { $set: { tenantId: TENANT_B } })),
      { name: 'TenantContextError' }
    );
  });

  it('cannot create a record for another tenant', async () => {
    await assert.rejects(
      () => asA(() => Item.create({ name: 'sneaky', tenantId: TENANT_B })),
      { name: 'TenantContextError' }
    );
  });

  it('cannot insertMany records for another tenant', async () => {
    await assert.rejects(
      () => asA(() => Item.insertMany([{ name: 'ok' }, { name: 'bad', tenantId: TENANT_B }])),
      { name: 'TenantContextError' }
    );
  });

  it('system context needs a reason, and only then sees all tenants', async () => {
    assert.throws(() => runAsSystem('', () => null));
    const all = await asSystem(() => Item.countDocuments());
    assert.equal(all, 3);
  });

  it('estimatedDocumentCount (not tenant-safe) is blocked for tenants', async () => {
    await assert.rejects(() => asA(() => Item.estimatedDocumentCount()), { name: 'TenantContextError' });
  });

  it('soft-deleted records are hidden from normal queries', async () => {
    await asA(async () => {
      const doc = await Item.findById(aDoc._id);
      await doc.softDelete();
    });
    assert.equal(await asA(() => Item.countDocuments()), 1);
    const deleted = await asA(() => Item.find({ deletedAt: { $ne: null } }));
    assert.equal(deleted.length, 1);
  });

  it('private fields never appear in JSON output', async () => {
    const json = aDoc.toJSON();
    assert.equal(json.secret, undefined);
    assert.equal(json.__v, undefined);
    assert.ok(json.id);
  });
});
