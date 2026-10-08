// Business logic for register / login / refresh / logout / password change.
// Controllers stay thin; all rules live here.
import mongoose from '../../config/mongoose.js';
import User from '../../models/User.js';
import Tenant from '../../models/Tenant.js';
import Plan from '../../models/Plan.js';
import { createInitialSubscription } from '../billing/subscriptionService.js';
import TenantSettings from '../../models/TenantSettings.js';
import ApiError from '../../utils/ApiError.js';
import { runAsSystem, runWithTenant } from '../../utils/tenantContext.js';
import { logSecurityEvent } from '../../utils/securityLogger.js';
import { ROLE_PERMISSIONS, hasPermission } from '../../config/permissions.js';
import { hashPassword, verifyPassword, burnTime } from './passwordService.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  ACCESS_TOKEN_TTL_SECONDS,
} from './tokenService.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const TRIAL_DAYS = 14; // fallback when no 'free-trial' plan exists yet
const ACTIVE_TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE']; // PAST_DUE = grace period, still usable
const INVALID_LOGIN = 'Invalid email or password';

export const isTenantActive = (tenant) => Boolean(tenant) && ACTIVE_TENANT_STATUSES.includes(tenant.status);

/**
 * FULL         → normal access
 * BILLING_ONLY → company suspended for non-payment; owners can still open Billing to pay
 * NONE         → no access (suspended by platform admin, cancelled, deleted)
 */
export function tenantAccess(tenant, role) {
  if (isTenantActive(tenant)) return 'FULL';
  if (tenant?.status === 'SUSPENDED' && tenant.suspensionType === 'NON_PAYMENT' && hasPermission(role, 'billing:manage')) {
    return 'BILLING_ONLY';
  }
  return 'NONE';
}

export function accessDeniedError(tenant) {
  if (tenant?.status === 'SUSPENDED' && tenant.suspensionType === 'NON_PAYMENT') {
    return ApiError.forbidden("Your company's subscription is suspended. Please ask the account owner to renew it.");
  }
  return ApiError.forbidden('Your organization account is not active. Please contact support.');
}

function slugify(name) {
  const base = String(name)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'company';
  return `${base}-${new mongoose.Types.ObjectId().toString().slice(-6)}`;
}

function publicTenant(tenant) {
  return {
    id: String(tenant._id),
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    suspensionType: tenant.suspensionType || null,
    trialEndsAt: tenant.trialEndsAt,
  };
}

/** Everything the frontend needs after login/register/refresh. */
export async function buildSession(user, tenant, meta, familyId = null) {
  const refreshToken = familyId === false ? null : await issueRefreshToken(user, { ...meta, familyId });
  return {
    refreshToken, // controller puts this in the HttpOnly cookie — never in the JSON body
    body: {
      user: user.toJSON(),
      tenant: publicTenant(tenant),
      permissions: ROLE_PERMISSIONS[user.role] || [], // UI uses this to hide menus; the server still checks every request
      access: tenantAccess(tenant, user.role),
      accessToken: signAccessToken(user),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    },
  };
}

export async function register({ name, email, password, companyName }, meta) {
  const exists = await runAsSystem('auth:register:email-check', () => User.exists({ email }));
  if (exists) throw ApiError.conflict('An account with this email already exists');

  const trialPlan = await Plan.findOne({ code: 'free-trial', isActive: true });
  const trialDays = trialPlan?.trialDays || TRIAL_DAYS;
  const tenant = await Tenant.create({
    name: companyName,
    slug: slugify(companyName),
    status: 'TRIAL',
    planId: trialPlan?._id ?? null,
    trialEndsAt: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
  });

  let user;
  try {
    const passwordHash = await hashPassword(password);
    // tenantId comes from the tenant we just created — never from the request
    user = await runWithTenant({ tenantId: tenant._id }, async () => {
      const owner = await User.create({ name, email, passwordHash, role: 'TENANT_OWNER' });
      if (trialPlan) await createInitialSubscription(tenant, trialPlan);
      await TenantSettings.create({ tenantId: tenant._id }); // onboarding wizard starts from here
      return owner;
    });
  } catch (err) {
    await Tenant.deleteOne({ _id: tenant._id }); // undo half-finished signup
    if (err.code === 11000) throw ApiError.conflict('An account with this email already exists');
    throw err;
  }

  logSecurityEvent('tenant_registered', { tenantId: String(tenant._id), userId: String(user._id), ip: meta.ip });
  return buildSession(user, tenant, meta);
}

