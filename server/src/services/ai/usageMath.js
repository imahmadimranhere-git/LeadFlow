// PHASE 26 — pure helpers for the AI usage & cost dashboards (no database, unit-tested).
// Money here is USD as a float (AI costs are fractions of a cent) — always rounded to 6 decimals for
// storage/maths and shown with 4 decimals. These are ESTIMATES from the platform's price list.

export const usd6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;

/** Calendar days "YYYY-MM-DD" from `from` to `to` (inclusive). Max 400 entries (safety). */
export function dayKeysBetween(from, to) {
  const out = [];
  let t = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(t) || !Number.isFinite(end)) return out;
  while (t <= end && out.length < 400) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

/** Daily series with zero days filled in (a chart with gaps lies about "quiet" days). */
export function fillDays(rows, from, to) {
  const byDay = new Map((rows || []).map((r) => [r.day, r]));
  return dayKeysBetween(from, to).map((day) => {
    const r = byDay.get(day) || {};
    return { day, requests: r.requests || 0, failed: r.failed || 0, tokens: r.tokens || 0, costUsd: usd6(r.costUsd) };
  });
}

/** Adds each row's share (%) of the total cost and of the requests. */
export function withShares(rows) {
  const cost = rows.reduce((s, r) => s + (r.costUsd || 0), 0);
  const reqs = rows.reduce((s, r) => s + (r.requests || 0), 0);
  return rows.map((r) => ({
    ...r,
    costUsd: usd6(r.costUsd),
    costShare: cost > 0 ? Math.round(((r.costUsd || 0) / cost) * 1000) / 10 : 0,
    requestShare: reqs > 0 ? Math.round(((r.requests || 0) / reqs) * 1000) / 10 : 0,
  }));
}

/** Failure rate in % (one decimal); null when there were no requests. */
export const failureRate = (failed, requests) => (requests > 0 ? Math.round((failed / requests) * 1000) / 10 : null);

/**
 * Monthly budget status.
 *   NONE      no budget set
 *   OK        below the alert line
 *   WARN      at/above the alert line (e.g. 80%)
 *   EXCEEDED  at/above 100%
 */
export function budgetStatus({ spentUsd, budgetUsd, alertPercent = 80 }) {
  if (!(budgetUsd > 0)) return { level: 'NONE', percent: null, remainingUsd: null };
  const percent = Math.round((spentUsd / budgetUsd) * 1000) / 10;
  const level = percent >= 100 ? 'EXCEEDED' : percent >= alertPercent ? 'WARN' : 'OK';
  return { level, percent, remainingUsd: usd6(Math.max(0, budgetUsd - spentUsd)) };
}

/**
 * Straight-line projection to the end of the month: spent ÷ days passed × days in month.
 * Honest: with fewer than 3 days of data the projection is meaningless → null.
 *   dayOfMonth = today's day in the company time zone (1..31), counting today as a full day.
 */
export function projectMonthEnd({ spentUsd, dayOfMonth, daysInMonth }) {
  if (!(dayOfMonth >= 3) || !(daysInMonth >= dayOfMonth)) return null;
  return usd6((spentUsd / dayOfMonth) * daysInMonth);
}

export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Plan quota row: used / limit / remaining / percent; -1 (or null) limit = unlimited. */
export function quotaRow(used, limit) {
  const u = Math.max(0, Number(used) || 0);
  if (limit === null || limit === undefined || limit < 0) return { used: u, limit: null, remaining: null, percent: null, unlimited: true };
  return { used: u, limit, remaining: Math.max(0, limit - u), percent: limit > 0 ? Math.min(100, Math.round((u / limit) * 1000) / 10) : 100, unlimited: false };
}

/**
 * Which alert (if any) must be sent now, given the level before and after this request.
 * Only an UPWARD crossing alerts (WARN once, EXCEEDED once per month — dedupe by key).
 */
export function budgetAlertToSend(before, after) {
  const rank = { NONE: 0, OK: 1, WARN: 2, EXCEEDED: 3 };
  if (rank[after] <= rank[before]) return null;
  if (after === 'EXCEEDED') return 'EXCEEDED';
  if (after === 'WARN') return 'WARN';
  return null;
}

/** Average with one decimal; null for no data. */
export const avg = (sum, n) => (n > 0 ? Math.round((sum / n) * 10) / 10 : null);
