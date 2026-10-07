import Plan from '../../models/Plan.js';
import ApiError from '../../utils/ApiError.js';
import { recordAudit } from '../audit/auditService.js';

export async function listPlans() {
  const plans = await Plan.find({}).sort({ sortOrder: 1, createdAt: 1 }).limit(200);
  return plans.map((p) => p.toJSON());
}

export async function createPlan(admin, data, meta) {
  const plan = await Plan.create(data);
  await recordAudit({
    actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, action: 'plan.created',
    targetType: 'Plan', targetId: plan._id, metadata: { code: plan.code }, ip: meta.ip,
  });
  return plan.toJSON();
}

export async function updatePlan(admin, id, data, meta) {
  const plan = await Plan.findById(id);
  if (!plan) throw ApiError.notFound('Plan not found');
  // Only fields that passed validation are here (code is not editable)
  for (const [key, value] of Object.entries(data)) {
    if (key === 'limits') {
      for (const [limitKey, limitValue] of Object.entries(value)) plan.set(`limits.${limitKey}`, limitValue);
    } else {
      plan.set(key, value);
    }
  }
  await plan.save();
  await recordAudit({
    actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, action: 'plan.updated',
    targetType: 'Plan', targetId: plan._id, metadata: { code: plan.code, fields: Object.keys(data) }, ip: meta.ip,
  });
  return plan.toJSON();
}
