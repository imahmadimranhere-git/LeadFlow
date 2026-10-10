// PHASE 30 — one "health snapshot" of this server + alert check (runs every minute from the scheduler).
// Alerts go to the server log (level error/warn, so a log service can alert too) and, if platform email is
// set up, to ALERT_EMAIL (or SUPER_ADMIN_EMAIL). Cooldown: the same alert at most every 30 minutes.
import os from 'node:os';
import env from '../config/env.js';
import logger from '../config/logger.js';
import mongoose from '../config/mongoose.js';
import { dbStatus } from '../config/db.js';
import { runAsSystem } from '../utils/tenantContext.js';
import ExportJob from '../models/ExportJob.js';
import DiscoveryRun from '../models/DiscoveryRun.js';
import AiBatchJob from '../models/AiBatchJob.js';
import { sendPlatformEmail, platformMailConfigured } from '../services/email/platformMailer.js';
import { evaluateAlerts } from './metricsCore.js';
import { metrics, jobs, startedAt, eventLoopP99Ms, getIndexReport, alertState, pushAlertHistory } from './monitorState.js';

async function dbPing() {
  const status = dbStatus();
  if (status !== 'connected') return { status, pingMs: null };
  const t = Date.now();
  try {
    await mongoose.connection.db.admin().ping();
    return { status, pingMs: Date.now() - t };
  } catch {
    return { status: 'error', pingMs: null };
  }
}

async function backlog() {
  if (dbStatus() !== 'connected') return {};
  try {
    const [exports, discovery, scoring] = await runAsSystem('monitor:backlog', () =>
      Promise.all([ExportJob.countDocuments({ status: 'QUEUED' }), DiscoveryRun.countDocuments({ status: 'QUEUED' }), AiBatchJob.countDocuments({ status: 'QUEUED' })])
    );
    return { exports, discovery, scoring };
  } catch {
    return {};
  }
}

export async function snapshot(now = Date.now()) {
  const mem = process.memoryUsage();
  const idx = getIndexReport();
  return {
    at: new Date(now).toISOString(),
    server: { uptimeMinutes: Math.round((now - startedAt) / 60000), node: process.version, cpus: os.cpus().length, loadAvg1m: Math.round(os.loadavg()[0] * 100) / 100 },
    db: await dbPing(),
    http: metrics.summary({ windowMinutes: 15, now }),
    jobs: jobs.status(now).map(({ name, intervalMs, lastOk, lastError, lastErrorAt, runs, failures, running, stale }) => ({
      name, intervalSeconds: Math.round(intervalMs / 1000), lastOk: lastOk && new Date(lastOk).toISOString(), lastError, lastErrorAt: lastErrorAt && new Date(lastErrorAt).toISOString(), runs, failures, running, stale,
    })),
    memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), limitMb: env.MEMORY_LIMIT_MB },
    eventLoop: { p99Ms: eventLoopP99Ms() },
    backlog: await backlog(),
    indexes: { ok: idx.ok.length, failed: idx.failed, checkedAt: idx.at },
    alerts: { active: [...alertState.map.entries()].filter(([, v]) => v.active).map(([k]) => k), recent: alertState.history.slice(0, 20) },
  };
}

/** Called every minute by the scheduler. → alerts that were sent this time */
export async function runAlertCheck(now = Date.now()) {
  const snap = await snapshot(now);
  const { send, state } = evaluateAlerts(snap, alertState.map, now);
  alertState.map = state;
  if (!send.length) return [];
  pushAlertHistory(send);
  for (const a of send) {
    const line = { alert: a.key, level: a.level, detail: a.detail };
    if (a.level === 'critical') logger.error(line, `ALERT ${a.title}`);
    else logger.warn(line, `ALERT ${a.title}`);
  }
  const to = env.ALERT_EMAIL || env.SUPER_ADMIN_EMAIL;
  if (to && platformMailConfigured()) {
    const text = send.map((a) => `[${a.level.toUpperCase()}] ${a.title}\n  ${a.detail}`).join('\n\n');
    void sendPlatformEmail({ to, subject: `LeadFlow alert: ${send.map((a) => a.title).join(' · ').slice(0, 120)}`, text: `${text}\n\nOpen Super admin → System for details.` });
  }
  return send;
}
