// PHASE 27 — account security (spec 23.6):
//   forgot / reset password   single-use, hashed, 30-minute link; same answer whether the email exists or not;
//                             a reset logs out every device; max 3 links per hour per account
//   email verification        single-use, hashed, 24-hour link (not blocking — a banner reminds people)
//   active sessions           see every logged-in device, log one out
//   two-step login (MFA)      optional TOTP for every user + 10 one-time recovery codes
import env from '../../config/env.js';
import User from '../../models/User.js';
import Tenant from '../../models/Tenant.js';
import AuthToken from '../../models/AuthToken.js';
import RefreshToken from '../../models/RefreshToken.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { encrypt, decrypt } from '../../utils/crypto.js';
import { runAsSystem } from '../../utils/tenantContext.js';
import { logSecurityEvent } from '../../utils/securityLogger.js';
import { recordAudit } from '../audit/auditService.js';
import { sendPlatformEmail } from '../email/platformMailer.js';
import { escapeHtml } from '../outreach/emailBuilder.js';
import { hashPassword, verifyPassword } from './passwordService.js';
import { generateOpaqueToken, hashToken, revokeAllForUser } from './tokenService.js';
import { generateTotpSecret, verifyTotp, otpauthUrl } from '../superAdmin/totp.js';
import { generateRecoveryCodes, normalizeRecoveryCode, hashSecret, maskIp, describeUserAgent, atLeast } from './authCodes.js';

export const RESET_TTL_MINUTES = 30;
export const VERIFY_TTL_HOURS = 24;
export const MAX_LINKS_PER_HOUR = 3;
const MIN_FORGOT_MS = env.NODE_ENV === 'test' ? 0 : 350;
const INVALID_LINK = 'This link is invalid or has expired. Please ask for a new one.';
const appUrl = () => env.CORS_ORIGINS[0].replace(/\/$/, '');

const mailHtml = (title, lines, link, button) =>
  `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:520px"><h2 style="font-size:18px">${escapeHtml(title)}</h2>${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}${link ? `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(button)}</a></p><p style="color:#777;font-size:12px">Or copy this link: ${escapeHtml(link)}</p>` : ''}</div>`;

/** Creates a one-time link token (old unused ones of the same kind stop working). null = too many recently. */
async function issueToken(user, purpose, ttlMs, ip) {
  const since = new Date(Date.now() - 3600_000);
  const recent = await AuthToken.countDocuments({ userId: user._id, purpose, createdAt: { $gte: since } });
  if (recent >= MAX_LINKS_PER_HOUR) return null;
  await AuthToken.updateMany({ userId: user._id, purpose, usedAt: null }, { $set: { usedAt: new Date() } });
  const raw = generateOpaqueToken();
  await AuthToken.create({ userId: user._id, tenantId: user.tenantId, purpose, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + ttlMs), requestedIp: ip || null });
  return raw;
}

/** Atomically uses a link token. → the token record, or throws 400. */
async function consumeToken(raw, purpose) {
  if (typeof raw !== 'string' || raw.length < 20 || raw.length > 200) throw ApiError.badRequest(INVALID_LINK);
  const rec = await AuthToken.findOneAndUpdate(
    { tokenHash: hashToken(raw), purpose, usedAt: null, expiresAt: { $gt: new Date() } },
    { $set: { usedAt: new Date() } },
    { new: true }
  );
  if (!rec) throw ApiError.badRequest(INVALID_LINK);
  return rec;
}

// ---------------------------------------------------------------- forgot / reset password

async function forgotWork(email, meta) {
  const user = await runAsSystem('auth:forgot', () => User.findOne({ email }).select('_id tenantId name email status'));
  if (!user || user.status !== 'ACTIVE') {
    logSecurityEvent('password_reset_requested', { found: false, ip: meta.ip });
    return null;
  }
  const tenant = await Tenant.findById(user.tenantId).select('status');
  if (!tenant || ['CANCELLED'].includes(tenant.status)) return null;
  const raw = await runAsSystem('auth:forgot:token', () => issueToken(user, 'PASSWORD_RESET', RESET_TTL_MINUTES * 60_000, meta.ip));
  logSecurityEvent('password_reset_requested', { found: true, userId: String(user._id), throttled: !raw, ip: meta.ip });
  if (!raw) return null;
  const link = `${appUrl()}/reset-password?token=${raw}`;
  return { user, link };
}

