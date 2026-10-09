// PHASE 21 — INVOICES + PAYMENTS: numbering without gaps, issued = locked, no overpayment (even in a race),
// payments voided not deleted, stock taken/returned, money permission, tenant isolation.
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import Item from '../src/models/Item.js';
import ClientInvoice from '../src/models/ClientInvoice.js';
import ClientPayment from '../src/models/ClientPayment.js';
import Notification from '../src/models/Notification.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { notifyOverdueInvoices, recoverStuckIssuing } from '../src/services/erp/invoiceService.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}
const INV = '/api/v1/invoices';
const DAY = 86400000;

describe('Invoices + payments', () => {
  let owner, manager, sales, viewer, other, noInv;
  let laptop, plot, ownerClient, salesClient;
  const post = (u, url, body) => request(app).post(url).set(bearer(u.token)).send(body);
  const patch = (u, url, body) => request(app).patch(url).set(bearer(u.token)).send(body);
  const get = (u, url) => request(app).get(url).set(bearer(u.token));
  const draft = async (u, clientId, lines = [{ description: 'Website', quantity: '1', unitPrice: '1000' }]) => {
    const r = await post(u, INV, { clientId, lines });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.data.invoice;
  };
  const issue = (u, id, body = {}) => post(u, `${INV}/${id}/issue`, body);
  const pay = (u, id, amount, extra = {}) => post(u, `${INV}/${id}/payments`, { amount, method: 'BANK_TRANSFER', ...extra });

  before(async () => {
    await startTestDb();
    const growth = DEFAULT_PLANS.find((p) => p.code === 'growth');
    await Plan.insertMany([...DEFAULT_PLANS, { ...growth, code: 'no-inv', name: 'No invoicing', erpModules: ['SALES'] }]);
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'growth');
    manager = await inviteAndAccept(owner, 'MANAGER');
    sales = await inviteAndAccept(owner, 'SALES');
    viewer = await inviteAndAccept(owner, 'VIEWER');
    other = await registerTenant();
    await usePlan(other.tenant.id, 'growth');
    noInv = await registerTenant();
    await usePlan(noInv.tenant.id, 'no-inv');
    assert.equal((await patch(owner, '/api/v1/settings/sales', { currency: 'PKR', invoicePrefix: 'INV', paymentTermsDays: 15, invoiceFooter: 'Bank: HBL 0000-1111' })).status, 200);
    laptop = (await post(owner, '/api/v1/items', { name: 'Laptop', type: 'PRODUCT', price: '150000' })).body.data.item;
    await sys(() => Item.updateOne({ _id: laptop.id }, { $set: { stockQty: 5 } }));
    plot = (await post(owner, '/api/v1/items', { name: 'Plot A-1', type: 'PROPERTY', price: '9000000', availability: 'AVAILABLE' })).body.data.item;
    ownerClient = (await post(owner, '/api/v1/clients', { name: 'Ali Bakery' })).body.data.client;
    salesClient = (await post(sales, '/api/v1/clients', { name: 'Sara Salon' })).body.data.client;
  });
  after(stopTestDb);

  it('plan module INVOICING required (402); money actions need invoices:manage — Sales/Viewer 403', async () => {
    assert.equal((await get(noInv, INV)).status, 402);
    assert.equal((await post(sales, INV, { clientId: salesClient.id, lines: [{ description: 'x', quantity: '1', unitPrice: '1' }] })).status, 403);
    assert.equal((await post(viewer, INV, { clientId: ownerClient.id, lines: [{ description: 'x', quantity: '1', unitPrice: '1' }] })).status, 403);
  });

  let first;
  it('draft: no number yet, server totals, browser totals refused, editable, deletable without leaving a gap', async () => {
    const d = await draft(manager, ownerClient.id, [{ description: 'Website', quantity: '1', unitPrice: '1000', tax: '17' }]);
    assert.equal(d.number, null);
    assert.equal(d.status, 'DRAFT');
    assert.equal(d.totalMinor, 117000);
    assert.equal(d.footer, 'Bank: HBL 0000-1111');
    assert.equal((await post(manager, INV, { clientId: ownerClient.id, lines: [{ description: 'x', quantity: '1', unitPrice: '1' }], totalMinor: 1 })).status, 400);
    const e = await patch(manager, `${INV}/${d.id}`, { title: 'Website — phase 1' });
    assert.equal(e.status, 200);
    const throwAway = await draft(manager, ownerClient.id);
    assert.equal((await request(app).delete(`${INV}/${throwAway.id}`).set(bearer(manager.token))).status, 200);
    first = d;
  });

  it('issue: next number INV-YYYY-0001 (deleted draft left no gap), due date from payment terms, then LOCKED; two clicks → one issue', async () => {
    const [a, b] = await Promise.all([issue(manager, first.id), issue(owner, first.id)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const inv = (a.status === 200 ? a : b).body.data.invoice;
    assert.match(inv.number, /^INV-\d{4}-0001$/);
    assert.equal(inv.status, 'ISSUED');
    assert.equal(inv.balanceMinor, 117000);
    assert.equal(Math.round((new Date(inv.dueDate) - new Date(inv.issueDate)) / DAY), 15);
    assert.equal(inv.paymentState, 'UNPAID');
    assert.equal((await patch(manager, `${INV}/${first.id}`, { title: 'changed' })).status, 409, 'issued = locked');
    assert.equal((await request(app).delete(`${INV}/${first.id}`).set(bearer(manager.token))).status, 409, 'issued is voided, never deleted');
    const second = await draft(manager, ownerClient.id);
    assert.match((await issue(manager, second.id)).body.data.invoice.number, /^INV-\d{4}-0002$/);
  });

  it('payments: partial → PARTIAL; no overpayment, no 0, no future date; last payment → PAID; owner told', async () => {
    const inv = await draft(manager, salesClient.id, [{ description: 'Salon booking site', quantity: '1', unitPrice: '1000' }]);
    await issue(manager, inv.id);
    const p1 = await pay(manager, inv.id, '400', { reference: 'TRX-1' });
    assert.equal(p1.status, 201, JSON.stringify(p1.body));
    assert.equal(p1.body.data.invoice.paymentState, 'PARTIAL');
    assert.equal(p1.body.data.invoice.balanceMinor, 60000);
    assert.equal((await pay(manager, inv.id, '600.01')).status, 400, 'more than the balance');
    assert.equal((await pay(manager, inv.id, '0')).status, 400);
    assert.equal((await pay(manager, inv.id, '-1')).status, 400);
    assert.equal((await pay(manager, inv.id, '100', { paidAt: new Date(Date.now() + 3 * DAY).toISOString() })).status, 400);
    assert.equal((await pay(manager, inv.id, '100', { method: 'BITCOIN' })).status, 400);
    const p2 = await pay(manager, inv.id, '600');
    assert.equal(p2.body.data.invoice.status, 'PAID');
    assert.equal(p2.body.data.invoice.paymentState, 'PAID');
    assert.equal((await pay(manager, inv.id, '1')).status, 409, 'already paid');
    assert.equal(await sys(() => Notification.countDocuments({ userId: sales.user.id, type: 'INVOICE_PAID' })), 1, 'the client\'s owner (Sales) is told');
    assert.equal((await get(sales, `${INV}/${inv.id}`)).status, 200, 'Sales can read invoices of own clients');
    assert.equal((await pay(sales, inv.id, '1')).status, 403);
  });

  it('race: two people record the full remaining balance at the same time → exactly one succeeds', async () => {
    const inv = await draft(manager, ownerClient.id);
    await issue(manager, inv.id);
    const [a, b] = await Promise.all([pay(manager, inv.id, '1000'), pay(owner, inv.id, '1000')]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    const db = await sys(() => ClientInvoice.findById(inv.id));
    assert.equal(db.paidMinor, 100000);
    assert.equal(db.balanceMinor, 0);
    assert.equal(await sys(() => ClientPayment.countDocuments({ invoiceId: inv.id })), 1);
  });

  it('void a payment: reason required, money goes back to the balance, PAID → ISSUED, record kept; voiding an invoice with payments is refused', async () => {
    const inv = await draft(manager, ownerClient.id);
    await issue(manager, inv.id);
    const p = (await pay(manager, inv.id, '1000')).body.data.payment;
    assert.equal((await post(manager, `${INV}/${inv.id}/void`, { reason: 'Wrong client' })).status, 409, 'void the payments first');
    assert.equal((await post(manager, `${INV}/payments/${p.id}/void`, {})).status, 400, 'reason required');
    const v = await post(manager, `${INV}/payments/${p.id}/void`, { reason: 'Cheque bounced' });
    assert.equal(v.status, 200);
    assert.equal(v.body.data.invoice.status, 'ISSUED');
    assert.equal(v.body.data.invoice.balanceMinor, 100000);
    assert.equal((await post(manager, `${INV}/payments/${p.id}/void`, { reason: 'again' })).status, 409);
    const kept = await sys(() => ClientPayment.findById(p.id));
    assert.equal(kept.voided, true, 'never deleted');
    const vi = await post(manager, `${INV}/${inv.id}/void`, { reason: 'Wrong client' });
    assert.equal(vi.status, 200);
    assert.equal(vi.body.data.invoice.status, 'VOID');
    assert.equal((await pay(manager, inv.id, '1')).status, 409);
  });

  it('stock: issuing takes stock (refused if not enough → stays draft), whole units only, property → SOLD; void gives it back', async () => {
    const a = await draft(manager, ownerClient.id, [{ itemId: laptop.id, quantity: '3' }, { itemId: plot.id, quantity: '1' }]);
    assert.equal((await issue(manager, a.id)).status, 200);
    assert.equal((await sys(() => Item.findById(laptop.id))).stockQty, 2);
    assert.equal((await sys(() => Item.findById(plot.id))).availability, 'SOLD');
    const b = await draft(manager, ownerClient.id, [{ itemId: laptop.id, quantity: '3' }]);
    const r = await issue(manager, b.id);
    assert.equal(r.status, 409);
    assert.match(r.body.message, /Not enough stock/);
    assert.equal((await sys(() => ClientInvoice.findById(b.id))).status, 'DRAFT');
    assert.equal((await sys(() => Item.findById(laptop.id))).stockQty, 2, 'nothing taken');
    const c = await draft(manager, ownerClient.id, [{ itemId: laptop.id, quantity: '1.5' }]);
    assert.equal((await issue(manager, c.id)).status, 409);
    await post(manager, `${INV}/${a.id}/void`, { reason: 'Order cancelled' });
    assert.equal((await sys(() => Item.findById(laptop.id))).stockQty, 5);
    assert.equal((await sys(() => Item.findById(plot.id))).availability, 'AVAILABLE');
  });

  it('from an accepted quote: quote prices (not today\'s catalog); only once while not void; not from a draft quote', async () => {
    const lead = (await post(owner, '/api/v1/leads', { name: 'Hamza Traders', phone: '0300 9998887' })).body.data.lead.id;
    const q = (await post(owner, '/api/v1/quotes', { leadId: lead, lines: [{ itemId: laptop.id, quantity: '1' }] })).body.data.quote;
    assert.equal((await post(manager, `${INV}/from-quote/${q.id}`)).status, 409, 'not accepted yet');
    await post(owner, `/api/v1/quotes/${q.id}/status`, { status: 'SENT' });
    await post(owner, `/api/v1/quotes/${q.id}/status`, { status: 'ACCEPTED' });
    await patch(owner, `/api/v1/items/${laptop.id}`, { price: '175000' });
    const r = await post(manager, `${INV}/from-quote/${q.id}`);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.data.invoice.lines[0].unitPriceMinor, 15000000, 'the quoted price');
    assert.equal(r.body.data.invoice.totalMinor, q.totalMinor);
    assert.equal((await post(manager, `${INV}/from-quote/${q.id}`)).status, 409, 'already invoiced');
  });

  it('overdue: calculated from the due date, filterable, ONE notification per invoice', async () => {
    const inv = await draft(manager, salesClient.id);
    await issue(manager, inv.id, { issueDate: new Date(Date.now() - 40 * DAY).toISOString(), dueDate: new Date(Date.now() - 10 * DAY).toISOString() });
    const list = await get(manager, `${INV}?overdue=true`);
    const row = list.body.data.items.find((x) => x.id === inv.id);
    assert.ok(row && row.overdue && row.daysOverdue >= 9);
    assert.ok((await notifyOverdueInvoices()) >= 1);
    assert.equal(await notifyOverdueInvoices(), 0);
    assert.equal(await sys(() => Notification.countDocuments({ userId: sales.user.id, type: 'INVOICE_OVERDUE' })), 1);
    const sum = await get(manager, `${INV}/summary`);
    assert.ok(sum.body.data.overdue.PKR >= 100000);
    assert.ok(sum.body.data.outstanding.PKR >= sum.body.data.overdue.PKR);
  });

  it('interrupted issue (server crash) → back to DRAFT and stock returned, never auto-issued', async () => {
    const inv = await draft(manager, ownerClient.id, [{ itemId: laptop.id, quantity: '2' }]);
    await sys(() => Item.updateOne({ _id: laptop.id }, { $inc: { stockQty: -2 } })); // as if stock was taken…
    await sys(() => ClientInvoice.collection.updateOne({ _id: new ClientInvoice.base.Types.ObjectId(inv.id) }, { $set: { status: 'ISSUING', stockTaken: true, updatedAt: new Date(Date.now() - 20 * 60 * 1000) } }));
    const before = (await sys(() => Item.findById(laptop.id))).stockQty;
    assert.ok((await recoverStuckIssuing()) >= 1);
    const db = await sys(() => ClientInvoice.findById(inv.id));
    assert.equal(db.status, 'DRAFT');
    assert.equal(db.number, null);
    assert.equal((await sys(() => Item.findById(laptop.id))).stockQty, before + 2);
  });

  it('isolation + records: other company 404; Sales sees only own clients\' invoices; a client with invoices can\'t be deleted', async () => {
    assert.equal((await get(other, `${INV}/${first.id}`)).status, 404);
    assert.equal((await pay(other, first.id, '1')).status, 404, 'their owner may record payments — but only on THEIR invoices');
    assert.equal((await get(other, INV)).body.data.items.length, 0);
    assert.equal((await get(other, `${INV}/payments`)).body.data.items.length, 0);
    assert.equal((await get(sales, `${INV}/${first.id}`)).status, 404);
    assert.ok((await get(sales, INV)).body.data.items.every((x) => x.clientId.id === salesClient.id));
    assert.equal((await request(app).delete(`/api/v1/clients/${ownerClient.id}`).set(bearer(owner.token))).status, 409);
  });
});
