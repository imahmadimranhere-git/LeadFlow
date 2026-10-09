// Lead management (CRM core). Every query runs in the tenant context (tenant plugin),
// AND is narrowed by the user's own scope: SALES only sees/edits leads assigned to or created by them.
// A lead outside your scope behaves exactly like a lead that doesn't exist (404) → no IDOR.
import mongoose from '../../config/mongoose.js';
import Lead from '../../models/Lead.js';
import LeadActivity from '../../models/LeadActivity.js';
import User from '../../models/User.js';
import TenantSettings from '../../models/TenantSettings.js';
import { notify } from '../notifications/notificationService.js';
import { dayBounds, isValidTimeZone } from '../../utils/zonedTime.js';
import ApiError from '../../utils/ApiError.js';
import { hasPermission, PERMISSIONS as P } from '../../config/permissions.js';
import { LEAD_LIMITS, LEAD_STATUSES, LEAD_PRIORITIES } from '../../config/leadOptions.js';
import { buildFilter, buildSort, buildPagination, escapeRegex } from '../../utils/queryBuilder.js';
import { consumeQuota, releaseQuota } from '../billing/quotaService.js';
import { recordAudit } from '../audit/auditService.js';
import { identityKeys, looksLikePromptInjection } from './normalize.js';
import { matchesDoNotContact } from './dncService.js';

const STRONG_KEYS = ['emailNormalized', 'websiteNormalized', 'phoneNormalized', 'socialNormalized'];
const KEY_LABEL = { emailNormalized: 'email', websiteNormalized: 'website', phoneNormalized: 'phone', socialNormalized: 'social profile', companyCityKey: 'company + city' };
const IDENTITY_FIELDS = ['email', 'website', 'phone', 'socialProfileUrl', 'companyName', 'city'];
const TEXT_FIELDS_FOR_INJECTION = ['name', 'description', 'businessProblem', 'evidence', 'evidenceSnippet', 'requiredService'];
const CLOSED_STATUSES = ['CONVERTED', 'NOT_INTERESTED', 'LOST'];

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const canReadAll = (auth) => hasPermission(auth.role, P.LEADS_READ_ALL);

/** Extra filter that limits a user to the leads they may see. */
export function scopeFilter(auth) {
  if (canReadAll(auth)) return {};
  const me = oid(auth.userId);
  return { $or: [{ assignedTo: me }, { createdBy: me }] };
}

function requirePermission(auth, permission, message) {
  if (!hasPermission(auth.role, permission)) throw ApiError.forbidden(message);
}

async function loadLead(auth, id, { select } = {}) {
  const q = Lead.findOne({ _id: id, ...scopeFilter(auth) });
  if (select) q.select(select);
  const lead = await q;
  if (!lead) throw ApiError.notFound('Lead not found');
  return lead;
}

const activity = (auth, leadId, type, body = '', meta = {}) =>
  LeadActivity.create({ leadId, type, body, meta, actorId: auth?.userId || null });

async function pipelineStages() {
  const s = await TenantSettings.findOne({}).select('pipelineStages');
  return s?.pipelineStages?.length ? s.pipelineStages : ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
}

async function assertStage(stage) {
  const stages = await pipelineStages();
  if (!stages.includes(stage)) {
    throw ApiError.badRequest('Validation failed', [{ field: 'pipelineStage', message: `Must be one of: ${stages.join(', ')}` }]);
  }
}

async function assertAssignee(auth, assigneeId) {
  if (assigneeId === null) return;
  if (String(assigneeId) !== String(auth.userId)) requirePermission(auth, P.LEADS_ASSIGN, 'You cannot assign leads to other people');
  const user = await User.findOne({ _id: assigneeId, status: 'ACTIVE' }).select('_id'); // tenant-scoped
  if (!user) throw ApiError.badRequest('Validation failed', [{ field: 'assignedTo', message: 'Team member not found' }]);
}

// ---------------------------------------------------------------- duplicates

