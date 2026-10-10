// PHASE 30 — production monitoring, pure parts (no database, no env → unit-tested).
//   RequestMetrics  per-minute buckets for the last 60 minutes: counts, 4xx/5xx, latency percentiles, slow routes
//   JobRegistry     heartbeat of every background job: last run / last success / last error / stale?
//   evaluateAlerts  turns a snapshot into alerts, with cooldown (no alert storms) and "recovered" notices
// Everything is in memory per server: it resets on restart and each server has its own numbers (honest
// limitation; an external tool like UptimeRobot / Better Stack watches from outside).

export function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return sortedValues[idx];
}

const MINUTE = 60_000;
const SAMPLE_CAP = 1000; // per minute bucket — enough for percentiles, bounded memory

export class RequestMetrics {
  constructor({ minutes = 60 } = {}) {
    this.minutes = minutes;
    this.buckets = new Map(); // minuteIndex → { n, s4, s5, ms: [], routes: Map(route → {n, s5, msSum}) }
    this.slowQueries = new Map(); // minuteIndex → count
  }

  bucket(at) {
    const key = Math.floor(at / MINUTE);
    let b = this.buckets.get(key);
    if (!b) {
      b = { n: 0, s4: 0, s5: 0, ms: [], routes: new Map() };
      this.buckets.set(key, b);
      const oldest = key - this.minutes;
      for (const k of this.buckets.keys()) if (k <= oldest) this.buckets.delete(k);
      for (const k of this.slowQueries.keys()) if (k <= oldest) this.slowQueries.delete(k);
    }
    return b;
  }

  record({ route = 'unmatched', status, ms, at = Date.now() }) {
    const b = this.bucket(at);
    b.n += 1;
    if (status >= 500) b.s5 += 1;
    else if (status >= 400) b.s4 += 1;
    if (b.ms.length < SAMPLE_CAP) b.ms.push(ms);
    else b.ms[Math.floor(Math.random() * SAMPLE_CAP)] = ms; // security-scan: ignore (statistical sampling, not a secret)
    const r = b.routes.get(route) || { n: 0, s5: 0, msSum: 0, msMax: 0 };
    r.n += 1;
    r.msSum += ms;
    r.msMax = Math.max(r.msMax, ms);
    if (status >= 500) r.s5 += 1;
    b.routes.set(route, r);
  }

  slowQuery(at = Date.now()) {
    const key = Math.floor(at / MINUTE);
    this.bucket(at);
    this.slowQueries.set(key, (this.slowQueries.get(key) || 0) + 1);
  }

  summary({ windowMinutes = 15, now = Date.now(), topRoutes = 8 } = {}) {
    const from = Math.floor(now / MINUTE) - windowMinutes + 1;
    let n = 0;
    let s4 = 0;
    let s5 = 0;
    let slow = 0;
    const ms = [];
    const routes = new Map();
    for (const [k, b] of this.buckets) {
      if (k < from) continue;
      n += b.n;
      s4 += b.s4;
      s5 += b.s5;
      ms.push(...b.ms);
      for (const [route, r] of b.routes) {
        const t = routes.get(route) || { n: 0, s5: 0, msSum: 0, msMax: 0 };
        t.n += r.n;
        t.s5 += r.s5;
        t.msSum += r.msSum;
        t.msMax = Math.max(t.msMax, r.msMax);
        routes.set(route, t);
      }
    }
    for (const [k, c] of this.slowQueries) if (k >= from) slow += c;
    ms.sort((a, b) => a - b);
    const round = (v) => (v === null ? null : Math.round(v));
    return {
      windowMinutes,
      requests: n,
      perMinute: Math.round((n / windowMinutes) * 10) / 10,
      clientErrors: s4,
      serverErrors: s5,
      errorRate: n ? Math.round((s5 / n) * 1000) / 10 : 0, // % of requests that were 5xx
      p50: round(percentile(ms, 50)),
      p95: round(percentile(ms, 95)),
      p99: round(percentile(ms, 99)),
      slowQueries: slow,
      slowestRoutes: [...routes.entries()]
        .map(([route, r]) => ({ route, requests: r.n, avgMs: Math.round(r.msSum / r.n), maxMs: Math.round(r.msMax), serverErrors: r.s5 }))
        .sort((a, b) => b.avgMs - a.avgMs)
        .slice(0, topRoutes),
    };
  }
}

/** Route label without ids: "/api/v1/leads/:id" — never the real id or query string (no PII in metrics). */
export function routeLabel(baseUrl, routePath, method) {
  if (!routePath) return 'unmatched';
  const p = `${baseUrl || ''}${routePath === '/' ? '' : routePath}` || '/';
  return `${String(method || 'GET').toUpperCase()} ${p}`;
}

export class JobRegistry {
  constructor() {
    this.jobs = new Map();
  }

  register(name, intervalMs, firstDelayMs = 0) {
    if (!this.jobs.has(name)) this.jobs.set(name, { name, intervalMs, firstDelayMs, registeredAt: Date.now(), lastStart: null, lastOk: null, lastError: null, lastErrorAt: null, runs: 0, failures: 0, running: false });
  }

