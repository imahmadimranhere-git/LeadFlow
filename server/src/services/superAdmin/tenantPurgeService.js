// PHASE 30 — PERMANENT erasure of a deleted company's data (privacy "right to erasure").
// Only for companies that were already deleted (soft delete). Every collection with a tenantId is
// emptied for that company, EXCEPT records we must keep: platform billing (our invoices/payments to them)
// and the security audit log. The Tenant record stays as an anonymised tombstone (so old invoices still
// point somewhere). Dry-run first: shows what WOULD be deleted.
import mongoose from '../../config/mongoose.js';
import Tenant from '../../models/Tenant.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { runAsSystem } from '../../utils/tenantContext.js';
import { recordAudit } from '../audit/auditService.js';

// kept on purpose (legal / security) — everything else with a tenantId is erased
export const KEEP_ON_PURGE = new Set(['Tenant', 'AuditLog', 'PlatformInvoice', 'Payment', 'Subscription']);

/** Models that hold data of a tenant (have a tenantId path), minus the ones we keep. */
export function purgeableModels(models = Object.values(mongoose.models)) {
  return models.filter((m) => m.schema.path('tenantId') && !KEEP_ON_PURGE.has(m.modelName)).sort((a, b) => a.modelName.localeCompare(b.modelName));
}

export async function purgeTenant(tenantId, { dryRun = true, actor = null, meta = {} } = {}) {
  return runAsSystem(`tenant:purge${dryRun ? ':dry-run' : ''}`, async () => {
    const tenant = await Tenant.findOne({ _id: tenantId, deletedAt: { $ne: null } });
    if (!tenant) throw ApiError.badRequest('Only a company that has already been deleted can be erased permanently.');
    if (tenant.purgedAt) return { tenantId: String(tenant._id), alreadyPurged: true, purgedAt: tenant.purgedAt, counts: {} };
    const counts = {};
    for (const model of purgeableModels()) {
      const filter = { tenantId: tenant._id };
      counts[model.modelName] = dryRun ? await model.countDocuments({ ...filter, ...(model.schema.path('deletedAt') && { deletedAt: { $not: { $type: 'string' } } }) }) : (await model.deleteMany(filter)).deletedCount;
    }
    if (!dryRun) {
      await Tenant.updateOne({ _id: tenant._id, deletedAt: { $ne: null } }, { $set: { name: 'Deleted company', purgedAt: new Date() } });
      await recordAudit({ actorType: actor ? 'PLATFORM_ADMIN' : 'SYSTEM', actorId: actor, tenantId: tenant._id, action: 'tenant.purged', targetType: 'Tenant', targetId: tenant._id, ip: meta.ip, metadata: { counts } });
      logger.warn({ tenantId: String(tenant._id), counts }, 'tenant data permanently erased');
    }
    return { tenantId: String(tenant._id), dryRun, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
}

/** Daily job (only when PURGE_DELETED_TENANTS_AFTER_DAYS > 0). */
export async function purgeDeletedTenants(days, now = new Date()) {
  if (!(days > 0)) return { purged: 0 };
  const due = await runAsSystem('tenant:purge:due', () => Tenant.find({ deletedAt: { $ne: null, $lte: new Date(now.getTime() - days * 86400000) }, purgedAt: null }).select('_id').limit(20));
  let purged = 0;
  for (const t of due) {
    await purgeTenant(t._id, { dryRun: false });
    purged += 1;
  }
  return { purged };
}

/** Deleted companies (for the Super admin "Data erasure" card). */
export async function listDeletedTenants() {
  const items = await runAsSystem('admin:deleted-tenants', () =>
    Tenant.find({ deletedAt: { $ne: null } }).sort({ deletedAt: -1 }).limit(100).select('name slug deletedAt purgedAt statusReason').lean()
  );
  return items.map((t) => ({ id: String(t._id), name: t.name, slug: t.slug, deletedAt: t.deletedAt, purgedAt: t.purgedAt, reason: t.statusReason }));
}
