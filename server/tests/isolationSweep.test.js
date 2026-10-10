// PHASE 28 — tenant isolation sweep through the REAL API for the business modules (spec 23.5:
// "Tenant A must never read/update/delete Tenant B's ..."). Company B is an owner with every permission
// and the same plan → the ONLY thing stopping it is tenant isolation. Every attempt must be 404
// (not 403: we don't even admit the record exists).
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant } from './helpers/authHelpers.js';

const V = '/api/v1';
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await runAsSystem('test', () => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}

describe('Tenant isolation sweep (API, all business modules)', () => {
  let a, b;
  const ids = {};
  const as = (u) => ({
    get: (url) => request(app).get(url).set(bearer(u.token)),
    post: (url, body) => request(app).post(url).set(bearer(u.token)).send(body),
    patch: (url, body) => request(app).patch(url).set(bearer(u.token)).send(body),
    del: (url) => request(app).delete(url).set(bearer(u.token)),
  });

  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    a = await registerTenant({ companyName: 'Company A' });
    b = await registerTenant({ companyName: 'Company B' });
    await usePlan(a.tenant.id, 'pro'); // every ERP module
    await usePlan(b.tenant.id, 'pro');
    const A = as(a);
    const made = async (res, key) => {
      assert.ok([200, 201].includes(res.status), `${key}: ${JSON.stringify(res.body)}`);
      return res.body.data[key].id;
    };
    ids.lead = await made(await A.post(`${V}/leads`, { name: 'A lead', email: 'lead@a.pk', source: 'MANUAL' }), 'lead');
    ids.item = await made(await A.post(`${V}/items`, { name: 'A item', type: 'SERVICE', price: '1000' }), 'item');
    ids.client = await made(await A.post(`${V}/clients`, { name: 'A client' }), 'client');
    ids.quote = await made(await A.post(`${V}/quotes`, { clientId: ids.client, title: 'A quote', lines: [{ description: 'Work', quantity: '1', unitPrice: '1000' }] }), 'quote');
    ids.invoice = await made(await A.post(`${V}/invoices`, { clientId: ids.client, lines: [{ description: 'Work', quantity: '1', unitPrice: '1000' }] }), 'invoice');
    ids.project = await made(await A.post(`${V}/projects`, { name: 'A project', clientId: ids.client }), 'project');
    ids.task = await made(await A.post(`${V}/projects/${ids.project}/tasks`, { title: 'A task' }), 'task');
    ids.expense = await made(await A.post(`${V}/accounting/expenses`, { category: 'Rent', amount: '5000' }), 'expense');
    ids.template = await made(await A.post(`${V}/templates`, { name: 'A template', channel: 'WHATSAPP', body: 'Hi {{firstName|there}}' }), 'template');
  });
  after(stopTestDb);

  it('READ by exact id → 404 (leads, items, clients, quotes, invoices, projects, PDFs, dossier)', async () => {
    const B = as(b);
    for (const url of [
      `${V}/leads/${ids.lead}`, `${V}/items/${ids.item}`, `${V}/clients/${ids.client}`, `${V}/quotes/${ids.quote}`, `${V}/invoices/${ids.invoice}`,
      `${V}/projects/${ids.project}`, `${V}/projects/${ids.project}/tasks`, `${V}/quotes/${ids.quote}/pdf`, `${V}/invoices/${ids.invoice}/pdf`, `${V}/leads/${ids.lead}/dossier.pdf`,
    ]) assert.equal((await B.get(url)).status, 404, url);
  });

  it('UPDATE → 404 and nothing changes', async () => {
    const B = as(b);
    const tries = [
      [`${V}/leads/${ids.lead}`, { name: 'pwned' }],
      [`${V}/items/${ids.item}`, { name: 'pwned' }],
      [`${V}/clients/${ids.client}`, { name: 'pwned' }],
      [`${V}/quotes/${ids.quote}`, { title: 'pwned' }],
      [`${V}/invoices/${ids.invoice}`, { title: 'pwned' }],
      [`${V}/projects/${ids.project}`, { name: 'pwned' }],
      [`${V}/tasks/${ids.task}`, { title: 'pwned' }],
      [`${V}/accounting/expenses/${ids.expense}`, { vendor: 'pwned' }],
      [`${V}/templates/${ids.template}`, { name: 'pwned' }],
    ];
    for (const [url, body] of tries) assert.equal((await B.patch(url, body)).status, 404, url);
    const A = as(a);
    assert.equal((await A.get(`${V}/leads/${ids.lead}`)).body.data.lead.name, 'A lead');
    assert.equal((await A.get(`${V}/items/${ids.item}`)).body.data.item.name, 'A item');
    assert.ok(!JSON.stringify((await A.get(`${V}/projects/${ids.project}`)).body).includes('pwned'));
    assert.ok(!JSON.stringify((await A.get(`${V}/projects/${ids.project}/tasks`)).body).includes('pwned'));
    assert.ok(!JSON.stringify((await A.get(`${V}/templates`)).body).includes('pwned'));
  });

  it('STATE CHANGES (issue, accept, void, convert) → 404', async () => {
    const B = as(b);
    assert.equal((await B.post(`${V}/invoices/${ids.invoice}/issue`, {})).status, 404);
    assert.equal((await B.post(`${V}/accounting/expenses/${ids.expense}/void`, { reason: 'not mine' })).status, 404);
    assert.equal((await B.post(`${V}/invoices/from-quote/${ids.quote}`)).status, 404);
    assert.equal((await B.post(`${V}/projects/${ids.project}/tasks`, { title: 'sneaky' })).status, 404);
  });

  it('DELETE → 404 and the record is still there', async () => {
    const B = as(b);
    for (const url of [`${V}/leads/${ids.lead}`, `${V}/items/${ids.item}`, `${V}/clients/${ids.client}`, `${V}/invoices/${ids.invoice}`, `${V}/projects/${ids.project}`, `${V}/tasks/${ids.task}`, `${V}/templates/${ids.template}`]) {
      assert.equal((await B.del(url)).status, 404, url);
    }
    const A = as(a);
    for (const url of [`${V}/leads/${ids.lead}`, `${V}/items/${ids.item}`, `${V}/clients/${ids.client}`, `${V}/invoices/${ids.invoice}`, `${V}/projects/${ids.project}`]) {
      assert.equal((await A.get(url)).status, 200, `${url} still exists`);
    }
  });

  it('LISTS and reports of company B contain nothing of company A', async () => {
    const B = as(b);
    const all = [];
    for (const url of [`${V}/leads`, `${V}/items`, `${V}/clients`, `${V}/quotes`, `${V}/invoices`, `${V}/projects`, `${V}/accounting/expenses`, `${V}/templates`, `${V}/ai/usage`, `${V}/exports`, `${V}/notifications`]) {
      const r = await B.get(url);
      assert.equal(r.status, 200, url);
      all.push(JSON.stringify(r.body));
    }
    const text = all.join('\n');
    for (const [k, id] of Object.entries(ids)) assert.ok(!text.includes(id), `${k} id leaked`);
    for (const word of ['A lead', 'A item', 'A client', 'A quote', 'A project', 'A template', 'lead@a.pk']) assert.ok(!text.includes(word), word);
  });
});
