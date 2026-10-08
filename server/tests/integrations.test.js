// PHASE 8 — INTEGRATIONS VAULT (each company's own API keys)
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import TenantIntegration from '../src/models/TenantIntegration.js';
import AuditLog from '../src/models/AuditLog.js';
import { runWithTenant, runAsSystem } from '../src/utils/tenantContext.js';
import { getCredentials } from '../src/services/integrations/vaultService.js';
import { registerTester } from '../src/services/integrations/testers.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { createAdmin, loginAdmin, adminBearer } from './helpers/adminHelpers.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const I = '/api/v1/integrations';
const OPENAI_KEY = 'sk-test1234567890abcdefghijklmnopqrstuvwxyzXYZ9';
const sys = (fn) => runAsSystem('test', fn);
const save = (u, provider, body) => request(app).put(`${I}/${provider}`).set(bearer(u.token)).send(body);

describe('Integrations vault', () => {
  let owner, admin, manager, sales, otherOwner, platformAdmin;
  before(async () => {
    await startTestDb();
    owner = await registerTenant();
    admin = await inviteAndAccept(owner, 'ADMIN');
    manager = await inviteAndAccept(owner, 'MANAGER');
    sales = await inviteAndAccept(owner, 'SALES');
    otherOwner = await registerTenant();
    platformAdmin = await loginAdmin(await createAdmin());
    // No real network in tests: replace the OpenAI tester
    registerTester('OPENAI', async (secrets) => (secrets.apiKey === OPENAI_KEY ? { ok: true, message: 'Connection successful' } : { ok: false, message: 'The provider rejected these credentials' }));
  });
  after(stopTestDb);

  it('only OWNER and ADMIN can open integrations (manager/sales → 403)', async () => {
    assert.equal((await request(app).get(I).set(bearer(owner.token))).status, 200);
    assert.equal((await request(app).get(I).set(bearer(admin.token))).status, 200);
    assert.equal((await request(app).get(I).set(bearer(manager.token))).status, 403);
    assert.equal((await request(app).get(I).set(bearer(sales.token))).status, 403);
  });

  it('provider catalog lists fields but contains no validation secrets or keys', async () => {
    const res = await request(app).get(`${I}/providers`).set(bearer(owner.token));
    const openai = res.body.data.items.find((p) => p.key === 'OPENAI');
    assert.deepEqual(openai.secretFields.map((f) => f.key), ['apiKey']);
    const google = res.body.data.items.find((p) => p.key === 'GOOGLE_SEARCH');
    assert.equal(google.deprecated, true);
  });

  it('saving a key returns ONLY a masked hint — the real key never comes back', async () => {
    const res = await save(owner, 'openai', { label: 'Main', credentials: { apiKey: OPENAI_KEY } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.integration.maskedHints.apiKey, 'sk-••••XYZ9');
    assert.equal(res.body.data.integration.status, 'NOT_TESTED');
    assert.ok(!JSON.stringify(res.body).includes(OPENAI_KEY));

    const list = await request(app).get(I).set(bearer(owner.token));
    const json = JSON.stringify(list.body);
    assert.ok(!json.includes(OPENAI_KEY));
    assert.ok(!json.includes('ciphertext'));
    assert.ok(!json.includes('encryptedCredentials'));
  });

  it('the key is stored ENCRYPTED in the database, not in plain text', async () => {
    const doc = await sys(() => TenantIntegration.findOne({ tenantId: owner.tenant.id, provider: 'OPENAI' }).select('+encryptedCredentials'));
    assert.ok(doc.encryptedCredentials.ciphertext);
    assert.ok(!JSON.stringify(doc.toObject()).includes(OPENAI_KEY));
  });

  it('audit log records the change by field NAME, never the value', async () => {
    await new Promise((r) => setTimeout(r, 50));
    const logs = await AuditLog.find({ tenantId: owner.tenant.id, action: 'integration.created' });
    assert.equal(logs.length, 1);
    assert.deepEqual(logs[0].metadata.secretsChanged, ['apiKey']);
    assert.ok(!JSON.stringify(logs[0]).includes(OPENAI_KEY));
  });

  it('wrong key format, unknown fields and unknown providers are rejected', async () => {
    assert.equal((await save(owner, 'OPENAI', { credentials: { apiKey: 'not-a-key' } })).status, 400);
    assert.equal((await save(owner, 'OPENAI', { credentials: { apiKey: OPENAI_KEY, extra: 'x' } })).status, 400);
    assert.equal((await save(owner, 'OPENAI', { tenantId: otherOwner.tenant.id })).status, 400);
    assert.equal((await save(owner, 'MYSPACE', { credentials: {} })).status, 404);
  });

  it('a new integration needs all required fields', async () => {
    const res = await save(owner, 'WHATSAPP_CLOUD', { config: { phoneNumberId: '1234567890' } });
    assert.equal(res.status, 400);
    const fields = res.body.errors.map((e) => e.field);
    assert.ok(fields.includes('accessToken') && fields.includes('businessAccountId'));
  });

  it('OAuth providers (Meta, LinkedIn) cannot be saved with a pasted key', async () => {
    assert.equal((await save(owner, 'META_GRAPH', {})).status, 400);
  });

  it('editing without re-typing the key keeps the stored key', async () => {
    const res = await save(owner, 'OPENAI', { credentials: { apiKey: '' }, config: { organizationId: 'org-abc123456' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.integration.config.organizationId, 'org-abc123456');
    const creds = await runWithTenant({ tenantId: owner.tenant.id }, () => getCredentials('OPENAI', { purpose: 'test' }));
    assert.equal(creds.secrets.apiKey, OPENAI_KEY);
  });

  it('"Test connection" marks it CONNECTED; a bad key gives a safe error that never echoes the key', async () => {
    const ok = await request(app).post(`${I}/OPENAI/test`).set(bearer(owner.token));
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.integration.status, 'CONNECTED');

    const badKey = 'sk-wrongwrongwrongwrongwrongwrong';
    await save(owner, 'OPENAI', { credentials: { apiKey: badKey } });
    const bad = await request(app).post(`${I}/OPENAI/test`).set(bearer(owner.token));
    assert.equal(bad.body.data.integration.status, 'ERROR');
    assert.ok(!JSON.stringify(bad.body).includes(badKey));
    await save(owner, 'OPENAI', { credentials: { apiKey: OPENAI_KEY } });
  });

  it('server-side use of a key is audit-logged with its purpose and updates "last used"', async () => {
    await runWithTenant({ tenantId: owner.tenant.id }, () => getCredentials('OPENAI', { purpose: 'lead-scoring' }));
    await new Promise((r) => setTimeout(r, 50));
    const log = await AuditLog.findOne({ tenantId: owner.tenant.id, action: 'integration.used', 'metadata.purpose': 'lead-scoring' });
    assert.ok(log);
    const doc = await sys(() => TenantIntegration.findOne({ tenantId: owner.tenant.id, provider: 'OPENAI' }));
    assert.ok(doc.lastUsedAt);
  });

  it('a DISABLED integration is never handed to jobs and cannot be tested', async () => {
    await request(app).patch(`${I}/OPENAI/status`).set(bearer(owner.token)).send({ enabled: false });
    const creds = await runWithTenant({ tenantId: owner.tenant.id }, () => getCredentials('OPENAI', { purpose: 'test' }));
    assert.equal(creds, null);
    assert.equal((await request(app).post(`${I}/OPENAI/test`).set(bearer(owner.token))).status, 400);
    await request(app).patch(`${I}/OPENAI/status`).set(bearer(owner.token)).send({ enabled: true });
  });

  it('ISOLATION: another company cannot see, use, test or delete these keys', async () => {
    const list = await request(app).get(I).set(bearer(otherOwner.token));
    assert.equal(list.body.data.items.length, 0);
    assert.equal((await request(app).post(`${I}/OPENAI/test`).set(bearer(otherOwner.token))).status, 404);
    assert.equal((await request(app).delete(`${I}/OPENAI`).set(bearer(otherOwner.token))).status, 404);
    const creds = await runWithTenant({ tenantId: otherOwner.tenant.id }, () => getCredentials('OPENAI', { purpose: 'test' }));
    assert.equal(creds, null);
  });

  it('data provider URL must be public https (internal addresses, http and custom ports rejected)', async () => {
    const base = { credentials: { apiKey: 'provider-key-123' }, config: { authHeader: 'X-Api-Key' } };
    for (const baseUrl of ['http://api.example.com', 'https://127.0.0.1', 'https://169.254.169.254', 'https://localhost', 'https://api.example.com:8443', 'https://user:pass@api.example.com']) {
      const res = await save(owner, 'DATA_PROVIDER', { ...base, config: { ...base.config, baseUrl } });
      assert.equal(res.status, 400, baseUrl);
    }
    assert.equal((await save(owner, 'DATA_PROVIDER', { ...base, config: { ...base.config, baseUrl: 'https://api.example.com' } })).status, 200);
  });

  it('SMTP only allows ports 465 / 587 / 2525', async () => {
    const res = await save(owner, 'SMTP', {
      credentials: { password: 'app-password' },
      config: { host: 'smtp.example.com', port: '25', username: 'me@example.com', fromEmail: 'me@example.com' },
    });
    assert.equal(res.status, 400);
  });

  it('super admin sees connection STATUS only — no masked hints, no config, no secrets', async () => {
    const res = await request(app).get(`/api/v1/super-admin/tenants/${owner.tenant.id}/integrations`).set(adminBearer(platformAdmin));
    assert.equal(res.status, 200);
    const openai = res.body.data.items.find((i) => i.provider === 'OPENAI');
    assert.ok(openai.status);
    assert.equal(openai.maskedHints, undefined);
    assert.equal(openai.config, undefined);
    assert.ok(!JSON.stringify(res.body).includes(OPENAI_KEY));
  });

  it('delete removes the encrypted key completely', async () => {
    assert.equal((await request(app).delete(`${I}/OPENAI`).set(bearer(owner.token))).status, 200);
    const left = await sys(() => TenantIntegration.countDocuments({ tenantId: owner.tenant.id, provider: 'OPENAI' }));
    assert.equal(left, 0);
  });
});
