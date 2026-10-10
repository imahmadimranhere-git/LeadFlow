// Exports (spec A29) — CSV & PDF, governed:
//   - who: export:run (owner/admin/manager) + the type's own permission (audit log → audit:read, …) + plan module
//   - what: allow-listed types, filters and columns only (exportTypes.js); never raw documents
//   - personal data (names/phones/emails/profiles): password re-check before the export is created
//   - do-not-contact & withdrawn consent: EXCLUDED by default; including them needs an admin + a written reason
//   - every request and every download is audit-logged (who, type, filters, columns, rows, IP)
//   - runs in the background (DB queue), row cap, file ≤ 15 MB, deleted after 24 h
//   - download only through a short-lived signed link, re-checking the user at download time
//   - large exports (≥ 1,000 rows) notify the company owner(s)
import crypto from 'node:crypto';
import env from '../../config/env.js';
import logger from '../../config/logger.js';
import ExportJob from '../../models/ExportJob.js';
import ExportFile from '../../models/ExportFile.js';
import User from '../../models/User.js';
import Tenant from '../../models/Tenant.js';
import Lead from '../../models/Lead.js';
import Signal from '../../models/Signal.js';
import OutreachMessage from '../../models/OutreachMessage.js';
import Quote from '../../models/Quote.js';
import ClientInvoice from '../../models/ClientInvoice.js';
import Expense from '../../models/Expense.js';
import AiUsageLog from '../../models/AiUsageLog.js';
import AuditLog from '../../models/AuditLog.js';
import ApiError from '../../utils/ApiError.js';
import { buildPagination } from '../../utils/queryBuilder.js';
import { runAsSystem, runWithTenant } from '../../utils/tenantContext.js';
import { PERMISSIONS as P, hasPermission } from '../../config/permissions.js';
import { recordAudit } from '../audit/auditService.js';
import { consumeQuota } from '../billing/quotaService.js';
import { verifyPassword } from '../auth/passwordService.js';
import { notify } from '../notifications/notificationService.js';
import { assertModule } from '../erp/moduleAccess.js';
import { scopeFilter } from '../leads/leadService.js';
import { EXPORT_TYPES, PDF_MAX_COLUMNS, resolveColumns, toRows, exportCatalog } from './exportTypes.js';
import { toCsv, safeFileName } from './csv.js';
import { PdfDoc } from './pdf.js';
import { signDownload, verifyDownload } from './downloadToken.js';

export const ROW_CAP = 20000;
const MAX_BYTES = 15 * 1024 * 1024;
const FILE_TTL_MS = 24 * 3600 * 1000;
const STUCK_MS = 15 * 60 * 1000;
export const LARGE_EXPORT_ROWS = 1000;
const LEGAL = 'Using this data for outreach must follow platform terms and local laws (consent, anti-spam, privacy). You are responsible for lawful use.';

const linkKey = () => crypto.createHmac('sha256', env.JWT_SECRET).update('leadflow:export-download:v1').digest();
const isAdmin = (auth) => hasPermission(auth.role, P.TENANT_UPDATE);

function assertTypeAllowed(auth, type) {
  const def = EXPORT_TYPES[type];
  if (!def) throw ApiError.badRequest('Unknown export type');
  if (!hasPermission(auth.role, P.EXPORT_RUN) || (def.permission && !hasPermission(auth.role, def.permission))) {
    throw ApiError.forbidden('You are not allowed to export this.');
  }
  return def;
}

export async function catalog(auth) {
  const all = exportCatalog();
  return Object.fromEntries(Object.entries(all).filter(([, d]) => !d.permission || hasPermission(auth.role, d.permission)));
}

// ---------------------------------------------------------------- request

export async function createExport(auth, { type, format, filters = {}, columns, includeDoNotContact = false, overrideReason, password }, meta = {}) {
  const def = assertTypeAllowed(auth, type);
  if (def.module) await assertModule(auth.tenantId, def.module);
  const r = resolveColumns(type, columns);
  if (r.error) throw ApiError.badRequest('Validation failed', [{ field: 'columns', message: r.error }]);
  if (format === 'PDF' && r.columns.length > PDF_MAX_COLUMNS) {
    throw ApiError.badRequest('Validation failed', [{ field: 'columns', message: `A PDF table fits at most ${PDF_MAX_COLUMNS} columns — choose fewer, or use CSV.` }]);
  }
  if (includeDoNotContact) {
    if (!def.contactable) throw ApiError.badRequest('This export has no do-not-contact records.');
    if (!isAdmin(auth)) throw ApiError.forbidden('Only an owner/admin can include do-not-contact or withdrawn-consent records.');
    if (!overrideReason || overrideReason.trim().length < 5) throw ApiError.badRequest('Validation failed', [{ field: 'overrideReason', message: 'Write why these records must be included' }]);
  }
  if (r.includesPii) await assertReauth(auth, password); // bulk personal data → prove it's really you
  await consumeQuota(auth.tenantId, 'exports'); // plan limit (402 when used up)
  const job = await ExportJob.create({ type, format, filters, columns: r.columns.map((c) => c.key), includesPii: r.includesPii, includeDoNotContact, overrideReason: includeDoNotContact ? overrideReason.trim() : null, requestedBy: auth.userId, ip: meta.ip || null });
  await recordAudit({
    actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'export.requested', targetType: 'ExportJob', targetId: job._id, ip: meta.ip,
    metadata: { type, format, filters, columns: job.columns, includesPii: r.includesPii, includeDoNotContact, overrideReason: job.overrideReason },
  });
  return job.toJSON();
}