/**
 * Finds existing (non-deleted) leads in THIS company with the same email/website/phone/social or company+city.
 * Searches all of the company's leads (so sales people can't create duplicates of a colleague's lead), but
 * only reveals details of leads the user is allowed to see.
 */
export async function findDuplicates(auth, keys, { excludeId = null } = {}) {
  const or = [...STRONG_KEYS, 'companyCityKey'].filter((k) => keys[k]).map((k) => ({ [k]: keys[k] }));
  if (or.length === 0) return [];
  const filter = { $or: or };
  if (excludeId) filter._id = { $ne: excludeId };
  const found = await Lead.find(filter)
    .select('emailNormalized websiteNormalized phoneNormalized socialNormalized companyCityKey name companyName status score source assignedTo createdBy')
    .limit(10);
  const visible = new Set(canReadAll(auth) ? found.map((d) => String(d._id)) : found.filter((d) => [String(d.assignedTo), String(d.createdBy)].includes(auth.userId)).map((d) => String(d._id)));

  return found.map((d) => {
    const matchedOn = [...STRONG_KEYS, 'companyCityKey'].filter((k) => keys[k] && d[k] === keys[k]);
    const strong = matchedOn.some((k) => STRONG_KEYS.includes(k));
    const base = { matchedOn: matchedOn.map((k) => KEY_LABEL[k]), strong };
    return visible.has(String(d._id))
      ? { ...base, id: String(d._id), name: d.name, companyName: d.companyName, status: d.status, score: d.score, source: d.source, visible: true }
      : { ...base, visible: false }; // owned by a colleague — existence only
  });
}

/** 409 with the matching leads in `details` so the UI can offer "open existing" / "add as source" / merge. */
function duplicateError(duplicates) {
  const err = new ApiError(409, 'This lead already exists', [{ code: 'DUPLICATE_LEAD', field: '', message: 'duplicate' }]);
  err.details = { duplicates };
  return err;
}

export async function checkDuplicates(auth, input) {
  return findDuplicates(auth, identityKeys(input));
}

// ---------------------------------------------------------------- create / read

export async function createLead(auth, data) {
  const { force, ...input } = data;
  const keys = identityKeys(input);
  const duplicates = await findDuplicates(auth, keys);
  if (duplicates.some((d) => d.strong) || (duplicates.length && !force)) {
    throw duplicateError(duplicates);
  }

  if (input.assignedTo !== undefined) await assertAssignee(auth, input.assignedTo);
  const assignedTo = input.assignedTo !== undefined ? input.assignedTo : hasPermission(auth.role, P.LEADS_ASSIGN) ? null : auth.userId;
  const stages = await pipelineStages();
  if (input.pipelineStage && !stages.includes(input.pipelineStage)) await assertStage(input.pipelineStage);

  const name = input.name || input.companyName || input.personName;
  const now = new Date();
  await consumeQuota(auth.tenantId, 'leads'); // plan limit (atomic) — throws 402 when reached
  try {
    const lead = await Lead.create({
      ...input,
      ...keys,
      name,
      assignedTo,
      pipelineStage: input.pipelineStage || stages[0],
      discoveryTimestamp: now,
      sourcesHistory: [
        {
          source: input.source, sourceUrl: input.sourceUrl, postUrl: input.postUrl, searchQuery: input.searchQuery,
          matchedKeyword: input.matchedKeyword, matchedHashtag: input.matchedHashtag, matchedIntentPhrase: input.matchedIntentPhrase,
          evidenceSnippet: input.evidenceSnippet, discoveredAt: now, addedBy: auth.userId,
        },
      ],
      suspectedInjection: looksLikePromptInjection(...TEXT_FIELDS_FOR_INJECTION.map((f) => input[f])),
      doNotContact: await matchesDoNotContact(keys),
      createdBy: auth.userId,
      lastActivityAt: now,
    });
    await activity(auth, lead._id, 'CREATED', '', { source: lead.source });
    if (lead.assignedTo) await notifyAssigned(auth, [lead]);
    return lead.populate('assignedTo', 'name email');
  } catch (err) {
    await releaseQuota(auth.tenantId, 'leads'); // give the slot back
    if (err.code === 11000) {
      const dups = await findDuplicates(auth, keys);
      throw duplicateError(dups); // a parallel request created it a moment ago
    }
    throw err;
  }
}

