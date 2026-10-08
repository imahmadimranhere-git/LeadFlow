// Super admin: manage Industry Packs (platform-level data).
import IndustryPack from '../../models/IndustryPack.js';
import TenantSettings from '../../models/TenantSettings.js';
import ApiError from '../../utils/ApiError.js';
import { recordAudit } from '../audit/auditService.js';

export async function listAllPacks() {
  const [packs, usage] = await Promise.all([
    IndustryPack.find({}).sort({ sortOrder: 1, name: 1 }).limit(200),
    TenantSettings.aggregate([{ $match: { 'industryPack.code': { $ne: null } } }, { $group: { _id: '$industryPack.code', count: { $sum: 1 } } }]),
  ]);
  const counts = Object.fromEntries(usage.map((u) => [u._id, u.count]));
  return packs.map((p) => ({ ...p.toJSON(), tenantCount: counts[p.code] || 0 }));
}

export async function createPack(admin, data, meta) {
  const pack = await IndustryPack.create(data);
  await recordAudit({
    actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, action: 'industry_pack.created',
    targetType: 'IndustryPack', targetId: pack._id, metadata: { code: pack.code }, ip: meta.ip,
  });
  return pack.toJSON();
}

export async function updatePack(admin, id, data, meta) {
  const pack = await IndustryPack.findById(id);
  if (!pack) throw ApiError.notFound('Industry pack not found');
  for (const [k, v] of Object.entries(data)) pack.set(k, v);
  await pack.save();
  await recordAudit({
    actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, action: 'industry_pack.updated',
    targetType: 'IndustryPack', targetId: pack._id, metadata: { code: pack.code, fields: Object.keys(data) }, ip: meta.ip,
  });
  return pack.toJSON();
}
