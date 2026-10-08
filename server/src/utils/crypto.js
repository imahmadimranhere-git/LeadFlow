// AES-256-GCM encryption for secrets stored in the database (integration keys, MFA secrets).
// - Keys come from the environment, never from the DB or code.
// - Every value gets its own random 12-byte IV; the GCM authTag detects any tampering.
// - KEY ROTATION: every encrypted value remembers which key version encrypted it.
//     ENCRYPTION_KEY          → current key  (version ENCRYPTION_KEY_VERSION)
//     ENCRYPTION_KEY_PREVIOUS → old key      (version ENCRYPTION_KEY_VERSION - 1), only during rotation
//   New data always uses the current key; old data still decrypts; `npm run rotate-keys` re-encrypts it.
import crypto from 'node:crypto';
import env from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';

export function defaultKeyring() {
  const ring = { current: env.ENCRYPTION_KEY_VERSION, keys: { [env.ENCRYPTION_KEY_VERSION]: env.ENCRYPTION_KEY } };
  if (env.ENCRYPTION_KEY_PREVIOUS) ring.keys[env.ENCRYPTION_KEY_VERSION - 1] = env.ENCRYPTION_KEY_PREVIOUS;
  return ring;
}

const keyBuffer = (hex) => Buffer.from(hex, 'hex');

/** @returns {{ciphertext: string, iv: string, authTag: string, keyVersion: number}} */
export function encrypt(plaintext, ring = defaultKeyring()) {
  if (typeof plaintext !== 'string') throw new TypeError('encrypt() expects a string');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer(ring.keys[ring.current]), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: ring.current,
  };
}

export function decrypt({ ciphertext, iv, authTag, keyVersion }, ring = defaultKeyring()) {
  const version = keyVersion ?? ring.current;
  const keyHex = ring.keys[version];
  if (!keyHex) throw new Error(`No encryption key available for key version ${version}`);
  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer(keyHex), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** Rotation helper: returns null if already on the current key, else a freshly encrypted value. */
export function reEncrypt(encrypted, ring = defaultKeyring()) {
  if (!encrypted?.ciphertext || (encrypted.keyVersion ?? ring.current) === ring.current) return null;
  return encrypt(decrypt(encrypted, ring), ring);
}

/** "sk-abcdef123456" → "sk-••••3456" (only this is ever shown in the UI) */
export function maskSecret(value, visible = 4) {
  const s = String(value || '');
  if (s.length <= visible * 2) return '••••';
  const prefix = s.includes('-') ? `${s.split('-')[0]}-` : '';
  return `${prefix.length <= 6 ? prefix : ''}••••${s.slice(-visible)}`;
}
