// PHASE 23 — ACCOUNTING-LITE: expenses (edit audited, void not delete), closed periods (expenses AND payments),
// cash-basis P&L in the company's time zone, receivables aging, breakdowns, permission + plan + isolation.
import './helpers/setupEnv.js';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../src/app.js';
import Plan from '../src/models/Plan.js';
import Subscription from '../src/models/Subscription.js';
import ClientInvoice from '../src/models/ClientInvoice.js';
import AuditLog from '../src/models/AuditLog.js';
import { DEFAULT_PLANS } from '../src/config/defaultPlans.js';
import { runAsSystem } from '../src/utils/tenantContext.js';
import { zonedDayKey } from '../src/utils/zonedTime.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';
import { bearer, registerTenant, inviteAndAccept } from './helpers/authHelpers.js';

const sys = (fn) => runAsSystem('test', fn);
async function usePlan(tenantId, code) {
  const plan = await Plan.findOne({ code });
  await sys(() => Subscription.updateOne({ tenantId }, { $set: { planId: plan._id } }));
}
const A = '/api/v1/accounting';
const TZ = 'Asia/Karachi';
const DAY = 86400000;
const kday = (d) => zonedDayKey(d, TZ);

describe('Accounting-lite', () => {
  let owner, admin, manager, other, growthCo;
  let clientId, clientB;
  const post = (u, url, body) => request(app).post(url).set(bearer(u.token)).send(body);
  const patch = (u, url, body) => request(app).patch(url).set(bearer(u.token)).send(body);
  const get = (u, url) => request(app).get(url).set(bearer(u.token));
  const thisMonth = () => kday(new Date()).slice(0, 7);
  const expense = (u, body) => post(u, `${A}/expenses`, { category: 'Rent', amount: '50000', ...body });
  async function paidInvoice(cid, amount, paidAt) {
    const inv = (await post(owner, '/api/v1/invoices', { clientId: cid, lines: [{ description: 'Work', quantity: '1', unitPrice: amount }] })).body.data.invoice;
    await post(owner, `/api/v1/invoices/${inv.id}/issue`, {});
    const p = await post(owner, `/api/v1/invoices/${inv.id}/payments`, { amount, method: 'BANK_TRANSFER', ...(paidAt && { paidAt }) });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    return { inv, payment: p.body.data.payment };
  }

  before(async () => {
    await startTestDb();
    await Plan.insertMany(DEFAULT_PLANS);
    owner = await registerTenant();
    await usePlan(owner.tenant.id, 'pro');
    admin = await inviteAndAccept(owner, 'ADMIN');
    manager = await inviteAndAccept(owner, 'MANAGER');
    other = await registerTenant();
    await usePlan(other.tenant.id, 'pro');
    growthCo = await registerTenant();
    await usePlan(growthCo.tenant.id, 'growth');
    await patch(owner, '/api/v1/settings/sales', { currency: 'PKR' });
    await patch(owner, '/api/v1/settings/general', { timezone: TZ });
    clientId = (await post(owner, '/api/v1/clients', { name: 'Ali Bakery' })).body.data.client.id;
    clientB = (await post(owner, '/api/v1/clients', { name: 'Sara Salon' })).body.data.client.id;
  });
  after(stopTestDb);

  it('plan module ACCOUNTING (402) and accounting:manage only (owner/admin; manager 403)', async () => {
    assert.equal((await get(growthCo, `${A}/summary`)).status, 402);
    assert.equal((await get(manager, `${A}/summary`)).status, 403);
    assert.equal((await get(admin, `${A}/summary`)).status, 200);
  });

  let rentId;
  it('expenses: category from the list, no future day, amount > 0; currency = company currency', async () => {
    const r = await expense(admin, { vendor: 'Landlord', reference: 'Rent Oct' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    rentId = r.body.data.expense.id;
    assert.equal(r.body.data.expense.currency, 'PKR');
    assert.equal(r.body.data.expense.amountMinor, 5000000);
    assert.equal(r.body.data.expense.day, kday(new Date()), 'today in the company time zone');
    assert.equal((await expense(admin, { category: 'Yacht' })).status, 400);
    assert.equal((await expense(admin, { day: kday(new Date(Date.now() + 3 * DAY)) })).status, 400);
    for (const amount of ['0', '-5', '1e3']) assert.equal((await expense(admin, { amount })).status, 400, amount);
    assert.equal((await expense(admin, { amountMinor: 1 })).status, 400, 'unknown field');
  });

  it('edit is audited (old → new); void needs a reason; void is not delete; void twice 409; totals ignore void', async () => {
    const e = await patch(admin, `${A}/expenses/${rentId}`, { amount: '55000' });
    assert.equal(e.status, 200);
    const log = await sys(() => AuditLog.findOne({ action: 'expense.updated', targetId: rentId }));
    assert.deepEqual(log.metadata.changes.amountMinor, { from: '5000000', to: '5500000' });
    const tmp = (await expense(admin, { category: 'Marketing', amount: '1000' })).body.data.expense;
    assert.equal((await post(admin, `${A}/expenses/${tmp.id}/void`, {})).status, 400);
    assert.equal((await post(admin, `${A}/expenses/${tmp.id}/void`, { reason: 'Entered twice' })).status, 200);
    assert.equal((await post(admin, `${A}/expenses/${tmp.id}/void`, { reason: 'again' })).status, 409);
    const list = await get(admin, `${A}/expenses`);
    assert.equal(list.body.data.totals.PKR, 5500000, 'void expense not counted');
    assert.equal((await get(admin, `${A}/expenses?status=VOID`)).body.data.items.length, 1, 'still kept');
  });

  it('closed books: nothing on/before the lock day can be added, edited or voided — expenses AND payments', async () => {
    const old = kday(new Date(Date.now() - 20 * DAY));
    const oldExp = (await expense(admin, { day: old, category: 'Utilities', amount: '7000' })).body.data.expense;
    const { payment } = await paidInvoice(clientId, '2000', new Date(Date.now() - 20 * DAY).toISOString());
    const lock = kday(new Date(Date.now() - 10 * DAY));
    assert.equal((await patch(admin, `${A}/settings`, { lockedUntil: kday(new Date()) })).status, 400, 'today is not over yet');
    assert.equal((await patch(manager, `${A}/settings`, { lockedUntil: lock })).status, 403);
    assert.equal((await patch(admin, `${A}/settings`, { lockedUntil: lock })).status, 200);
    let r = await expense(admin, { day: old });
    assert.equal(r.status, 409);
    assert.equal(r.body.errors[0].code, 'PERIOD_LOCKED');
    assert.equal((await patch(admin, `${A}/expenses/${oldExp.id}`, { amount: '1' })).status, 409);
    assert.equal((await post(admin, `${A}/expenses/${oldExp.id}/void`, { reason: 'x wrong' })).status, 409);
    assert.equal((await patch(admin, `${A}/expenses/${rentId}`, { day: old })).status, 409, 'can\'t move an open expense INTO a closed period');
    assert.equal((await post(owner, `/api/v1/invoices/payments/${payment.id}/void`, { reason: 'bounced' })).status, 409, 'payments in closed periods are frozen too');
    const inv = (await post(owner, '/api/v1/invoices', { clientId, lines: [{ description: 'x', quantity: '1', unitPrice: '10' }] })).body.data.invoice;
    await post(owner, `/api/v1/invoices/${inv.id}/issue`, {});
    r = await post(owner, `/api/v1/invoices/${inv.id}/payments`, { amount: '10', method: 'CASH', paidAt: new Date(Date.now() - 15 * DAY).toISOString() });
    assert.equal(r.status, 409);
    assert.equal((await patch(admin, `${A}/settings`, { lockedUntil: null })).status, 200, 're-open');
    assert.ok(await sys(() => AuditLog.exists({ action: 'accounting.period_reopened' })));
    assert.equal((await post(owner, `/api/v1/invoices/${inv.id}/payments`, { amount: '10', method: 'CASH', paidAt: new Date(Date.now() - 15 * DAY).toISOString() })).status, 201);
  });

  it('P&L (cash): payments − expenses per month in the COMPANY time zone; voided payments drop out', async () => {
    const now = new Date();
    // 21:00 UTC on the last day of last month = 02:00 on the 1st of THIS month in Karachi
    const edge = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 3 * 3600 * 1000);
    const edgeCounts = kday(edge).slice(0, 7) === thisMonth(); // false only in the few hours when UTC and Karachi are in different months
    if (edgeCounts) await paidInvoice(clientB, '30000', edge.toISOString());
    const { payment } = await paidInvoice(clientId, '100000', undefined);
    const m = thisMonth();
    const r = await get(admin, `${A}/reports/pnl?from=${m}&to=${m}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.basis, 'CASH');
    const pkr = r.body.data.currencies.PKR.rows[0];
    assert.ok(pkr.income >= 10000000 + (edgeCounts ? 3000000 : 0), 'includes the edge payment (Karachi month) and today\'s payment');
    assert.ok(pkr.expenses >= 5500000);
    assert.equal(pkr.profit, pkr.income - pkr.expenses);
    await post(owner, `/api/v1/invoices/payments/${payment.id}/void`, { reason: 'Cheque bounced' });
    const after = (await get(admin, `${A}/reports/pnl?from=${m}&to=${m}`)).body.data.currencies.PKR.rows[0];
    assert.equal(after.income, pkr.income - 10000000);
    assert.equal((await get(admin, `${A}/reports/pnl?from=2020-01&to=2026-12`)).status, 400, 'max 24 months');
    assert.equal((await get(admin, `${A}/reports/pnl?from=2026-05&to=2026-01`)).status, 400);
  });

  it('receivables aging by client: 31–60 days overdue bucket, current, totals', async () => {
    const inv = (await post(owner, '/api/v1/invoices', { clientId: clientB, lines: [{ description: 'Old work', quantity: '1', unitPrice: '40000' }] })).body.data.invoice;
    await post(owner, `/api/v1/invoices/${inv.id}/issue`, { issueDate: new Date(Date.now() - 60 * DAY).toISOString(), dueDate: new Date(Date.now() - 45 * DAY).toISOString() });
    const fresh = (await post(owner, '/api/v1/invoices', { clientId, lines: [{ description: 'New work', quantity: '1', unitPrice: '1000' }] })).body.data.invoice;
    await post(owner, `/api/v1/invoices/${fresh.id}/issue`, {});
    const r = (await get(admin, `${A}/reports/aging`)).body.data;
    assert.ok(r.currencies.PKR.buckets['31-60'] >= 4000000);
    assert.ok(r.currencies.PKR.buckets.current >= 100000);
    const sara = r.currencies.PKR.clients.find((c) => c.name === 'Sara Salon');
    assert.ok(sara.buckets['31-60'] >= 4000000);
    const open = await sys(() => ClientInvoice.find({ status: 'ISSUED' }));
    assert.equal(r.currencies.PKR.total, open.filter((i) => String(i.tenantId) === owner.tenant.id).reduce((s, i) => s + i.balanceMinor, 0));
  });

  it('income by client + expenses by category / project; summary', async () => {
    await paidInvoice(clientId, '5000');
    const m = thisMonth();
    const inc = (await get(admin, `${A}/reports/income-by-client?from=${m}&to=${m}`)).body.data;
    assert.ok(inc.currencies.PKR.items.some((i) => i.name === 'Ali Bakery'));
    const cat = (await get(admin, `${A}/reports/expenses?from=${m}&to=${m}&by=category`)).body.data;
    assert.equal(cat.currencies.PKR.items[0].name, 'Rent');
    assert.ok(!cat.currencies.PKR.items.some((i) => i.name === 'Marketing'), 'void expense excluded');
    assert.equal((await get(admin, `${A}/reports/expenses?from=${m}&to=${m}&by=vendor`)).status, 400);
    const s = (await get(admin, `${A}/summary`)).body.data;
    assert.equal(s.month, m);
    assert.ok(s.thisMonth.PKR.income > 0);
    assert.ok(s.receivables.PKR.overdue >= 4000000);
    assert.ok(s.expenseCategories.includes('Rent'));
  });

  it('isolation: another company sees nothing and can\'t touch our expenses', async () => {
    assert.equal((await get(other, `${A}/expenses`)).body.data.items.length, 0);
    assert.equal((await patch(other, `${A}/expenses/${rentId}`, { amount: '1' })).status, 404);
    assert.equal((await post(other, `${A}/expenses/${rentId}/void`, { reason: 'hack attempt' })).status, 404);
    assert.deepEqual((await get(other, `${A}/reports/aging`)).body.data.currencies, {});
    const m = thisMonth();
    assert.deepEqual((await get(other, `${A}/reports/pnl?from=${m}&to=${m}`)).body.data.currencies, {});
  });
});