export async function getLead(auth, id) {
  const lead = await loadLead(auth, id);
  return lead.populate([{ path: 'assignedTo', select: 'name email' }, { path: 'createdBy', select: 'name' }]);
}

export async function listLeads(auth, q) {
  const and = [scopeFilter(auth), buildFilter(q, ['status', 'priority', 'source', 'pipelineStage'])];
  if (q.tag) and.push({ tags: q.tag });
  if (q.doNotContact !== undefined) and.push({ doNotContact: q.doNotContact });
  if (q.minScore !== undefined) and.push({ score: { $gte: q.minScore } });
  if (q.assignedTo === 'me') and.push({ assignedTo: oid(auth.userId) });
  else if (q.assignedTo === 'unassigned') and.push({ assignedTo: null });
  else if (q.assignedTo) and.push({ assignedTo: oid(q.assignedTo) });
  if (q.search) {
    // escaped → special characters are literal (no regex injection / ReDoS)
    const rx = new RegExp(escapeRegex(q.search), 'i');
    and.push({ $or: ['name', 'companyName', 'personName', 'email', 'city', 'phone'].map((f) => ({ [f]: rx })) });
  }
  const filter = { $and: and.filter((f) => Object.keys(f).length) };
  if (!filter.$and.length) delete filter.$and;

  const { skip } = buildPagination(q.page, q.limit);
  const [items, total] = await Promise.all([
    Lead.find(filter)
      .select('name personName companyName city country email phone website status pipelineStage priority tags score source assignedTo followUpDate doNotContact suspectedInjection lastActivityAt createdAt')
      .sort(buildSort(q.sort, ['createdAt', 'updatedAt', 'lastActivityAt', 'score', 'name', 'followUpDate']))
      .skip(skip)
      .limit(q.limit)
      .populate('assignedTo', 'name'),
    Lead.countDocuments(filter),
  ]);
  return { items: items.map((l) => l.toJSON()), total };
}

/** "A lead was assigned to you" — never to yourself; several leads at once = one notification. */
async function notifyAssigned(auth, leads) {
  const byUser = new Map();
  for (const l of leads) {
    if (!l.assignedTo || String(l.assignedTo._id || l.assignedTo) === String(auth.userId)) continue;
    const k = String(l.assignedTo._id || l.assignedTo);
    if (!byUser.has(k)) byUser.set(k, []);
    byUser.get(k).push(l);
  }
  for (const [userId, list] of byUser) {
    await notify({
      userIds: [userId],
      type: 'LEAD_ASSIGNED',
      title: list.length === 1 ? `New lead for you: ${list[0].name}` : `${list.length} leads were assigned to you`,
      link: list.length === 1 ? `/app/leads/${list[0]._id}` : '/app/leads?assignedTo=me',
      leadId: list.length === 1 ? list[0]._id : null,
    });
  }
}

// ---------------------------------------------------------------- update

