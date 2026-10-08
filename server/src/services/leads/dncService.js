// Do-Not-Contact list (opt-outs). Matching leads get doNotContact=true; outreach (Phase 17) refuses them.
import DoNotContact from '../../models/DoNotContact.js';
import Lead from '../../models/Lead.js';
import ApiError from '../../utils/ApiError.js';
import { recordAudit } from '../audit/auditService.js';
import { buildPagination } from '../../utils/queryBuilder.js';
import { normalizeEmail, normalizePhone, normalizeSocial, normalizeWebsite, businessDomainOfEmail } from './normalize.js';

export function normalizeDncValue(type, value) {
  switch (type) {
    case 'EMAIL':
      return normalizeEmail(value);
    case 'PHONE':
      return normalizePhone(value);
    case 'DOMAIN':
      return normalizeWebsite(String(value).includes('@') ? String(value).split('@')[1] : value);
    case 'SOCIAL':
      return normalizeSocial(value);
    default:
      return null;
  }
}

/** Does a lead (given its identity keys) match the list? Runs inside the tenant context. */
export async function matchesDoNotContact(keys) {
  const or = [];
  if (keys.emailNormalized) {
    or.push({ type: 'EMAIL', value: keys.emailNormalized });
    const d = businessDomainOfEmail(keys.emailNormalized);
    if (d) or.push({ type: 'DOMAIN', value: d });
  }
  if (keys.websiteNormalized) or.push({ type: 'DOMAIN', value: keys.websiteNormalized });
  if (keys.phoneNormalized) or.push({ type: 'PHONE', value: keys.phoneNormalized });
  if (keys.socialNormalized) or.push({ type: 'SOCIAL', value: keys.socialNormalized });
  if (!or.length) return false;
  return Boolean(await DoNotContact.exists({ $or: or }));
}

/** Lead filter for one DNC entry */
function leadFilterFor(entry) {
  switch (entry.type) {
    case 'EMAIL':
      return { emailNormalized: entry.value };
    case 'PHONE':
      return { phoneNormalized: entry.value };
    case 'SOCIAL':
      return { socialNormalized: entry.value };
    case 'DOMAIN':
      return { $or: [{ websiteNormalized: entry.value }, { emailNormalized: { $regex: `@${entry.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` } }] };
    default:
      return { _id: null };
  }
}

export async function listDnc({ page, limit, type }) {
  const filter = type ? { type } : {};
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    DoNotContact.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('addedBy', 'name'),
    DoNotContact.countDocuments(filter),
  ]);
  return { items: items.map((d) => d.toJSON()), total };
}

export async function addDnc(auth, { type, value, reason }) {
  const normalized = normalizeDncValue(type, value);
  if (!normalized) throw ApiError.badRequest('Validation failed', [{ field: 'value', message: `Not a valid ${type.toLowerCase()}` }]);
  let entry;
  try {
    entry = await DoNotContact.create({ type, value: normalized, reason: reason || '', addedBy: auth.userId });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('Already on the do-not-contact list');
    throw err;
  }
  const { modifiedCount } = await Lead.updateMany(leadFilterFor(entry), { $set: { doNotContact: true } });
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'dnc.added', targetType: 'DoNotContact', targetId: entry._id, metadata: { type, leadsFlagged: modifiedCount } });
  return { entry: entry.toJSON(), leadsFlagged: modifiedCount };
}

export async function removeDnc(auth, id) {
  const entry = await DoNotContact.findOne({ _id: id });
  if (!entry) throw ApiError.notFound('Entry not found');
  await DoNotContact.deleteOne({ _id: entry._id });
  // Re-check only the leads this entry affected (another entry may still match them)
  // (leads whose own consent was WITHDRAWN stay do-not-contact)
  const leads = await Lead.find({ ...leadFilterFor(entry), doNotContact: true, 'compliance.consentStatus': { $ne: 'WITHDRAWN' } }).select('emailNormalized websiteNormalized phoneNormalized socialNormalized').limit(5000);
  let cleared = 0;
  for (const lead of leads) {
    if (!(await matchesDoNotContact(lead))) {
      await Lead.updateOne({ _id: lead._id }, { $set: { doNotContact: false } });
      cleared += 1;
    }
  }
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'dnc.removed', targetType: 'DoNotContact', targetId: entry._id, metadata: { type: entry.type, leadsCleared: cleared } });
  return { deleted: true, leadsCleared: cleared };
}

/** For bulk imports: loads the list ONCE and returns a fast matcher(keys) → boolean. */
export async function loadDncMatcher() {
  const entries = await DoNotContact.find({}).select('type value').limit(50000);
  const set = new Set(entries.map((e) => `${e.type}:${e.value}`));
  return (keys) => {
    if (keys.emailNormalized && (set.has(`EMAIL:${keys.emailNormalized}`) || set.has(`DOMAIN:${businessDomainOfEmail(keys.emailNormalized)}`))) return true;
    if (keys.websiteNormalized && set.has(`DOMAIN:${keys.websiteNormalized}`)) return true;
    if (keys.phoneNormalized && set.has(`PHONE:${keys.phoneNormalized}`)) return true;
    if (keys.socialNormalized && set.has(`SOCIAL:${keys.socialNormalized}`)) return true;
    return false;
  };
}
