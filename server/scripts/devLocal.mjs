#!/usr/bin/env node
// Run the API on YOUR PC with a LOCAL MongoDB — no Atlas, no internet needed for the database.
// Uses the MongoDB that `npm test` already downloaded. Data is SAVED in server/.localdb (survives restarts).
//   npm run dev:local            → start (first time: also creates plans + super admin)
//   npm run dev:local -- --seed  → run the seed again (e.g. new super admin password)
// Atlas is only needed later for deployment (Render connects to Atlas, not your home internet).
import { spawn } from 'node:child_process'; // security-scan: ignore (developer tool, fixed arguments)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const PORT = 27027;
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(serverDir, '.localdb');
const firstTime = !fs.existsSync(dbPath);
fs.mkdirSync(dbPath, { recursive: true });

const say = (s) => process.stdout.write(`${s}\n`);
const portOpen = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.setTimeout(1500);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOW_TO_CLEAN = [
  '   1) Close ALL other terminals (VS Code: the 🗑️ icon on each terminal; also close extra black CMD windows).',
  '   2) In ONE new terminal run:   taskkill /F /IM mongod.exe      (Mac/Linux: pkill mongod)',
  '   3) Wait 5 seconds, then:      npm run dev:local',
].join('\n');

// 1) Another local database still running (old terminal / crashed run)? → it would fight with this one.
if (await portOpen(PORT)) {
  say(`\n❌ Port ${PORT} is already in use — a local database from ANOTHER terminal (or an old run) is still running.`);
  say('   Two copies of the same database kill each other ("ECONNREFUSED 127.0.0.1:27027").');
  say(`${HOW_TO_CLEAN}\n`);
  process.exit(1);
}

say('Starting local MongoDB (data folder: server/.localdb)…');
let mongod;
try {
  mongod = await MongoMemoryServer.create({
    instance: { dbPath, storageEngine: 'wiredTiger', port: PORT, launchTimeout: 180_000 },
  });
} catch (err) {
  say(`\n❌ The local database could not start: ${err.message}`);
  say(`   Usually an old database process is still holding server/.localdb.\n${HOW_TO_CLEAN}\n`);
  process.exit(1);
}
const uri = `${mongod.getUri().replace(/\/+$/, '').split('?')[0]}/leadflow`;
const env = { ...process.env, MONGODB_URI: uri }; // overrides the Atlas address from .env (dotenv never overrides)

// 2) Make sure it really answers before starting the API.
let ready = false;
for (let i = 0; i < 20 && !ready; i += 1) {
  ready = await portOpen(PORT);
  if (!ready) await sleep(500);
}
if (!ready) {
  say(`\n❌ The local database started but does not answer on port ${PORT}.\n${HOW_TO_CLEAN}\n`);
  await mongod.stop({ doCleanup: false }).catch(() => {});
  process.exit(1);
}
say(`✅ Local MongoDB running: ${uri}`);

let child = null;
const run = (args) =>
  new Promise((resolve) => {
    child = spawn(process.execPath, args, { cwd: serverDir, stdio: 'inherit', env });
    child.on('exit', (code) => {
      child = null;
      resolve(code);
    });
  });

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  if (child) child.kill(); // never leave the API running without its database
  await mongod.stop({ doCleanup: false }).catch(() => {}); // keep the data folder
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('SIGHUP', stop);

if (firstTime || process.argv.includes('--seed')) {
  say('\nFirst start: creating plans + super admin (npm run seed)…');
  await run(['scripts/seed.js']);
}

say('\nStarting the API (press Ctrl+C to stop both)…');
await run(['--watch', 'src/server.js']);
await stop();
