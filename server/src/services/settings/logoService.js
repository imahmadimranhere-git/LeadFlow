// Tenant logo upload. Security rules:
//  - Only PNG / JPEG / WebP. NO SVG (an SVG file can contain JavaScript).
//  - The file's real type is checked from its first bytes ("magic bytes"), not just the Content-Type header.
//  - Max 256 KB. Served back with nosniff + a locked-down CSP so the browser can only show it as an image.
import crypto from 'node:crypto';
import TenantAsset, { ALLOWED_IMAGE_TYPES } from '../../models/TenantAsset.js';
import TenantSettings from '../../models/TenantSettings.js';
import ApiError from '../../utils/ApiError.js';
import { recordAudit } from '../audit/auditService.js';
import { ensureSettings } from './settingsService.js';

export const MAX_LOGO_BYTES = 256 * 1024;

/** Detects the real image type from the file's first bytes. */
export function detectImageType(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('ascii') === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export async function uploadLogo(actor, { buffer, declaredType }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ApiError(415, 'Upload a PNG, JPEG or WebP image (SVG is not allowed)');
  }
  if (buffer.length > MAX_LOGO_BYTES) throw new ApiError(413, 'Logo must be 256 KB or smaller');

  const realType = detectImageType(buffer);
  if (!realType || !ALLOWED_IMAGE_TYPES.includes(realType) || realType !== declaredType) {
    throw new ApiError(415, 'The file is not a valid PNG, JPEG or WebP image');
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const settings = await ensureSettings(actor.tenantId);
  const oldAssetId = settings.branding?.logoAssetId;

  const asset = await TenantAsset.create({
    tenantId: actor.tenantId, kind: 'LOGO', contentType: realType, size: buffer.length, sha256, data: buffer, uploadedBy: actor.userId,
  });
  await TenantSettings.updateOne(
    { tenantId: actor.tenantId },
    { $set: { 'branding.logoAssetId': asset._id, 'branding.logoVersion': sha256.slice(0, 12) } }
  );
  if (oldAssetId) await TenantAsset.deleteOne({ _id: oldAssetId });

  await recordAudit({
    actorType: 'USER', actorId: actor.userId, tenantId: actor.tenantId, action: 'settings.logo_uploaded',
    targetType: 'TenantAsset', targetId: asset._id, metadata: { contentType: realType, size: buffer.length },
  });
  return { hasLogo: true, logoVersion: sha256.slice(0, 12) };
}

export async function removeLogo(actor) {
  const settings = await ensureSettings(actor.tenantId);
  const assetId = settings.branding?.logoAssetId;
  if (!assetId) return { hasLogo: false };
  await TenantSettings.updateOne({ tenantId: actor.tenantId }, { $set: { 'branding.logoAssetId': null, 'branding.logoVersion': null } });
  await TenantAsset.deleteOne({ _id: assetId });
  await recordAudit({ actorType: 'USER', actorId: actor.userId, tenantId: actor.tenantId, action: 'settings.logo_removed' });
  return { hasLogo: false };
}

/** Returns { contentType, data, sha256 } of the current tenant's logo, or null. */
export async function getLogo(tenantId) {
  const settings = await TenantSettings.findOne({ tenantId }).select('branding.logoAssetId');
  const assetId = settings?.branding?.logoAssetId;
  if (!assetId) return null;
  const asset = await TenantAsset.findOne({ _id: assetId, kind: 'LOGO' }).select('+data contentType sha256');
  return asset ? { contentType: asset.contentType, data: asset.data, sha256: asset.sha256 } : null;
}
