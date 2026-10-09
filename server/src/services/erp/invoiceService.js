// Client invoices + payments (spec A12 module 2).
//
// Accounting rules enforced here:
//   - totals: same server-side math as quotes (quoteMath.js); browser totals are never accepted
//   - DRAFT has no number. "Issue" gives the next number (INV-2026-0001…) — drafts that are deleted never
//     leave gaps. Issued invoices can't be edited; a mistake is fixed with VOID (reason required) + a new invoice.
//   - payments only change the balance atomically: "balance ≥ amount" is part of the database update itself,
//     so two people recording the last payment at the same time can't overpay
//   - payments are never edited or deleted; a wrong one is VOIDED (reason) and the balance comes back
//   - stock: issuing takes stock of stocked items (refused if not enough), properties become SOLD; voiding gives it back
//   - money permission: only invoices:manage (owner, admin, manager) creates/issues/voids invoices or records payments;
//     Sales can READ invoices of their own clients.
import ClientInvoice from '../../models/ClientInvoice.js';
import ClientPayment from '../../models/ClientPayment.js';
import Client from '../../models/Client.js';
import Quote from '../../models/Quote.js';
import Item from '../../models/Item.js';
import Tenant from '../../models/Tenant.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { buildPagination, escapeRegex } from '../../utils/queryBuilder.js';
import { runAsSystem, runWithTenant } from '../../utils/tenantContext.js';
import { recordAudit } from '../audit/auditService.js';
import { notify } from '../notifications/notificationService.js';
import { clientScope } from './clientService.js';
import { salesSettings, buildLines, applyTotals, nextNumber } from './quoteService.js';
import { invoiceView, paymentProblem, dueDateFor, stockNeeds } from './invoiceRules.js';
import { releaseTimeForInvoice } from './projectService.js';
import { assertOpenPeriod } from './accountingService.js';
import { companyClock } from '../followUps/followUpService.js';
import { zonedDayKey, zonedParts, zonedMidnight } from '../../utils/zonedTime.js';

const STUCK_MS = 10 * 60 * 1000;
const audit = (auth, action, id, metadata = {}) => recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action, targetType: 'ClientInvoice', targetId: id, metadata });

async function invoiceScope(auth) {
  const cs = clientScope(auth);
  if (!Object.keys(cs).length) return {};
  const mine = await Client.find(cs).select('_id').limit(5000);
  return { clientId: { $in: mine.map((c) => c._id) } };
}

async function loadInvoice(auth, id) {
  const inv = await ClientInvoice.findOne({ $and: [{ _id: id }, await invoiceScope(auth)] });
  if (!inv) throw ApiError.notFound('Invoice not found');
  return inv;
}

const withView = (inv, now = new Date()) => ({ ...inv.toJSON(), ...invoiceView(inv, now) });

async function toPublic(id) {
  const inv = await ClientInvoice.findById(id).populate([{ path: 'clientId', select: 'name email phone address city country taxId' }, { path: 'quoteId', select: 'number' }, { path: 'ownerId', select: 'name' }, { path: 'issuedBy', select: 'name' }]);
  return withView(inv);
}

async function loadClient(auth, clientId) {
  const c = await Client.findOne({ $and: [{ _id: clientId }, clientScope(auth)] });
  if (!c) throw ApiError.badRequest('Validation failed', [{ field: 'clientId', message: 'Client not found' }]);
  return c;
}

// ---------------------------------------------------------------- read

export async function listInvoices(auth, { page, limit, status, clientId, overdue, q }, now = new Date()) {
  const { skip } = buildPagination(page, limit);
  const and = [await invoiceScope(auth)];
  if (status) and.push({ status });
  if (clientId) and.push({ clientId });
  if (overdue) and.push({ status: 'ISSUED', balanceMinor: { $gt: 0 }, dueDate: { $lt: now } });
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ number: rx }, { title: rx }] });
  }
  const filter = { $and: and.filter((f) => Object.keys(f).length) };
  if (!filter.$and.length) delete filter.$and;
  const [items, total] = await Promise.all([
    ClientInvoice.find(filter).select('-lines').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate('clientId', 'name'),
    ClientInvoice.countDocuments(filter),
  ]);
  return { items: items.map((i) => withView(i, now)), total };
}

