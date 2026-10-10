// PHASE 30 — monitoring, alerts, backups and load-test maths, tested without a server or database.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { percentile, RequestMetrics, routeLabel, JobRegistry, evaluateAlerts, ALERT_COOLDOWN_MS } from '../src/monitoring/metricsCore.js';
import { parseKey, sealBuffer, openBuffer, sha256, sameDatabase, backupStamp, skipCollection, splitLines } from '../scripts/lib/backupFormat.mjs';
import { summarizeLoad } from '../scripts/lib/loadStats.mjs';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);

describe('Request metrics', () => {
  it('percentiles', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.deepEqual([percentile(v, 50), percentile(v, 95), percentile(v, 99), percentile([], 50)], [50, 95, 99, null]);
  });

  it('15-minute window: counts, 4xx/5xx, error rate, p95, slowest routes; old minutes forgotten', () => {
    const m = new RequestMetrics({ minutes: 60 });
    for (let i = 0; i < 90; i += 1) m.record({ route: 'GET /api/v1/leads', status: 200, ms: 20, at: T0 });
    for (let i = 0; i < 5; i += 1) m.record({ route: 'GET /api/v1/leads', status: 404, ms: 5, at: T0 });
    for (let i = 0; i < 5; i += 1) m.record({ route: 'POST /api/v1/exports', status: 500, ms: 900, at: T0 });
    m.record({ route: 'GET /old', status: 500, ms: 1, at: T0 - 20 * MIN }); // outside 15 min
    m.slowQuery(T0);
    const s = m.summary({ windowMinutes: 15, now: T0 });
    assert.deepEqual([s.requests, s.clientErrors, s.serverErrors, s.errorRate, s.slowQueries], [100, 5, 5, 5, 1]);
    assert.equal(s.p95, 20);
    assert.equal(s.slowestRoutes[0].route, 'POST /api/v1/exports');
    assert.equal(s.slowestRoutes[0].serverErrors, 5);
    m.record({ route: 'x', status: 200, ms: 1, at: T0 + 61 * MIN }); // a new minute far later evicts old buckets
    assert.equal(m.summary({ windowMinutes: 60, now: T0 + 61 * MIN }).requests, 1);
  });

  it('memory stays bounded under heavy traffic (sampled latencies)', () => {
    const m = new RequestMetrics();
    for (let i = 0; i < 20000; i += 1) m.record({ route: 'r', status: 200, ms: i % 100, at: T0 });
    assert.ok([...m.buckets.values()][0].ms.length <= 1000);
    assert.equal(m.summary({ now: T0 }).requests, 20000);
  });

  it('route labels never contain ids or query strings', () => {
    assert.equal(routeLabel('/api/v1/leads', '/:id', 'get'), 'GET /api/v1/leads/:id');
    assert.equal(routeLabel('/api/v1/leads', '/', 'post'), 'POST /api/v1/leads');
    assert.equal(routeLabel('/api/v1/x', undefined, 'GET'), 'unmatched');
  });
});

describe('Background job heartbeats', () => {
  it('stale after 3 missed intervals; stuck when "running" too long; failures counted', () => {
    const j = new JobRegistry();
    j.register('billing', 60 * MIN, 0);
    j.jobs.get('billing').registeredAt = T0;
    j.start('billing', T0);
    j.ok('billing', T0 + 1000);
    assert.equal(j.status(T0 + 2 * 60 * MIN)[0].stale, false);
    assert.equal(j.status(T0 + 4 * 60 * MIN)[0].stale, true);
    j.start('billing', T0 + 4 * 60 * MIN);
    assert.equal(j.status(T0 + 8 * 60 * MIN)[0].stuck, true);
    j.fail('billing', new Error('boom'), T0 + 8 * 60 * MIN);
    const s = j.status(T0 + 8 * 60 * MIN)[0];
    assert.deepEqual([s.failures, s.lastError, s.running], [1, 'boom', false]);
    j.register('new', MIN, 30_000);
    j.jobs.get('new').registeredAt = T0;
    assert.equal(j.status(T0 + 2 * MIN)[0 + 1].stale, false, 'grace period before the first run');
  });
});

