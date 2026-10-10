// PHASE 26 — platform-wide AI usage for the super admin (all companies). Metadata only.
// The important split: PLATFORM key = the platform pays the provider; TENANT key = the company pays.
// Days are UTC here (the platform has no single time zone). Costs are estimates from the price list.
import mongoose from '../../config/mongoose.js';
import AiUsageLog from '../../models/AiUsageLog.js';
import Tenant from '../../models/Tenant.js';
import { runAsSystem } from '../../utils/tenantContext.js';
import { usd6, fillDays, withShares, failureRate } from '../ai/usageMath.js';

const NOT_OK = { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 0, 1] };
const PLATFORM_COST = { $cond: [{ $eq: ['$keySource', 'PLATFORM'] }, '$estimatedCostUsd', 0] };
const SUMS = { requests: { $sum: 1 }, failed: { $sum: NOT_OK }, tokens: { $sum: '$totalTokens' }, costUsd: { $sum: '$estimatedCostUsd' }, platformCostUsd: { $sum: PLATFORM_COST } };
const clean = (r) => ({ requests: r?.requests || 0, failed: r?.failed || 0, tokens: r?.tokens || 0, costUsd: usd6(r?.costUsd), platformCostUsd: usd6(r?.platformCostUsd) });

export async function platformAiUsage({ from, to, tenantId }, now = new Date()) {
  const since = new Date(`${from}T00:00:00Z`);
  const until = new Date(Date.parse(`${to}T00:00:00Z`) + 86400000);
  const match = { createdAt: { $gte: since, $lt: until }, ...(tenantId && { tenantId: new mongoose.Types.ObjectId(tenantId) }) };
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const group = (key, limit = 50) => [{ $group: { _id: key, ...SUMS } }, { $sort: { costUsd: -1 } }, { $limit: limit }];
  return runAsSystem('super-admin:ai-usage', async () => {
    const [[f], [month]] = await Promise.all([
      AiUsageLog.aggregate([
        { $match: match },
        {
          $facet: {
            totals: [{ $group: { _id: null, ...SUMS, tenants: { $addToSet: '$tenantId' } } }],
            byKey: group('$keySource'),
            byModel: group({ provider: '$provider', model: '$model' }),
            byType: group('$requestType'),
            byTenant: group('$tenantId', 25),
            errors: [{ $match: { errorCode: { $ne: null } } }, { $group: { _id: { provider: '$provider', code: '$errorCode' }, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 20 }],
            daily: [{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, ...SUMS } }],
          },
        },
      ]),
      AiUsageLog.aggregate([{ $match: { createdAt: { $gte: monthStart }, keySource: 'PLATFORM', ...(tenantId && { tenantId: new mongoose.Types.ObjectId(tenantId) }) } }, { $group: { _id: null, costUsd: { $sum: '$estimatedCostUsd' }, requests: { $sum: 1 } } }]),
    ]);
    const tenants = await Tenant.find({ _id: { $in: f.byTenant.map((r) => r._id) } }).select('name slug status').lean();
    const t = f.totals[0];
    return {
      range: { from, to, timezone: 'UTC', tenantId: tenantId || null },
      totals: { ...clean(t), failureRate: failureRate(t?.failed || 0, t?.requests || 0), activeTenants: t?.tenants?.length || 0 },
      platformKeyThisMonth: { costUsd: usd6(month?.costUsd), requests: month?.requests || 0 },
      byKey: withShares(f.byKey.map((r) => ({ key: r._id, ...clean(r) }))),
      byModel: withShares(f.byModel.map((r) => ({ provider: r._id.provider, model: r._id.model, ...clean(r), failureRate: failureRate(r.failed, r.requests) }))),
      byType: withShares(f.byType.map((r) => ({ key: r._id, ...clean(r) }))),
      byTenant: withShares(f.byTenant.map((r) => {
        const x = tenants.find((n) => String(n._id) === String(r._id));
        return { tenantId: String(r._id), name: x?.name || 'Deleted company', slug: x?.slug || null, status: x?.status || null, ...clean(r) };
      })),
      errors: f.errors.map((r) => ({ provider: r._id.provider, code: r._id.code, count: r.count })),
      daily: fillDays(f.daily.map((r) => ({ day: r._id, ...r })), from, to),
    };
  });
}
