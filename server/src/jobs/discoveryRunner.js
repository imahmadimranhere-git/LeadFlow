// Background worker for discovery runs.
//
// Concept — a "database queue": runs are stored in MongoDB with status QUEUED. Each worker tick
// atomically CLAIMS one (QUEUED → RUNNING with findOneAndUpdate), so even with several servers a run
// is processed exactly once. A heartbeat is written while it works; if a server dies, the run is
// marked failed after 10 minutes and its unused searches are refunded.
// Trade-off vs BullMQ + Redis: no extra service to pay for/host, durable (it's in MongoDB), good for
// a few hundred runs per day. Redis queues become worth it with many workers / high volume (Phase 11+).
import crypto from 'node:crypto';
import logger from '../config/logger.js';
import { claimNextRun, processRun, recoverStaleRuns } from '../services/leads/discovery/discoveryService.js';
import { claimDueWatch, processWatch } from '../services/signals/watchService.js';

const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;
const MAX_PARALLEL = 2;
let active = 0;
let watchActive = false; // one hashtag watch at a time per server (Instagram rate limits)
let timer = null;
let lastRecovery = 0;

async function tick() {
  try {
    if (Date.now() - lastRecovery > 60_000) {
      lastRecovery = Date.now();
      const n = await recoverStaleRuns();
      if (n) logger.warn({ n }, 'recovered stale discovery runs');
    }
    while (active < MAX_PARALLEL) {
      const run = await claimNextRun(WORKER_ID);
      if (!run) break;
      active += 1;
      processRun(run).finally(() => {
        active -= 1;
      });
    }
    if (!watchActive) {
      const watch = await claimDueWatch();
      if (watch) {
        watchActive = true;
        processWatch(watch)
          .then((r) => logger.info({ watchId: String(watch._id), status: r.status, signals: r.signals }, 'hashtag watch ran'))
          .catch((err) => logger.error({ err: err.message }, 'hashtag watch crashed'))
          .finally(() => {
            watchActive = false;
          });
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'discovery runner tick failed');
  }
}

export function startDiscoveryRunner(intervalMs = 5000) {
  if (timer) return;
  timer = setInterval(tick, intervalMs).unref();
  logger.info({ worker: WORKER_ID }, 'discovery runner started');
}

export function stopDiscoveryRunner() {
  clearInterval(timer);
  timer = null;
}
