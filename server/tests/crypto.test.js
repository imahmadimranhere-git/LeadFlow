// PHASE 4 — ENCRYPTION, MFA CODE (TOTP) & AUDIT SANITISING UNIT TESTS (no database needed)
import './helpers/setupEnv.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, maskSecret } from '../src/utils/crypto.js';
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
      nested: { evil: true },
    });
    assert.deepEqual(out, { reason: 'late payment', count: 3 });
  });
});
