#!/usr/bin/env node
// PHASE 30 — restore a backup made by backup.mjs into a TARGET database (e.g. a "leadflow_restore_test").
//   npm run db:restore -- --from=backups\20261010-2130 --target=mongodb+srv://...    (or RESTORE_MONGODB_URI)
// Safety: refuses a target that already has data (unless --drop), and refuses the production database
// (MONGODB_URI) unless you add --into-production (a real emergency only). Checks every file's checksum.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import mongoose from 'mongoose';
import env from '../src/config/env.js';
import { parseKey, openBuffer, sha256, sameDatabase, splitLines, BACKUP_FORMAT } from './lib/backupFormat.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const has = (flag) => process.argv.includes(`--${flag}`);
const from = arg('from');
const target = arg('target') || process.env.RESTORE_MONGODB_URI;
if (!from || !target) {
  process.stderr.write('Usage: npm run db:restore -- --from=<backup folder> --target=<mongodb uri of the TARGET database> [--drop]\n');
  process.exit(1);
}
if (sameDatabase(target, env.MONGODB_URI) && !has('into-production')) {
  process.stderr.write('❌ The target is your PRODUCTION database (MONGODB_URI). Restore into a separate database first.\n   Real emergency? Add --into-production (and make a fresh backup before).\n');
  process.exit(1);
}
const key = parseKey(process.env.BACKUP_ENCRYPTION_KEY);
const manifest = JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf8'));
if (manifest.format !== BACKUP_FORMAT) throw new Error(`Unknown backup format ${manifest.format}`);
const { EJSON } = mongoose.mongo.BSON;

await mongoose.connect(target, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db;
const existing = (await db.listCollections({}, { nameOnly: true }).toArray()).filter((c) => !c.name.startsWith('system.'));
let hasData = false;
for (const c of existing) if (await db.collection(c.name).estimatedDocumentCount()) hasData = true;
if (hasData && !has('drop')) {
  process.stderr.write(`❌ Target database "${db.databaseName}" already has data. Use an empty database, or add --drop to replace it.\n`);
  await mongoose.disconnect();
  process.exit(1);
}

for (const c of manifest.collections) {
  const gz = openBuffer(key, fs.readFileSync(path.join(from, `${c.name}.ndjson.gz.enc`)));
  if (sha256(gz) !== c.sha256) throw new Error(`${c.name}: checksum mismatch — file damaged`);
  const lines = splitLines(zlib.gunzipSync(gz).toString('utf8'));
  if (has('drop')) await db.collection(c.name).deleteMany({});
  for (let i = 0; i < lines.length; i += 500) {
    const batch = lines.slice(i, i + 500).map((l) => EJSON.parse(l, { relaxed: false }));
    if (batch.length) await db.collection(c.name).insertMany(batch, { ordered: false });
  }
  const now = await db.collection(c.name).countDocuments();
  process.stdout.write(`${now === c.count ? '✔' : '⚠'} ${c.name}: ${now}/${c.count}\n`);
}
await mongoose.disconnect();
process.stdout.write('\n✅ Restore finished. Indexes are created by the app on start (or: npm run db:indexes -- --create with MONGODB_URI pointing there).\n');