// ---------------------------------------------------------------- queries (filters are already validated)

const dayRange = (from, to, field) => (from || to ? { [field]: { ...(from && { $gte: new Date(`${from}T00:00:00Z`) }), ...(to && { $lt: new Date(Date.parse(`${to}T00:00:00Z`) + 86400000) }) } } : {});
const notContactable = { $or: [{ doNotContact: true }, { 'compliance.consentStatus': 'WITHDRAWN' }] };

async function fetchRecords(job, auth) {
  const f = job.filters || {};
  const lim = ROW_CAP + 1;
  switch (job.type) {
    case 'LEADS': {
      const and = [scopeFilter(auth), dayRange(f.from, f.to, 'createdAt')];
      for (const k of ['source', 'status', 'city', 'country', 'matchedHashtag', 'priority']) if (f[k]) and.push({ [k]: f[k] });
      if (f.tag) and.push({ tags: f.tag });
      if (f.minScore !== undefined) and.push({ score: { $gte: f.minScore } });
      if (f.assignedTo) and.push({ assignedTo: f.assignedTo });
      if (!job.includeDoNotContact) and.push({ $nor: [notContactable] });
      return Lead.find({ $and: and.filter((x) => Object.keys(x).length) }).sort({ createdAt: -1 }).limit(lim).populate('assignedTo', 'name').lean();
    }
    case 'FOLLOW_UPS': {
      const and = [scopeFilter(auth), { followUpDate: { $ne: null } }, dayRange(f.from, f.to, 'followUpDate')];
      if (!job.includeDoNotContact) and.push({ $nor: [notContactable] });
      return Lead.find({ $and: and.filter((x) => Object.keys(x).length) }).sort({ followUpDate: 1 }).limit(lim).populate('assignedTo', 'name').lean();
    }
    case 'SIGNALS': {
      const q = { ...dayRange(f.from, f.to, 'discoveredAt') };
      for (const k of ['status', 'source', 'matchedHashtag', 'watchId']) if (f[k]) q[k] = f[k];
      if (!job.includeDoNotContact) q['compliance.consentStatus'] = { $ne: 'WITHDRAWN' };
      return Signal.find(q).sort({ discoveredAt: -1 }).limit(lim).lean();
    }
    case 'OUTREACH': {
      const q = { sentAt: { $ne: null }, ...dayRange(f.from, f.to, 'sentAt') };
      for (const k of ['channel', 'status']) if (f[k]) q[k] = f[k];
      return OutreachMessage.find(q).sort({ sentAt: -1 }).limit(lim).populate('leadId', 'name').populate('reviewedBy', 'name').lean();
    }
    case 'QUOTES': {
      const q = { ...dayRange(f.from, f.to, 'createdAt'), ...(f.status && { status: f.status }) };
      return Quote.find(q).select('-lines').sort({ createdAt: -1 }).limit(lim).populate('clientId', 'name').populate('leadId', 'name').lean();
    }
    case 'INVOICES': {
      const q = { ...dayRange(f.from, f.to, 'createdAt'), ...(f.status && { status: f.status }) };
      return ClientInvoice.find(q).select('-lines').sort({ createdAt: -1 }).limit(lim).populate('clientId', 'name').lean();
    }
    case 'EXPENSES': {
      const q = { status: f.status || 'RECORDED', ...(f.category && { category: f.category }) };
      if (f.from || f.to) q.day = { ...(f.from && { $gte: f.from }), ...(f.to && { $lte: f.to }) };
      return Expense.find(q).sort({ day: -1 }).limit(lim).populate('projectId', 'name').lean();
    }
    case 'AI_USAGE':
      return AiUsageLog.find(dayRange(f.from, f.to, 'createdAt')).sort({ createdAt: -1 }).limit(lim).lean();
    case 'AUDIT_LOGS': // not tenant-plugin scoped (platform model) → explicit tenant filter
      return AuditLog.find({ tenantId: job.tenantId, ...dayRange(f.from, f.to, 'createdAt'), ...(f.action && { action: f.action }) }).sort({ createdAt: -1 }).limit(lim).lean();
    default:
      throw new Error('unknown type');
  }
}

