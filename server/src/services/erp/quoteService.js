// Quotes (spec A12 sales module).
//
// Business-logic rules enforced HERE (never trusting the browser):
//   - totals are recalculated on every save (quoteMath.js) — totals sent by a browser are not even accepted
//   - prices of catalog items come from the catalog; a Sales user cannot go BELOW the catalog price and cannot
//     give more total discount than the company's limit (Settings → Sales). Managers/admins can.
//   - one currency per quote (the company currency at creation); a catalog item priced in another currency is refused
//   - only DRAFT quotes can be edited; SENT → back to draft creates a new revision; ACCEPTED is a permanent record
//   - accepting a quote converts the lead into a client (once) and reserves tracked items (e.g. a plot)
//   - Sales only sees / changes quotes of their own leads & clients (others → 404)
import Quote from '../../models/Quote.js';
import Item from '../../models/Item.js';
import Lead from '../../models/Lead.js';
import LeadActivity from '../../models/LeadActivity.js';
import Client from '../../models/Client.js';
import Tenant from '../../models/Tenant.js';
import TenantSettings from '../../models/TenantSettings.js';
import { nextSequence } from '../../models/Counter.js';
import ApiError from '../../utils/ApiError.js';
import { buildPagination, escapeRegex } from '../../utils/queryBuilder.js';
import { runAsSystem } from '../../utils/tenantContext.js';
import { PERMISSIONS as P, hasPermission } from '../../config/permissions.js';
import { QUOTE_TRANSITIONS } from '../../config/erpOptions.js';
import { recordAudit } from '../audit/auditService.js';
import { notify } from '../notifications/notificationService.js';
import { scopeFilter as leadScope } from '../leads/leadService.js';
import { clientScope, convertLead } from './clientService.js';
import { calculateTotals, effectiveDiscountBp, QuoteMathError } from './quoteMath.js';
import { companyClock } from '../followUps/followUpService.js';
import { zonedParts } from '../../utils/zonedTime.js';

const DAY = 24 * 3600 * 1000;
export const mathErrorToApi = (err) => (err instanceof QuoteMathError ? ApiError.badRequest('Validation failed', [{ field: err.field, message: err.message }]) : err);
const canManageCatalog = (auth) => hasPermission(auth.role, P.CATALOG_MANAGE);
const readsAll = (auth) => hasPermission(auth.role, P.LEADS_READ_ALL);

export async function salesSettings() {
  const s = await TenantSettings.findOne({}).select('sales profile');
  const sales = s?.sales?.toObject ? s.sales.toObject() : s?.sales || {};
  return { currency: 'USD', defaultTaxBp: 0, salesMaxDiscountBp: 1000, quoteValidityDays: 15, quotePrefix: 'Q', quoteTerms: '', invoicePrefix: 'INV', paymentTermsDays: 15, invoiceFooter: '', ...sales, profile: s?.profile || {} };
}

/** Quotes I may see: all (managers) — or those I own / created / that belong to my leads or clients. */
async function quoteScope(auth) {
  if (readsAll(auth)) return {};
  const [leads, clients] = await Promise.all([
    Lead.find(leadScope(auth)).select('_id').limit(5000),
    Client.find(clientScope(auth)).select('_id').limit(5000),
  ]);
  return { $or: [{ ownerId: auth.userId }, { createdBy: auth.userId }, { leadId: { $in: leads.map((l) => l._id) } }, { clientId: { $in: clients.map((c) => c._id) } }] };
}

async function loadQuote(auth, id) {
  const q = await Quote.findOne({ $and: [{ _id: id }, await quoteScope(auth)] });
  if (!q) throw ApiError.notFound('Quote not found');
  return q;
}

const mathError = (err) => (err instanceof QuoteMathError ? ApiError.badRequest('Validation failed', [{ field: err.field, message: err.message }]) : err);

/** Who the quote is for: a client and/or a lead — both must be visible to the user and belong together. */
async function resolveParty(auth, { clientId, leadId }) {
  let client = null;
  let lead = null;
  if (clientId) {
    client = await Client.findOne({ $and: [{ _id: clientId }, clientScope(auth)] });
    if (!client) throw ApiError.badRequest('Validation failed', [{ field: 'clientId', message: 'Client not found' }]);
  }
  if (leadId) {
    lead = await Lead.findOne({ _id: leadId, ...leadScope(auth) });
    if (!lead) throw ApiError.badRequest('Validation failed', [{ field: 'leadId', message: 'Lead not found' }]);
  }
  if (!client && !lead) throw ApiError.badRequest('Validation failed', [{ field: 'clientId', message: 'Choose a client or a lead' }]);
  if (client && lead && client.leadId && String(client.leadId) !== String(lead._id)) {
    throw ApiError.badRequest('Validation failed', [{ field: 'leadId', message: 'This lead belongs to a different client' }]);
  }
  if (!client && lead) client = await Client.findOne({ leadId: lead._id }); // lead already converted → use its client
  return { clientId: client?._id || null, leadId: lead?._id || client?.leadId || null, ownerId: client?.ownerId || lead?.assignedTo || auth.userId };
}

