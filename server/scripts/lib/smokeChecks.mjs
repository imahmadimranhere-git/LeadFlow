// PHASE 29 — what a healthy, safe deployment must look like from the outside. Pure: takes the
// collected responses and returns pass/fail lines (unit-tested; the network part is in smokeTest.mjs).
const h = (r, k) => (r?.headers?.[k.toLowerCase()] ?? '');

export function evaluateSmoke(r) {
  const checks = [];
  const add = (name, ok, hint) => checks.push({ name, ok: Boolean(ok), hint: ok ? '' : hint });

  add('App page loads (200, HTML)', r.app?.status === 200 && /text\/html/.test(h(r.app, 'content-type')), 'Vercel build/deploy failed or wrong domain');
  add('App: Content-Security-Policy', /default-src 'self'/.test(h(r.app, 'content-security-policy')), 'client/vercel.json headers not applied (file must be in the client folder = Vercel "Root Directory")');
  add('App: HSTS (HTTPS forced)', /max-age=\d{6,}/.test(h(r.app, 'strict-transport-security')), 'missing Strict-Transport-Security');
  add('App: clickjacking protection', /DENY/i.test(h(r.app, 'x-frame-options')) || /frame-ancestors 'none'/.test(h(r.app, 'content-security-policy')), 'missing X-Frame-Options / frame-ancestors');
  add('Deep link works (SPA fallback)', r.deepLink?.status === 200 && /text\/html/.test(h(r.deepLink, 'content-type')), 'reloading /app/leads would 404 — check the last route in vercel.json');
  add('HTTP redirects to HTTPS', [301, 302, 307, 308].includes(r.http?.status) && /^https:/.test(h(r.http, 'location')), 'plain http:// is not redirected');

  add('API health through the app domain (200, db connected)', r.health?.status === 200 && r.health?.json?.data?.db === 'connected', r.health?.status === 403 ? 'Render refused the request: ORIGIN_SECRET differs between Vercel and Render' : r.health?.status === 503 ? 'API is up but MongoDB is not connected (Atlas Network Access / user / password)' : 'Vercel → Render rewrite not working (check the Render address in vercel.json)');
  add('API: answers are not cached', /no-store/.test(h(r.health, 'cache-control')), 'Cache-Control: no-store missing on API responses');
  add('API: no "X-Powered-By"', !h(r.health, 'x-powered-by'), 'X-Powered-By header leaks the stack');
  add('API: protected route needs login (401)', r.protected?.status === 401, 'GET /api/v1/leads without login did not return 401');
  add('API: other websites get no CORS permission', !h(r.cors, 'access-control-allow-origin'), 'CORS allows a random website — check CLIENT_URL');
  if (r.direct) {
    add('Direct API address refuses requests that skip Vercel (403)', r.direct.status === 403, 'ORIGIN_SECRET not set on Render (anyone can bypass Vercel and fake their IP)');
    add('Direct API health still open for Render (200/503)', [200, 503].includes(r.directHealth?.status), 'health check path blocked — Render would keep restarting the service');
  }
  return { ok: checks.every((c) => c.ok), checks };
}
