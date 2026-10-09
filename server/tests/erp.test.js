// PHASE 20 — ERP SALES: items, clients, quotes. Totals on the server, price/discount rules for Sales,
// plan modules, status rules, tenant isolation.
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import Lead from '../src/models/Lead.js';
import Item from '../src/models/Item.js';
import Quote from '../src/models/Quote.js';
import Notification from '../src/models/Notification.js';
import AuditLog from '../src/models/AuditLog.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { expireQuotes } from '../src/services/erp/quoteService.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}
const I = '/api/v1/items';
const CL = '/api/v1/clients';
const Q = '/api/v1/quotes';

describe('ERP — items, clients, quotes', () => {
  let owner, manager, sales, viewer, other, noErp;
  let website, plot, leadId, salesLeadId;
  const post = (u, url, body) => request(app).post(url).set(bearer(u.token)).send(body);
  const patch = (u, url, body) => request(app).patch(url).set(bearer(u.token)).send(body);
  const get = (u, url) => request(app).get(url).set(bearer(u.token));

  before(async () => {
    await startTestDb();
    await Plan.insertMany([...DEFAULT_PLANS, { ...DEFAULT_PLANS[1], code: 'no-erp', name: 'No ERP', erpModules: [] }]);
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'growth');
    manager = await inviteAndAccept(owner, 'MANAGER');
    sales = await inviteAndAccept(owner, 'SALES');
    viewer = await inviteAndAccept(owner, 'VIEWER');
    other = await registerTenant();
    await usePlan(other.tenant.id, 'growth');
    noErp = await registerTenant();
    await usePlan(noErp.tenant.id, 'no-erp');
    leadId = (await post(owner, '/api/v1/leads', { name: 'Ali Bakery', companyName: 'Ali Bakery', personName: 'Ali Khan', email: 'ali@alibakery.pk', phone: '0300 1234567', city: 'Lahore' })).body.data.lead.id;
    salesLeadId = (await post(sales, '/api/v1/leads', { name: 'Sara Salon', personName: 'Sara', phone: '0321 7654321' })).body.data.lead.id;
  });
  after(stopTestDb);

  it('plan modules: no ERP in the plan → items/quotes 402 (clients still work, they are CRM)', async () => {
    const r = await get(noErp, Q);
    assert.equal(r.status, 402);
    assert.equal(r.body.errors[0].code, 'PLAN_MODULE');
    assert.equal((await get(noErp, I)).status, 402);
    assert.equal((await get(noErp, CL)).status, 200);
  });

  it('sales settings: currency, max discount for Sales, tax id — owner only, validated', async () => {
    const r = await patch(owner, '/api/v1/settings/sales', { currency: 'PKR', salesMaxDiscount: '10', defaultTax: '0', quotePrefix: 'TB', taxId: '1234567-8', quoteTerms: '50% advance.' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.settings.sales.salesMaxDiscountBp, 1000);
    assert.equal((await patch(sales, '/api/v1/settings/sales', { salesMaxDiscount: '100' })).status, 403);
    assert.equal((await patch(owner, '/api/v1/settings/sales', { quotePrefix: 'q-1' })).status, 400);
    assert.equal((await patch(owner, '/api/v1/settings/sales', { salesMaxDiscount: '150' })).status, 400);
    assert.equal((await patch(owner, '/api/v1/settings/sales', { currency: 'BTC' })).status, 400);
  });

  it('items: managers set prices (money parsed exactly); Sales/Viewer read only; bad numbers refused; duplicates 409', async () => {
    const r = await post(manager, I, { name: 'Website (5 pages)', type: 'SERVICE', price: '60000.50', tax: '17', unit: 'project' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    website = r.body.data.item;
    assert.equal(website.priceMinor, 6000050);
    assert.equal(website.taxBp, 1700);
    assert.equal(website.currency, 'PKR');
    plot = (await post(owner, I, { name: 'Plot C-12', type: 'PROPERTY', price: '12500000', unit: 'plot', availability: 'AVAILABLE', customFields: { Size: '10 marla', Block: 'C' } })).body.data.item;
    assert.equal(plot.customFields.Size, '10 marla');
    assert.equal((await post(sales, I, { name: 'Cheap thing', price: '1' })).status, 403);
    for (const price of ['-5', '1e5', '10.999', 'abc', '']) assert.equal((await post(manager, I, { name: `X ${price}`, price })).status, 400, price);
    assert.equal((await post(manager, I, { name: 'website (5 PAGES)', price: '1' })).status, 409, 'same name, different case');
    assert.equal((await post(manager, I, { name: 'Y', price: '1', priceMinor: 1 })).status, 400, 'unknown field');
    const list = await get(viewer, `${I}?q=website`);
    assert.equal(list.body.data.items.length, 1);
    await patch(manager, `${I}/${website.id}`, { price: '65000' });
    assert.ok(await sys(() => AuditLog.exists({ action: 'item.price_changed', targetId: website.id })));
  });

  let clientId;
  it('lead → client: details copied, lead CONVERTED, converting again returns the same client; Sales only own leads', async () => {
    const r = await post(owner, `${CL}/from-lead/${leadId}`);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    clientId = r.body.data.client.id;
    assert.equal(r.body.data.client.name, 'Ali Bakery');
    assert.equal(r.body.data.client.contacts[0].name, 'Ali Khan');
    assert.equal((await sys(() => Lead.findById(leadId))).status, 'CONVERTED');
    const again = await post(owner, `${CL}/from-lead/${leadId}`);
    assert.equal(again.status, 200);
    assert.equal(again.body.data.client.id, clientId);
    assert.equal((await post(sales, `${CL}/from-lead/${leadId}`)).status, 404);
    assert.equal((await get(sales, `${CL}/${clientId}`)).status, 404, 'Sales sees only own clients');
    assert.equal((await post(sales, CL, { name: 'Walk-in customer', email: 'not-an-email' })).status, 400);
  });

  let quoteId;
  it('quote: the SERVER calculates totals (browser totals are refused); numbering; validity; currency', async () => {
    const r = await post(owner, Q, {
      clientId,
      title: 'Website for Ali Bakery',
      lines: [{ itemId: website.id, quantity: '1' }, { description: 'Logo design', quantity: '2', unitPrice: '5000', tax: '0' }],
      discount: { type: 'PERCENT', value: '5' },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const q = r.body.data.quote;
    quoteId = q.id;
    assert.match(q.number, /^TB-\d{4}-0001$/);
    assert.equal(q.currency, 'PKR');
    assert.equal(q.lines[0].unitPriceMinor, 6500000, 'catalog price (after the change)');
    assert.equal(q.lines[0].taxBp, 1700, 'item tax');
    // (65,000 + 10,000) − 5 % = 71,250 ; tax 17 % only on the website share (65,000 − 3,250 = 61,750) = 10,497.50
    assert.equal(q.subtotalMinor, 7500000);
    assert.equal(q.orderDiscountMinor, 375000);
    assert.equal(q.taxMinor, 1049750);
    assert.equal(q.totalMinor, 7500000 - 375000 + 1049750);
    assert.equal(Math.round((new Date(q.validUntil) - new Date(q.issueDate)) / 86400000), 15);
    const cheat = await post(owner, Q, { clientId, lines: [{ itemId: website.id, quantity: '1', totalMinor: 1 }], totalMinor: 1 });
    assert.equal(cheat.status, 400, 'totals from the browser are not accepted at all');
    const second = await post(owner, Q, { clientId, lines: [{ description: 'Hosting', quantity: '12', unitPrice: '1500' }] });
    assert.match(second.body.data.quote.number, /^TB-\d{4}-0002$/);
  });

  it('Sales rules: no price below catalog, total discount within the company limit; a manager may', async () => {
    const below = await post(sales, Q, { leadId: salesLeadId, lines: [{ itemId: website.id, quantity: '1', unitPrice: '50000' }] });
    assert.equal(below.status, 403);
    assert.equal(below.body.errors[0].code, 'BELOW_CATALOG_PRICE');
    const tooMuch = await post(sales, Q, { leadId: salesLeadId, lines: [{ itemId: website.id, quantity: '1', discount: '8' }], discount: { type: 'PERCENT', value: '5' } });
    assert.equal(tooMuch.status, 403, '8 % + 5 % = 12.6 % > 10 %');
    assert.equal(tooMuch.body.errors[0].code, 'DISCOUNT_LIMIT');
    const ok = await post(sales, Q, { leadId: salesLeadId, lines: [{ itemId: website.id, quantity: '1', discount: '10' }] });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const mgr = await post(manager, Q, { leadId: salesLeadId, lines: [{ itemId: website.id, quantity: '1', unitPrice: '50000' }], discount: { type: 'PERCENT', value: '30' } });
    assert.equal(mgr.status, 201);
    assert.equal((await post(sales, Q, { leadId: salesLeadId, lines: [{ description: 'x', quantity: '0', unitPrice: '1' }] })).status, 400);
    assert.equal((await post(sales, Q, { leadId: salesLeadId, lines: [] })).status, 400);
    assert.equal((await post(sales, Q, { leadId: salesLeadId, lines: [{ description: 'x', quantity: '1', unitPrice: '10' }], discount: { type: 'AMOUNT', value: '11' } })).status, 400, 'discount bigger than the quote');
  });

  it('only drafts can be edited; Send → locked; Revise → new draft revision; invalid jumps 409', async () => {
    assert.equal((await post(owner, `${Q}/${quoteId}/status`, { status: 'ACCEPTED' })).status, 409, 'DRAFT cannot jump to ACCEPTED');
    assert.equal((await post(owner, `${Q}/${quoteId}/status`, { status: 'SENT' })).status, 200);
    assert.equal((await patch(owner, `${Q}/${quoteId}`, { title: 'Changed' })).status, 409);
    const rev = await post(owner, `${Q}/${quoteId}/status`, { status: 'DRAFT' });
    assert.equal(rev.body.data.quote.revision, 2);
    const ed = await patch(owner, `${Q}/${quoteId}`, { discount: { type: 'NONE' } });
    assert.equal(ed.status, 200);
    assert.equal(ed.body.data.quote.totalMinor, 7500000 + 1105000, 'recalculated without the discount');
    assert.equal((await post(owner, `${Q}/${quoteId}/status`, { status: 'SENT' })).status, 200);
  });

  it('accept: once only (two clicks → one wins), lead converted + client linked, tracked item reserved, owner told', async () => {
    const q = (await post(manager, Q, { leadId: salesLeadId, lines: [{ itemId: plot.id, quantity: '1' }] })).body.data.quote;
    await sys(() => Quote.updateOne({ _id: q.id }, { $set: { ownerId: sales.user.id } }));
    await post(manager, `${Q}/${q.id}/status`, { status: 'SENT' });
    const [a, b] = await Promise.all([post(manager, `${Q}/${q.id}/status`, { status: 'ACCEPTED' }), post(owner, `${Q}/${q.id}/status`, { status: 'ACCEPTED' })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const done = await sys(() => Quote.findById(q.id));
    assert.ok(done.clientId, 'a client was created from the lead');
    assert.equal((await sys(() => Lead.findById(salesLeadId))).status, 'CONVERTED');
    assert.equal((await sys(() => Item.findById(plot.id))).availability, 'RESERVED');
    assert.equal(await sys(() => Notification.countDocuments({ userId: sales.user.id, type: 'QUOTE_ACCEPTED' })), 1);
    assert.equal((await patch(manager, `${Q}/${q.id}`, { title: 'x' })).status, 409, 'accepted = permanent record');
    assert.equal((await post(manager, `${Q}/${q.id}/status`, { status: 'CANCELLED' })).status, 409);
  });

  it('currency is fixed per quote: an item priced in another currency is refused with a clear message', async () => {
    await patch(owner, '/api/v1/settings/sales', { currency: 'USD' });
    const r = await post(owner, Q, { clientId, lines: [{ itemId: website.id, quantity: '1' }] });
    assert.equal(r.status, 400);
    assert.match(r.body.errors[0].message, /priced in PKR, the quote is in USD/);
    await patch(owner, '/api/v1/settings/sales', { currency: 'PKR' });
    await patch(manager, `${I}/${website.id}`, { status: 'ARCHIVED' });
    assert.equal((await post(owner, Q, { clientId, lines: [{ itemId: website.id, quantity: '1' }] })).status, 400, 'archived items cannot be quoted');
    await patch(manager, `${I}/${website.id}`, { status: 'ACTIVE' });
  });

  it('visibility: Sales sees only quotes for own leads/clients; Viewer reads but cannot create; other company 404', async () => {
    assert.equal((await get(sales, `${Q}/${quoteId}`)).status, 404);
    const mine = (await get(sales, Q)).body.data.items;
    assert.ok(mine.length >= 1 && !mine.some((x) => x.id === quoteId));
    assert.equal((await get(viewer, `${Q}/${quoteId}`)).status, 200);
    assert.equal((await post(viewer, Q, { clientId, lines: [{ description: 'x', quantity: '1', unitPrice: '1' }] })).status, 403);
    assert.equal((await get(other, `${Q}/${quoteId}`)).status, 404);
    assert.equal((await get(other, Q)).body.data.items.length, 0);
    assert.equal((await post(other, Q, { clientId, lines: [{ description: 'x', quantity: '1', unitPrice: '1' }] })).status, 400, 'our client is invisible to them');
    assert.equal((await get(other, `${I}/${website.id}`)).status, 404);
    assert.equal((await get(other, `${CL}/${clientId}`)).status, 404);
  });

  it('expiry + duplicate: SENT quotes past "valid until" expire; duplicate = new number, DRAFT', async () => {
    await sys(() => Quote.updateOne({ _id: quoteId }, { $set: { validUntil: new Date(Date.now() - 1000) } }));
    assert.ok((await expireQuotes()) >= 1);
    assert.equal((await sys(() => Quote.findById(quoteId))).status, 'EXPIRED');
    const dup = await post(owner, `${Q}/${quoteId}/duplicate`);
    assert.equal(dup.status, 201, JSON.stringify(dup.body));
    assert.equal(dup.body.data.quote.status, 'DRAFT');
    assert.notEqual(dup.body.data.quote.number, (await sys(() => Quote.findById(quoteId))).number);
  });

  it('print data: company details + quote; internal note is part of the quote but marked internal', async () => {
    const r = await get(owner, `${Q}/${quoteId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.company.taxId, '1234567-8');
    assert.equal(r.body.data.quote.clientId.name, 'Ali Bakery');
    assert.equal(r.body.data.canManagePrices, true);
  });
});
