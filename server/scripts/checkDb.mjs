#!/usr/bin/env node
// Diagnose "Could not connect to any servers in your MongoDB Atlas cluster" step by step.
//   cd server  →  npm run db:check      (reads MONGODB_URI from server/.env; the password is NEVER printed)
// Steps: 1 address format · 2 DNS (SRV) · 3 your public IP · 4 port 27017 reachable · 5 TLS handshake · 6 real login.
import 'dotenv/config';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import mongoose from 'mongoose';

const out = (icon, msg) => process.stdout.write(`${icon} ${msg}\n`);
const hint = (msg) => process.stdout.write(`   → ${msg}\n`);
const uri = process.env.MONGODB_URI || '';

// 1) address
const m = /^(mongodb(?:\+srv)?):\/\/(?:([^:@/]+)(?::[^@]*)?@)?([^/?]+)\/?([^?]*)/.exec(uri);
if (!m) {
  out('❌', 'MONGODB_URI in server/.env is missing or not a mongodb:// / mongodb+srv:// address');
  process.exit(1);
}
const [, scheme, user, hostPart, dbName] = m;
out('✔', `Address: ${scheme}://${user || '(no user)'}:****@${hostPart}/${dbName || '(no database name)'}`);
if (/[<>]/.test(uri)) hint('The address still contains < > — replace <password> completely (no < >).');
if (!dbName) hint('No database name after the host — add /leadflow before the "?"');

// 2) DNS
let hosts = hostPart.split(',').map((h) => {
  const [name, port] = h.split(':');
  return { name, port: Number(port) || 27017 };
});
if (scheme === 'mongodb+srv') {
  try {
    const srv = await dns.resolveSrv(`_mongodb._tcp.${hostPart}`);
    hosts = srv.map((r) => ({ name: r.name, port: r.port }));
    out('✔', `DNS: found ${hosts.length} servers (${hosts.map((h) => h.name.split('.')[0]).join(', ')})`);
  } catch (err) {
    out('❌', `DNS lookup failed (${err.code}) — your internet's DNS can't find the Atlas cluster`);
    hint('Fix: Windows → Network settings → your adapter → IPv4 → DNS 8.8.8.8 and 1.1.1.1, then try again.');
    hint('Or: also check the cluster name in the address is exactly right (copy it again from Atlas → Connect).');
    process.exit(1);
  }
}

// 3) public IP (to compare with Atlas → Network Access)
try {
  const ip = (await (await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(8000) })).text()).trim();
  out('ℹ', `Your public IP right now: ${ip}  ← this exact IP (or a range containing it) must be in Atlas → Network Access, status Active`);
} catch {
  out('ℹ', 'Could not read your public IP (no problem) — check https://api.ipify.org in a browser');
}

// 4) + 5) port and TLS on every server
let portOk = 0;
let tlsOk = 0;
for (const h of hosts) {
  const open = await new Promise((resolve) => {
    const s = net.connect({ host: h.name, port: h.port, timeout: 7000 });
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
  if (!open) {
    out('❌', `${h.name.split('.')[0]}: port ${h.port} not reachable`);
    continue;
  }
  portOk += 1;
  const t = await new Promise((resolve) => {
    const s = tls.connect({ host: h.name, port: h.port, servername: h.name, timeout: 8000 }, () => { s.destroy(); resolve(null); });
    s.on('timeout', () => { s.destroy(); resolve('timeout'); });
    s.on('error', (e) => resolve(e.code || e.message));
  });
  if (t) out('❌', `${h.name.split('.')[0]}: port open but the secure (TLS) connection failed: ${t}`);
  else {
    tlsOk += 1;
    out('✔', `${h.name.split('.')[0]}: port ${h.port} open, TLS ok`);
  }
}
if (!portOk) {
  hint('Port 27017 is blocked or Atlas refuses your IP. Most likely: your IP is NOT in Network Access (or not Active yet),');
  hint('or the cluster is PAUSED (Atlas → Database → "Resume"), or your network blocks 27017 (try a mobile hotspot).');
} else if (!tlsOk) {
  hint('Port is open but TLS breaks: usually an antivirus "HTTPS / SSL scanning" feature (Kaspersky, Avast, ESET…) or a wrong PC clock.');
  hint('Fix: switch off SSL/HTTPS scanning in the antivirus (or add node.exe as exception) and check Windows date/time is automatic.');
}

// 6) real connection + login
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000 });
  await mongoose.connection.db.admin().ping();
  out('✅', `Connected and logged in to database "${mongoose.connection.db.databaseName}". npm run dev should work now.`);
  await mongoose.disconnect();
  process.exit(0);
} catch (err) {
  const reasons = [];
  for (const [addr, sd] of err.reason?.servers || []) if (sd?.error) reasons.push(`${String(addr).split('.')[0]}: ${sd.error.message}`);
  out('❌', `Login/connection failed: ${err.name}`);
  for (const r of reasons.slice(0, 3)) hint(r.replace(/:\/\/[^@]*@/, '://****@'));
  const text = `${err.message} ${reasons.join(' ')}`;
  if (/auth|Authentication failed|bad auth/i.test(text)) hint('Wrong username or password in MONGODB_URI (after a password change, update server/.env). Special characters like @ : / ? # in the password must be URL-encoded — easiest: autogenerate a letters+numbers password in Atlas.');
  else if (/not authorized/i.test(text)) hint('The user has no rights on this database — give it readWrite on the database named in the address.');
  else if (portOk && tlsOk) hint('Network is fine → check username/password and that the user exists in Atlas → Database Access.');
  process.exit(1);
}