describe('Alerts', () => {
  const healthy = { db: { status: 'connected', pingMs: 5 }, http: { requests: 500, errorRate: 0.2, p95: 120, slowQueries: 0, slowestRoutes: [] }, jobs: [], memory: { rssMb: 200, limitMb: 512 }, eventLoop: { p99Ms: 20 }, backlog: {}, indexes: { failed: [] } };

  it('healthy → nothing', () => {
    assert.deepEqual(evaluateAlerts(healthy, new Map(), T0).send, []);
  });

  it('fires the right alerts, with a 30-minute cooldown, and says "resolved" when it is over', () => {
    const bad = { ...healthy, db: { status: 'disconnected' }, http: { ...healthy.http, errorRate: 12, serverErrors: 60, windowMinutes: 15 }, jobs: [{ name: 'worker', stale: true, lastError: 'x' }], memory: { rssMb: 500, limitMb: 512 } };
    const r1 = evaluateAlerts(bad, new Map(), T0);
    assert.deepEqual(r1.send.map((a) => a.key).sort(), ['DB_DOWN', 'HIGH_ERROR_RATE', 'JOB_STALE:worker', 'MEMORY_HIGH']);
    assert.equal(r1.send.find((a) => a.key === 'DB_DOWN').level, 'critical');
    const r2 = evaluateAlerts(bad, r1.state, T0 + 5 * MIN);
    assert.equal(r2.send.length, 0, 'no alert storm');
    const r3 = evaluateAlerts(bad, r2.state, T0 + ALERT_COOLDOWN_MS + 1);
    assert.equal(r3.send.length, 4, 'reminder after the cooldown');
    const r4 = evaluateAlerts(healthy, r3.state, T0 + ALERT_COOLDOWN_MS + 2 * MIN);
    assert.deepEqual(r4.send.map((a) => a.level), ['resolved', 'resolved', 'resolved', 'resolved']);
    assert.equal(evaluateAlerts(healthy, r4.state, T0 + ALERT_COOLDOWN_MS + 3 * MIN).send.length, 0);
  });

  it('few requests never trigger rate alerts (5 errors out of 6 is not a trend)', () => {
    const r = evaluateAlerts({ ...healthy, http: { requests: 6, errorRate: 83, p95: 5000, slowQueries: 0 } }, new Map(), T0);
    assert.deepEqual(r.send, []);
  });

  it('index build failure and backlog are reported', () => {
    const r = evaluateAlerts({ ...healthy, indexes: { failed: [{ model: 'User', error: 'E11000 duplicate key' }] }, backlog: { exports: 60 } }, new Map(), T0);
    assert.deepEqual(r.send.map((a) => a.key).sort(), ['BACKLOG', 'INDEX_BUILD_FAILED']);
  });
});

describe('Backups', () => {
  const key = crypto.randomBytes(32);
  it('encrypt → decrypt round trip; wrong key or a changed byte is refused', () => {
    const plain = Buffer.from('{"_id":{"$oid":"6720"}}\n{"name":"علی"}');
    const sealed = sealBuffer(key, plain);
    assert.ok(!sealed.includes(Buffer.from('علی')), 'not readable without the key');
    assert.deepEqual(openBuffer(key, sealed), plain);
    assert.throws(() => openBuffer(crypto.randomBytes(32), sealed));
    const changed = Buffer.from(sealed);
    changed[changed.length - 1] ^= 1;
    assert.throws(() => openBuffer(key, changed));
    assert.throws(() => openBuffer(key, Buffer.from('not a backup at all, definitely not')), /Not a LeadFlow/);
    assert.throws(() => parseKey('abc'), /64 hex/);
    assert.equal(sha256(plain).length, 64);
  });
  it('production protection: the same database is recognised whatever the user/password/options', () => {
    const a = ['mongodb+srv://leadflow_app', 'x@cluster0.ab.mongodb.net/leadflow?retryWrites=true'].join(':');
    const b = ['mongodb+srv://admin', 'y@Cluster0.ab.mongodb.net/leadflow'].join(':');
    assert.equal(sameDatabase(a, b), true);
    assert.equal(sameDatabase(a, a.replace('/leadflow?', '/leadflow_restore_test?')), false);
  });
  it('helpers: stamp, system collections skipped, blank lines ignored', () => {
    assert.equal(backupStamp(new Date('2026-10-10T21:30:00Z')), '20261010-2130');
    assert.equal(skipCollection('system.views'), true);
    assert.deepEqual(splitLines('a\n\nb\n'), ['a', 'b']);
  });
});

describe('Load test statistics', () => {
  it('rps, percentiles, 429 counted separately from errors, pass/fail against targets', () => {
    const res = [...Array.from({ length: 95 }, (_, i) => ({ ok: true, status: 200, ms: 50 + i })), { ok: false, status: 429, ms: 5 }, { ok: false, status: 500, ms: 30 }, { ok: false, status: 0, ms: 30000 }, ...Array.from({ length: 2 }, () => ({ ok: true, status: 200, ms: 60 }))];
    const s = summarizeLoad(res, { durationMs: 10_000 });
    assert.deepEqual([s.requests, s.rps, s.rateLimited, s.errors, s.errorRate], [100, 10, 1, 2, 2]);
    assert.equal(s.pass, false);
    assert.ok(s.notes.some((n) => /429/.test(n)));
    assert.equal(summarizeLoad([{ ok: true, status: 200, ms: 10 }], { durationMs: 1000 }).pass, true);
  });
});