function buildPdf({ job, def, columns, rows, tenantName, userName, truncated }) {
  const when = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const doc = new PdfDoc({ title: `${def.label} export`, landscape: columns.length > 5, footer: `${tenantName} · exported by ${userName} · ${when} UTC${job.includesPii ? ' · Confidential — contains personal data' : ''}` });
  doc.heading(`${def.label} — ${tenantName}`);
  const filters = Object.entries(job.filters || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
  doc.text(`${rows.length} row(s)${truncated ? ` (cut at ${ROW_CAP} — narrow your filters)` : ''}${filters ? ` · filters: ${filters}` : ''}`, { size: 9, color: [0.35, 0.35, 0.35] });
  if (def.contactable) doc.text(job.includeDoNotContact ? `Includes do-not-contact / withdrawn-consent records (reason: ${job.overrideReason}).` : 'Do-not-contact and withdrawn-consent records are excluded.', { size: 8.5, color: [0.35, 0.35, 0.35] });
  doc.table(columns.map((c) => ({ header: c.header, width: ['captionSnippet', 'body', 'notes', 'evidenceSummary', 'description'].includes(c.key) ? 3 : 1 })), rows.map((r) => columns.map((c) => r[c.key])));
  if (job.includesPii) doc.text(LEGAL, { size: 8, color: [0.4, 0.4, 0.4] });
  return doc;
}

/** Runs one job end-to-end (runner, or directly in tests). Never throws — failures are stored on the job. */
export async function processExport(jobId) {
  const job = await runAsSystem('exports:claim', () => ExportJob.findOneAndUpdate({ _id: jobId, status: 'QUEUED' }, { $set: { status: 'RUNNING', startedAt: new Date() } }, { new: true }));
  if (!job) return null;
  return runWithTenant({ tenantId: job.tenantId }, async () => {
    try {
      const user = await User.findOne({ _id: job.requestedBy, status: 'ACTIVE' }).select('name role');
      if (!user || !hasPermission(user.role, P.EXPORT_RUN)) throw new Error('The person who asked for this export can no longer export.');
      const auth = { userId: String(user._id), tenantId: String(job.tenantId), role: user.role };
      const def = EXPORT_TYPES[job.type];
      const { columns } = resolveColumns(job.type, job.columns);
      let records = await fetchRecords(job, auth);
      const truncated = records.length > ROW_CAP;
      if (truncated) records = records.slice(0, ROW_CAP);
      const rows = toRows(columns, records);
      const tenant = await Tenant.findById(job.tenantId).select('name');
      let data;
      let replaced = 0;
      if (job.format === 'CSV') data = toCsv(columns, rows);
      else {
        const doc = buildPdf({ job, def, columns, rows, tenantName: tenant?.name || '', userName: user.name, truncated });
        data = doc.toBuffer();
        replaced = doc.replacedChars;
      }
      if (data.length > MAX_BYTES) throw new Error('The file is too large (over 15 MB) — narrow the filters or choose fewer columns.');
      const expiresAt = new Date(Date.now() + FILE_TTL_MS);
      const fileName = safeFileName(`${(tenant?.name || 'leadflow').toLowerCase()}-${job.type.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`, job.format.toLowerCase());
      await ExportFile.create({ jobId: job._id, contentType: job.format === 'CSV' ? 'text/csv; charset=utf-8' : 'application/pdf', data, expiresAt });
      await ExportJob.updateOne({ _id: job._id }, { $set: { status: 'DONE', rowCount: rows.length, truncated, replacedChars: replaced, fileName, sizeBytes: data.length, finishedAt: new Date(), expiresAt } });
      await recordAudit({ actorType: 'SYSTEM', tenantId: job.tenantId, action: 'export.completed', targetType: 'ExportJob', targetId: job._id, metadata: { rows: rows.length, bytes: data.length, type: job.type } });
      if (rows.length >= LARGE_EXPORT_ROWS) {
        const owners = await User.find({ role: 'TENANT_OWNER', status: 'ACTIVE' }).select('_id');
        await notify({ userIds: owners.map((o) => o._id), exceptUserId: job.requestedBy, type: 'LARGE_EXPORT', title: `Large export: ${rows.length} ${def.label.toLowerCase()} rows`, body: `Requested by ${user.name}${job.includesPii ? ' — contains personal data' : ''}`, link: '/app/exports' });
      }
    } catch (err) {
      logger.warn({ jobId: String(job._id), err: err.message }, 'export failed');
      await ExportJob.updateOne({ _id: job._id }, { $set: { status: 'FAILED', error: String(err.message || 'Export failed').slice(0, 300), finishedAt: new Date() } });
    }
    return ExportJob.findById(job._id).then((j) => j.toJSON());
  });
}

/** Runner: process the oldest waiting export (one at a time per server). → small summary or null */
export async function processNextExport() {
  const j = await runAsSystem('exports:next', () => ExportJob.findOne({ status: 'QUEUED' }).sort({ createdAt: 1 }).select('_id'));
  if (!j) return null;
  const done = await processExport(j._id);
  return done ? { exportId: done.id, status: done.status, rows: done.rowCount } : null;
}

/** "Recent re-authentication" for personal-data exports and reports. */
export async function assertReauth(auth, password) {
  const user = await User.findById(auth.userId).select('+passwordHash');
  if (!password || !(await verifyPassword(password, user?.passwordHash))) {
    throw new ApiError(403, 'Please confirm your password — this contains personal data.', [{ code: 'REAUTH_REQUIRED', field: 'password', message: 'password' }]);
  }
}

/** Runner housekeeping: stuck jobs fail, old files expire. */
export async function housekeepExports(now = new Date()) {
  await runAsSystem('exports:housekeeping', async () => {
    await ExportJob.updateMany({ status: 'RUNNING', startedAt: { $lt: new Date(now.getTime() - STUCK_MS) } }, { $set: { status: 'FAILED', error: 'Interrupted — please try again.' } });
    const old = await ExportJob.find({ status: 'DONE', expiresAt: { $lt: now } }).select('_id').limit(500);
    if (old.length) {
      await ExportFile.deleteMany({ jobId: { $in: old.map((j) => j._id) } });
      await ExportJob.updateMany({ _id: { $in: old.map((j) => j._id) } }, { $set: { status: 'EXPIRED' } });
    }
  });
}

// ---------------------------------------------------------------- history + download

const mine = (auth) => (isAdmin(auth) ? {} : { requestedBy: auth.userId });

export async function listExports(auth, { page, limit }) {
  const { skip } = buildPagination(page, limit);
  const filter = mine(auth);
  const [items, total] = await Promise.all([ExportJob.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('requestedBy', 'name'), ExportJob.countDocuments(filter)]);
  return { items: items.map((j) => j.toJSON()), total };
}

export async function getExport(auth, id) {
  const j = await ExportJob.findOne({ _id: id, ...mine(auth) }).populate('requestedBy', 'name');
  if (!j) throw ApiError.notFound('Export not found');
  return j.toJSON();
}

/** A fresh 10-minute download link (authorization checked NOW). */
export async function createLink(auth, id) {
  const j = await ExportJob.findOne({ _id: id, ...mine(auth) });
  if (!j) throw ApiError.notFound('Export not found');
  assertTypeAllowed(auth, j.type);
  if (j.status !== 'DONE' || !j.expiresAt || j.expiresAt < new Date()) throw ApiError.conflict(j.status === 'DONE' || j.status === 'EXPIRED' ? 'This file has expired — run the export again.' : 'The file is not ready yet.');
  const token = signDownload({ jobId: j._id, tenantId: auth.tenantId, userId: auth.userId }, linkKey());
  return { url: `${String(env.API_PUBLIC_URL).replace(/\/$/, '')}/api/v1/exports/download/${token}`, expiresInSeconds: 600 };
}

/** Public route (the link IS the credential) — but the user, job and permission are re-checked here. */
export async function download(token, meta = {}) {
  const t = verifyDownload(token, linkKey());
  if (t.error) throw new ApiError(t.error === 'EXPIRED' ? 410 : 404, t.error === 'EXPIRED' ? 'This download link has expired — create a new one.' : 'Not found');
  return runWithTenant({ tenantId: t.tenantId }, async () => {
    const user = await User.findOne({ _id: t.userId, status: 'ACTIVE' }).select('role');
    const job = await ExportJob.findOne({ _id: t.jobId });
    if (!user || !job) throw ApiError.notFound('Not found');
    const auth = { userId: t.userId, tenantId: t.tenantId, role: user.role };
    if (String(job.requestedBy) !== t.userId && !isAdmin(auth)) throw ApiError.notFound('Not found');
    assertTypeAllowed(auth, job.type); // role may have changed since the link was made
    if (job.status !== 'DONE' || job.expiresAt < new Date()) throw new ApiError(410, 'This file has expired — run the export again.');
    const file = await ExportFile.findOne({ jobId: job._id }).select('+data');
    if (!file) throw new ApiError(410, 'This file has expired — run the export again.');
    await ExportJob.updateOne({ _id: job._id }, { $inc: { downloads: 1 } });
    await recordAudit({ actorType: 'USER', actorId: t.userId, tenantId: t.tenantId, action: 'export.downloaded', targetType: 'ExportJob', targetId: job._id, ip: meta.ip, metadata: { type: job.type, rows: job.rowCount } });
    return { fileName: job.fileName, contentType: file.contentType, data: file.data };
  });
}
