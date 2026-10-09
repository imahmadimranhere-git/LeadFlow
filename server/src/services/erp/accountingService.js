// Accounting-lite (spec A12 module 5): expenses + financial reports.
//
//   - money: integer minor units, per currency (never mixed)
//   - expenses are edited (audited, old → new) or VOIDED — never deleted
//   - "Books closed until <day>": nothing dated on/before that day can be added, changed or voided
//     (expenses AND client payments) → last month's numbers can't silently change after you reported them
//   - who: accounting:manage (owner + admin by default) — financial data is sensitive
import Expense from '../../models/Expense.js';
import ClientPayment from '../../models/ClientPayment.js';
import ClientInvoice from '../../models/ClientInvoice.js';
import Client from '../../models/Client.js';
import Project from '../../models/Project.js';
import TenantSettings from '../../models/TenantSettings.js';
import ApiError from '../../utils/ApiError.js';
import { buildPagination, escapeRegex } from '../../utils/queryBuilder.js';
import { zonedDayKey, zonedMidnight } from '../../utils/zonedTime.js';
import { DEFAULT_EXPENSE_CATEGORIES } from '../../config/erpOptions.js';
import { recordAudit } from '../audit/auditService.js';
import { companyClock } from '../followUps/followUpService.js';
import { salesSettings } from './quoteService.js';
import { monthOf, monthsBetween, buildPnl, buildAging, groupTotals, isLocked } from './accountingReports.js';

const audit = (auth, action, id, metadata = {}) => recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action, targetType: 'Expense', targetId: id, metadata });

export async function accountingSettings() {
  const s = await TenantSettings.findOne({}).select('accounting');
  return { expenseCategories: s?.accounting?.expenseCategories?.length ? [...s.accounting.expenseCategories] : [...DEFAULT_EXPENSE_CATEGORIES], lockedUntil: s?.accounting?.lockedUntil || null };
}

export function lockedError(lockedUntil) {
  return new ApiError(409, `The books are closed until ${lockedUntil} — change the date or re-open the period in Accounting → Settings.`, [{ code: 'PERIOD_LOCKED', field: 'day', message: lockedUntil }]);
}

/** Used by payments too: throws if this day is in a closed period. */
export async function assertOpenPeriod(dayKey) {
  const { lockedUntil } = await accountingSettings();
  if (isLocked(dayKey, lockedUntil)) throw lockedError(lockedUntil);
}

async function todayKey() {
  const { timezone } = await companyClock();
  return { today: zonedDayKey(new Date(), timezone), timezone };
}

async function checkExpense(data, settings) {
  if (data.category !== undefined && !settings.expenseCategories.includes(data.category)) {
    throw ApiError.badRequest('Validation failed', [{ field: 'category', message: 'Choose a category from your list (Accounting → Settings)' }]);
  }
  if (data.day !== undefined) {
    const { today } = await todayKey();
    if (data.day > today) throw ApiError.badRequest('Validation failed', [{ field: 'day', message: 'An expense can\'t be in the future' }]);
    if (isLocked(data.day, settings.lockedUntil)) throw lockedError(settings.lockedUntil);
  }
  if (data.projectId && !(await Project.exists({ _id: data.projectId }))) throw ApiError.badRequest('Validation failed', [{ field: 'projectId', message: 'Project not found' }]);
}

// ---------------------------------------------------------------- expenses

export async function listExpenses({ page, limit, from, to, category, projectId, status, q }) {
  const { skip } = buildPagination(page, limit);
  const filter = { status: status || 'RECORDED' };
  if (from || to) filter.day = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  if (category) filter.category = category;
  if (projectId) filter.projectId = projectId;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ vendor: rx }, { description: rx }, { reference: rx }];
  }
  const [items, total, sums] = await Promise.all([
    Expense.find(filter).sort({ day: -1, createdAt: -1 }).skip(skip).limit(limit).populate('projectId', 'name').populate('createdBy', 'name'),
    Expense.countDocuments(filter),
    Expense.aggregate([{ $match: filter }, { $group: { _id: '$currency', total: { $sum: '$amountMinor' } } }]),
  ]);
  return { items: items.map((e) => e.toJSON()), total, totals: Object.fromEntries(sums.map((s) => [s._id, s.total])) };
}