/** Money overview per currency (never mixes currencies). */
export async function invoiceSummary(auth, now = new Date()) {
  const scope = await invoiceScope(auth);
  const open = await ClientInvoice.find({ ...scope, status: 'ISSUED' }).select('currency balanceMinor dueDate').limit(10000);
  const add = (map, k, v) => ({ ...map, [k]: (map[k] || 0) + v });
  let outstanding = {};
  let overdue = {};
  let overdueCount = 0;
  for (const i of open) {
    outstanding = add(outstanding, i.currency, i.balanceMinor);
    if (i.balanceMinor > 0 && i.dueDate && i.dueDate < now) {
      overdue = add(overdue, i.currency, i.balanceMinor);
      overdueCount += 1;
    }
  }
  const { timezone } = await companyClock();
  const zp = zonedParts(now, timezone);
  const monthStart = zonedMidnight(zp.year, zp.month, 1, timezone); // "this month" in the company's time zone
  const payScope = scope.clientId ? { clientId: scope.clientId } : {};
  const pays = await ClientPayment.find({ ...payScope, voided: false, paidAt: { $gte: monthStart } }).select('currency amountMinor').limit(10000);
  let receivedThisMonth = {};
  for (const p of pays) receivedThisMonth = add(receivedThisMonth, p.currency, p.amountMinor);
  return { outstanding, overdue, overdueCount, receivedThisMonth, openCount: open.length };
}

export async function getInvoice(auth, id) {
  const inv = await loadInvoice(auth, id);
  const [payments, settings, tenant] = await Promise.all([
    ClientPayment.find({ invoiceId: inv._id }).sort({ paidAt: 1, _id: 1 }).populate('recordedBy', 'name').populate('voidedBy', 'name'),
    salesSettings(),
    Tenant.findById(auth.tenantId).select('name'),
  ]);
  const p = settings.profile?.toObject ? settings.profile.toObject() : settings.profile || {};
  return {
    invoice: await toPublic(inv._id),
    payments: payments.map((x) => x.toJSON()),
    company: { name: tenant?.name || '', email: p.email || null, phone: p.phone || null, website: p.website || null, address: p.address || null, city: p.city || null, country: p.country || null, taxId: settings.taxId || null },
  };
}

// ---------------------------------------------------------------- drafts

export async function createInvoice(auth, data) {
  const settings = await salesSettings();
  const client = await loadClient(auth, data.clientId);
  const inv = new ClientInvoice({
    title: data.title || '',
    clientId: client._id,
    currency: settings.currency,
    dueDate: data.dueDate || null,
    notes: data.notes || '',
    footer: data.footer ?? settings.invoiceFooter ?? '',
    internalNote: data.internalNote || '',
    ownerId: client.ownerId || auth.userId,
    createdBy: auth.userId,
    updatedBy: auth.userId,
  });
  applyTotals(auth, inv, await buildLines(auth, data.lines, settings), data.discount, settings);
  await inv.save();
  await audit(auth, 'invoice.created', inv._id, { totalMinor: inv.totalMinor });
  return toPublic(inv._id);
}

