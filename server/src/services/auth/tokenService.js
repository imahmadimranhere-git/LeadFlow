// Access tokens: short-lived JWT (15 min) sent in the Authorization header, kept in browser MEMORY only.
// Refresh tokens: random opaque strings in an HttpOnly cookie, stored hashed, ROTATED on every use,
// with REUSE DETECTION (a stolen old token kills the whole session family).
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import env from '../../config/env.js';
import RefreshToken from '../../models/RefreshToken.js';
import ApiError from '../../utils/ApiError.js';
import { logSecurityEvent } from '../../utils/securityLogger.js';

const ISSUER = 'leadflow-api';
const AUDIENCE = 'leadflow-app';
const CONCURRENT_REFRESH_GRACE_MS = 5000;

export const ACCESS_TOKEN_TTL_SECONDS = env.ACCESS_TOKEN_TTL_MINUTES * 60;

export function signAccessToken(user) {
  return jwt.sign(
    { tid: String(user.tenantId), tv: user.tokenVersion ?? 0 },
    env.JWT_SECRET,
    {
      algorithm: 'HS256',
      subject: String(user._id),
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    }
  );
}

/** Throws if invalid/expired. Algorithm is pinned → "alg: none" and algorithm-swap attacks fail. */
export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
}

export const generateOpaqueToken = () => crypto.randomBytes(48).toString('base64url');
export const hashToken = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex');

export async function issueRefreshToken(user, { familyId = null, ip = null, userAgent = null } = {}) {
  const raw = generateOpaqueToken();
  await RefreshToken.create({
    userId: user._id,
    tenantId: user.tenantId,
    tokenHash: hashToken(raw),
    familyId: familyId || crypto.randomUUID(),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    createdByIp: ip,
    userAgent: userAgent ? String(userAgent).slice(0, 200) : null,
  });
  return raw;
}

/**
 * Validates a refresh token and atomically replaces it with a new one.
 * Returns { record, newRaw }. Caller still checks that the user/tenant are active.
 */
export async function rotateRefreshToken(raw, meta = {}) {
  if (!raw || typeof raw !== 'string' || raw.length > 200) throw ApiError.unauthorized('Session expired');

  const record = await RefreshToken.findOne({ tokenHash: hashToken(raw) });
  if (!record) throw ApiError.unauthorized('Session expired');

  if (record.revokedAt) {
    const concurrent =
      record.revokeReason === 'ROTATED' && Date.now() - record.revokedAt.getTime() < CONCURRENT_REFRESH_GRACE_MS;
    if (!concurrent) {
      // An OLD token was used again → it was probably stolen. Kill the whole session family.
      await RefreshToken.updateMany(
        { familyId: record.familyId, revokedAt: null },
        { $set: { revokedAt: new Date(), revokeReason: 'REUSE_DETECTED' } }
      );
      logSecurityEvent('refresh_token_reuse', {
        userId: String(record.userId),
        tenantId: String(record.tenantId),
        ip: meta.ip,
      });
    }
    throw ApiError.unauthorized('Session expired');
  }

  if (record.expiresAt.getTime() <= Date.now()) throw ApiError.unauthorized('Session expired');

  const newRaw = generateOpaqueToken();
  // Atomic claim: only ONE parallel request can rotate this token
  const claimed = await RefreshToken.findOneAndUpdate(
    { _id: record._id, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: 'ROTATED', replacedByHash: hashToken(newRaw) } },
    { new: true }
  );
  if (!claimed) throw ApiError.unauthorized('Session expired');

  await RefreshToken.create({
    userId: record.userId,
    tenantId: record.tenantId,
    tokenHash: hashToken(newRaw),
    familyId: record.familyId,
    expiresAt: record.expiresAt, // rotation does NOT extend the absolute session lifetime
    createdByIp: meta.ip ?? null,
    userAgent: meta.userAgent ? String(meta.userAgent).slice(0, 200) : null,
  });

  return { record, newRaw };
}

export async function revokeRefreshToken(raw, reason = 'LOGOUT') {
  if (!raw || typeof raw !== 'string' || raw.length > 200) return;
  await RefreshToken.updateOne(
    { tokenHash: hashToken(raw), revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason } }
  );
}

export async function revokeAllForUser(userId, reason) {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokeReason: reason } });
}
