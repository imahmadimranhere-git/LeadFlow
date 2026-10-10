#!/usr/bin/env node
// PHASE 30 — index report: which indexes the code expects but the database lacks (and extras).
//   npm run db:indexes              → report only
//   npm run db:indexes -- --create  → create the missing ones (never drops anything)
import mongoose from '../src/config/mongoose.js';
import env from '../src/config/env.js';
import '../src/app.js'; // loads every model
import { ensureIndexes } from '../src/config/indexes.js';

await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
let missing = 0;
for (const model of Object.values(mongoose.models).sort((a, b) => a.modelName.localeCompare(b.modelName))) {
  const diff = await model.diffIndexes().catch((err) => ({ error: err.message }));
  if (diff.error) process.stdout.write(`⚠ ${model.modelName}: ${diff.error}\n`);
  else if (diff.toCreate.length || diff.toDrop.length) {
    missing += diff.toCreate.length;
    process.stdout.write(`${model.modelName}: missing ${JSON.stringify(diff.toCreate)}${diff.toDrop.length ? ` · extra (not dropped): ${diff.toDrop.join(', ')}` : ''}\n`);
  }
}
if (process.argv.includes('--create')) {
  const r = await ensureIndexes();
  process.stdout.write(r.failed.length ? `❌ ${r.failed.length} failed: ${JSON.stringify(r.failed)}\n` : `✅ All indexes created/present (${r.ok.length} models)\n`);
} else process.stdout.write(missing ? `\n${missing} missing index(es). Run with --create (the API also creates them on start).\n` : '\n✅ No missing indexes.\n');
await mongoose.disconnect();
process.exit(0);
