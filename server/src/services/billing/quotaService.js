// Plan limits. Two kinds:
//  1) monthly counters (leads/month, AI requests/month...) → consumeQuota() — atomic, race-safe
//  2) "how many exist right now" (users, hashtag watches) → assertCanAddUser() etc.
import ApiError from '../../utils/ApiError.js';
import UsageCounter, { MONTHLY_METRICS } from '../../models/UsageCounter.js';
import User from '../../models/User.js';
import Invitation from '../../models/Invitation.js';
import { getEffectivePlan, isUnlimited } from './planResolver.js';
import { periodKey } from './dates.js';

const LABELS = {
  leads: 'leads this month',
  discoverySearches: 'discovery searches this month',
  aiRequests: 'AI requests this month',
  aiTokens: 'AI tokens this month',
  exports: 'exports this month',
  users: 'team members',
};

/** 402 Payment Required + a clear upgrade message for the UI */
export function limitError(metric, limit, planName) {
  return new ApiError(
    402,
    `Your ${planName} plan allows ${limit} ${LABELS[metric] || metric}. Please upgrade your plan to continue.`,
    [{ code: 'PLAN_LIMIT_REACHED', field: metric, message: `limit ${limit}` }]
  );
}

/**
 * Atomically adds `amount` to this month's counter ONLY if the result stays within the limit.
 * Two parallel requests can never both pass when only one slot is left.
 */
export async function consumeQuota(tenantId, metric, amount = 1, now = new Date()) {
  const limitKey = MONTHLY_METRICS[metric];
  if (!limitKey) throw new Error(`Unknown metric ${metric}`);
  if (!Number.isInteger(amount) || amount < 1) throw new Error('amount must be a positive integer');

  const plan = await getEffectivePlan(tenantId);
  const limit = plan.limits?.[limitKey];
  const period = periodKey(now);

  if (isUnlimited(limit)) {
    await UsageCounter.updateOne({ tenantId, metric, period }, { $inc: { count: amount } }, { upsert: true });
    return { unlimited: true };
  }
  if (amount > limit) throw limitError(metric, limit, plan.name);

  // Try twice: the very first request of the month may race with another one creating the document
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const doc = await UsageCounter.findOneAndUpdate(
        { tenantId, metric, period, count: { $lte: limit - amount } },
        { $inc: { count: amount } },
        { upsert: true, new: true }
      );
      return { used: doc.count, limit };
    } catch (err) {
      // 11000 = the document exists but the count condition failed (limit reached) OR a parallel insert won
      if (err.code !== 11000) throw err;
    }
  }
  throw limitError(metric, limit, plan.name);
}

/** Give quota back (e.g. the action failed after consuming). Never goes below 0. */
export async function releaseQuota(tenantId, metric, amount = 1, now = new Date()) {
  await UsageCounter.updateOne(
    { tenantId, metric, period: periodKey(now), count: { $gte: amount } },
    { $inc: { count: -amount } }
  );
}

/** Users limit counts active users + pending invitations (so you can't invite past the limit). */
export async function assertCanAddUser(tenantId, { countPendingInvites = true } = {}) {
  const plan = await getEffectivePlan(tenantId);
  const limit = plan.limits?.users;
  if (isUnlimited(limit)) return;
  const [users, pending] = await Promise.all([
    User.countDocuments({ tenantId, status: 'ACTIVE' }),
    countPendingInvites ? Invitation.countDocuments({ tenantId, status: 'PENDING', expiresAt: { $gt: new Date() } }) : 0,
  ]);
  if (users + pending >= limit) throw limitError('users', limit, plan.name);
}

export async function getUsage(tenantId, now = new Date()) {
  const plan = await getEffectivePlan(tenantId);
  const period = periodKey(now);
  const [counters, users] = await Promise.all([
    UsageCounter.find({ tenantId, period }),
    User.countDocuments({ tenantId, status: 'ACTIVE' }),
  ]);
  const byMetric = Object.fromEntries(counters.map((c) => [c.metric, c.count]));

  const rows = [
    { metric: 'users', label: 'Team members', used: users, limit: plan.limits?.users ?? -1 },
    ...Object.entries(MONTHLY_METRICS).map(([metric, limitKey]) => ({
      metric,
      label: LABELS[metric].replace(/^./, (c) => c.toUpperCase()),
      used: byMetric[metric] || 0,
      limit: plan.limits?.[limitKey] ?? -1,
    })),
    { metric: 'hashtagWatches', label: 'Hashtag watches', used: 0, limit: plan.limits?.hashtagWatches ?? -1 }, // counted from Phase 11
    { metric: 'storageMb', label: 'Storage (MB)', used: 0, limit: plan.limits?.storageMb ?? -1 }, // counted when uploads arrive
  ];
  return { period, plan: { id: plan._id ? String(plan._id) : null, name: plan.name, code: plan.code }, rows };
}