/** Accepted quote → draft invoice with exactly the quote's lines and prices (not today's catalog). */
export async function invoiceFromQuote(auth, quoteId) {
  const quote = await Quote.findOne({ _id: quoteId });
  if (!quote) throw ApiError.notFound('Quote not found');
  if (quote.status !== 'ACCEPTED') throw ApiError.conflict('Only accepted quotes can be invoiced.');
  if (!quote.clientId) throw ApiError.conflict('This quote has no client yet.');
  const client = await loadClient(auth, quote.clientId);
  const settings = await salesSettings();
  const inv = new ClientInvoice({
    title: quote.title || `Quote ${quote.number}`,
    clientId: client._id,
    quoteId: quote._id,
    quoteLink: quote._id,
    currency: quote.currency,
    notes: quote.notes,
    footer: settings.invoiceFooter || '',
    ownerId: quote.ownerId || client.ownerId || auth.userId,
    createdBy: auth.userId,
    updatedBy: auth.userId,
  });
  const lines = quote.lines.map((l) => ({ itemId: l.itemId, description: l.description, unit: l.unit, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor, catalogPriceMinor: l.catalogPriceMinor, discountBp: l.discountBp, taxBp: l.taxBp }));
  // the quote was already approved at these prices → no Sales-limit check again (invoice managers only anyway)
  applyTotals({ ...auth, role: 'TENANT_OWNER' }, inv, lines, quote.discount?.toObject ? quote.discount.toObject() : quote.discount, settings);
  try {
    await inv.save();
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('This quote already has an invoice (void it first to make a new one).');
    throw err;
  }
  await audit(auth, 'invoice.created_from_quote', inv._id, { quoteId: String(quote._id), totalMinor: inv.totalMinor });
  return toPublic(inv._id);
}

export async function updateInvoice(auth, id, data) {
  const inv = await loadInvoice(auth, id);
  if (inv.status !== 'DRAFT') throw ApiError.conflict('Issued invoices can\'t be changed — void it and create a new one.');
  const settings = { ...(await salesSettings()), currency: inv.currency };
  if (data.clientId && String(data.clientId) !== String(inv.clientId)) {
    if (inv.quoteId) throw ApiError.badRequest('An invoice from a quote stays with that quote\'s client.');
    inv.clientId = (await loadClient(auth, data.clientId))._id;
  }
  for (const k of ['title', 'dueDate', 'notes', 'footer', 'internalNote']) if (data[k] !== undefined) inv[k] = data[k];
  if (data.lines || data.discount) {
    const lines = data.lines
      ? await buildLines(auth, data.lines, settings)
      : inv.lines.map((l) => ({ itemId: l.itemId, description: l.description, unit: l.unit, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor, catalogPriceMinor: l.catalogPriceMinor, discountBp: l.discountBp, taxBp: l.taxBp }));
    applyTotals(auth, inv, lines, data.discount ?? inv.discount, settings);
  }
  inv.updatedBy = auth.userId;
  try {
    await inv.save();
  } catch (err) {
    if (err.name === 'VersionError') throw ApiError.conflict('Someone else changed this invoice — reload and try again.');
    throw err;
  }
  return toPublic(inv._id);
}

export async function deleteDraft(auth, id) {
  const inv = await loadInvoice(auth, id);
  const r = await ClientInvoice.deleteOne({ _id: inv._id, status: 'DRAFT' }); // drafts have no number → no gap
  if (!r.deletedCount) throw ApiError.conflict('Only drafts can be deleted — issued invoices are voided instead.');
  await releaseTimeForInvoice(inv._id); // billed hours can be billed again
  await audit(auth, 'invoice.draft_deleted', inv._id);
  return { deleted: true };
}

// ---------------------------------------------------------------- stock

