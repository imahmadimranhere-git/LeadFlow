// AI usage & cost for ONE company (spec A19, Phase 26). Metadata only — never prompts, lead text or keys.
// Days and months follow the company time zone (Settings → General), like follow-ups.
// All money is ESTIMATED from the platform price list; the AI provider's bill is the real cost.
import mongoose from '../../config/mongoose.js';
import AiUsageLog from '../../models/AiUsageLog.js';
import Lead from '../../models/Lead.js';
import User from '../../models/User.js';
import { buildPagination } from '../../utils/queryBuilder.js';
import { zonedMidnight, zonedDayKey } from '../../utils/zonedTime.js';
import { getUsage } from '../billing/quotaService.js';
import { companyClock, spendSince } from './aiBudget.js';
import { usd6, fillDays, withShares, failureRate, budgetStatus, projectMonthEnd, quotaRow, avg } from './usageMath.js';

const NOT_OK = { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 0, 1] };
const SUMS = {
  requests: { $sum: 1 },
  failed: { $sum: NOT_OK },
  inputTokens: { $sum: '$inputTokens' },
  outputTokens: { $sum: '$outputTokens' },
  tokens: { $sum: '$totalTokens' },
  costUsd: { $sum: '$estimatedCostUsd' },
};
const zero = { requests: 0, failed: 0, inputTokens: 0, outputTokens: 0, tokens: 0, costUsd: 0 };
const clean = (r) => (r ? { ...zero, ...r, _id: undefined, costUsd: usd6(r.costUsd) } : { ...zero });

