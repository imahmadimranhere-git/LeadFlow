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
import { claimNextBatch, processBatch, recoverStaleBatches } from '../services/ai/scoring/leadScoring.js';
import { recoverStuckSending } from '../services/outreach/outreachService.js';
import { notifyDueFollowUps, sendDailyDigests } from '../services/followUps/followUpService.js';
import { expireQuotes } from '../services/erp/quoteService.js';
import { notifyOverdueInvoices, recoverStuckIssuing } from '../services/erp/invoiceService.js';

const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;
const MAX_PARALLEL = 2;
let active = 0;
let watchActive = false;
let batchActive = false; // one AI scoring batch at a time per server (protects your AI rate limits) // one hashtag watch at a time per server (Instagram rate limits)
let timer = null;
let lastRecovery = 0;
let lastFollowUps = 0;
let followUpsActive = false;

async function tick() {
  try {
    if (Date.now() - lastRecovery > 60_000) {
      lastRecovery = Date.now();
      const n = await recoverStaleRuns();
      if (n) logger.warn({ n }, 'recovered stale discovery runs');
      const b = await recoverStaleBatches();
      if (b) logger.warn({ b }, 'recovered stale scoring batches');
      const m = await recoverStuckSending();
      if (m) logger.warn({ m }, 'outreach sends interrupted — marked SEND_FAILED for a human to check');
      const q = await expireQuotes();
      if (q) logger.info({ q }, 'quotes expired (validity date passed)');
      await recoverStuckIssuing();
      await notifyOverdueInvoices();
    }
    if (!followUpsActive && Date.now() - lastFollowUps > 60_000) {
      // follow-up reminders + daily emails: once a minute, never two at the same time on one server
      lastFollowUps = Date.now();
      followUpsActive = true;
      Promise.all([notifyDueFollowUps(), sendDailyDigests()])
        .then(([n, d]) => (n || d) && logger.info({ notified: n, digests: d }, 'follow-up reminders'))
        .catch((err) => logger.error({ err: err.message }, 'follow-up reminders failed'))
        .finally(() => {
          followUpsActive = false;
        });
    }
    while (active < MAX_PARALLEL) {
      const run = await claimNextRun(WORKER_ID);
      if (!run) break;
      active += 1;
      processRun(run).finally(() => {
        active -= 1;
      });
    }
    if (!batchActive) {
      const batch = await claimNextBatch();
      if (batch) {
        batchActive = true;
        processBatch(batch)
          .catch((err) => logger.error({ err: err.message }, 'scoring batch crashed'))
          .finally(() => {
            batchActive = false;
          });
      }
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
