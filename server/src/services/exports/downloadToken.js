// Short-lived signed download links — PURE (the secret is passed in; unit-tested).
// The link works without a login header (the browser just opens it), so it carries its own proof:
//   payload = { j: exportJobId, t: tenantId, u: userId, e: expiry (unix seconds) }, HMAC-SHA256 signed.
// The server STILL re-checks the user and the job when the link is used (authorization at use time).
import crypto from 'node:crypto';

const b64 = (buf) => Buffer.from(buf).toString('base64url');
export const LINK_TTL_SECONDS = 10 * 60;

export function signDownload({ jobId, tenantId, userId }, key, now = Date.now(), ttl = LINK_TTL_SECONDS) {
  const payload = b64(JSON.stringify({ j: String(jobId), t: String(tenantId), u: String(userId), e: Math.floor(now / 1000) + ttl }));
  return `${payload}.${b64(crypto.createHmac('sha256', key).update(payload).digest())}`;
}

/** → { jobId, tenantId, userId } | { error: 'INVALID' | 'EXPIRED' } */
export function verifyDownload(token, key, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 400 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return { error: 'INVALID' };
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', key).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { error: 'INVALID' };
  let o;
  try {
    o = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { error: 'INVALID' };
  }
  if (![o.j, o.t, o.u].every((v) => /^[a-f\d]{24}$/i.test(String(v))) || !Number.isInteger(o.e)) return { error: 'INVALID' };
  if (o.e * 1000 < now) return { error: 'EXPIRED' };
  return { jobId: o.j, tenantId: o.t, userId: o.u };
}
