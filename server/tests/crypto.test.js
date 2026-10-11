// PHASE 4 — ENCRYPTION, MFA CODE (TOTP) & AUDIT SANITISING UNIT TESTS (no database needed)
import './helpers/setupEnv.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, maskSecret, reEncrypt } from '../src/utils/crypto.js';
import { base32Encode, base32Decode, hotp, verifyTotp, totpAt, currentStep, generateTotpSecret } from '../src/services/superAdmin/totp.js';
import { sanitizeMetadata } from '../src/services/audit/auditService.js';

describe('AES-256-GCM encryption', () => {
  it('encrypts and decrypts back to the same text', () => {
    const enc = encrypt('sk-live-very-secret-key');
    assert.notEqual(enc.ciphertext, 'sk-live-very-secret-key');
    assert.equal(decrypt(enc), 'sk-live-very-secret-key');
  });

  it('uses a different IV every time (same text → different ciphertext)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ciphertext, b.ciphertext);
  });

  it('detects tampering with the ciphertext', () => {
    const enc = encrypt('hello world');
    const bytes = Buffer.from(enc.ciphertext, 'base64');
    bytes[0] ^= 0xff;
    assert.throws(() => decrypt({ ...enc, ciphertext: bytes.toString('base64') }));
  });

  it('detects tampering with the auth tag', () => {
    const enc = encrypt('hello world');
    const tag = Buffer.from(enc.authTag, 'base64');
    tag[0] ^= 0xff;
    assert.throws(() => decrypt({ ...enc, authTag: tag.toString('base64') }));
  });

  it('masks secrets for display', () => {
    assert.equal(maskSecret('sk-abcdef123456'), 'sk-••••3456');
    assert.equal(maskSecret('abc'), '••••');
  });
});

describe('Encryption key rotation', () => {
  const OLD = 'b'.repeat(64);
  const NEW = 'c'.repeat(64);
  const oldRing = { current: 1, keys: { 1: OLD } };
  const rotatingRing = { current: 2, keys: { 2: NEW, 1: OLD } };
  const newOnlyRing = { current: 2, keys: { 2: NEW } };

  it('old data still decrypts during rotation, then is re-encrypted with the new key', () => {
    const old = encrypt('sk-secret-value-123', oldRing);
    assert.equal(old.keyVersion, 1);
    assert.equal(decrypt(old, rotatingRing), 'sk-secret-value-123');

    const rotated = reEncrypt(old, rotatingRing);
    assert.equal(rotated.keyVersion, 2);
    assert.equal(decrypt(rotated, newOnlyRing), 'sk-secret-value-123'); // works after the old key is removed
    assert.throws(() => decrypt(old, newOnlyRing)); // and the old copy no longer opens
  });

  it('values already on the current key are left alone', () => {
    assert.equal(reEncrypt(encrypt('x', rotatingRing), rotatingRing), null);
  });

  it('the wrong key cannot decrypt', () => {
    const enc = encrypt('hello', oldRing);
    assert.throws(() => decrypt(enc, { current: 1, keys: { 1: NEW } }));
  });
});

describe('TOTP (authenticator codes)', () => {
  const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the official RFC 6238 test vectors', () => {
    assert.equal(hotp(Buffer.from('12345678901234567890'), 1), '287082'); // time 59s
    assert.equal(hotp(Buffer.from('12345678901234567890'), 37037036), '081804'); // time 1111111109s
    assert.equal(totpAt(RFC_SECRET, 1), '287082');
  });

  it('base32 encode/decode round trip', () => {
    const buf = Buffer.from('any random bytes!');
    assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  });

  it('accepts the current code and rejects a wrong one', () => {
    const secret = generateTotpSecret();
    const now = currentStep();
    assert.equal(verifyTotp(secret, totpAt(secret, now)), now);
    const wrong = totpAt(secret, now) === '000000' ? '111111' : '000000';
    assert.equal(verifyTotp(secret, wrong), null);
  });

  it('rejects a code that was already used (replay protection)', () => {
    const secret = generateTotpSecret();
    const now = currentStep();
    assert.equal(verifyTotp(secret, totpAt(secret, now), { lastUsedStep: now }), null);
  });

  it('rejects codes from far in the past or future', () => {
    const secret = generateTotpSecret();
    assert.equal(verifyTotp(secret, totpAt(secret, currentStep() - 10)), null);
    assert.equal(verifyTotp(secret, totpAt(secret, currentStep() + 10)), null);
  });

  it('rejects non-numeric / wrong length codes', () => {
    const secret = generateTotpSecret();
    for (const bad of ['12345', '1234567', 'abcdef', '']) assert.equal(verifyTotp(secret, bad), null);
  });
});

describe('Audit metadata sanitising', () => {
  it('drops secrets and keeps safe values', () => {
    const out = sanitizeMetadata({
      reason: 'late payment',
      password: 'x',
      apiKey: 'y',
      refreshToken: 'z',
      count: 3,
      nested: { ok: true, apiToken: 'leak' },
    });
    assert.deepEqual(out, { reason: 'late payment', count: 3, nested: { ok: true } }, 'secret keys are dropped inside nested objects too');
  });

  it('keeps edit history (old → new) and names-only keys; depth is limited', () => {
    const out = sanitizeMetadata({
      changes: { amountMinor: { from: '5000000', to: '5500000' }, passwordHash: { from: 'a', to: 'b' } },
      secretsChanged: ['apiKey'],
      hashtags: ['needawebsite'],
      planCode: 'pro',
      deep: { a: { b: { c: 'too deep' } } },
    });
    assert.deepEqual(out.changes, { amountMinor: { from: '5000000', to: '5500000' } });
    assert.deepEqual(out.secretsChanged, ['apiKey'], 'field NAMES, not values');
    assert.deepEqual(out.hashtags, ['needawebsite']);
    assert.equal(out.planCode, 'pro');
    assert.deepEqual(out.deep, { a: {} }, 'max 2 levels');
  });
});
