// AI usage for a company: this month's totals + latest requests (metadata only).
import mongoose from '../../config/mongoose.js';
import AiUsageLog from '../../models/AiUsageLog.js';
import { buildPagination } from '../../utils/queryBuilder.js';

export async function usageSummary(auth, now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const group = async (since) => {
    const [r] = await AiUsageLog.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(auth.tenantId), createdAt: { $gte: since } } },
      { $group: { _id: null, requests: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 0, 1] } }, inputTokens: { $sum: '$inputTokens' }, outputTokens: { $sum: '$outputTokens' }, costUsd: { $sum: '$estimatedCostUsd' } } },
    ]);
    const z = { requests: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    return r ? { ...z, ...r, _id: undefined, costUsd: Math.round(r.costUsd * 1e4) / 1e4 } : z;
  };
  return { today: await group(today), month: await group(from) };
}

export async function listUsage({ page, limit }) {
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    AiUsageLog.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name'),
    AiUsageLog.countDocuments({}),
  ]);
  return { items: items.map((i) => i.toJSON()), total };
}
