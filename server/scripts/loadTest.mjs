#!/usr/bin/env node
// PHASE 30 — a small load test against a STAGING copy (not production in business hours!).
//   npm run load -- --url=https://staging.yourdomain.com --email=test@... --requests=300 --concurrency=10
// The password is asked from the environment variable LOAD_PASSWORD (not on the command line → not in history):
//   PowerShell:  $env:LOAD_PASSWORD = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText ; npm run load -- ...
// Only READ requests (lists) are sent — nothing is created or changed. Use a test account WITHOUT two-step login.
import { summarizeLoad } from './lib/loadStats.mjs';

const arg = (name, d) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? d;
const base = String(arg('url', '')).replace(/\/$/, '');
const email = arg('email');
const total = Math.min(5000, Number(arg('requests', 200)));
const concurrency = Math.min(50, Number(arg('concurrency', 10)));
const paths = String(arg('paths', '/api/v1/leads?limit=20,/api/v1/auth/me,/api/v1/notifications/unread-count,/api/v1/follow-ups')).split(',');
if (!/^https?:\/\//.test(base) || !email || !process.env.LOAD_PASSWORD) {
  process.stderr.write('Usage: set LOAD_PASSWORD, then: npm run load -- --url=https://staging... --email=... [--requests=200] [--concurrency=10]\n');
  process.exit(1);
}

const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: process.env.LOAD_PASSWORD }) });
const body = await login.json().catch(() => ({}));
if (!login.ok || !body.data?.accessToken) {
  process.stderr.write(`Login failed (${login.status}): ${body.message || ''}${body.data?.mfaRequired ? ' — use an account without two-step login' : ''}\n`);
  process.exit(1);
}
const token = body.data.accessToken;
const results = [];
let next = 0;
const started = Date.now();
async function worker() {
  while (next < total) {
    const i = next++;
    const t = performance.now();
    try {
      const r = await fetch(`${base}${paths[i % paths.length]}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
      await r.arrayBuffer();
      results.push({ ok: r.ok, status: r.status, ms: performance.now() - t });
    } catch {
      results.push({ ok: false, status: 0, ms: performance.now() - t });
    }
  }
}
process.stdout.write(`Sending ${total} requests with ${concurrency} in parallel…\n`);
await Promise.all(Array.from({ length: concurrency }, worker));
const s = summarizeLoad(results, { durationMs: Date.now() - started });
process.stdout.write(`\nRequests ${s.requests} · ${s.rps}/s · OK ${s.ok} · errors ${s.errors} (${s.errorRate}%) · 429 ${s.rateLimited}\nLatency p50 ${s.p50} ms · p95 ${s.p95} ms · p99 ${s.p99} ms · max ${s.max} ms\n`);
for (const n of s.notes) process.stdout.write(`• ${n}\n`);
process.stdout.write(s.pass ? '✅ Within targets (p95 ≤ 800 ms, errors ≤ 1%).\n' : '⚠ Outside targets — see Super admin → System for the slowest routes.\n');
