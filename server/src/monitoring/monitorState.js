// PHASE 30 — the in-memory monitoring state of THIS server process (one shared instance per process).
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { RequestMetrics, JobRegistry } from './metricsCore.js';

export const metrics = new RequestMetrics({ minutes: 60 });
export const jobs = new JobRegistry();
export const startedAt = Date.now();

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
/** p99 event-loop delay (ms) since the last call — high = something blocks the server. */
export function eventLoopP99Ms() {
  const v = loop.percentile(99) / 1e6;
  loop.reset();
  return Math.round(v);
}

let indexReport = { ok: [], failed: [], at: null };
export const setIndexReport = (r) => {
  indexReport = { ...r, at: new Date().toISOString() };
};
export const getIndexReport = () => indexReport;

export const alertState = { map: new Map(), history: [] };
export function pushAlertHistory(items) {
  alertState.history.unshift(...items.map((a) => ({ ...a, at: new Date().toISOString() })));
  alertState.history.length = Math.min(alertState.history.length, 50);
}