export async function createExpense(auth, data) {
  const settings = await accountingSettings();
  const { today } = await todayKey();
  const d = { ...data, day: data.day || today };
  await checkExpense(d, settings);
  const { currency } = await salesSettings();
  const e = await Expense.create({ ...d, currency, createdBy: auth.userId });
  await audit(auth, 'expense.created', e._id, { amountMinor: e.amountMinor, category: e.category, day: e.day });
  return e.toJSON();
}

export async function updateExpense(auth, id, data) {
  const e = await Expense.findOne({ _id: id });
  if (!e) throw ApiError.notFound('Expense not found');
  if (e.status === 'VOID') throw ApiError.conflict('This expense is void.');
  const settings = await accountingSettings();
  if (isLocked(e.day, settings.lockedUntil)) throw lockedError(settings.lockedUntil); // the OLD date is closed
  await checkExpense(data, settings);
  const changes = {};
  for (const [k, v] of Object.entries(data)) {
    const before = e.get(k) ?? null;
    if (String(before ?? '') !== String(v ?? '')) changes[k] = { from: before === null ? null : String(before), to: v === null ? null : String(v) };
    e.set(k, v);
  }
  e.updatedBy = auth.userId;
  await e.save();
  if (Object.keys(changes).length) await audit(auth, 'expense.updated', e._id, { changes });
  return e.toJSON();
}

export async function voidExpense(auth, id, { reason }) {
  const e = await Expense.findOne({ _id: id });
  if (!e) throw ApiError.notFound('Expense not found');
  const { lockedUntil } = await accountingSettings();
  if (isLocked(e.day, lockedUntil)) throw lockedError(lockedUntil);
  const r = await Expense.findOneAndUpdate({ _id: e._id, status: 'RECORDED' }, { $set: { status: 'VOID', voidedAt: new Date(), voidReason: reason, updatedBy: auth.userId } }, { new: true });
  if (!r) throw ApiError.conflict('This expense is already void.');
  await audit(auth, 'expense.voided', e._id, { reason, amountMinor: e.amountMinor });
  return r.toJSON();
}

// ---------------------------------------------------------------- settings

export async function updateAccountingSettings(auth, { expenseCategories, lockedUntil }) {
  const s = await TenantSettings.findOne({});
  if (!s) throw ApiError.notFound('Settings not found');
  const before = s.accounting?.lockedUntil || null;
  if (expenseCategories !== undefined) s.set('accounting.expenseCategories', [...new Set(expenseCategories)]);
  if (lockedUntil !== undefined) {
    const { today } = await todayKey();
    if (lockedUntil && lockedUntil >= today) throw ApiError.badRequest('Validation failed', [{ field: 'lockedUntil', message: 'You can only close days that are over (before today)' }]);
    s.set('accounting.lockedUntil', lockedUntil || null);
  }
  await s.save();
  if (lockedUntil !== undefined && lockedUntil !== before) {
    await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: lockedUntil && (!before || lockedUntil > before) ? 'accounting.period_closed' : 'accounting.period_reopened', targetType: 'TenantSettings', metadata: { from: before, to: lockedUntil || null } });
  }
  return accountingSettings();
}

// ---------------------------------------------------------------- reports

/** [from, to) instants for whole company-time-zone months "YYYY-MM". */
function monthRange(months, timezone) {
  const [fy, fm] = months[0].split('-').map(Number);
  const [ty, tm] = months[months.length - 1].split('-').map(Number);
  const next = tm === 12 ? [ty + 1, 1] : [ty, tm + 1];
  return { start: zonedMidnight(fy, fm, 1, timezone), end: zonedMidnight(next[0], next[1], 1, timezone) };
}

function parseMonths(from, to) {
  const months = monthsBetween(from, to, 24);
  if (!months) throw ApiError.badRequest('Validation failed', [{ field: 'from', message: 'Choose a valid range of at most 24 months (YYYY-MM)' }]);
  return months;
}