/** Input lines → stored lines (catalog lookups, currency check, Sales price rule) + server totals. */
export async function buildLines(auth, input, { currency, defaultTaxBp }) {
  const ids = [...new Set(input.filter((l) => l.itemId).map((l) => String(l.itemId)))];
  const items = ids.length ? await Item.find({ _id: { $in: ids }, status: 'ACTIVE' }) : [];
  const byId = new Map(items.map((i) => [String(i._id), i]));
  const lines = input.map((l, i) => {
    let item = null;
    if (l.itemId) {
      item = byId.get(String(l.itemId));
      if (!item) throw ApiError.badRequest('Validation failed', [{ field: `lines.${i}.itemId`, message: 'Item not found (or archived)' }]);
      if (item.currency !== currency) throw ApiError.badRequest('Validation failed', [{ field: `lines.${i}.itemId`, message: `This item is priced in ${item.currency}, the quote is in ${currency}. Update the item price first.` }]);
    }
    const unitPriceMinor = l.unitPriceMinor ?? item?.priceMinor;
    if (unitPriceMinor === undefined || unitPriceMinor === null) throw ApiError.badRequest('Validation failed', [{ field: `lines.${i}.unitPrice`, message: 'Enter a price' }]);
    if (item && !canManageCatalog(auth) && unitPriceMinor < item.priceMinor) {
      throw new ApiError(403, `"${item.name}": you can't sell below the catalog price — use a discount (within your limit) or ask a manager.`, [{ code: 'BELOW_CATALOG_PRICE', field: `lines.${i}.unitPrice`, message: 'below catalog price' }]);
    }
    const description = l.description || item?.name;
    if (!description) throw ApiError.badRequest('Validation failed', [{ field: `lines.${i}.description`, message: 'Describe the line' }]);
    return {
      itemId: item?._id || null,
      description,
      unit: l.unit ?? item?.unit ?? '',
      qtyMilli: l.qtyMilli,
      unitPriceMinor,
      catalogPriceMinor: item ? item.priceMinor : null,
      discountBp: l.discountBp ?? 0,
      taxBp: l.taxBp ?? item?.taxBp ?? defaultTaxBp ?? 0,
    };
  });
  return lines;
}

export function applyTotals(auth, quote, lines, discount, settings) {
  let totals;
  try {
    totals = calculateTotals(lines, discount);
  } catch (err) {
    throw mathError(err);
  }
  const eff = effectiveDiscountBp(totals);
  if (!canManageCatalog(auth) && eff > settings.salesMaxDiscountBp) {
    throw new ApiError(403, `Total discount ${(eff / 100).toFixed(2)}% is above your limit of ${(settings.salesMaxDiscountBp / 100).toFixed(2)}% — ask a manager.`, [{ code: 'DISCOUNT_LIMIT', field: 'discount', message: 'above limit' }]);
  }
  quote.lines = lines.map((l, i) => ({ ...l, ...totals.lines[i] }));
  quote.discount = { type: discount?.type || 'NONE', valueBp: discount?.valueBp || 0, valueMinor: discount?.valueMinor || 0 };
  Object.assign(quote, {
    subtotalMinor: totals.subtotalMinor,
    lineDiscountMinor: totals.lineDiscountMinor,
    orderDiscountMinor: totals.orderDiscountMinor,
    discountMinor: totals.discountMinor,
    taxMinor: totals.taxMinor,
    totalMinor: totals.totalMinor,
    effectiveDiscountBp: eff,
  });
}

/** "TB-2026-0001" — one sequence per company, per document kind, per (company-time-zone) year. */
export async function nextNumber(tenantId, prefix, kind = 'quote') {
  const { timezone } = await companyClock();
  const year = zonedParts(new Date(), timezone).year;
  const seq = await runAsSystem(`${kind}:number`, () => nextSequence(`${kind}:${tenantId}:${year}`));
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}

const populated = (q) => q.populate([{ path: 'clientId', select: 'name email phone address city country taxId' }, { path: 'leadId', select: 'name companyName personName email phone status' }, { path: 'ownerId', select: 'name' }, { path: 'createdBy', select: 'name' }]);

