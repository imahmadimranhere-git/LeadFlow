// PHASE 29 — checks a PRODUCTION environment before/after deploying. Pure: takes a plain object
// (process.env or a parsed file) and returns { errors, warnings, ok }. Never returns secret values.
const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};
const host = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
};
// placeholders / development values (a random secret almost never contains these as a whole prefix/word)
const weak = (v) => !v || v.length < 32 || /^(test|dev|example|demo)[_-]|change_?me|placeholder|your[_-]?(secret|key)/i.test(v) || /^(.)\1+$/.test(v);

export function checkProductionEnv(e) {
  const errors = [];
  const warnings = [];
  const err = (key, msg) => errors.push({ key, msg });
  const warn = (key, msg) => warnings.push({ key, msg });

  if (e.NODE_ENV !== 'production') err('NODE_ENV', 'must be "production" (secure cookies, HSTS, no debug output)');

  // secrets
  for (const k of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) if (weak(e[k])) err(k, 'missing, too short (<32) or looks like a placeholder — run: npm run secrets:generate');
  if (e.JWT_SECRET && e.JWT_SECRET === e.JWT_REFRESH_SECRET) err('JWT_REFRESH_SECRET', 'must be different from JWT_SECRET');
  if (!/^[0-9a-fA-F]{64}$/.test(e.ENCRYPTION_KEY || '') || /^(.)\1+$/.test(e.ENCRYPTION_KEY)) err('ENCRYPTION_KEY', 'must be 64 random hex characters (not the development key)');

  // database
  const uri = e.MONGODB_URI || '';
  if (!uri) err('MONGODB_URI', 'missing');
  else {
    if (!/^mongodb\+srv:\/\//.test(uri) && !/tls=true|ssl=true/.test(uri)) err('MONGODB_URI', 'use the Atlas mongodb+srv:// address (TLS)');
    const user = /^mongodb(?:\+srv)?:\/\/([^:@/]+)/.exec(uri)?.[1];
    if (user && user !== 'leadflow_app') warn('MONGODB_URI', `connects as "${user}" — use the least-privilege user "leadflow_app" (readWrite on the app database only)`);
    if (/localhost|127\.0\.0\.1/.test(uri)) err('MONGODB_URI', 'points to localhost');
    if (/\/(test|leadflow_test)(\?|$)/.test(uri)) warn('MONGODB_URI', 'database name looks like a test database');
  }

  // addresses
  const origins = String(e.CLIENT_URL || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origins.length) err('CLIENT_URL', 'missing');
  for (const o of origins) {
    if (o.includes('*')) err('CLIENT_URL', 'must not contain "*"');
    else if (!isHttps(o)) err('CLIENT_URL', `${o} must be https://`);
    else if (/localhost|127\.0\.0\.1/.test(o)) err('CLIENT_URL', `${o} is a local address`);
    else if (new URL(o).pathname !== '/' || o.endsWith('/')) warn('CLIENT_URL', `${o}: use only the origin (no path, no trailing slash)`);
  }
  if (!isHttps(e.API_PUBLIC_URL)) err('API_PUBLIC_URL', 'must be https:// (used in OAuth callbacks, download and unsubscribe links)');
  const sameHost = origins.length && host(e.API_PUBLIC_URL) && origins.some((o) => host(o) === host(e.API_PUBLIC_URL));

  // proxy + cookies
  const hops = Number(e.TRUST_PROXY_HOPS ?? 1);
  if (sameHost) {
    if (hops !== 2) warn('TRUST_PROXY_HOPS', 'the API is reached through Vercel → set 2 (browser → Vercel → Render), otherwise rate limits see Vercel\'s IP');
    if (weak(e.ORIGIN_SECRET)) err('ORIGIN_SECRET', 'required with the Vercel proxy (and TRUST_PROXY_HOPS=2) so nobody can bypass Vercel and fake their IP — same value in Render AND Vercel');
  } else {
    warn('API_PUBLIC_URL', 'the app and API are on different hosts — the login cookie becomes "third-party" and many browsers block it. Recommended: API_PUBLIC_URL = your app address (Vercel proxies /api)');
    if ((e.COOKIE_SAMESITE || 'strict') !== 'none') warn('COOKIE_SAMESITE', 'with different hosts the refresh cookie needs "none" (or use the Vercel proxy instead — recommended)');
  }

  // features
  if (!e.EXTENSION_ORIGINS) warn('EXTENSION_ORIGINS', 'empty → the Chrome extension is refused in production. Add chrome-extension://<your published extension id>');
  else for (const o of e.EXTENSION_ORIGINS.split(',').map((s) => s.trim())) if (!/^chrome-extension:\/\/[a-p]{32}$/.test(o)) err('EXTENSION_ORIGINS', `${o} is not a valid chrome-extension://<32 letters a-p> origin`);
  if (!e.PLATFORM_SMTP_HOST || !e.PLATFORM_EMAIL_FROM) warn('PLATFORM_SMTP_HOST', 'not set → password-reset and email-confirmation emails are NOT sent');
  else if (['465', '587', '25'].includes(String(e.PLATFORM_SMTP_PORT || '587'))) warn('PLATFORM_SMTP_PORT', 'Render FREE instances block ports 25/465/587 — on free use 2525 (if your provider supports it) or a paid instance');
  if (Boolean(e.META_APP_ID) !== Boolean(e.META_APP_SECRET)) err('META_APP_SECRET', 'META_APP_ID and META_APP_SECRET must be set together');
  if (e.ENABLE_JOBS === 'false') warn('ENABLE_JOBS', 'background jobs are off (follow-up emails, hashtag watches, exports, billing cycle will not run)');
  if (['debug', 'trace'].includes(e.LOG_LEVEL)) warn('LOG_LEVEL', 'debug logs in production are noisy and may contain more personal data — use info');
  if (Number(e.ACCESS_TOKEN_TTL_MINUTES || 15) > 30) warn('ACCESS_TOKEN_TTL_MINUTES', 'over 30 minutes — a stolen token works longer');
  if (e.COOKIE_SAMESITE === 'none' && sameHost) warn('COOKIE_SAMESITE', '"none" is not needed with the Vercel proxy — use strict');

  return { ok: errors.length === 0, errors, warnings };
}

/** Minimal .env parser (KEY=VALUE, quotes, comments) — no package needed. */
export function parseEnvText(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}
