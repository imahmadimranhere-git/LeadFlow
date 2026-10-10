// PHASE 30 — load-test result statistics (pure, unit-tested).
import { percentile } from '../../src/monitoring/metricsCore.js';

/** results: [{ ok: bool, status: number, ms: number }] → summary + a verdict against simple targets */
export function summarizeLoad(results, { durationMs, targets = { p95: 800, errorRate: 1 } } = {}) {
  const n = results.length;
  const ms = results.filter((r) => r.status > 0).map((r) => r.ms).sort((a, b) => a - b);
  const by = (pred) => results.filter(pred).length;
  const limited = by((r) => r.status === 429);
  const errors = by((r) => r.status === 0 || r.status >= 500);
  const s = {
    requests: n,
    rps: durationMs ? Math.round((n / (durationMs / 1000)) * 10) / 10 : null,
    ok: by((r) => r.ok),
    rateLimited: limited,
    errors,
    errorRate: n ? Math.round((errors / n) * 1000) / 10 : 0,
    p50: percentile(ms, 50) === null ? null : Math.round(percentile(ms, 50)),
    p95: percentile(ms, 95) === null ? null : Math.round(percentile(ms, 95)),
    p99: percentile(ms, 99) === null ? null : Math.round(percentile(ms, 99)),
    max: ms.length ? Math.round(ms[ms.length - 1]) : null,
  };
  const notes = [];
  if (limited) notes.push(`${limited} requests got 429 (rate limit) — expected protection; for a capacity test use a staging server with a higher RATE_LIMIT_MAX`);
  if (s.errorRate > targets.errorRate) notes.push(`error rate ${s.errorRate}% is above ${targets.errorRate}%`);
  if (s.p95 !== null && s.p95 > targets.p95) notes.push(`p95 ${s.p95} ms is above ${targets.p95} ms`);
  return { ...s, pass: s.errorRate <= targets.errorRate && (s.p95 === null || s.p95 <= targets.p95), notes };
}