export async function login({ email, password }, meta) {
  const user = await runAsSystem('auth:login', () => User.findOne({ email }).select('+passwordHash'));

  if (!user) {
    await burnTime(password);
    logSecurityEvent('login_failed', { reason: 'unknown_email', ip: meta.ip });
    throw ApiError.unauthorized(INVALID_LOGIN);
  }

  if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
    await burnTime(password);
    logSecurityEvent('login_blocked_locked', { userId: String(user._id), ip: meta.ip });
    throw ApiError.unauthorized(INVALID_LOGIN);
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const updated = await runAsSystem('auth:login:failed', () =>
      User.findOneAndUpdate({ _id: user._id }, { $inc: { failedLoginCount: 1 } }, { new: true })
    );
    if (updated && updated.failedLoginCount >= MAX_FAILED_LOGINS) {
      await runAsSystem('auth:login:lock', () =>
        User.updateOne(
          { _id: user._id },
          { $set: { lockUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000), failedLoginCount: 0 } }
        )
      );
      logSecurityEvent('account_locked', { userId: String(user._id), ip: meta.ip });
    } else {
      logSecurityEvent('login_failed', { reason: 'wrong_password', userId: String(user._id), ip: meta.ip });
    }
    throw ApiError.unauthorized(INVALID_LOGIN);
  }

  if (user.status !== 'ACTIVE') throw ApiError.unauthorized(INVALID_LOGIN);

  const tenant = await Tenant.findById(user.tenantId);
  if (tenantAccess(tenant, user.role) === 'NONE') throw accessDeniedError(tenant);

  await runAsSystem('auth:login:success', () =>
    User.updateOne(
      { _id: user._id },
      { $set: { failedLoginCount: 0, lockUntil: null, lastLoginAt: new Date(), lastLoginIp: meta.ip ?? null } }
    )
  );

  return buildSession(user, tenant, meta);
}

export async function refresh(rawToken, meta) {
  const { record, newRaw } = await rotateRefreshToken(rawToken, meta);

  const [user, tenant] = await runAsSystem('auth:refresh', () =>
    Promise.all([User.findOne({ _id: record.userId, tenantId: record.tenantId }), Tenant.findById(record.tenantId)])
  );
  if (!user || user.status !== 'ACTIVE' || tenantAccess(tenant, user?.role) === 'NONE') {
    await revokeRefreshToken(newRaw, 'USER_DISABLED');
    throw ApiError.unauthorized('Session expired');
  }

  const session = await buildSession(user, tenant, meta, false);
  session.refreshToken = newRaw;
  return session;
}

export async function logout(rawToken) {
  await revokeRefreshToken(rawToken, 'LOGOUT');
}

/** Logs out every device: kills refresh tokens AND makes existing access tokens invalid. */
export async function logoutAll(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } }); // runs in tenant context
  await revokeAllForUser(userId, 'LOGOUT_ALL');
  logSecurityEvent('logout_all', { userId: String(userId) });
}

export async function changePassword(userId, { currentPassword, newPassword }, meta) {
  const user = await User.findById(userId).select('+passwordHash'); // tenant context
  if (!user) throw ApiError.unauthorized();

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    logSecurityEvent('password_change_failed', { userId: String(userId), ip: meta.ip });
    throw ApiError.badRequest('Current password is incorrect');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.tokenVersion += 1; // all old access tokens stop working
  await user.save();
  await revokeAllForUser(user._id, 'PASSWORD_CHANGED'); // all other devices logged out

  logSecurityEvent('password_changed', { userId: String(userId), ip: meta.ip });
  const tenant = await Tenant.findById(user.tenantId);
  return buildSession(user, tenant, meta); // keep THIS device logged in
}

export async function getMe(userId) {
  const user = await User.findById(userId);
  const tenant = await Tenant.findById(user.tenantId);
  return {
    user: user.toJSON(),
    tenant: publicTenant(tenant),
    permissions: ROLE_PERMISSIONS[user.role] || [],
    access: tenantAccess(tenant, user.role),
  };
}
