// Super admin login: password → MFA (TOTP). MFA is MANDATORY: the first login forces setup.
// Admin tokens use a DIFFERENT signing key and audience than tenant tokens,
// so a tenant token can never open the admin panel (and vice versa).
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import env from '../../config/env.js';
import PlatformAdmin from '../../models/PlatformAdmin.js';
import ApiError from '../../utils/ApiError.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { hashPassword, verifyPassword, burnTime } from '../auth/passwordService.js';
import { generateTotpSecret, verifyTotp, otpauthUrl } from './totp.js';
import { logSecurityEvent } from '../../utils/securityLogger.js';

const ISSUER = 'leadflow-api';
const ADMIN_AUDIENCE = 'leadflow-admin';
const MFA_AUDIENCE = 'leadflow-admin-mfa';
const MFA_TOKEN_TTL_SECONDS = 5 * 60;
const MAX_FAILED = 5;
const LOCK_MINUTES = 30;
const INVALID = 'Invalid credentials';

// Separate key derived from JWT_SECRET → tenant tokens and admin tokens are signed differently
const ADMIN_KEY = crypto.createHmac('sha256', env.JWT_SECRET).update('leadflow:platform-admin-tokens').digest();

export const ADMIN_TOKEN_TTL_SECONDS = env.ADMIN_TOKEN_TTL_MINUTES * 60;

const sign = (admin, audience, expiresIn) =>
  jwt.sign({ tv: admin.tokenVersion ?? 0 }, ADMIN_KEY, {
    algorithm: 'HS256',
    subject: String(admin._id),
    issuer: ISSUER,
    audience,
    expiresIn,
  });

export const verifyAdminAccessToken = (token) =>
  jwt.verify(token, ADMIN_KEY, { algorithms: ['HS256'], issuer: ISSUER, audience: ADMIN_AUDIENCE });

const verifyMfaToken = (token) =>
  jwt.verify(token, ADMIN_KEY, { algorithms: ['HS256'], issuer: ISSUER, audience: MFA_AUDIENCE });

async function registerFailure(admin, meta, reason) {
  const updated = await PlatformAdmin.findOneAndUpdate({ _id: admin._id }, { $inc: { failedLoginCount: 1 } }, { new: true });
  if (updated && updated.failedLoginCount >= MAX_FAILED) {
    await PlatformAdmin.updateOne(
      { _id: admin._id },
      { $set: { lockUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000), failedLoginCount: 0 } }
    );
    logSecurityEvent('admin_account_locked', { actorType: 'PLATFORM_ADMIN', actorId: admin._id, ip: meta.ip });
  } else {
    logSecurityEvent('admin_login_failed', { actorType: 'PLATFORM_ADMIN', actorId: admin._id, reason, ip: meta.ip });
  }
}

const isLocked = (admin) => admin.lockUntil && admin.lockUntil.getTime() > Date.now();

/** Used by the seed script and tests. */
export async function createPlatformAdmin({ name, email, password }) {
  return PlatformAdmin.create({ name, email, passwordHash: await hashPassword(password) });
}

/** Step 1: email + password. Returns which MFA step comes next — never an access token. */
export async function adminLogin({ email, password }, meta) {
  const admin = await PlatformAdmin.findOne({ email }).select('+passwordHash');
  if (!admin) {
    await burnTime(password);
    logSecurityEvent('admin_login_failed', { actorType: 'ANONYMOUS', reason: 'unknown_email', ip: meta.ip });
    throw ApiError.unauthorized(INVALID);
  }
  if (isLocked(admin) || admin.status !== 'ACTIVE') {
    await burnTime(password);
    throw ApiError.unauthorized(INVALID);
  }
  if (!(await verifyPassword(password, admin.passwordHash))) {
    await registerFailure(admin, meta, 'wrong_password');
    throw ApiError.unauthorized(INVALID);
  }

  const mfaToken = sign(admin, MFA_AUDIENCE, MFA_TOKEN_TTL_SECONDS);

  if (admin.mfaEnabled) return { step: 'MFA_REQUIRED', mfaToken };

  // First login: create a pending secret. It becomes active only after a correct code.
  const secret = generateTotpSecret();
  await PlatformAdmin.updateOne({ _id: admin._id }, { $set: { mfaPendingSecretEnc: encrypt(secret) } });
  return {
    step: 'MFA_SETUP',
    mfaToken,
    secret, // shown ONCE so the admin can add it to the authenticator app
    otpauthUrl: otpauthUrl({ secret, accountName: admin.email }),
  };
}

/** Step 2: the 6-digit code. Confirms setup (first time) or verifies, then issues the admin token. */
export async function adminVerifyMfa({ mfaToken, code }, meta) {
  let payload;
  try {
    payload = verifyMfaToken(mfaToken);
  } catch {
    throw ApiError.unauthorized('Login step expired, please start again');
  }

  const admin = await PlatformAdmin.findById(payload.sub).select('+mfaSecretEnc +mfaPendingSecretEnc');
  if (!admin || admin.status !== 'ACTIVE' || admin.tokenVersion !== payload.tv || isLocked(admin)) {
    throw ApiError.unauthorized(INVALID);
  }

  const encSecret = admin.mfaEnabled ? admin.mfaSecretEnc : admin.mfaPendingSecretEnc;
  if (!encSecret?.ciphertext) throw ApiError.unauthorized('Login step expired, please start again');

  const step = verifyTotp(decrypt(encSecret), code, { lastUsedStep: admin.lastTotpStep });
  if (step === null) {
    await registerFailure(admin, meta, 'wrong_mfa_code');
    throw ApiError.unauthorized('Invalid code');
  }

  // Atomic: only succeeds if no other request already used this (or a later) step → no replay
  const update = {
    $set: { lastTotpStep: step, failedLoginCount: 0, lockUntil: null, lastLoginAt: new Date(), lastLoginIp: meta.ip ?? null },
  };
  if (!admin.mfaEnabled) {
    update.$set.mfaEnabled = true;
    update.$set.mfaSecretEnc = admin.mfaPendingSecretEnc;
    update.$set.mfaPendingSecretEnc = null;
  }
  const claimed = await PlatformAdmin.findOneAndUpdate({ _id: admin._id, lastTotpStep: { $lt: step } }, update, { new: true });
  if (!claimed) throw ApiError.unauthorized('Invalid code');

  logSecurityEvent(admin.mfaEnabled ? 'admin_login_success' : 'admin_mfa_enabled', {
    actorType: 'PLATFORM_ADMIN',
    actorId: admin._id,
    ip: meta.ip,
  });

  return {
    admin: claimed.toJSON(),
    accessToken: sign(claimed, ADMIN_AUDIENCE, ADMIN_TOKEN_TTL_SECONDS),
    expiresIn: ADMIN_TOKEN_TTL_SECONDS,
  };
}

export async function adminChangePassword(adminId, { currentPassword, newPassword }, meta) {
  const admin = await PlatformAdmin.findById(adminId).select('+passwordHash');
  if (!admin || !(await verifyPassword(currentPassword, admin.passwordHash))) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  admin.passwordHash = await hashPassword(newPassword);
  admin.tokenVersion += 1; // log out every admin session
  await admin.save();
  logSecurityEvent('admin_password_changed', { actorType: 'PLATFORM_ADMIN', actorId: admin._id, ip: meta.ip });
  return { changed: true };
}
