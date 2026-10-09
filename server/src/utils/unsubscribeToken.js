// Signed unsubscribe tokens for email links. No expiry (an unsubscribe link must keep working),
// but they can't be forged or changed: HMAC-SHA256 with a key derived from JWT_SECRET.
import crypto from 'node:crypto';
import env from '../config/env.js';

const key = () => crypto.createHmac('sha256', env.JWT_SECRET).update('leadflow:unsubscribe:v1').digest();
const b64 = (buf) => Buffer.from(buf).toString('base64url');

export function signUnsubscribe({ tenantId, leadId, email }) {
  const payload = b64(JSON.stringify({ t: String(tenantId), l: String(leadId), e: String(email).toLowerCase() }));
  const sig = b64(crypto.createHmac('sha256', key()).update(payload).digest());
  return `${payload}.${sig}`;
}

/** → { tenantId, leadId, email } or null */
export function verifyUnsubscribe(token) {
  if (typeof token !== 'string' || token.length > 600 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', key()).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const o = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (![o.t, o.l].every((v) => /^[a-f\d]{24}$/i.test(v)) || typeof o.e !== 'string') return null;
    return { tenantId: o.t, leadId: o.l, email: o.e };
  } catch {
    return null;
  }
}
