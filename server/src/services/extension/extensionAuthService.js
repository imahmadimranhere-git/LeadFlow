// Chrome extension login — without ever typing a password into the extension.
//
//  1. Logged-in user (web app) → "Connect extension" → one-time PAIRING CODE (e.g. K7QX-M2PA), 5 minutes.
//  2. User types the code into the extension → it gets:
//       - an ACCESS token: JWT, 15 minutes, audience "leadflow-extension" (useless on the normal API)
//       - a REFRESH token: random, stored HASHED on the server, ROTATED on every use, 30 days
//  3. Old refresh token used again → stolen/copied → whole session revoked.
//  4. Password change / "log out everywhere" / disabled user / revoke in the web app → extension stops.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from '../../config/mongoose.js';
import env from '../../config/env.js';
import User from '../../models/User.js';
import Tenant from '../../models/Tenant.js';
import ExtensionPairing from '../../models/ExtensionPairing.js';
import ExtensionSession from '../../models/ExtensionSession.js';
import ApiError from '../../utils/ApiError.js';
import { runAsSystem, runWithTenant } from '../../utils/tenantContext.js';
import { generateOpaqueToken, hashToken } from '../auth/tokenService.js';
import { tenantAccess, accessDeniedError } from '../auth/authService.js';
import { PERMISSIONS as P, hasPermission } from '../../config/permissions.js';
import { recordAudit } from '../audit/auditService.js';
import { logSecurityEvent } from '../../utils/securityLogger.js';

const ISSUER = 'leadflow-api';
export const EXTENSION_AUDIENCE = 'leadflow-extension';
export const EXT_ACCESS_TTL_SECONDS = 15 * 60;
const SESSION_DAYS = 30;
const PAIRING_MINUTES = 5;
const MAX_SESSIONS_PER_USER = 5;
const REUSE_GRACE_MS = 10_000; // two refreshes at the same moment (two popups) aren't an attack
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I → easy to type

const unauthorized = (msg = 'Please connect the extension again') => ApiError.unauthorized(msg);

export function normalizePairingCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function newPairingCode() {
  const bytes = crypto.randomBytes(8);
  const raw = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join(''); // 256 % 32 = 0 → no bias
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function signExtensionToken(session) {
  return jwt.sign({ tid: String(session.tenantId), sid: String(session._id), tv: session.tokenVersion }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: String(session.userId),
    issuer: ISSUER,
    audience: EXTENSION_AUDIENCE,
    expiresIn: EXT_ACCESS_TTL_SECONDS,
  });
}

export function verifyExtensionToken(token) {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: EXTENSION_AUDIENCE });
}

/** User + company must still be allowed to use the extension (checked at pairing, refresh AND every request). */
async function loadAllowedUser(userId, tenantId, tokenVersion) {
  const [user, tenant] = await runAsSystem('ext:auth', () => Promise.all([User.findOne({ _id: userId, tenantId }), Tenant.findById(tenantId)]));
  if (!user || user.status !== 'ACTIVE' || (tokenVersion !== undefined && (user.tokenVersion ?? 0) !== tokenVersion)) throw unauthorized();
  const access = tenantAccess(tenant, user.role);
  if (access === 'NONE') throw accessDeniedError(tenant);
  if (access !== 'FULL') throw new ApiError(402, 'Your subscription is suspended. Please renew it from the Billing page.', [{ code: 'SUBSCRIPTION_SUSPENDED', field: '', message: 'billing only' }]);
  if (!hasPermission(user.role, P.LEADS_WRITE)) throw ApiError.forbidden('Your role cannot save leads');
  return { user, tenant };
}

// ------------------------------------------------------------------ web app side

export async function createPairingCode(auth) {
  const code = newPairingCode();
  // only the newest code of this user stays valid
  await ExtensionPairing.deleteMany({ userId: auth.userId, usedAt: null });
  const doc = await ExtensionPairing.create({
    codeHash: hashToken(normalizePairingCode(code)),
    userId: auth.userId,
    expiresAt: new Date(Date.now() + PAIRING_MINUTES * 60 * 1000),
  });
  return { code, expiresAt: doc.expiresAt };
}

export async function listSessions(auth) {
  const filter = { revokedAt: null, expiresAt: { $gt: new Date() } };
  if (!hasPermission(auth.role, P.USERS_MANAGE)) filter.userId = auth.userId; // admins see the whole team
  const items = await ExtensionSession.find(filter).sort({ lastUsedAt: -1 }).limit(100).populate('userId', 'name email');
  return items.map((s) => ({ ...s.toJSON(), mine: String(s.userId?._id || s.userId) === auth.userId }));
}

export async function revokeSession(auth, id, reason = 'REVOKED_IN_APP') {
  const filter = { _id: id, revokedAt: null };
  if (!hasPermission(auth.role, P.USERS_MANAGE)) filter.userId = auth.userId;
  const s = await ExtensionSession.findOneAndUpdate(filter, { $set: { revokedAt: new Date(), revokedReason: reason } }, { new: true });
  if (!s) throw ApiError.notFound('Connected browser not found');
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'extension.revoked', targetType: 'ExtensionSession', targetId: s._id, metadata: { userId: String(s.userId) } });
  return { revoked: true };
}