async function toPublic(id) {
  const q = await populated(Quote.findById(id));
  return q.toJSON();
}

// ---------------------------------------------------------------- read

export async function listQuotes(auth, { page, limit, status, clientId, leadId, q }) {
  const { skip } = buildPagination(page, limit);
  const and = [await quoteScope(auth)];
  if (status) and.push({ status });
  if (clientId) and.push({ clientId });
  if (leadId) and.push({ leadId });
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ number: rx }, { title: rx }] });
  }
  const filter = { $and: and.filter((f) => Object.keys(f).length) };
  if (!filter.$and.length) delete filter.$and;
  const [items, total] = await Promise.all([
    Quote.find(filter).select('-lines').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate('clientId', 'name').populate('leadId', 'name').populate('ownerId', 'name'),
    Quote.countDocuments(filter),
  ]);
  return { items: items.map((x) => x.toJSON()), total };
}

/** Quote + what the printed version needs (company details). */
export async function getQuote(auth, id) {
  const q = await loadQuote(auth, id);
  const [settings, tenant] = await Promise.all([salesSettings(), Tenant.findById(auth.tenantId).select('name')]);
  const p = settings.profile?.toObject ? settings.profile.toObject() : settings.profile || {};
  return {
    quote: await toPublic(q._id),
    company: { name: tenant?.name || '', email: p.email || null, phone: p.phone || null, website: p.website || null, address: p.address || null, city: p.city || null, country: p.country || null, taxId: settings.taxId || null },
    canManagePrices: canManageCatalog(auth),
    salesMaxDiscountBp: settings.salesMaxDiscountBp,
  };
}

// ---------------------------------------------------------------- write

export async function createQuote(auth, data) {
  const settings = await salesSettings();
  const party = await resolveParty(auth, data);
  const quote = new Quote({
    title: data.title || '',
    ...party,
    currency: settings.currency,
    issueDate: data.issueDate || new Date(),
    notes: data.notes || '',
    terms: data.terms ?? settings.quoteTerms ?? '',
    internalNote: data.internalNote || '',
    createdBy: auth.userId,
    updatedBy: auth.userId,
  });
  quote.validUntil = data.validUntil || new Date(quote.issueDate.getTime() + settings.quoteValidityDays * DAY);
  if (quote.validUntil < quote.issueDate) throw ApiError.badRequest('Validation failed', [{ field: 'validUntil', message: 'Must be after the issue date' }]);
  const lines = await buildLines(auth, data.lines, settings);
  applyTotals(auth, quote, lines, data.discount, settings);
  quote.number = await nextNumber(auth.tenantId, settings.quotePrefix || 'Q');
  await quote.save();
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'quote.created', targetType: 'Quote', targetId: quote._id, metadata: { totalMinor: quote.totalMinor, currency: quote.currency } });
  return toPublic(quote._id);
}

export async function updateQuote(auth, id, data) {
  const quote = await loadQuote(auth, id);
  if (quote.status !== 'DRAFT') throw ApiError.conflict('Only draft quotes can be edited — use "Revise" to make a new draft.');
  const settings = await salesSettings();
  if (data.clientId !== undefined || data.leadId !== undefined) {
    Object.assign(quote, await resolveParty(auth, { clientId: data.clientId ?? quote.clientId, leadId: data.leadId ?? quote.leadId }));
  }
  for (const k of ['title', 'issueDate', 'validUntil', 'notes', 'terms', 'internalNote']) if (data[k] !== undefined) quote[k] = data[k];
  if (quote.validUntil && quote.validUntil < quote.issueDate) throw ApiError.badRequest('Validation failed', [{ field: 'validUntil', message: 'Must be after the issue date' }]);
  if (data.lines || data.discount) {
    // lines that were not changed keep their own price (catalog changes don't silently change a quote)
    const lines = data.lines
      ? await buildLines(auth, data.lines, settings)
      : quote.lines.map((l) => ({ itemId: l.itemId, description: l.description, unit: l.unit, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor, catalogPriceMinor: l.catalogPriceMinor, discountBp: l.discountBp, taxBp: l.taxBp }));
    applyTotals(auth, quote, lines, data.discount ?? quote.discount, settings);
  }
  quote.updatedBy = auth.userId;
  try {
    await quote.save();
  } catch (err) {
    if (err.name === 'VersionError') throw ApiError.conflict('Someone else changed this quote — reload and try again.');
    throw err;
  }
  return toPublic(quote._id);
}

