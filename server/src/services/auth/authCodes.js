// PHASE 27 — pure helpers for account security (unit-tested, no database).
import crypto from 'node:crypto';

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** 10 one-time recovery codes like "k7m2q-x9p4t" (50 bits each). Shown ONCE; only hashes are stored. */
export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const bytes = crypto.randomBytes(10);
    const chars = [...bytes].map((b) => B32[b & 31]).join('');
    return `${chars.slice(0, 5)}-${chars.slice(5, 10)}`;
  });
}

/** "K7M2Q X9P4T" / "k7m2q-x9p4t" → "k7m2qx9p4t"; anything else → null. */
export function normalizeRecoveryCode(input) {
  const s = String(input ?? '').toLowerCase().replace(/[\s-]/g, '');
  return /^[a-z2-7]{10}$/.test(s) ? s : null;
}

export const hashSecret = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** 203.0.113.45 → "203.0.113.x"; IPv6 → first 3 groups; ::ffff:1.2.3.4 handled. Never the full address. */
export function maskIp(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.x`;
  if (ip.includes(':')) return `${ip.split(':').filter(Boolean).slice(0, 3).join(':')}:…`;
  return null;
}

/** "Chrome on Windows" — enough for a person to recognise their device. Unknown → "Unknown device". */
export function describeUserAgent(ua) {
  const s = String(ua || '');
  if (!s) return 'Unknown device';
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : /curl|node|axios|python/i.test(s) ? 'Script / API client' : 'Browser';
  const os = /Windows/.test(s) ? 'Windows' : /iPhone|iPad/.test(s) ? 'iPhone/iPad' : /Android/.test(s) ? 'Android' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : null;
  return os ? `${browser} on ${os}` : browser;
}

/** Same response time shape for "account exists" and "doesn't exist" (used with a fixed minimum delay). */
export async function atLeast(ms, promise) {
  const [result] = await Promise.all([promise, new Promise((r) => setTimeout(r, ms))]);
  return result;
}