// ------------------------------------------------------------------ extension side (public)

function tokensFor(session, refreshToken) {
  return { accessToken: signExtensionToken(session), expiresIn: EXT_ACCESS_TTL_SECONDS, refreshToken };
}

export async function pairExtension({ code, deviceName }, meta = {}) {
  const normalized = normalizePairingCode(code);
  if (normalized.length !== 8) throw unauthorized('Wrong or expired code');

  const pairing = await runAsSystem('ext:pair', () =>
    ExtensionPairing.findOneAndUpdate(
      { codeHash: hashToken(normalized), usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true }
    )
  );
  if (!pairing) {
    logSecurityEvent('extension_pair_failed', { ip: meta.ip });
    throw unauthorized('Wrong or expired code');
  }

  const { user, tenant } = await loadAllowedUser(pairing.userId, pairing.tenantId);
  const refreshToken = generateOpaqueToken();
  const session = await runAsSystem('ext:pair', async () => {
    // keep at most 5 connected browsers per user: the oldest are signed out
    const active = await ExtensionSession.find({ tenantId: user.tenantId, userId: user._id, revokedAt: null }).sort({ lastUsedAt: -1, _id: -1 }).select('_id');
    const extra = active.slice(MAX_SESSIONS_PER_USER - 1).map((s) => s._id);
    if (extra.length) await ExtensionSession.updateMany({ _id: { $in: extra } }, { $set: { revokedAt: new Date(), revokedReason: 'TOO_MANY_SESSIONS' } });
    return ExtensionSession.create({
      tenantId: user.tenantId,
      userId: user._id,
      deviceName: String(deviceName || 'Chrome').replace(/[^\p{L}\p{N} .,'()_-]/gu, '').slice(0, 60) || 'Chrome',
      tokenHash: hashToken(refreshToken),
      tokenVersion: user.tokenVersion ?? 0,
      userAgent: meta.userAgent || null,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    });
  });
  await recordAudit({ actorType: 'USER', actorId: user._id, tenantId: user.tenantId, action: 'extension.connected', targetType: 'ExtensionSession', targetId: session._id, metadata: { deviceName: session.deviceName } });
  return { ...tokensFor(session, refreshToken), user: { name: user.name, email: user.email }, tenant: { name: tenant.name } };
}

export async function refreshExtensionToken(rawToken, meta = {}) {
  if (typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 200) throw unauthorized();
  const h = hashToken(rawToken);
  const now = new Date();
  const next = generateOpaqueToken();

  const session = await runAsSystem('ext:refresh', () =>
    ExtensionSession.findOneAndUpdate(
      { tokenHash: h, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { tokenHash: hashToken(next), previousTokenHash: h, rotatedAt: now, lastUsedAt: now } },
      { new: true }
    )
  );

  if (!session) {
    // An OLD token? Then someone else has a copy → revoke everything (unless it's a same-second double refresh)
    const reused = await runAsSystem('ext:refresh', () => ExtensionSession.findOne({ previousTokenHash: h, revokedAt: null }));
    if (reused && !(reused.rotatedAt && now - reused.rotatedAt < REUSE_GRACE_MS)) {
      await runAsSystem('ext:refresh', () => ExtensionSession.updateOne({ _id: reused._id }, { $set: { revokedAt: now, revokedReason: 'TOKEN_REUSE' } }));
      logSecurityEvent('extension_token_reuse', { tenantId: String(reused.tenantId), userId: String(reused.userId), ip: meta.ip });
    }
    throw unauthorized();
  }

  await loadAllowedUser(session.userId, session.tenantId, session.tokenVersion);
  return tokensFor(session, next);
}

/** Middleware: only extension tokens, only /extension/* routes. */
export async function authenticateExtension(req, _res, next) {
  try {
    const [scheme, token] = (req.get('Authorization') || '').split(' ');
    if (scheme !== 'Bearer' || !token || token.length > 2000) throw unauthorized();
    let payload;
    try {
      payload = verifyExtensionToken(token);
    } catch {
      throw ApiError.unauthorized('Invalid or expired token');
    }
    const { sub, tid, sid, tv } = payload;
    if (![sub, tid, sid].every((v) => mongoose.isValidObjectId(v))) throw unauthorized();

    const session = await runAsSystem('ext:auth', () => ExtensionSession.findOne({ _id: sid, tenantId: tid, userId: sub }));
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw unauthorized();
    const { user } = await loadAllowedUser(sub, tid, tv);

    if (Date.now() - new Date(session.lastUsedAt).getTime() > 5 * 60 * 1000) {
      await runAsSystem('ext:auth', () => ExtensionSession.updateOne({ _id: session._id }, { $set: { lastUsedAt: new Date() } }));
    }
    req.auth = Object.freeze({ userId: String(user._id), tenantId: String(user.tenantId), role: user.role, access: 'FULL', extensionSessionId: String(session._id) });
    runWithTenant({ tenantId: user.tenantId, userId: user._id }, () => next());
  } catch (err) {
    next(err);
  }
}

export async function logoutExtension(auth) {
  await ExtensionSession.updateOne({ _id: auth.extensionSessionId }, { $set: { revokedAt: new Date(), revokedReason: 'LOGOUT' } });
  return { loggedOut: true };
}