export async function updateLead(auth, id, data) {
  requirePermission(auth, P.LEADS_WRITE, 'You cannot edit leads');
  const lead = await loadLead(auth, id);

  if (data.assignedTo !== undefined && String(data.assignedTo) !== String(lead.assignedTo)) await assertAssignee(auth, data.assignedTo);
  if (data.pipelineStage && data.pipelineStage !== lead.pipelineStage) await assertStage(data.pipelineStage);

  const changes = [];
  const before = { status: lead.status, pipelineStage: lead.pipelineStage, assignedTo: lead.assignedTo ? String(lead.assignedTo) : null };
  for (const [k, v] of Object.entries(data)) {
    if (k === 'customFields') lead.customFields = v;
    else if (k === 'compliance') {
      // merge (partial update); withdrawing consent = opt-out → do-not-contact
      const cur = lead.compliance?.toObject ? lead.compliance.toObject() : lead.compliance || {};
      const next = { ...cur, ...v };
      if (v.consentStatus === 'WITHDRAWN' && cur.consentStatus !== 'WITHDRAWN') {
        next.optOutAt = new Date();
        lead.doNotContact = true;
      }
      lead.compliance = next;
    } else lead.set(k, v);
    changes.push(k);
  }

  if (IDENTITY_FIELDS.some((f) => f in data)) {
    const keys = identityKeys(lead);
    const dups = (await findDuplicates(auth, keys, { excludeId: lead._id })).filter((d) => d.strong);
    if (dups.length) throw duplicateError(dups);
    Object.assign(lead, keys);
    lead.doNotContact = (await matchesDoNotContact(keys)) || lead.compliance?.consentStatus === 'WITHDRAWN';
  }
  if (TEXT_FIELDS_FOR_INJECTION.some((f) => f in data)) {
    lead.suspectedInjection = looksLikePromptInjection(...TEXT_FIELDS_FOR_INJECTION.map((f) => lead[f]));
  }
  lead.lastActivityAt = new Date();

  try {
    await lead.save();
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('Another lead already has this email / website / phone / profile');
    throw err;
  }

  if (data.status && data.status !== before.status) await activity(auth, lead._id, 'STATUS_CHANGED', '', { from: before.status, to: data.status });
  if (data.pipelineStage && data.pipelineStage !== before.pipelineStage) await activity(auth, lead._id, 'STAGE_CHANGED', '', { from: before.pipelineStage, to: data.pipelineStage });
  if (data.assignedTo !== undefined && String(data.assignedTo) !== String(before.assignedTo)) {
    await activity(auth, lead._id, 'ASSIGNED', '', { to: data.assignedTo ? String(data.assignedTo) : null });
    if (data.assignedTo) await notifyAssigned(auth, [lead]);
  }
  const other = changes.filter((c) => !['status', 'pipelineStage', 'assignedTo'].includes(c));
  if (other.length) await activity(auth, lead._id, 'UPDATED', '', { fields: other });

  return lead.populate('assignedTo', 'name email');
}

export async function moveStage(auth, id, pipelineStage) {
  return updateLead(auth, id, { pipelineStage });
}

export async function deleteLead(auth, id) {
  requirePermission(auth, P.LEADS_DELETE, 'You cannot delete leads');
  const lead = await loadLead(auth, id);
  await lead.softDelete(auth.userId);
  await activity(auth, lead._id, 'DELETED');
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'lead.deleted', targetType: 'Lead', targetId: lead._id });
  return { deleted: true };
}

// ---------------------------------------------------------------- sources & merge

export async function addSource(auth, id, data) {
  requirePermission(auth, P.LEADS_WRITE, 'You cannot edit leads');
  const lead = await loadLead(auth, id);
  if (lead.sourcesHistory.length >= LEAD_LIMITS.sourcesHistory) throw ApiError.badRequest('This lead already has the maximum number of sources');
  lead.sourcesHistory.push({ ...data, discoveredAt: new Date(), addedBy: auth.userId });
  if (looksLikePromptInjection(data.evidenceSnippet, data.evidence)) lead.suspectedInjection = true;
  lead.lastActivityAt = new Date();
  await lead.save();
  await activity(auth, lead._id, 'SOURCE_ADDED', '', { source: data.source });
  return lead;
}

const FILLABLE = ['personName', 'companyName', 'industry', 'country', 'city', 'website', 'email', 'phone', 'socialProfileUrl', 'language', 'description', 'businessProblem', 'requiredService', 'budgetStated', 'followUpDate'];

