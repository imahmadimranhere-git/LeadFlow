// Clients (customers). Visibility works like leads: Sales sees the clients they own or created;
// managers/admins see all. A lead becomes a client when it is converted (by hand or when a quote is accepted).
import Client from '../../models/Client.js';
import Lead from '../../models/Lead.js';
import LeadActivity from '../../models/LeadActivity.js';
import Quote from '../../models/Quote.js';
import ClientInvoice from '../../models/ClientInvoice.js';
import { invoiceView } from './invoiceRules.js';
import ApiError from '../../utils/ApiError.js';
import { buildPagination, escapeRegex } from '../../utils/queryBuilder.js';
import { PERMISSIONS as P, hasPermission } from '../../config/permissions.js';
import { recordAudit } from '../audit/auditService.js';
import { scopeFilter as leadScope } from '../leads/leadService.js';

export function clientScope(auth) {
  if (hasPermission(auth.role, P.LEADS_READ_ALL)) return {};
  return { $or: [{ ownerId: auth.userId }, { createdBy: auth.userId }] };
}

export async function loadClient(auth, id) {
  const c = await Client.findOne({ $and: [{ _id: id }, clientScope(auth)] });
  if (!c) throw ApiError.notFound('Client not found');
  return c;
}

export async function listClients(auth, { page, limit, q, status }) {
  const { skip } = buildPagination(page, limit);
  const and = [clientScope(auth), { status: status || 'ACTIVE' }];
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ name: rx }, { email: rx }, { phone: rx }, { city: rx }, { 'contacts.name': rx }] });
  }
  const filter = { $and: and.filter((f) => Object.keys(f).length) };
  const [items, total] = await Promise.all([
    Client.find(filter).sort({ name: 1, _id: 1 }).skip(skip).limit(limit).populate('ownerId', 'name'),
    Client.countDocuments(filter),
  ]);
  return { items: items.map((c) => c.toJSON()), total };
}

export async function getClient(auth, id) {
  const c = await loadClient(auth, id);
  await c.populate([{ path: 'ownerId', select: 'name' }, { path: 'leadId', select: 'name status' }]);
  const [quotes, invoices] = await Promise.all([
    Quote.find({ clientId: c._id }).select('number title status currency totalMinor issueDate').sort({ createdAt: -1 }).limit(20),
    ClientInvoice.find({ clientId: c._id }).select('number title status currency totalMinor balanceMinor paidMinor dueDate issueDate').sort({ createdAt: -1 }).limit(20),
  ]);
  const outstanding = {};
  for (const i of invoices) if (i.status === 'ISSUED') outstanding[i.currency] = (outstanding[i.currency] || 0) + i.balanceMinor;
  return { client: c.toJSON(), quotes: quotes.map((q) => q.toJSON()), invoices: invoices.map((i) => ({ ...i.toJSON(), ...invoiceView(i) })), outstanding };
}

export async function createClient(auth, data) {
  const c = await Client.create({ ...data, ownerId: auth.userId, createdBy: auth.userId });
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'client.created', targetType: 'Client', targetId: c._id });
  return c.toJSON();
}

export async function updateClient(auth, id, data) {
  const c = await loadClient(auth, id);
  for (const [k, v] of Object.entries(data)) c.set(k, v);
  await c.save();
  return c.toJSON();
}

export async function deleteClient(auth, id) {
  const c = await loadClient(auth, id);
  if (await Quote.exists({ clientId: c._id, status: 'ACCEPTED' })) throw ApiError.conflict('This client has accepted quotes — archive it instead of deleting.');
  if (await ClientInvoice.exists({ clientId: c._id, status: { $ne: 'DRAFT' } })) throw ApiError.conflict('This client has invoices — archive it instead of deleting (accounting records must stay).');
  await Client.updateOne({ _id: c._id }, { $set: { deletedAt: new Date(), deletedBy: auth.userId } });
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'client.deleted', targetType: 'Client', targetId: c._id });
  return { deleted: true };
}

/**
 * Lead → client. Copies the contact details, links both ways, marks the lead CONVERTED.
 * Idempotent: converting the same lead again returns the existing client.
 */
export async function convertLead(auth, leadId, { markConverted = true } = {}) {
  const lead = await Lead.findOne({ _id: leadId, ...leadScope(auth) });
  if (!lead) throw ApiError.notFound('Lead not found');
  const existing = await Client.findOne({ leadId: lead._id });
  if (existing) return { client: existing.toJSON(), created: false };
  let client;
  try {
    client = await Client.create({
      type: lead.companyName ? 'COMPANY' : 'PERSON',
      name: lead.companyName || lead.name,
      email: lead.email || null,
      phone: lead.phone || null,
      website: lead.website || null,
      city: lead.city || null,
      country: lead.country || null,
      contacts: lead.personName && lead.companyName ? [{ name: lead.personName, email: lead.email || null, phone: lead.phone || null }] : [],
      leadId: lead._id,
      ownerId: lead.assignedTo || auth.userId,
      createdBy: auth.userId,
    });
  } catch (err) {
    if (err.code === 11000) return { client: (await Client.findOne({ leadId: lead._id })).toJSON(), created: false }; // converted in parallel
    throw err;
  }
  if (markConverted && lead.status !== 'CONVERTED') {
    await Lead.updateOne({ _id: lead._id }, { $set: { status: 'CONVERTED', lastActivityAt: new Date() } });
    await LeadActivity.create({ leadId: lead._id, type: 'STATUS_CHANGED', body: 'Converted to a client', meta: { from: lead.status, to: 'CONVERTED', clientId: String(client._id) }, actorId: auth.userId });
  }
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'client.converted_from_lead', targetType: 'Client', targetId: client._id, metadata: { leadId: String(lead._id) } });
  return { client: client.toJSON(), created: true };
}
