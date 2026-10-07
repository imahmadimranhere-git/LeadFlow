import PlatformSettings from '../../models/PlatformSettings.js';
import { recordAudit } from '../audit/auditService.js';

export async function getPlatformSettings() {
  const existing = await PlatformSettings.findOne({ key: 'platform' });
  if (existing) return existing;
  try {
    return await PlatformSettings.create({ key: 'platform' }); // first time: defaults
  } catch (err) {
    if (err.code === 11000) return PlatformSettings.findOne({ key: 'platform' }); // created in parallel
    throw err;
  }
}

export async function getBillingSettings() {
  const settings = await getPlatformSettings();
  return settings.toObject().billing;
}

export async function updateBillingSettings(admin, data, meta) {
  const settings = await getPlatformSettings();
  for (const [key, value] of Object.entries(data)) settings.set(`billing.${key}`, value);
  await settings.save();
  await recordAudit({
    actorType: 'PLATFORM_ADMIN', actorId: admin.adminId, action: 'platform.billing_settings_updated',
    metadata: { fields: Object.keys(data) }, ip: meta.ip,
  });
  return getBillingSettings();
}
