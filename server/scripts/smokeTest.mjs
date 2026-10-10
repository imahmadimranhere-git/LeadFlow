#!/usr/bin/env node
// PHASE 29 — after every deploy: is the live site healthy and safe?  (read-only: only GET requests)
//   npm run smoke -- https://app.yourdomain.com                                  (app address)
//   npm run smoke -- https://app.yourdomain.com https://leadflow-api.onrender.com  (+ direct API check)
import { evaluateSmoke } from './lib/smokeChecks.mjs';

const [appUrl, directUrl] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!appUrl || !/^https:\/\//.test(appUrl)) {
  process.stderr.write('Usage: npm run smoke -- https://your-app-address [https://your-api.onrender.com]\n');
  process.exit(1);
}
const base = appUrl.replace(/\/$/, '');
async function get(url, headers = {}, redirect = 'follow') {
  try {
    const res = await fetch(url, { headers, redirect, signal: AbortSignal.timeout(70_000) }); // free Render may need ~1 min to wake up
    const out = { status: res.status, headers: Object.fromEntries(res.headers) };
    if (/json/.test(out.headers['content-type'] || '')) out.json = await res.json().catch(() => null);
    else await res.arrayBuffer().catch(() => null);
    return out;
  } catch (err) {
    return { status: 0, headers: {}, error: err.message };
  }
}

process.stdout.write(`Checking ${base} …\n`);
const r = {
  app: await get(`${base}/`),
  deepLink: await get(`${base}/app/leads`),
  http: await get(base.replace(/^https:/, 'http:'), {}, 'manual'),
  health: await get(`${base}/api/v1/health`),
  protected: await get(`${base}/api/v1/leads`),
  cors: await get(`${base}/api/v1/health`, { Origin: 'https://evil.example' }),
};
if (directUrl) {
  const d = directUrl.replace(/\/$/, '');
  r.direct = await get(`${d}/api/v1/leads`);
  r.directHealth = await get(`${d}/api/v1/health`);
}
const { ok, checks } = evaluateSmoke(r);
for (const c of checks) process.stdout.write(`${c.ok ? '✅' : '❌'} ${c.name}${c.ok ? '' : `\n     → ${c.hint}`}\n`);
process.stdout.write(ok ? '\n✅ Deployment looks healthy.\n' : '\n❌ Fix the items above, redeploy, and run this again.\n');
process.exitCode = ok ? 0 : 1;