/** Local day "YYYY-MM-DD" → the instant it starts in the zone. */
const dayStart = (key, tz) => {
  const [y, m, d] = key.split('-').map(Number);
  return zonedMidnight(y, m, d, tz);
};
const nextDayKey = (key) => new Date(Date.parse(`${key}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

async function totalsSince(since, until = null) {
  const [r] = await AiUsageLog.aggregate([{ $match: { createdAt: { $gte: since, ...(until && { $lt: until }) } } }, { $group: { _id: null, ...SUMS } }]);
  return clean(r);
}

async function budgetAndQuota(auth, clock) {
  const spent = await spendSince(clock.monthStart);
  const b = clock.budget;
  const usage = await getUsage(auth.tenantId);
  const row = (metric) => usage.rows.find((x) => x.metric === metric) || { used: 0, limit: -1 };
  return {
    budget: {
      monthlyBudgetUsd: b.monthlyBudgetUsd,
      alertPercent: b.budgetAlertPercent,
      hardStop: b.budgetHardStop,
      spentUsd: spent,
      ...budgetStatus({ spentUsd: spent, budgetUsd: b.monthlyBudgetUsd, alertPercent: b.budgetAlertPercent }),
      projectedUsd: projectMonthEnd({ spentUsd: spent, dayOfMonth: clock.dayOfMonth, daysInMonth: clock.daysInMonth }),
    },
    quota: { plan: usage.plan.name, period: usage.period, aiRequests: quotaRow(row('aiRequests').used, row('aiRequests').limit), aiTokens: quotaRow(row('aiTokens').used, row('aiTokens').limit) },
  };
}

/** Today + this month (company time zone) + budget + plan quota. Used by the dashboard cards. */
export async function usageSummary(auth, now = new Date()) {
  const clock = await companyClock(now);
  const todayStart = dayStart(zonedDayKey(now, clock.tz), clock.tz);
  const [today, month, extra] = await Promise.all([totalsSince(todayStart), totalsSince(clock.monthStart), budgetAndQuota(auth, clock)]);
  return { timezone: clock.tz, today, month, ...extra };
}

/** Full report for a date range (local days, inclusive): totals, breakdowns, daily series, top leads. */
export async function usageReport(auth, { from, to }, now = new Date()) {
  const clock = await companyClock(now);
  const since = dayStart(from, clock.tz);
  const until = dayStart(nextDayKey(to), clock.tz);
  const group = (key) => [{ $group: { _id: key, ...SUMS } }, { $sort: { costUsd: -1, requests: -1 } }, { $limit: 50 }];
  const [f] = await AiUsageLog.aggregate([
    { $match: { createdAt: { $gte: since, $lt: until } } },
    {
      $facet: {
        totals: [{ $group: { _id: null, ...SUMS, durationMs: { $sum: '$durationMs' }, retries: { $sum: { $subtract: ['$attempts', 1] } }, invalidOutput: { $sum: { $cond: [{ $eq: ['$status', 'INVALID_OUTPUT'] }, 1, 0] } } } }],
        byType: group('$requestType'),
        byModel: group({ provider: '$provider', model: '$model' }),
        byUser: group('$userId'),
        byKey: group('$keySource'),
        byError: [{ $match: { errorCode: { $ne: null } } }, { $group: { _id: '$errorCode', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 20 }],
        daily: [{ $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: clock.tz } }, ...SUMS } }],
        topLeads: [{ $match: { targetType: 'Lead', targetId: { $ne: null } } }, ...group('$targetId').slice(0, 2), { $limit: 10 }],
      },
    },
  ]);
  const t = f.totals[0] || {};
  const userIds = f.byUser.map((r) => r._id).filter(Boolean);
  const leadIds = f.topLeads.map((r) => r._id);
  const [users, leads] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('name').lean(),
    Lead.find({ _id: { $in: leadIds }, deletedAt: { $not: { $type: 'string' } } }).select('name deletedAt').lean(),
  ]);
  const nameOf = (list, id) => list.find((x) => String(x._id) === String(id));
  const strip = (r) => clean(r);
  return {
    range: { from, to, timezone: clock.tz },
    totals: {
      ...clean(t),
      failureRate: failureRate(t.failed || 0, t.requests || 0),
      invalidOutput: t.invalidOutput || 0,
      retries: t.retries || 0,
      avgDurationMs: avg(t.durationMs || 0, t.requests || 0),
      avgCostUsd: t.requests ? usd6(t.costUsd / t.requests) : null,
    },
    byType: withShares(f.byType.map((r) => ({ key: r._id, ...strip(r), failureRate: failureRate(r.failed, r.requests) }))),
    byModel: withShares(f.byModel.map((r) => ({ provider: r._id.provider, model: r._id.model, ...strip(r) }))),
    byUser: withShares(f.byUser.map((r) => ({ userId: r._id ? String(r._id) : null, name: r._id ? nameOf(users, r._id)?.name || 'Removed user' : 'System (background job)', ...strip(r) }))),
    byKey: withShares(f.byKey.map((r) => ({ key: r._id, ...strip(r) }))),
    errors: f.byError.map((r) => ({ code: r._id, count: r.count })),
    daily: fillDays(f.daily.map((r) => ({ day: r._id, ...r })), from, to),
    topLeads: f.topLeads.map((r) => {
      const l = nameOf(leads, r._id);
      return { leadId: String(r._id), name: l ? l.name : 'Deleted lead', deleted: !l || Boolean(l.deletedAt), ...strip(r) };
    }),
    ...(await budgetAndQuota(auth, clock)),
  };
}

/** Latest requests with optional filters (allow-listed by the validator). */
export async function listUsage({ page, limit, requestType, status, keySource, userId, from, to }, tz = 'UTC') {
  const { skip } = buildPagination(page, limit);
  const filter = {
    ...(requestType && { requestType }),
    ...(status && { status }),
    ...(keySource && { keySource }),
    ...(userId && { userId: new mongoose.Types.ObjectId(userId) }),
  };
  if (from || to) filter.createdAt = { ...(from && { $gte: dayStart(from, tz) }), ...(to && { $lt: dayStart(nextDayKey(to), tz) }) };
  const [items, total] = await Promise.all([
    AiUsageLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('userId', 'name'),
    AiUsageLog.countDocuments(filter),
  ]);
  return { items: items.map((i) => i.toJSON()), total };
}

/** The company's time zone for list filters. */
export async function companyTimezone() {
  return (await companyClock()).tz;
}
