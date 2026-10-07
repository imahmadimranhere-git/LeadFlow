// Super admin: manage all tenants. Every change is audit-logged with a reason.
import mongoose from '../../config/mongoose.js';
import Tenant, { TENANT_STATUSES } from '../../models/Tenant.js';
import User from '../../models/User.js';
import Plan from '../../models/Plan.js';
import ApiError from '../../utils/ApiError.js';
import { buildSort, buildPagination, prefixSearch } from '../../utils/queryBuilder.js';
import { recordAudit } from '../audit/auditService.js';
import { revokeAllForUser } from '../auth/tokenService.js';
import Subscription from '../../models/Subscription.js';
import { ensureSubscription } from '../billing/subscriptionService.js';

const SORTABLE = ['createdAt', 'name', 'status'];

async function userCountsFor(tenantIds) {
  if (!tenantIds.length) return {};
  const rows = await User.aggregate([
    { $match: { tenantId: { $in: tenantIds } } },
    { $group: { _id: '$tenantId', count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.count]));
}

export async function listTenants({ page, limit, status, search, planId, sort }) {
  const filter = {};
  if (status) filter.status = status;
  if (planId) filter.planId = new mongoose.Types.ObjectId(planId);
  if (search) {
    const rx = prefixSearch(search, 60);
    filter.$or = [{ name: rx }, { slug: rx }];
  }
  const { skip } = buildPagination(page, limit);
  const [tenants, total] = await Promise.all([
    Tenant.find(filter).sort(buildSort(sort, SORTABLE)).skip(skip).limit(limit).populate('planId', 'name code'),
    Tenant.countDocuments(filter),
  ]);
  const counts = await userCountsFor(tenants.map((t) => t._id));
  const items = tenants.map((t) => ({ ...t.toJSON(), userCount: counts[String(t._id)] || 0 }));
  return { items, total };
}

export async function getTenant(id) {
  const tenant = await Tenant.findById(id).populate('planId', 'name code');
  if (!tenant) throw ApiError.notFound('Tenant not found');
  const [userCount, owner] = await Promise.all([
    User.countDocuments({ tenantId: tenant._id }),
    User.findOne({ tenantId: tenant._id, role: 'TENANT_OWNER' }).select('name email lastLoginAt'),
  ]);
  return { tenant: tenant.toJSON(), userCount, owner: owner ? owner.toJSON() : null };
}

export async function changeTenantStatus(admin, id, { status, reason }, meta) {
  if (!TENANT_STATUSES.includes(status)) throw ApiError.badRequest('Invalid status');
  const tenant = await Tenant.findById(id);
  if (!tenant) throw ApiError.notFound('Tenant not found');
  const from = tenant.status;
  if (from === status) return tenant.toJSON();

  tenant.status = status;
  tenant.statusReason = reason;
  tenant.statusChangedAt = new Date();
  // A suspension by the platform admin can't be undone by paying; billing never lifts it
  tenant.suspensionType = status === 'SUSPENDED' ? 'ADMIN' : null;
  await tenant.save();

  await recordAudit({
    actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, tenantId: tenant._id,
    action: 'tenant.status_changed', targetType: 'Tenant', targetId: tenant._id,
    metadata: { from, to: status, reason }, ip: meta.ip,
  });
  return tenant.toJSON();
}

export async function assignPlan(admin, id, { planId, reason }, meta) {
  const [tenant, plan] = await Promise.all([Tenant.findById(id), Plan.findById(planId)]);
  if (!tenant) throw ApiError.notFound('Tenant not found');
  if (!plan || !plan.isActive) throw ApiError.badRequest('Plan not found or inactive');

  const fromPlan = tenant.planId ? String(tenant.planId) : null;
  tenant.planId = plan._id;
  await tenant.save();
  // keep the subscription on the same plan (limits are read from the subscription)
  const sub = await ensureSubscription(tenant._id);
  if (sub) await Subscription.updateOne({ _id: sub._id }, { $set: { planId: plan._id } });

  await recordAudit({
    actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, tenantId: tenant._id,
    action: 'tenant.plan_changed', targetType: 'Tenant', targetId: tenant._id,
    metadata: { fromPlan, toPlan: String(plan._id), planCode: plan.code, reason: reason || null }, ip: meta.ip,
  });
  return (await tenant.populate('planId', 'name code')).toJSON();
}

/** Soft delete. Safety check: admin must type the tenant's slug. */
export async function softDeleteTenant(admin, id, { confirmSlug, reason }, meta) {
  const tenant = await Tenant.findById(id);
  if (!tenant) throw ApiError.notFound('Tenant not found');
  if (confirmSlug !== tenant.slug) throw ApiError.badRequest('Confirmation does not match the tenant slug');

  tenant.status = 'CANCELLED';
  tenant.statusReason = reason;
  tenant.statusChangedAt = new Date();
  tenant.deletedAt = new Date();
  await tenant.save();

  // Log every user of this tenant out
  const users = await User.find({ tenantId: tenant._id }).select('_id');
  await Promise.all(users.map((u) => revokeAllForUser(u._id, 'USER_DISABLED')));

  await recordAudit({
    actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, tenantId: tenant._id,
    action: 'tenant.deleted', targetType: 'Tenant', targetId: tenant._id,
    metadata: { reason, slug: tenant.slug }, ip: meta.ip,
  });
  return { deleted: true };
}