async function takeStock(inv) {
  const ids = inv.lines.filter((l) => l.itemId).map((l) => l.itemId);
  if (!ids.length) return { taken: [] };
  const items = await Item.find({ _id: { $in: ids } }).select('_id name stockQty type availability');
  const stocked = new Set(items.filter((i) => i.stockQty !== null && i.stockQty !== undefined).map((i) => String(i._id)));
  const { need, error } = stockNeeds(inv.lines, stocked);
  if (error) throw ApiError.conflict(error);
  const taken = [];
  for (const [itemId, units] of need) {
    const r = await Item.updateOne({ _id: itemId, stockQty: { $gte: units } }, { $inc: { stockQty: -units } });
    if (!r.modifiedCount) {
      await giveBack(taken);
      const name = items.find((i) => String(i._id) === itemId)?.name || 'An item';
      throw ApiError.conflict(`Not enough stock: "${name}" (needs ${units}).`);
    }
    taken.push([itemId, units]);
  }
  const properties = items.filter((i) => i.type === 'PROPERTY' && ['AVAILABLE', 'RESERVED'].includes(i.availability)).map((i) => i._id);
  if (properties.length) await Item.updateMany({ _id: { $in: properties } }, { $set: { availability: 'SOLD' } });
  return { taken, properties };
}
async function giveBack(taken) {
  for (const [itemId, units] of taken) await Item.updateOne({ _id: itemId }, { $inc: { stockQty: units } });
}
async function returnStock(inv) {
  const ids = inv.lines.filter((l) => l.itemId).map((l) => l.itemId);
  if (!ids.length) return;
  const items = await Item.find({ _id: { $in: ids } }).select('_id stockQty type availability');
  const stocked = new Set(items.filter((i) => i.stockQty !== null && i.stockQty !== undefined).map((i) => String(i._id)));
  const { need } = stockNeeds(inv.lines, stocked);
  await giveBack([...(need || new Map())]);
  const sold = items.filter((i) => i.type === 'PROPERTY' && i.availability === 'SOLD').map((i) => i._id);
  if (sold.length) await Item.updateMany({ _id: { $in: sold } }, { $set: { availability: 'AVAILABLE' } });
}

// ---------------------------------------------------------------- issue / void

export async function issueInvoice(auth, id, { issueDate, dueDate } = {}) {
  const inv = await loadInvoice(auth, id);
  if (inv.status !== 'DRAFT') throw ApiError.conflict('Only drafts can be issued.');
  if (!inv.lines.length) throw ApiError.badRequest('Add at least one line.');
  const settings = await salesSettings();
  const issued = issueDate || new Date();
  const due = dueDate || inv.dueDate || dueDateFor(issued, settings.paymentTermsDays ?? 15);
  if (due < new Date(issued.getTime() - 60_000)) throw ApiError.badRequest('Validation failed', [{ field: 'dueDate', message: 'Due date must be on or after the issue date' }]);

  // 1) claim — only one person can issue it
  const claimed = await ClientInvoice.findOneAndUpdate({ _id: inv._id, status: 'DRAFT' }, { $set: { status: 'ISSUING', updatedBy: auth.userId }, $inc: { __v: 1 } }, { new: true });
  if (!claimed) throw ApiError.conflict('This invoice is being issued by someone else.');
  // 2) stock
  try {
    await takeStock(claimed);
  } catch (err) {
    await ClientInvoice.updateOne({ _id: inv._id, status: 'ISSUING' }, { $set: { status: 'DRAFT' }, $inc: { __v: 1 } });
    throw err;
  }
  await ClientInvoice.updateOne({ _id: inv._id }, { $set: { stockTaken: true } });
  // 3) number (after everything that can fail → no gaps from failed attempts)
  const number = await nextNumber(auth.tenantId, settings.invoicePrefix || 'INV', 'invoice');
  const zero = claimed.totalMinor === 0;
  await ClientInvoice.updateOne(
    { _id: inv._id, status: 'ISSUING' },
    { $set: { status: zero ? 'PAID' : 'ISSUED', number, issueDate: issued, dueDate: due, paidMinor: 0, balanceMinor: claimed.totalMinor, issuedBy: auth.userId, ...(zero && { paidAt: issued }) }, $inc: { __v: 1 } }
  );
  await audit(auth, 'invoice.issued', inv._id, { number, totalMinor: claimed.totalMinor, currency: claimed.currency });
  return toPublic(inv._id);
}

