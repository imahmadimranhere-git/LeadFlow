// PHASE 30 — backup file format helpers (pure, unit-tested).
// Each collection → NDJSON (one Extended-JSON document per line) → gzip → AES-256-GCM.
// Encrypted file layout: "LFB1" (4 bytes) + iv (12) + authTag (16) + ciphertext. Tampering = refused.
import crypto from 'node:crypto';

const MAGIC = Buffer.from('LFB1');
export const BACKUP_FORMAT = 'leadflow-backup-v1';

export function parseKey(hex) {
  if (!/^[0-9a-fA-F]{64}$/.test(hex || '')) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex characters (npm run secrets:generate → use the ENCRYPTION_KEY style value)');
  return Buffer.from(hex, 'hex');
}

export function sealBuffer(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), body]);
}

export function openBuffer(key, sealed) {
  if (sealed.length < 32 || !sealed.subarray(0, 4).equals(MAGIC)) throw new Error('Not a LeadFlow encrypted backup file');
  const d = crypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(4, 16));
  d.setAuthTag(sealed.subarray(16, 32));
  return Buffer.concat([d.update(sealed.subarray(32)), d.final()]); // throws if the key is wrong or the file was changed
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export const backupStamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');

/** Same database? (same hosts + same database name) — protects production from an accidental restore. */
export function sameDatabase(a, b) {
  const norm = (u) => {
    const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?([^/?]+)\/?([^?]*)/.exec(String(u || ''));
    return m ? `${m[1].toLowerCase().split(',').sort().join(',')}/${m[2] || 'test'}` : String(u);
  };
  return norm(a) === norm(b);
}

/** Collections that are never backed up / restored. */
export const skipCollection = (name) => name.startsWith('system.');

export function splitLines(text) {
  return String(text).split('\n').filter((l) => l.trim().length);
}
