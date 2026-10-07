// AES-256-GCM encryption for secrets stored in the database (MFA secrets now, API keys in Phase 8).
// - Key comes from ENCRYPTION_KEY (env), never stored in DB or code.
// - Every value gets its own random 12-byte IV.
// - GCM authTag detects any tampering → decrypt throws.
import crypto from 'node:crypto';
import env from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_VERSION = 1; // bump when rotating ENCRYPTION_KEY (re-encrypt job will read old + write new)

function getKey() {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

/** @returns {{ciphertext: string, iv: string, authTag: string, keyVersion: number}} */
export function encrypt(plaintext) {
  if (typeof plaintext !== 'string') throw new TypeError('encrypt() expects a string');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: KEY_VERSION,
  };
}

export function decrypt({ ciphertext, iv, authTag }) {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** "sk-abcdef123456" → "sk-••••3456" (only this is ever shown in the UI) */
export function maskSecret(value, visible = 4) {
  const s = String(value || '');
  if (s.length <= visible) return '••••';
  const prefix = s.includes('-') ? `${s.split('-')[0]}-` : '';
  return `${prefix}••••${s.slice(-visible)}`;
}