export async function voidInvoice(auth, id, { reason }) {
  const inv = await loadInvoice(auth, id);
  if (!['ISSUED', 'PAID'].includes(inv.status)) throw ApiError.conflict(inv.status === 'DRAFT' ? 'Drafts are deleted, not voided.' : 'This invoice is already void.');
  if (inv.paidMinor > 0) throw ApiError.conflict('This invoice has payments — void the payments first (so the money record stays correct).');
  const r = await ClientInvoice.findOneAndUpdate(
    { _id: inv._id, status: { $in: ['ISSUED', 'PAID'] }, paidMinor: 0 },
    { $set: { status: 'VOID', voidedAt: new Date(), voidReason: reason, balanceMinor: 0, quoteLink: null, updatedBy: auth.userId }, $inc: { __v: 1 } },
    { new: true }
  );
  if (!r) throw ApiError.conflict('The invoice changed — reload and try again.');
  if (inv.stockTaken) await returnStock(inv);
  await releaseTimeForInvoice(inv._id);
  await audit(auth, 'invoice.voided', inv._id, { number: inv.number, reason });
  return toPublic(inv._id);
}

// ---------------------------------------------------------------- payments

export async function recordPayment(auth, id, { amountMinor, method, reference, paidAt, note }) {
  const inv = await loadInvoice(auth, id);
  const problem = paymentProblem(inv, amountMinor);
  const amountWrong = inv.status === 'ISSUED' && inv.balanceMinor > 0 && (amountMinor <= 0 || amountMinor > inv.balanceMinor);
  if (problem) throw amountWrong ? ApiError.badRequest('Validation failed', [{ field: 'amount', message: problem }]) : ApiError.conflict(problem);
  const when = paidAt || new Date();
  if (when.getTime() > Date.now() + 5 * 60 * 1000) throw ApiError.badRequest('Validation failed', [{ field: 'paidAt', message: 'The payment date cannot be in the future' }]);
  const { timezone } = await companyClock();
  await assertOpenPeriod(zonedDayKey(when, timezone)); // closed books can't change

  // atomic: the balance check is part of the update → no overpayment, even with two clicks at once
  const updated = await ClientInvoice.findOneAndUpdate(
    { _id: inv._id, status: 'ISSUED', balanceMinor: { $gte: amountMinor } },
    { $inc: { paidMinor: amountMinor, balanceMinor: -amountMinor, __v: 1 } },
    { new: true }
  );
  if (!updated) throw ApiError.conflict('The open balance changed (another payment?) — reload and check the amount.');
  let payment;
  try {
    payment = await ClientPayment.create({ invoiceId: inv._id, clientId: inv.clientId, amountMinor, currency: inv.currency, method, reference: reference || '', paidAt: when, note: note || '', recordedBy: auth.userId });
  } catch (err) {
    await ClientInvoice.updateOne({ _id: inv._id }, { $inc: { paidMinor: -amountMinor, balanceMinor: amountMinor, __v: 1 } }); // undo
    throw err;
  }
  if (updated.balanceMinor === 0) {
    await ClientInvoice.updateOne({ _id: inv._id, status: 'ISSUED', balanceMinor: 0 }, { $set: { status: 'PAID', paidAt: when }, $inc: { __v: 1 } });
    await notify({ userIds: [inv.ownerId], exceptUserId: auth.userId, type: 'INVOICE_PAID', title: `Invoice ${inv.number} is fully paid`, link: `/app/invoices/${inv._id}` });
  }
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'payment.recorded', targetType: 'ClientPayment', targetId: payment._id, metadata: { invoiceId: String(inv._id), amountMinor, method } });
  return { payment: payment.toJSON(), invoice: await toPublic(inv._id) };
}

