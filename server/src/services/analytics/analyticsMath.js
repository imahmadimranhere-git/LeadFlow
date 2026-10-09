// Analytics maths — PURE (unit-tested).
//
// The honesty rule (spec): no "best source" claims without enough data.
//   - every rate comes with a 95% Wilson interval (how sure we are)
//   - a source needs ≥ 30 leads (and ≥ 10 contacted for reply rates) before it is compared at all
//   - a winner is named ONLY if its worst plausible rate beats the runner-up's best plausible rate
//     (the two intervals don't overlap) — otherwise: "no clear winner yet"
export const MIN_LEADS = 30;
export const MIN_CONTACTED = 10;
export const MIN_SENT = 10;

/** 95% Wilson score interval for k successes out of n. */
export function wilson(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const r = (x) => Math.round(x * 1000) / 10; // percent, 1 decimal
  return { rate: r(p), low: r(Math.max(0, centre - half)), high: r(Math.min(1, centre + half)), k, n };
}

/** Counts → funnel row with rates and "is there enough data" flags. */
export function funnelRow(key, c) {
  const leads = c.leads || 0;
  const contacted = c.contacted || 0;
  return {
    key,
    leads,
    qualified: c.qualified || 0,
    contacted,
    replied: c.replied || 0,
    converted: c.converted || 0,
    qualifiedRate: wilson(c.qualified || 0, leads),
    contactRate: wilson(contacted, leads),
    replyRate: wilson(c.replied || 0, contacted), // of the people we contacted
    conversionRate: wilson(c.converted || 0, leads),
    enoughData: leads >= MIN_LEADS,
    enoughReplyData: contacted >= MIN_CONTACTED,
  };
}

/**
 * @param rows funnel rows
 * @param metric 'conversionRate' | 'replyRate' | 'qualifiedRate'
 * → { status: 'CLEAR' | 'NO_CLEAR_WINNER' | 'NOT_ENOUGH_DATA', best, message }
 */
export function compareSources(rows, metric = 'conversionRate') {
  const eligible = rows.filter((r) => r[metric] && (metric === 'replyRate' ? r.enoughReplyData : r.enoughData));
  if (eligible.length < 2) {
    return { status: 'NOT_ENOUGH_DATA', best: null, message: `Not enough data to compare yet — each source needs at least ${metric === 'replyRate' ? `${MIN_CONTACTED} contacted leads` : `${MIN_LEADS} leads`}, and at least two sources must have that.` };
  }
  const sorted = [...eligible].sort((a, b) => b[metric].rate - a[metric].rate);
  const [first, second] = sorted;
  if (first[metric].low > second[metric].high) {
    return { status: 'CLEAR', best: first.key, message: `${first.key} is clearly ahead (${first[metric].rate}% vs ${second[metric].rate}% for ${second.key}, and the ranges don't overlap).` };
  }
  return { status: 'NO_CLEAR_WINNER', best: null, message: `${first.key} looks best (${first[metric].rate}%), but the difference to ${second.key} (${second[metric].rate}%) could still be chance — keep collecting data.` };
}

/** USD per qualified lead, or null. */
export const costPer = (costUsd, count) => (count > 0 ? Math.round((costUsd / count) * 100) / 100 : null);

/** "2026-10-09" (a Friday) → "2026-10-05" (its Monday). */
export function weekStart(dayKey) {
  const d = new Date(`${dayKey}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Every Monday from the week of `from` to the week of `to` (inclusive). */
export function weeksBetween(from, to) {
  const out = [];
  const d = new Date(`${weekStart(from)}T00:00:00Z`);
  const end = new Date(`${weekStart(to)}T00:00:00Z`);
  while (d <= end && out.length < 60) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/** Valid day range "YYYY-MM-DD", from ≤ to, at most maxDays long → number of days, or null. */
export function rangeDays(from, to, maxDays = 366) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b) return null;
  if (new Date(a).toISOString().slice(0, 10) !== from || new Date(b).toISOString().slice(0, 10) !== to) return null; // 2026-02-31
  const days = Math.round((b - a) / 86400000) + 1;
  return days <= maxDays ? days : null;
}