/** Status changes. Always atomic on the current status (two clicks can't both win). */
export async function changeStatus(auth, id, to, { note } = {}) {
  const quote = await loadQuote(auth, id);
  if (!(QUOTE_TRANSITIONS[quote.status] || []).includes(to)) {
    throw ApiError.conflict(`A ${quote.status.toLowerCase()} quote can't become ${to.toLowerCase()}.`);
  }
  if (to === 'SENT' && (!quote.lines.length || quote.totalMinor < 0)) throw ApiError.badRequest('Add at least one line before sending.');
  const now = new Date();
  const set = { status: to, updatedBy: auth.userId };
  if (to === 'SENT') set.sentAt = now;
  if (['ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'].includes(to)) Object.assign(set, { decidedAt: now, decisionNote: note || null });
  // __v + 1 → an edit that was loaded before this change fails instead of overwriting (optimistic concurrency)
  const inc = { __v: 1, ...(to === 'DRAFT' ? { revision: 1 } : {}) };
  const r = await Quote.findOneAndUpdate({ _id: quote._id, status: quote.status }, { $set: set, $inc: inc }, { new: true });
  if (!r) throw ApiError.conflict('The quote was changed by someone else — reload.');

  if (to === 'SENT' && quote.leadId) {
    await Lead.updateOne({ _id: quote.leadId, status: { $in: ['NEW', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'FOLLOW_UP'] } }, { $set: { status: 'NEGOTIATION' } });
    await Lead.updateOne({ _id: quote.leadId }, { $set: { lastActivityAt: now } });
    await LeadActivity.create({ leadId: quote.leadId, type: 'NOTE', body: `Quote ${quote.number} sent`, meta: { quoteId: String(quote._id), totalMinor: quote.totalMinor, currency: quote.currency }, actorId: auth.userId });
  }
  if (to === 'ACCEPTED') {
    if (!quote.clientId && quote.leadId) {
      const { client } = await convertLead(auth, quote.leadId);
      await Quote.updateOne({ _id: quote._id }, { $set: { clientId: client.id } });
    } else if (quote.leadId) {
      await Lead.updateOne({ _id: quote.leadId, status: { $ne: 'CONVERTED' } }, { $set: { status: 'CONVERTED', lastActivityAt: now } });
    }
    if (quote.leadId) await LeadActivity.create({ leadId: quote.leadId, type: 'NOTE', body: `Quote ${quote.number} accepted`, meta: { quoteId: String(quote._id) }, actorId: auth.userId });
    // tracked items (e.g. a plot or apartment) are reserved for this client
    const tracked = quote.lines.filter((l) => l.itemId).map((l) => l.itemId);
    if (tracked.length) await Item.updateMany({ _id: { $in: tracked }, availability: 'AVAILABLE' }, { $set: { availability: 'RESERVED' } });
    await notify({ userIds: [quote.ownerId, quote.createdBy], exceptUserId: auth.userId, type: 'QUOTE_ACCEPTED', title: `Quote ${quote.number} accepted 🎉`, link: `/app/quotes/${quote._id}` });
  }
  if (to === 'DECLINED' && quote.leadId) {
    await LeadActivity.create({ leadId: quote.leadId, type: 'NOTE', body: `Quote ${quote.number} declined${note ? `: ${note}` : ''}`, meta: { quoteId: String(quote._id) }, actorId: auth.userId });
  }
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: `quote.${to.toLowerCase()}`, targetType: 'Quote', targetId: quote._id, metadata: { from: quote.status, totalMinor: quote.totalMinor } });
  return toPublic(quote._id);
}

/** New DRAFT copy (e.g. same offer for another client). Prices re-checked with today's rules. */
export async function duplicateQuote(auth, id) {
  const src = await loadQuote(auth, id);
  return createQuote(auth, {
    title: src.title,
    clientId: src.clientId,
    leadId: src.clientId ? undefined : src.leadId,
    notes: src.notes,
    terms: src.terms,
    discount: src.discount?.toObject ? src.discount.toObject() : src.discount,
    lines: src.lines.map((l) => ({ itemId: l.itemId, description: l.description, unit: l.unit, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor, discountBp: l.discountBp, taxBp: l.taxBp })),
  });
}

/** Runner: SENT quotes past their "valid until" date → EXPIRED. */
export async function expireQuotes(now = new Date()) {
  const r = await runAsSystem('quotes:expire', () => Quote.updateMany({ status: 'SENT', validUntil: { $lt: now } }, { $set: { status: 'EXPIRED', decidedAt: now, decisionNote: 'Validity date passed' } }));
  return r.modifiedCount;
}