/** Always the same answer (no "this email is not registered" — that would help attackers). */
export async function forgotPassword({ email }, meta = {}) {
  const found = await atLeast(MIN_FORGOT_MS, forgotWork(email, meta));
  if (found) {
    // not awaited: a slow mail server must not make "account exists" answers slower than "doesn't exist"
    void sendPlatformEmail({
      to: found.user.email,
      subject: 'Reset your LeadFlow password',
      text: `Hi ${found.user.name},\n\nSomeone (hopefully you) asked to reset your LeadFlow password. This link works once, for ${RESET_TTL_MINUTES} minutes:\n${found.link}\n\nIf it wasn't you, ignore this email — your password stays the same.`,
      html: mailHtml('Reset your password', [`Hi ${found.user.name},`, `Someone (hopefully you) asked to reset your LeadFlow password. The button works once, for ${RESET_TTL_MINUTES} minutes.`, "If it wasn't you, ignore this email — your password stays the same."], found.link, 'Choose a new password'),
      devLink: found.link,
    });
  }
  return { message: 'If an account exists for this email, we have sent a link to reset the password. Check your inbox (and spam).' };
}

export async function resetPassword({ token, newPassword }, meta = {}) {
  return runAsSystem('auth:reset', async () => {
    const rec = await consumeToken(token, 'PASSWORD_RESET');
    const user = await User.findOne({ _id: rec.userId, tenantId: rec.tenantId }).select('+passwordHash');
    if (!user || user.status !== 'ACTIVE') throw ApiError.badRequest(INVALID_LINK);
    const passwordHash = await hashPassword(newPassword);
    await User.updateOne(
      { _id: user._id, tenantId: user.tenantId },
      { $set: { passwordHash, passwordChangedAt: new Date(), failedLoginCount: 0, lockUntil: null, emailVerified: true }, $inc: { tokenVersion: 1 } }
    );
    await revokeAllForUser(user._id, 'PASSWORD_CHANGED'); // every device must log in again
    await AuthToken.updateMany({ userId: user._id, purpose: 'PASSWORD_RESET', usedAt: null }, { $set: { usedAt: new Date() } });
    logSecurityEvent('password_reset_completed', { userId: String(user._id), ip: meta.ip });
    await recordAudit({ actorType: 'USER', actorId: user._id, tenantId: user.tenantId, action: 'auth.password_reset', targetType: 'User', targetId: user._id, ip: meta.ip });
    void sendPlatformEmail({
      to: user.email,
      subject: 'Your LeadFlow password was changed',
      text: `Hi ${user.name},\n\nYour LeadFlow password was just changed and all devices were logged out. If this wasn't you, reset your password again immediately and tell your company owner.`,
      html: mailHtml('Your password was changed', [`Hi ${user.name},`, 'Your LeadFlow password was just changed and all devices were logged out.', "If this wasn't you, reset your password again immediately and tell your company owner."]),
    });
    return { reset: true, mfaStillRequired: Boolean(user.mfaEnabled) };
  });
}

// ---------------------------------------------------------------- email verification

/** Sends a verification link (24 h). Used after sign-up and by "Resend". → { sent } */
export async function issueEmailVerification(userLike, meta = {}) {
  try {
    const raw = await runAsSystem('auth:verify:issue', () => issueToken(userLike, 'EMAIL_VERIFY', VERIFY_TTL_HOURS * 3600_000, meta.ip));
    if (!raw) return { sent: false, reason: 'TOO_MANY' };
    const link = `${appUrl()}/verify-email?token=${raw}`;
    const r = await sendPlatformEmail({
      to: userLike.email,
      subject: 'Confirm your email for LeadFlow',
      text: `Hi ${userLike.name},\n\nPlease confirm this is your email address (link valid ${VERIFY_TTL_HOURS} hours):\n${link}`,
      html: mailHtml('Confirm your email', [`Hi ${userLike.name},`, `Please confirm this is your email address. The link is valid for ${VERIFY_TTL_HOURS} hours.`], link, 'Confirm email'),
      devLink: link,
    });
    return { sent: r.sent, reason: r.sent ? null : 'EMAIL_NOT_CONFIGURED' };
  } catch (err) {
    logger.warn({ err: err.message }, 'verification email failed');
    return { sent: false, reason: 'ERROR' };
  }
}

