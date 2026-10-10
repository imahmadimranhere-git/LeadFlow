// PHASE 30 — make sure every index exists in production.
// db.js uses autoIndex:false in production (Mongoose would otherwise build indexes on every model
// load, blocking-ish and noisy). But then NOTHING created them: unique rules (one account per email,
// unique invoice numbers, token hashes) and TTL clean-ups (old sessions, export files, notifications)
// were missing on a fresh Atlas database. This runs createIndexes() for every model after connecting:
// existing indexes are a no-op, missing ones are built (MongoDB builds them without locking the collection).
// It never DROPS an index (see scripts/checkIndexes.mjs for a report).
import mongoose from './mongoose.js';
import logger from './logger.js';

/** → { ok: [modelName], failed: [{ model, error }] } */
export async function ensureIndexes(models = Object.values(mongoose.models)) {
  const ok = [];
  const failed = [];
  for (const model of models) {
    try {
      await model.createIndexes();
      ok.push(model.modelName);
    } catch (err) {
      // e.g. a UNIQUE index can't be built because duplicates already exist → must be fixed by hand
      failed.push({ model: model.modelName, error: String(err.message).slice(0, 300) });
      logger.error({ model: model.modelName, err: err.message }, 'index build failed');
    }
  }
  if (!failed.length) logger.info({ models: ok.length }, 'indexes ok');
  return { ok, failed };
}