export async function voidPayment(auth, paymentId, { reason }) {
  const pay = await ClientPayment.findOne({ _id: paymentId });
  if (!pay) throw ApiError.notFound('Payment not found');
  await loadInvoice(auth, pay.invoiceId); // scope check
  const { timezone } = await companyClock();
  await assertOpenPeriod(zonedDayKey(pay.paidAt, timezone));
  const r = await ClientPayment.findOneAndUpdate({ _id: pay._id, voided: false }, { $set: { voided: true, voidedAt: new Date(), voidedBy: auth.userId, voidReason: reason } }, { new: true });
  if (!r) throw ApiError.conflict('This payment is already void.');
  await ClientInvoice.updateOne({ _id: pay.invoiceId, status: { $in: ['ISSUED', 'PAID'] } }, { $inc: { paidMinor: -pay.amountMinor, balanceMinor: pay.amountMinor, __v: 1 } });
  await ClientInvoice.updateOne({ _id: pay.invoiceId, status: 'PAID', balanceMinor: { $gt: 0 } }, { $set: { status: 'ISSUED', paidAt: null }, $inc: { __v: 1 } });
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'payment.voided', targetType: 'ClientPayment', targetId: pay._id, metadata: { invoiceId: String(pay.invoiceId), amountMinor: pay.amountMinor, reason } });
  return { payment: r.toJSON(), invoice: await toPublic(pay.invoiceId) };
}

export async function listPayments(auth, { page, limit, clientId }) {
  const { skip } = buildPagination(page, limit);
  const scope = await invoiceScope(auth);
  const filter = { ...(scope.clientId ? { clientId: scope.clientId } : {}) };
  if (clientId) filter.clientId = scope.clientId ? { $in: scope.clientId.$in.filter((x) => String(x) === String(clientId)) } : clientId;
  const [items, total] = await Promise.all([
    ClientPayment.find(filter).sort({ paidAt: -1, _id: -1 }).skip(skip).limit(limit).populate('invoiceId', 'number').populate('clientId', 'name').populate('recordedBy', 'name'),
    ClientPayment.countDocuments(filter),
  ]);
  return { items: items.map((p) => p.toJSON()), total };
}

// ---------------------------------------------------------------- runner

/** Once per invoice: tell the responsible person it is overdue. */
export async function notifyOverdueInvoices(now = new Date()) {
  const due = await runAsSystem('invoices:overdue', () =>
    ClientInvoice.find({ status: 'ISSUED', balanceMinor: { $gt: 0 }, dueDate: { $lt: now }, overdueNotifiedAt: null }).select('_id tenantId number ownerId balanceMinor currency clientId').limit(200)
  );
  let n = 0;
  for (const inv of due) {
    const claimed = await runAsSystem('invoices:overdue-claim', () => ClientInvoice.updateOne({ _id: inv._id, overdueNotifiedAt: null }, { $set: { overdueNotifiedAt: now } }));
    if (!claimed.modifiedCount) continue;
    await runWithTenant({ tenantId: inv.tenantId }, async () => {
      const client = await Client.findById(inv.clientId).select('name ownerId');
      n += await notify({ userIds: [inv.ownerId || client?.ownerId].filter(Boolean), type: 'INVOICE_OVERDUE', title: `Invoice ${inv.number} is overdue`, body: client?.name || '', link: `/app/invoices/${inv._id}`, dedupeKey: `overdue:${inv._id}` });
    });
  }
  return n;
}

/** A server crash in the middle of "Issue" → back to DRAFT, stock returned. Never auto-issued. */
export async function recoverStuckIssuing(now = new Date()) {
  const stuck = await runAsSystem('invoices:recover', () => ClientInvoice.find({ status: 'ISSUING', updatedAt: { $lt: new Date(now.getTime() - STUCK_MS) } }).limit(50));
  for (const inv of stuck) {
    await runWithTenant({ tenantId: inv.tenantId }, async () => {
      const r = await ClientInvoice.updateOne({ _id: inv._id, status: 'ISSUING' }, { $set: { status: 'DRAFT', stockTaken: false }, $inc: { __v: 1 } });
      if (r.modifiedCount && inv.stockTaken) await returnStock(inv);
    });
    logger.warn({ invoiceId: String(inv._id) }, 'interrupted invoice issue rolled back to draft');
  }
  return stuck.length;
}
