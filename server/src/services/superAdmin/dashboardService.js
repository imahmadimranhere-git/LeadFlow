import Tenant from '../../models/Tenant.js';
import User from '../../models/User.js';
import Plan from '../../models/Plan.js';
import { platformRevenueMetrics } from '../billing/subscriptionService.js';

export async function getPlatformStats() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [byStatus, newSignups30d, totalUsers, activePlans, revenue] = await Promise.all([
    Tenant.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Tenant.countDocuments({ createdAt: { $gte: since } }),
    User.countDocuments({}),
    Plan.countDocuments({ isActive: true }),
    platformRevenueMetrics(),
  ]);
  const tenantsByStatus = { TRIAL: 0, ACTIVE: 0, PAST_DUE: 0, SUSPENDED: 0, CANCELLED: 0 };
  for (const row of byStatus) tenantsByStatus[row._id] = row.count;
  const totalTenants = Object.values(tenantsByStatus).reduce((a, b) => a + b, 0);

  return {
    totalTenants,
    tenantsByStatus,
    newSignups30d,
    totalUsers,
    activePlans,
    // money per currency, in minor units (e.g. { USD: 12900, PKR: 500000 })
    mrr: revenue.mrr,
    revenue30d: revenue.revenue30d,
    churn30d: revenue.churn30d,
    payingSubscriptions: revenue.payingSubscriptions,
  };
}