/** Merges `duplicateId` INTO `primaryId`: fills empty fields, combines tags/sources/notes, removes the duplicate. */
export async function mergeLeads(auth, primaryId, duplicateId) {
  requirePermission(auth, P.LEADS_DELETE, 'You cannot merge leads');
  if (String(primaryId) === String(duplicateId)) throw ApiError.badRequest('Choose two different leads');
  const [primary, dup] = await Promise.all([loadLead(auth, primaryId), loadLead(auth, duplicateId)]);

  // 1) remove the duplicate first → its unique email/website/phone become free for the primary
  dup.mergedInto = primary._id;
  await dup.softDelete(auth.userId);

  try {
    for (const f of FILLABLE) if (!primary[f] && dup[f]) primary.set(f, dup[f]);
    primary.tags = [...new Set([...primary.tags, ...dup.tags])].slice(0, LEAD_LIMITS.tags);
    primary.interestedItems = [...new Set([...primary.interestedItems, ...dup.interestedItems])].slice(0, LEAD_LIMITS.interestedItems);
    primary.sourcesHistory = [...primary.sourcesHistory, ...dup.sourcesHistory].slice(0, LEAD_LIMITS.sourcesHistory);
    for (const [k, v] of dup.customFields || []) if (!primary.customFields.get(k)) primary.customFields.set(k, v);
    if (primary.score === null && dup.score !== null) primary.score = dup.score;
    primary.suspectedInjection = primary.suspectedInjection || dup.suspectedInjection;
    Object.assign(primary, identityKeys(primary));
    primary.doNotContact = primary.doNotContact || dup.doNotContact;
    primary.lastActivityAt = new Date();
    await primary.save();
  } catch (err) {
    dup.mergedInto = null;
    await dup.restore(); // undo step 1
    if (err.code === 11000) throw ApiError.conflict('Merging would create a duplicate of a third lead');
    throw err;
  }

  await LeadActivity.updateMany({ leadId: dup._id }, { $set: { leadId: primary._id } });
  await activity(auth, primary._id, 'MERGED', '', { mergedLeadId: String(dup._id), mergedName: dup.name });
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'lead.merged', targetType: 'Lead', targetId: primary._id, metadata: { duplicateId: String(dup._id) } });
  return primary.populate('assignedTo', 'name email');
}

// ---------------------------------------------------------------- pipeline, bulk, stats

export async function getPipeline(auth, { perStage = 50 } = {}) {
  const stages = await pipelineStages();
  const scope = scopeFilter(auth);
  const select = 'name companyName personName city status priority score tags assignedTo pipelineStage doNotContact lastActivityAt followUpDate';
  const columns = await Promise.all(
    stages.map(async (stage) => {
      const filter = { ...scope, pipelineStage: stage, status: { $nin: ['NOT_INTERESTED'] } };
      const [items, total] = await Promise.all([
        Lead.find(filter).select(select).sort({ lastActivityAt: -1 }).limit(perStage).populate('assignedTo', 'name'),
        Lead.countDocuments(filter),
      ]);
      return { stage, total, items: items.map((l) => l.toJSON()) };
    })
  );
  return { stages, columns };
}

