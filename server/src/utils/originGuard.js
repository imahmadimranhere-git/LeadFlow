// PHASE 29 — "only through our front door". When ORIGIN_SECRET is set, Vercel adds the header
// x-origin-secret to every /api request it proxies; requests that skip Vercel and hit the API host
// directly are refused. That also makes the client IP (x-forwarded-for from Vercel) trustworthy.
// Pure (no env import) so it can be unit-tested.
import crypto from 'node:crypto';

// Callers that can't go through Vercel: payment / WhatsApp / form webhooks, and the host's health check.
export const ORIGIN_GUARD_OPEN_PATHS = [/^\/api\/v1\/webhooks\//, /^\/api\/v1\/health\/?$/];

export function makeOriginGuard(secret, { onBlocked = () => {} } = {}) {
  if (!secret) return (_req, _res, next) => next();
  const expected = crypto.createHash('sha256').update(secret).digest();
  return function originGuard(req, res, next) {
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (ORIGIN_GUARD_OPEN_PATHS.some((re) => re.test(path))) return next();
    const got = crypto.createHash('sha256').update(String(req.headers['x-origin-secret'] || '')).digest();
    if (crypto.timingSafeEqual(expected, got)) {
      delete req.headers['x-origin-secret']; // never logged / passed on
      return next();
    }
    onBlocked(req);
    return res.status(403).json({ success: false, message: 'Forbidden', errors: [] });
  };
}
