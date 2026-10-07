// Writes and reads audit logs. Writing never breaks the main request:
// if the DB write fails, we log the error and continue.
import mongoose from '../../config/mongoose.js';
import AuditLog from '../../models/AuditLog.js';
import logger from '../../config/logger.js';
import { buildPagination } from '../../utils/queryBuilder.js';

const SENSITIVE_KEY = /pass|token|secret|key|hash|cookie|authorization|otp|code/i;
const MAX_KEYS = 20;

/** Keep metadata small and free of secrets: primitives only, sensitive keys dropped. */
export function sanitizeMetadata(meta = {}) {
  const out = {};
  for (const [key, value] of Object.entries(meta).slice(0, MAX_KEYS)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === null || ['number', 'boolean'].includes(typeof value)) out[key] = value;
    else if (typeof value === 'string') out[key] = value.slice(0, 300);
    else if (Array.isArray(value)) out[key] = value.slice(0, 20).map((v) => String(v).slice(0, 60));
    else if (value instanceof Date) out[key] = value.toISOString();
    else if (value && typeof value.toString === 'function' && mongoose.isValidObjectId(value)) out[key] = String(value);
  }
  return out;
}

const toObjectId = (v) => (v && mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(String(v)) : null);

export async function recordAudit({ actorType, actorId = null, tenantId = null, action, targetType = null, targetId = null, metadata = {}, ip = null }) {
  if (mongoose.connection.readyState !== 1) return; // DB not connected (e.g. during shutdown)
  try {
    await AuditLog.create({
      actorType,
      actorId: toObjectId(actorId),
      tenantId: toObjectId(tenantId),
      action,
      targetType,
      targetId: targetId ? String(targetId) : null,
      metadata: sanitizeMetadata(metadata),
      ip: ip ? String(ip).slice(0, 64) : null,
    });
  } catch (err) {
    logger.error({ err: err.message, action }, 'Failed to write audit log');
  }
}

export async function listAuditLogs({ page, limit, tenantId, action, actorType, from, to }) {
  const filter = {};
  if (tenantId) filter.tenantId = new mongoose.Types.ObjectId(tenantId);
  if (action) filter.action = action;
  if (actorType) filter.actorType = actorType;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    AuditLog.countDocuments(filter),
  ]);
  return { items: items.map((i) => i.toJSON()), total };
}
