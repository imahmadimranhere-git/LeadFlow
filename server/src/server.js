import env from './config/env.js'; // validates env FIRST
import logger from './config/logger.js';
import { connectDB, disconnectDB } from './config/db.js';
import app from './app.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

await connectDB();

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 API running on http://localhost:${env.PORT}/api/v1/health (${env.NODE_ENV})`);
  startScheduler();
});

// Slow-client protection
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

// Graceful shutdown (Ctrl+C / platform restart)
async function shutdown(signal) {
  logger.info(`${signal} received, shutting down...`);
  stopScheduler();
  server.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — exiting');
  process.exit(1);
});
