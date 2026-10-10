// PHASE 26 — monthly AI budget per company (estimated USD, company time zone month).
//   before a request: hard stop (402) when the owner switched it on and the budget is used up
//   after a request:  WARN / EXCEEDED notification to owners + admins — once per level per month
// Honest limits: costs are ESTIMATES; requests already running in parallel can pass the line a little.
import TenantSettings from '../../models/TenantSettings.js';
import AiUsageLog from '../../models/AiUsageLog.js';
import User from '../../models/User.js';
import ApiError from '../../utils/ApiError.js';
import { zonedParts, zonedMidnight, isValidTimeZone } from '../../utils/zonedTime.js';
import { DEFAULT_TIMEZONE } from '../../config/notificationOptions.js';
import { PERMISSIONS as P, ROLES, hasPermission } from '../../config/permissions.js';
import { notify } from '../notifications/notificationService.js';
import { budgetStatus, budgetAlertToSend, daysInMonth, usd6 } from './usageMath.js';

/** The company's clock: time zone, start of this month (as an instant), day of month. */
export async function companyClock(now = new Date()) {
  const s = await TenantSettings.findOne({}).select('general ai').lean();
  const tz = s?.general?.timezone && isValidTimeZone(s.general.timezone) ? s.general.timezone : DEFAULT_TIMEZONE;
  const p = zonedParts(now, tz);
  return {
    tz,
    monthStart: zonedMidnight(p.year, p.month, 1, tz),
    monthKey: `${p.year}-${String(p.month).padStart(2, '0')}`,
    dayOfMonth: p.day,
    daysInMonth: daysInMonth(p.year, p.month),
    year: p.year,
    month: p.month,
    budget: { monthlyBudgetUsd: s?.ai?.monthlyBudgetUsd ?? null, budgetAlertPercent: s?.ai?.budgetAlertPercent ?? 80, budgetHardStop: Boolean(s?.ai?.budgetHardStop) },
  };
}

/** Estimated AI spend of the current company since `since` (tenant plugin adds the tenant filter). */
export async function spendSince(since) {
  const [r] = await AiUsageLog.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: null, cost: { $sum: '$estimatedCostUsd' } } }]);
  return usd6(r?.cost || 0);
}

/** Before an AI request. → context for afterAiUsage(), or null when no budget is set. */
export async function checkBudgetBefore(now = new Date()) {
  const clock = await companyClock(now);
  const { monthlyBudgetUsd, budgetHardStop } = clock.budget;
  if (!(monthlyBudgetUsd > 0)) return null;
  const spent = await spendSince(clock.monthStart);
  if (budgetHardStop && spent >= monthlyBudgetUsd) {
    throw new ApiError(402, `Your company's monthly AI budget ($${monthlyBudgetUsd}) is used up. An owner can raise it in Settings → Company → AI, or it resets next month.`, [
      { code: 'AI_BUDGET_REACHED', field: 'ai.monthlyBudgetUsd', message: String(monthlyBudgetUsd) },
    ]);
  }
  return { clock, spentBefore: spent };
}

/** After an AI request was logged: alert owners/admins when the WARN / EXCEEDED line was crossed. */
export async function afterAiUsage(ctx, costUsd) {
  if (!ctx) return null;
  const { monthlyBudgetUsd, budgetAlertPercent } = ctx.clock.budget;
  const before = budgetStatus({ spentUsd: ctx.spentBefore, budgetUsd: monthlyBudgetUsd, alertPercent: budgetAlertPercent });
  const after = budgetStatus({ spentUsd: ctx.spentBefore + (costUsd || 0), budgetUsd: monthlyBudgetUsd, alertPercent: budgetAlertPercent });
  const level = budgetAlertToSend(before.level, after.level);
  if (!level) return null;
  const roles = ROLES.filter((r) => hasPermission(r, P.INTEGRATIONS_MANAGE) || hasPermission(r, P.BILLING_MANAGE));
  const people = await User.find({ role: { $in: roles }, status: 'ACTIVE' }).select('_id').limit(50);
  await notify({
    userIds: people.map((u) => u._id),
    type: 'AI_BUDGET',
    title: level === 'EXCEEDED' ? `AI budget used up: $${monthlyBudgetUsd} this month` : `AI spend reached ${after.percent}% of the $${monthlyBudgetUsd} monthly budget`,
    body: ctx.clock.budget.budgetHardStop && level === 'EXCEEDED' ? 'New AI requests are paused until next month or until the budget is raised.' : 'Estimated from the platform price list — your AI provider bill is the real cost.',
    link: '/app/ai-usage',
    dedupeKey: `ai-budget:${ctx.clock.monthKey}:${level}`,
  });
  return level;
}