async function paymentsIn(start, end, timezone) {
  const pays = await ClientPayment.find({ voided: false, paidAt: { $gte: start, $lt: end } }).select('paidAt currency amountMinor clientId').limit(50000);
  return pays.map((p) => ({ month: monthOf(zonedDayKey(p.paidAt, timezone)), day: zonedDayKey(p.paidAt, timezone), currency: p.currency, amountMinor: p.amountMinor, clientId: p.clientId }));
}

async function expensesIn(months) {
  const ex = await Expense.find({ status: 'RECORDED', day: { $gte: `${months[0]}-01`, $lte: `${months[months.length - 1]}-31` } }).select('day currency amountMinor category projectId').limit(50000);
  return ex.map((e) => ({ month: monthOf(e.day), currency: e.currency, amountMinor: e.amountMinor, category: e.category, projectId: e.projectId }));
}

export async function profitAndLoss({ from, to }) {
  const months = parseMonths(from, to);
  const { timezone } = await companyClock();
  const { start, end } = monthRange(months, timezone);
  const [income, expenses] = await Promise.all([paymentsIn(start, end, timezone), expensesIn(months)]);
  return { basis: 'CASH', timezone, ...buildPnl(months, income, expenses) };
}

export async function receivablesAging(now = new Date()) {
  const open = await ClientInvoice.find({ status: 'ISSUED', balanceMinor: { $gt: 0 } }).select('clientId currency balanceMinor dueDate').populate('clientId', 'name').limit(20000);
  return { asOf: now, ...buildAging(open.map((i) => ({ clientId: i.clientId?._id || i.clientId, clientName: i.clientId?.name, currency: i.currency, balanceMinor: i.balanceMinor, dueDate: i.dueDate })), now) };
}

export async function incomeByClient({ from, to }) {
  const months = parseMonths(from, to);
  const { timezone } = await companyClock();
  const { start, end } = monthRange(months, timezone);
  const pays = await paymentsIn(start, end, timezone);
  const clients = await Client.find({ _id: { $in: [...new Set(pays.map((p) => String(p.clientId)))] }, deletedAt: { $not: { $type: 'string' } } }).select('name'); // includes deleted clients — their money still counts
  const names = new Map(clients.map((c) => [String(c._id), c.name]));
  return { months, currencies: groupTotals(pays.map((p) => ({ key: String(p.clientId), name: names.get(String(p.clientId)) || '(deleted client)', currency: p.currency, amountMinor: p.amountMinor }))) };
}

export async function expensesBreakdown({ from, to, by = 'category' }) {
  const months = parseMonths(from, to);
  const ex = await expensesIn(months);
  if (by === 'project') {
    const projects = await Project.find({ _id: { $in: [...new Set(ex.filter((e) => e.projectId).map((e) => String(e.projectId)))] } }).select('name');
    const names = new Map(projects.map((p) => [String(p._id), p.name]));
    return { months, by, currencies: groupTotals(ex.map((e) => ({ key: e.projectId ? String(e.projectId) : '-', name: e.projectId ? names.get(String(e.projectId)) || '(deleted project)' : 'No project', currency: e.currency, amountMinor: e.amountMinor }))) };
  }
  return { months, by, currencies: groupTotals(ex.map((e) => ({ key: e.category, name: e.category, currency: e.currency, amountMinor: e.amountMinor }))) };
}

/** Dashboard numbers: this month (company time zone). */
export async function accountingSummary() {
  const { timezone } = await companyClock();
  const month = monthOf(zonedDayKey(new Date(), timezone));
  const pnl = await profitAndLoss({ from: month, to: month });
  const aging = await receivablesAging();
  const receivables = Object.fromEntries(Object.entries(aging.currencies).map(([c, v]) => [c, { total: v.total, overdue: v.total - v.buckets.current }]));
  return { month, thisMonth: Object.fromEntries(Object.entries(pnl.currencies).map(([c, v]) => [c, v.totals])), receivables, ...(await accountingSettings()) };
}