export async function bulkUpdate(auth, { ids, action, value }) {
  requirePermission(auth, P.LEADS_WRITE, 'You cannot edit leads');
  const filter = { _id: { $in: ids }, ...scopeFilter(auth) };
  let update;
  let type = 'UPDATED';

  switch (action) {
    case 'status':
      if (!LEAD_STATUSES.includes(value)) throw ApiError.badRequest('Invalid status');
      update = { $set: { status: value } };
      type = 'STATUS_CHANGED';
      break;
    case 'priority':
      if (!LEAD_PRIORITIES.includes(value)) throw ApiError.badRequest('Invalid priority');
      update = { $set: { priority: value } };
      break;
    case 'stage':
      await assertStage(value);
      update = { $set: { pipelineStage: value } };
      type = 'STAGE_CHANGED';
      break;
    case 'assign':
      requirePermission(auth, P.LEADS_ASSIGN, 'You cannot assign leads');
      await assertAssignee(auth, value || null);
      update = { $set: { assignedTo: value ? oid(value) : null } };
      type = 'ASSIGNED';
      break;
    case 'addTag':
    case 'removeTag': {
      const t = String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
      if (!/^[\p{L}\p{M}\p{N}_-]{1,40}$/u.test(t)) throw ApiError.badRequest('Invalid tag');
      if (action === 'addTag') {
        filter[`tags.${LEAD_LIMITS.tags - 1}`] = { $exists: false }; // don't exceed the tag limit
        update = { $addToSet: { tags: t } };
      } else update = { $pull: { tags: t } };
      break;
    }
    case 'delete': {
      requirePermission(auth, P.LEADS_DELETE, 'You cannot delete leads');
      update = { $set: { deletedAt: new Date(), deletedBy: oid(auth.userId) } };
      type = 'DELETED';
      break;
    }
    default:
      throw ApiError.badRequest('Unknown action');
  }

  const affected = await Lead.find(filter).select('_id');
  const result = await Lead.updateMany({ _id: { $in: affected.map((d) => d._id) } }, { ...update, $currentDate: { updatedAt: true } });
  if (affected.length) {
    await LeadActivity.insertMany(affected.map((d) => ({ leadId: d._id, type, meta: { bulk: true, action, value: value ?? null }, actorId: auth.userId })));
  }
  if (action === 'assign' && value && affected.length) {
    await notifyAssigned(auth, await Lead.find({ _id: { $in: affected.map((d) => d._id) } }).select('_id name assignedTo').limit(LEAD_LIMITS.bulk));
  }
  if (action === 'delete') {
    await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'lead.bulk_deleted', metadata: { count: result.modifiedCount } });
  }
  return { matched: affected.length, modified: result.modifiedCount };
}

export async function getStats(auth) {
  const scope = scopeFilter(auth);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  // "due" = overdue + today in the COMPANY's time zone (same numbers as the Follow-ups page)
  const tzSetting = (await TenantSettings.findOne({}).select('general'))?.general?.timezone;
  const { end: endOfToday } = dayBounds(new Date(), isValidTimeZone(tzSetting) ? tzSetting : 'UTC');
  const [total, newThisWeek, qualified, followUpsDue, byStatus] = await Promise.all([
    Lead.countDocuments(scope),
    Lead.countDocuments({ ...scope, createdAt: { $gte: weekAgo } }),
    Lead.countDocuments({ ...scope, status: { $in: ['QUALIFIED', 'NEGOTIATION'] } }),
    Lead.countDocuments({ ...scope, followUpDate: { $lt: endOfToday }, status: { $nin: CLOSED_STATUSES } }),
    Lead.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }]).then((rows) =>
      Object.fromEntries(rows.map((r) => [r._id, r.count]))
    ),
  ]);
  return { total, newThisWeek, qualified, followUpsDue, byStatus };
}

// ---------------------------------------------------------------- activity & notes

export async function listActivities(auth, id, { page, limit }) {
  await loadLead(auth, id, { select: '_id' });
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    LeadActivity.find({ leadId: id }).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actorId', 'name'),
    LeadActivity.countDocuments({ leadId: id }),
  ]);
  return { items: items.map((a) => a.toJSON()), total };
}

export async function addNote(auth, id, body) {
  requirePermission(auth, P.LEADS_WRITE, 'You cannot add notes');
  await loadLead(auth, id, { select: '_id' });
  const note = await activity(auth, id, 'NOTE', body);
  await Lead.updateOne({ _id: id }, { $set: { lastActivityAt: new Date() } });
  return (await note.populate('actorId', 'name')).toJSON();
}

export async function deleteNote(auth, id, noteId) {
  await loadLead(auth, id, { select: '_id' });
  const note = await LeadActivity.findOne({ _id: noteId, leadId: id, type: 'NOTE' });
  if (!note) throw ApiError.notFound('Note not found');
  const own = String(note.actorId) === String(auth.userId);
  if (!own) requirePermission(auth, P.LEADS_DELETE, "You can only delete your own notes");
  await LeadActivity.deleteOne({ _id: note._id });
  return { deleted: true };
}
