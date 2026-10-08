// Simple in-process scheduler.
//
// Concept: why not BullMQ yet?
//   - setInterval (this file): zero setup, perfect for ONE server. Downside: if you run 2+ servers,
//     every server runs the job (our billing steps are atomic, so that's safe, just wasteful),
//     and a job is lost if the server is down at that moment (it simply runs at the next tick).
//   - BullMQ + Redis: proper queues, retries, one runner across many servers, dashboards.
//     We switch to it when discovery runs & hashtag watches arrive (Phase 10/11), which need real queues.
import env from '../config/env.js';
import logger from '../config/logger.js';
import { runAsSystem } from '../utils/tenantContext.js';
import { runBillingCycle } from '../services/billing/subscriptionService.js';
import { startDiscoveryRunner, stopDiscoveryRunner } from './discoveryRunner.js';
import { checkMetaTokenExpiry } from '../services/integrations/meta/metaOAuthService.js';

const HOUR = 60 * 60 * 1000;
const timers = [];

function every(name, intervalMs, task, firstDelayMs = 30_000) {
  let running = false; // never run the same job twice at the same time
  const run = async () => {
    if (running) return;
    running = true;
    const started = Date.now();
    try {
      const result = await runAsSystem(`job:${name}`, () => task());
      logger.info({ job: name, ms: Date.now() - started, result }, `job ${name} done`);
    } catch (err) {
      logger.error({ job: name, err: err.message }, `job ${name} failed`);
    } finally {
      running = false;
    }
  };
  timers.push(setTimeout(run, firstDelayMs).unref());
  timers.push(setInterval(run, intervalMs).unref());
}

export function startScheduler() {
  if (!env.ENABLE_JOBS) {
    logger.info('Background jobs disabled (ENABLE_JOBS=false)');
    return;
  }
  every('billing-cycle', HOUR, () => runBillingCycle(new Date()));
  every('meta-token-expiry', 24 * HOUR, () => checkMetaTokenExpiry(new Date()), 5 * 60_000);
  startDiscoveryRunner(); // also runs due hashtag watches
  logger.info('⏱  Background jobs started');
}

export function stopScheduler() {
  stopDiscoveryRunner();
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
}
