#!/usr/bin/env node
// PHASE 30 — encrypted logical backup of the whole database (no mongodump needed).
//   npm run db:backup                         → backups/<date-time>/  (encrypted .ndjson.gz.enc per collection + manifest.json)
//   npm run db:backup -- --out=D:\LeadFlowBackups
// Needs: MONGODB_URI (or BACKUP_MONGODB_URI — best a read-only "leadflow_backup" user) + BACKUP_ENCRYPTION_KEY (64 hex).
// Keep the key in your password manager, NOT next to the backup. Without the key a backup can't be restored.
// Fine for small/medium databases (each collection is held in memory once); big databases → Atlas backups.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import mongoose from 'mongoose';
import env from '../src/config/env.js';
import { parseKey, sealBuffer, sha256, backupStamp, skipCollection, BACKUP_FORMAT } from './lib/backupFormat.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const key = parseKey(process.env.BACKUP_ENCRYPTION_KEY);
const uri = process.env.BACKUP_MONGODB_URI || env.MONGODB_URI;
const outDir = path.resolve(arg('out') || 'backups', backupStamp());
const { EJSON } = mongoose.mongo.BSON;

await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
const db = mongoose.connection.db;
fs.mkdirSync(outDir, { recursive: true });
const manifest = { format: BACKUP_FORMAT, createdAt: new Date().toISOString(), database: db.databaseName, encrypted: true, collections: [] };
const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !skipCollection(n)).sort();

for (const name of collections) {
  const parts = [];
  let count = 0;
  for await (const doc of db.collection(name).find({}, { batchSize: 500 })) {
    parts.push(EJSON.stringify(doc, { relaxed: false }));
    count += 1;
  }
  const gz = zlib.gzipSync(Buffer.from(parts.join('\n'), 'utf8'), { level: 9 });
  const sealed = sealBuffer(key, gz);
  fs.writeFileSync(path.join(outDir, `${name}.ndjson.gz.enc`), sealed);
  manifest.collections.push({ name, count, gzBytes: gz.length, sha256: sha256(gz) });
  process.stdout.write(`✔ ${name}: ${count} documents\n`);
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
await mongoose.disconnect();
process.stdout.write(`\n✅ Backup written to ${outDir}\n   ${manifest.collections.length} collections, ${manifest.collections.reduce((a, c) => a + c.count, 0)} documents. Encrypted — keep BACKUP_ENCRYPTION_KEY safe.\n   Test a restore into a separate test database at least once a month: npm run db:restore -- --from=...\n`);