export async function resendVerification(auth, meta = {}) {
  const user = await User.findById(auth.userId).select('name email emailVerified tenantId');
  if (user.emailVerified) return { alreadyVerified: true, sent: false };
  return issueEmailVerification(user, meta);
}

export async function verifyEmail({ token }, meta = {}) {
  return runAsSystem('auth:verify', async () => {
    const rec = await consumeToken(token, 'EMAIL_VERIFY');
    await User.updateOne({ _id: rec.userId, tenantId: rec.tenantId }, { $set: { emailVerified: true } });
    logSecurityEvent('email_verified', { userId: String(rec.userId), ip: meta.ip });
    return { verified: true };
  });
}

// ---------------------------------------------------------------- sessions (logged-in devices)

export async function listSessions(auth, rawCookie) {
  const now = new Date();
  const active = await RefreshToken.find({ userId: auth.userId, revokedAt: null, expiresAt: { $gt: now } }).select('familyId userAgent createdAt expiresAt createdByIp').sort({ createdAt: -1 }).limit(50).lean();
  const families = [...new Set(active.map((t) => t.familyId))];
  const starts = await RefreshToken.aggregate([{ $match: { familyId: { $in: families } } }, { $group: { _id: '$familyId', startedAt: { $min: '$createdAt' } } }]);
  const current = rawCookie ? (await RefreshToken.findOne({ tokenHash: hashToken(rawCookie) }).select('familyId').lean())?.familyId : null;
  const seen = new Set();
  return active
    .filter((t) => !seen.has(t.familyId) && seen.add(t.familyId))
    .map((t) => ({
      id: t.familyId,
      device: describeUserAgent(t.userAgent),
      ip: maskIp(t.createdByIp),
      startedAt: starts.find((s) => s._id === t.familyId)?.startedAt || t.createdAt,
      lastActiveAt: t.createdAt,
      expiresAt: t.expiresAt,
      current: t.familyId === current,
    }));
}

/** Logs one device out. Its access token (max 15 min) still works until it expires — said honestly in the UI. */
export async function revokeSession(auth, familyId, meta = {}) {
  const r = await RefreshToken.updateMany({ userId: auth.userId, familyId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: 'LOGOUT' } });
  if (!r.modifiedCount) throw ApiError.notFound('Session not found');
  logSecurityEvent('session_revoked', { userId: auth.userId, ip: meta.ip });
  return { revoked: true };
}

// ---------------------------------------------------------------- two-step login (TOTP)

async function reauth(userId, password) {
  const user = await User.findById(userId).select('+passwordHash +mfaSecretEnc +mfaPendingSecretEnc +mfaRecoveryHashes');
  if (!user || !password || !(await verifyPassword(password, user.passwordHash))) {
    throw new ApiError(403, 'Please confirm your password.', [{ code: 'REAUTH_REQUIRED', field: 'password', message: 'password' }]);
  }
  return user;
}

/**
 * Checks a 6-digit code OR a recovery code and USES it (atomic: the same code can't work twice,
 * not even in two parallel requests). → 'TOTP' | 'RECOVERY' | null
 */
export async function useSecondFactor(user, { code, recoveryCode }) {
  if (code && user.mfaSecretEnc) {
    const step = verifyTotp(decrypt(user.mfaSecretEnc), code, { lastUsedStep: user.lastTotpStep ?? -1 });
    if (step === null) return null;
    const r = await User.updateOne({ _id: user._id, lastTotpStep: { $lt: step } }, { $set: { lastTotpStep: step } });
    return r.modifiedCount ? 'TOTP' : null;
  }
  const norm = normalizeRecoveryCode(recoveryCode);
  if (norm) {
    const hash = hashSecret(norm);
    const r = await User.updateOne({ _id: user._id, mfaRecoveryHashes: hash }, { $pull: { mfaRecoveryHashes: hash } });
    return r.modifiedCount ? 'RECOVERY' : null;
  }
  return null;
}