  start(name, at = Date.now()) {
    const j = this.jobs.get(name);
    if (!j) return;
    j.lastStart = at;
    j.running = true;
  }

  ok(name, at = Date.now()) {
    const j = this.jobs.get(name);
    if (!j) return;
    j.lastOk = at;
    j.running = false;
    j.runs += 1;
  }

  fail(name, error, at = Date.now()) {
    const j = this.jobs.get(name);
    if (!j) return;
    j.lastError = String(error?.message || error || 'failed').slice(0, 200);
    j.lastErrorAt = at;
    j.running = false;
    j.runs += 1;
    j.failures += 1;
  }

  /** Stale = no success for 3 intervals (after the first expected run), or stuck "running" for 3 intervals. */
  status(now = Date.now()) {
    return [...this.jobs.values()].map((j) => {
      const grace = j.firstDelayMs + 3 * j.intervalMs;
      const since = j.lastOk ?? j.registeredAt;
      const stale = now - since > (j.lastOk ? 3 * j.intervalMs : grace);
      const stuck = j.running && j.lastStart !== null && now - j.lastStart > 3 * j.intervalMs;
      return { ...j, stale: stale || stuck, stuck };
    });
  }
}

export const ALERT_COOLDOWN_MS = 30 * MINUTE;

/**
 * @param snap  { db: {status, pingMs}, http: summary(), jobs: status(), memory: {rssMb, limitMb}, eventLoop: {p99Ms}, backlog: {exports, discovery, scoring}, indexes: {failed: []} }
 * @param state Map(key → { active: bool, lastSentAt }) — kept between runs by the caller
 * @returns {{ send: Array<{key, level, title, detail}>, state }}
 */
export function evaluateAlerts(snap, state = new Map(), now = Date.now()) {
  const firing = new Map(); // key → { level, title, detail }
  const fire = (key, level, title, detail) => firing.set(key, { level, title, detail });
  const http = snap.http || {};

  if (snap.db?.status !== 'connected') fire('DB_DOWN', 'critical', 'Database not connected', `MongoDB status: ${snap.db?.status || 'unknown'}`);
  else if (snap.db?.pingMs > 1000) fire('DB_SLOW', 'warning', 'Database is slow', `ping ${snap.db.pingMs} ms`);
  if (http.requests >= 50 && http.errorRate >= 5) fire('HIGH_ERROR_RATE', 'critical', `Server errors: ${http.errorRate}% of requests`, `${http.serverErrors} errors in ${http.requests} requests (last ${http.windowMinutes} min)`);
  if (http.requests >= 50 && http.p95 >= 2000) fire('SLOW_RESPONSES', 'warning', `Slow API: p95 ${http.p95} ms`, `slowest: ${(http.slowestRoutes || []).slice(0, 3).map((r) => `${r.route} ${r.avgMs}ms`).join(', ')}`);
  if (http.slowQueries >= 30) fire('SLOW_QUERIES', 'warning', `${http.slowQueries} slow database queries`, 'see server logs: "slow query" (model + operation)');
  for (const j of snap.jobs || []) if (j.stale) fire(`JOB_STALE:${j.name}`, 'warning', `Background job "${j.name}" is not running`, j.lastError ? `last error: ${j.lastError}` : 'no successful run recently');
  if (snap.memory?.limitMb && snap.memory.rssMb / snap.memory.limitMb >= 0.85) fire('MEMORY_HIGH', 'warning', `Memory ${snap.memory.rssMb} MB of ${snap.memory.limitMb} MB`, 'restart may be near; check for big exports / leaks');
  if (snap.eventLoop?.p99Ms >= 500) fire('EVENT_LOOP_LAG', 'warning', `Server busy: event-loop delay ${snap.eventLoop.p99Ms} ms`, 'heavy work blocking requests (big CSV / PDF?)');
  const b = snap.backlog || {};
  if ((b.exports || 0) >= 50 || (b.discovery || 0) >= 100 || (b.scoring || 0) >= 50) fire('BACKLOG', 'warning', 'Work is piling up', `queued: ${b.exports || 0} exports, ${b.discovery || 0} discovery runs, ${b.scoring || 0} scoring batches`);
  if (snap.indexes?.failed?.length) fire('INDEX_BUILD_FAILED', 'critical', 'Database index could not be built', snap.indexes.failed.map((f) => `${f.model}: ${f.error}`).join('; ').slice(0, 400));

  const next = new Map(state);
  const send = [];
  for (const [key, a] of firing) {
    const prev = next.get(key);
    if (!prev?.active || now - (prev.lastSentAt || 0) >= ALERT_COOLDOWN_MS) {
      send.push({ key, ...a });
      next.set(key, { active: true, lastSentAt: now });
    } else next.set(key, { ...prev, active: true });
  }
  for (const [key, prev] of state) {
    if (prev.active && !firing.has(key)) {
      send.push({ key, level: 'resolved', title: `Resolved: ${key}`, detail: 'back to normal' });
      next.set(key, { active: false, lastSentAt: now });
    }
  }
  return { send, state: next };
}
