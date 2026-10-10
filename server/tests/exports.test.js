// PHASE 25 — EXPORTS (A29): permissions + plan modules, allow-listed columns/filters, password again for
// personal data, do-not-contact left out (override = owner/admin + reason), background jobs, signed
// 10-minute links that re-check the user, expiry, quota, large-export alert, PDFs, tenant isolation.
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import Lead from '../src/models/Lead.js';
import User from '../src/models/User.js';
import Signal from '../src/models/Signal.js';
import HashtagWatch from '../src/models/HashtagWatch.js';
import ExportJob from '../src/models/ExportJob.js';
import ExportFile from '../src/models/ExportFile.js';
import AuditLog from '../src/models/AuditLog.js';
import Notification from '../src/models/Notification.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem, runWithTenant } from '../src/utils/tenantContext.js';
import { processNextExport, housekeepExports } from '../src/services/exports/exportService.js';
import { signDownload } from '../src/services/exports/downloadToken.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept, GOOD_PASSWORD } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}
const EX = '/api/v1/exports';
const pathOf = (url) => new URL(url).pathname;
const binary = (res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
/** All drawn text of a PDF (content streams are deflated). */
function pdfText(buf) {
  const s = buf.toString('latin1');
  const re = /\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g;
  let m;
  let out = '';
  while ((m = re.exec(s))) out += zlib.inflateSync(buf.subarray(m.index + m[0].length, m.index + m[0].length + Number(m[1]))).toString('latin1');
  return out;
}
const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

describe('Exports', () => {
  let owner, manager, sales, other;
  let leadId;
  const post = (u, url, body) => request(app).post(url).set(bearer(u.token)).send(body);
  const get = (u, url) => request(app).get(url).set(bearer(u.token));
  const runAll = async () => { while (await processNextExport()); };

  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'growth');
    manager = await inviteAndAccept(owner, 'MANAGER');
    sales = await inviteAndAccept(owner, 'SALES');
    other = await registerTenant(); // free trial: 5 exports / month, SALES module only
    const mk = async (body) => (await post(owner, '/api/v1/leads', body)).body.data.lead.id;
    leadId = await mk({ name: 'Ali Bakery', email: 'ali@alibakery.pk', phone: '0300 1234567', city: 'Lahore' });
    await mk({ name: '=HYPERLINK("http://evil.example","Click me")', city: 'Lahore' });
    const dnc = await mk({ name: 'Do Not Contact Co', email: 'stop@dnc.pk' });
    await sys(() => Lead.updateOne({ _id: dnc }, { $set: { doNotContact: true } }));
    const withdrawn = await mk({ name: 'Withdrawn Ltd' });
    await sys(() => Lead.updateOne({ _id: withdrawn }, { $set: { 'compliance.consentStatus': 'WITHDRAWN' } }));
  });
  after(stopTestDb);

  it('catalogue: types the role may use, column names only (no code)', async () => {
    const r = await get(manager, `${EX}/catalog`);
    assert.equal(r.status, 200);
    assert.ok(r.body.data.types.LEADS && r.body.data.types.QUOTES);
    assert.ok(!r.body.data.types.AUDIT_LOGS, 'manager has no audit permission');
    assert.equal(r.body.data.rowCap, 20000);
    assert.ok(r.body.data.types.LEADS.filters.includes('minScore'), 'form shows only allowed filters');
    assert.equal(r.body.data.canIncludeDoNotContact, false);
    assert.ok((await get(owner, `${EX}/catalog`)).body.data.types.AUDIT_LOGS);
    assert.equal((await get(sales, `${EX}/catalog`)).status, 403);
  });

  it('permissions + allow-lists: Sales 403; audit needs its own permission; unknown columns/filters/formats 400; module needed', async () => {
    assert.equal((await post(sales, EX, { type: 'LEADS', format: 'CSV', columns: ['name'] })).status, 403);
    assert.equal((await post(manager, EX, { type: 'AUDIT_LOGS', format: 'CSV' })).status, 403);
    assert.equal((await post(manager, EX, { type: 'LEADS', format: 'CSV', columns: ['name', 'passwordHash'] })).status, 400);
    assert.equal((await post(manager, EX, { type: 'LEADS', format: 'CSV', columns: ['constructor'] })).status, 400);
    assert.equal((await post(manager, EX, { type: 'QUOTES', format: 'CSV', filters: { hashtag: 'x' } })).status, 400, 'not a quotes filter');
    assert.equal((await post(manager, EX, { type: 'QUOTES', format: 'XLSX' })).status, 400);
    assert.equal((await post(manager, EX, { type: 'LEADS', format: 'CSV', filters: { 'status.$ne': 'x' } })).status, 400);
    assert.equal((await post(manager, EX, { type: 'LEADS', format: 'CSV', columns: ['name'], filters: { from: '2026-05-01', to: '2026-04-01' } })).status, 400);
    const nine = ['leadId', 'name', 'personName', 'companyName', 'city', 'country', 'website', 'source', 'score'];
    assert.equal((await post(manager, EX, { type: 'LEADS', format: 'PDF', columns: nine })).status, 400, 'PDF table max 8 columns');
    assert.equal((await post(other, EX, { type: 'INVOICES', format: 'CSV' })).status, 402, 'invoicing module not on the free trial');
  });

  it('personal data needs the password again; non-personal columns don\'t', async () => {
    let r = await post(manager, EX, { type: 'LEADS', format: 'CSV' });
    assert.equal(r.status, 403);
    assert.equal(r.body.errors[0].code, 'REAUTH_REQUIRED');
    r = await post(manager, EX, { type: 'LEADS', format: 'CSV', password: 'wrong-password-123' });
    assert.equal(r.status, 403);
    r = await post(manager, EX, { type: 'LEADS', format: 'CSV', columns: ['name', 'city', 'score'] });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    assert.equal(r.body.data.export.includesPii, false);
    assert.equal(r.body.data.export.ip, undefined, 'private field never sent');
  });

  let jobId;
  it('background job → CSV: BOM, chosen columns in order, formula injection neutralised, do-not-contact & withdrawn left out', async () => {
    const r = await post(manager, EX, { type: 'LEADS', format: 'CSV', columns: ['name', 'email', 'city'], password: GOOD_PASSWORD });
    assert.equal(r.status, 202);
    jobId = r.body.data.export.id;
    assert.equal(r.body.data.export.status, 'QUEUED');
    await runAll();
    const job = (await get(manager, `${EX}/${jobId}`)).body.data.export;
    assert.equal(job.status, 'DONE');
    assert.equal(job.rowCount, 2);
    const link = await post(manager, `${EX}/${jobId}/link`);
    assert.equal(link.status, 200);
    assert.equal(link.body.data.expiresInSeconds, 600);
    const dl = await request(app).get(pathOf(link.body.data.url)).buffer(true).parse(binary);
    assert.equal(dl.status, 200);
    assert.match(dl.headers['content-type'], /text\/csv/);
    assert.match(dl.headers['content-disposition'], /^attachment; filename="[A-Za-z0-9._-]+\.csv"$/);
    assert.equal(dl.headers['x-content-type-options'], 'nosniff');
    assert.equal(dl.headers['cache-control'], 'no-store');
    const text = dl.body.toString('utf8');
    assert.ok(text.startsWith('﻿name,email,city\r\n'), text.slice(0, 40));
    assert.ok(text.includes(`"'=HYPERLINK(""http://evil.example"",""Click me"")"`), 'formula shown as text');
    assert.ok(!text.includes('Do Not Contact Co') && !text.includes('Withdrawn Ltd'));
    assert.ok(await sys(() => AuditLog.exists({ action: 'export.requested', targetId: jobId })));
    assert.ok(await sys(() => AuditLog.exists({ action: 'export.downloaded', targetId: jobId })));
    assert.equal((await sys(() => ExportJob.findById(jobId))).downloads, 1);
  });

  it('download links: only requester or admin; tampered/forged → 404; expired → 410; role taken away → refused', async () => {
    assert.equal((await post(sales, `${EX}/${jobId}/link`)).status, 403);
    const other2 = await inviteAndAccept(owner, 'MANAGER');
    assert.equal((await post(other2, `${EX}/${jobId}/link`)).status, 404, 'another manager cannot see my export');
    assert.equal((await post(owner, `${EX}/${jobId}/link`)).status, 200, 'owner/admin may');
    const url = pathOf((await post(manager, `${EX}/${jobId}/link`)).body.data.url);
    const token = url.split('/').pop();
    const bad = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
    assert.equal((await request(app).get(`${EX}/download/${bad}`)).status, 404);
    const forgedKey = signDownload({ jobId, tenantId: owner.tenant.id, userId: manager.user.id }, Buffer.alloc(32, 1));
    assert.equal((await request(app).get(`${EX}/download/${forgedKey}`)).status, 404, 'signed with the wrong key');
    await sys(() => User.updateOne({ _id: manager.user.id }, { $set: { role: 'SALES' } }));
    assert.equal((await request(app).get(url)).status, 403, 'no export permission any more');
    await sys(() => User.updateOne({ _id: manager.user.id }, { $set: { role: 'MANAGER' } }));
    assert.equal((await request(app).get(url)).status, 200);
  });

  it('do-not-contact override: owner/admin only, with a logged reason', async () => {
    assert.equal((await post(manager, EX, { type: 'LEADS', format: 'CSV', columns: ['name'], includeDoNotContact: true, overrideReason: 'Annual data review' })).status, 403);
    assert.equal((await post(owner, EX, { type: 'LEADS', format: 'CSV', columns: ['name'], includeDoNotContact: true })).status, 400, 'reason required');
    assert.equal((await post(owner, EX, { type: 'QUOTES', format: 'CSV', includeDoNotContact: true, overrideReason: 'Annual data review' })).status, 400, 'quotes have no DNC');
    const r = await post(owner, EX, { type: 'LEADS', format: 'CSV', columns: ['name', 'doNotContact'], includeDoNotContact: true, overrideReason: 'Annual data review' });
    assert.equal(r.status, 202);
    await runAll();
    assert.equal((await sys(() => ExportJob.findById(r.body.data.export.id))).rowCount, 4);
    const log = await sys(() => AuditLog.findOne({ action: 'export.requested', targetId: r.body.data.export.id }));
    assert.equal(log.metadata.overrideReason, 'Annual data review');
  });

  it('PDFs: leads list (job), lead dossier, quote — real PDF files; dossier needs export permission', async () => {
    const r = await post(manager, EX, { type: 'LEADS', format: 'PDF', columns: ['name', 'email', 'city'], password: GOOD_PASSWORD });
    assert.equal(r.status, 202, JSON.stringify(r.body));
    await runAll();
    const url = pathOf((await post(manager, `${EX}/${r.body.data.export.id}/link`)).body.data.url);
    const pdf = await request(app).get(url).buffer(true).parse(binary);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal(pdf.body.subarray(0, 8).toString(), '%PDF-1.4');
    assert.ok(pdfText(pdf.body).includes('(Ali Bakery) Tj'));
    const dossier = await get(owner, `/api/v1/leads/${leadId}/dossier.pdf`).buffer(true).parse(binary);
    assert.equal(dossier.status, 200);
    assert.ok(pdfText(dossier.body).includes('(Lead dossier: Ali Bakery) Tj'));
    assert.ok(await sys(() => AuditLog.exists({ action: 'export.dossier', targetId: leadId })));
    assert.equal((await get(sales, `/api/v1/leads/${leadId}/dossier.pdf`)).status, 403);
    assert.equal((await get(other, `/api/v1/leads/${leadId}/dossier.pdf`)).status, 404);
    const q = (await post(owner, '/api/v1/quotes', { leadId, lines: [{ description: 'Website', quantity: '1', unitPrice: '1000' }] })).body.data.quote;
    const qp = await get(owner, `/api/v1/quotes/${q.id}/pdf`).buffer(true).parse(binary);
    assert.equal(qp.status, 200);
    assert.equal(qp.headers['content-type'], 'application/pdf');
    assert.equal(qp.body.subarray(0, 5).toString(), '%PDF-');
    assert.equal((await get(other, `/api/v1/quotes/${q.id}/pdf`)).status, 404);
  });

  it('hashtag report: PDF straight away (password), CSV as a background job; other companies 404', async () => {
    let watchId;
    await runWithTenant({ tenantId: owner.tenant.id }, async () => {
      const w = await HashtagWatch.create({ name: 'Lahore web', hashtags: ['needawebsite'] });
      watchId = String(w._id);
      await Signal.insertMany(Array.from({ length: 3 }, (_, i) => ({ source: 'INSTAGRAM', externalId: `p${i}`, watchId: w._id, matchedHashtag: 'needawebsite', discoveredAt: new Date(), capture: { author: { status: 'NOT_PROVIDED_BY_SOURCE' } } })));
    });
    const R = `/api/v1/hashtag-watches/${watchId}/report`;
    assert.equal((await post(manager, R, { format: 'PDF', from: monthAgo, to: today })).status, 403, 'lists people → password');
    const r = await post(manager, R, { format: 'PDF', from: monthAgo, to: today, password: GOOD_PASSWORD }).buffer(true).parse(binary);
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/pdf');
    assert.ok(pdfText(r.body).includes('3 of 3 posts had no author information provided by the source'));
    const c = await post(manager, R, { format: 'CSV', from: monthAgo, to: today, password: GOOD_PASSWORD });
    assert.equal(c.status, 202, JSON.stringify(c.body));
    await runAll();
    assert.equal((await sys(() => ExportJob.findById(c.body.data.export.id))).rowCount, 3);
    assert.equal((await post(other, R, { format: 'PDF', from: monthAgo, to: today, password: GOOD_PASSWORD })).status, 404);
    assert.equal((await post(manager, R, { format: 'PDF', from: '2024-01-01', to: today, password: GOOD_PASSWORD })).status, 400, 'max 366 days');
  });

  it('large export (≥1000 rows) alerts the owner', async () => {
    await runWithTenant({ tenantId: owner.tenant.id }, () => Lead.insertMany(Array.from({ length: 1000 }, (_, i) => ({ name: `Bulk ${i}`, source: 'MANUAL' }))));
    const r = await post(manager, EX, { type: 'LEADS', format: 'CSV', columns: ['name'] });
    assert.equal(r.status, 202);
    await runAll();
    const job = await sys(() => ExportJob.findById(r.body.data.export.id));
    assert.equal(job.status, 'DONE', job.error);
    assert.ok(job.rowCount >= 1000);
    assert.ok(await sys(() => Notification.exists({ userId: owner.user.id, type: 'LARGE_EXPORT' })));
  });

  it('expiry: after 24 h the file is deleted and the job EXPIRED; stuck jobs fail', async () => {
    await sys(() => ExportJob.updateOne({ _id: jobId }, { $set: { expiresAt: new Date(Date.now() - 1000) } }));
    await housekeepExports();
    assert.equal((await sys(() => ExportJob.findById(jobId))).status, 'EXPIRED');
    assert.equal(await sys(() => ExportFile.countDocuments({ jobId })), 0);
    assert.equal((await post(manager, `${EX}/${jobId}/link`)).status, 409);
    const stuck = await runWithTenant({ tenantId: owner.tenant.id }, () => ExportJob.create({ type: 'QUOTES', format: 'CSV', columns: ['number'], status: 'RUNNING', startedAt: new Date(Date.now() - 20 * 60000), requestedBy: owner.user.id }));
    await housekeepExports();
    assert.equal((await sys(() => ExportJob.findById(stuck._id))).status, 'FAILED');
  });

  it('plan quota (402 after 5 on the free trial) and tenant isolation', async () => {
    for (let i = 0; i < 5; i += 1) assert.equal((await post(other, EX, { type: 'QUOTES', format: 'CSV' })).status, 202);
    assert.equal((await post(other, EX, { type: 'LEADS', format: 'CSV', columns: ['name'] })).status, 402);
    assert.equal((await get(other, `${EX}/${jobId}`)).status, 404);
    const list = (await get(other, EX)).body.data.items;
    assert.equal(list.length, 5);
    assert.ok(list.every((j) => j.type === 'QUOTES'));
  });
});