const audit = (auth, action, meta, metadata) => recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action, targetType: 'User', targetId: auth.userId, ip: meta.ip, metadata });

/** Step 1: password again → a new secret to put in the authenticator app (not active yet). */
export async function mfaSetup(auth, { password }) {
  const user = await reauth(auth.userId, password);
  if (user.mfaEnabled) throw ApiError.conflict('Two-step login is already on.');
  const secret = generateTotpSecret();
  await User.updateOne({ _id: user._id }, { $set: { mfaPendingSecretEnc: encrypt(secret) } });
  return { secret, otpauthUrl: otpauthUrl({ secret, accountName: user.email, issuer: 'LeadFlow' }) };
}

/** Step 2: the first code from the app proves it's set up → on + 10 recovery codes (shown once). */
export async function mfaEnable(auth, { code }, meta = {}) {
  const user = await User.findById(auth.userId).select('+mfaPendingSecretEnc');
  if (user.mfaEnabled) throw ApiError.conflict('Two-step login is already on.');
  if (!user.mfaPendingSecretEnc?.ciphertext) throw ApiError.badRequest('Start the set-up again.');
  const step = verifyTotp(decrypt(user.mfaPendingSecretEnc), code, { lastUsedStep: user.lastTotpStep ?? -1 });
  if (step === null) throw ApiError.badRequest('Validation failed', [{ field: 'code', message: 'Wrong code — check the time on your phone and try the newest code.' }]);
  const codes = generateRecoveryCodes();
  const r = await User.updateOne(
    { _id: user._id, mfaEnabled: false },
    { $set: { mfaEnabled: true, mfaEnabledAt: new Date(), mfaSecretEnc: user.mfaPendingSecretEnc, mfaPendingSecretEnc: null, mfaRecoveryHashes: codes.map((c) => hashSecret(normalizeRecoveryCode(c))), lastTotpStep: step } }
  );
  if (!r.modifiedCount) throw ApiError.conflict('Two-step login is already on.');
  logSecurityEvent('mfa_enabled', { userId: auth.userId, ip: meta.ip });
  await audit(auth, 'auth.mfa_enabled', meta);
  return { enabled: true, recoveryCodes: codes };
}

export async function mfaDisable(auth, { password, code, recoveryCode }, meta = {}) {
  const user = await reauth(auth.userId, password);
  if (!user.mfaEnabled) return { enabled: false };
  if (!(await useSecondFactor(user, { code, recoveryCode }))) throw ApiError.badRequest('Validation failed', [{ field: 'code', message: 'Wrong code' }]);
  await User.updateOne({ _id: user._id }, { $set: { mfaEnabled: false, mfaEnabledAt: null, mfaSecretEnc: null, mfaPendingSecretEnc: null }, $unset: { mfaRecoveryHashes: 1 } });
  logSecurityEvent('mfa_disabled', { userId: auth.userId, ip: meta.ip });
  await audit(auth, 'auth.mfa_disabled', meta);
  return { enabled: false };
}

export async function regenerateRecoveryCodes(auth, { password, code }, meta = {}) {
  const user = await reauth(auth.userId, password);
  if (!user.mfaEnabled) throw ApiError.badRequest('Two-step login is not on.');
  if ((await useSecondFactor(user, { code })) !== 'TOTP') throw ApiError.badRequest('Validation failed', [{ field: 'code', message: 'Wrong code' }]);
  const codes = generateRecoveryCodes();
  await User.updateOne({ _id: user._id }, { $set: { mfaRecoveryHashes: codes.map((c) => hashSecret(normalizeRecoveryCode(c))) } });
  await audit(auth, 'auth.mfa_recovery_codes_regenerated', meta);
  return { recoveryCodes: codes };
}

export async function securityStatus(auth) {
  const user = await User.findById(auth.userId).select('+mfaRecoveryHashes');
  return {
    emailVerified: Boolean(user.emailVerified),
    mfaEnabled: Boolean(user.mfaEnabled),
    mfaEnabledAt: user.mfaEnabledAt,
    recoveryCodesLeft: user.mfaEnabled ? (user.mfaRecoveryHashes || []).length : null,
  };
}
