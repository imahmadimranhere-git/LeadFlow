// Invite team members. The invite link contains a random token; only its hash is stored.
// Until Phase 19 (email), the link is returned ONCE to the inviter to share manually.
import env from '../../config/env.js';
import User from '../../models/User.js';
import Tenant from '../../models/Tenant.js';
import Invitation from '../../models/Invitation.js';
import ApiError from '../../utils/ApiError.js';
import { canAssignRole } from '../../config/permissions.js';
import { runAsSystem, runWithTenant } from '../../utils/tenantContext.js';
import { generateOpaqueToken, hashToken } from '../auth/tokenService.js';
import { hashPassword } from '../auth/passwordService.js';
import { buildSession, isTenantActive } from '../auth/authService.js';
import { logSecurityEvent } from '../../utils/securityLogger.js';
import { assertCanAddUser } from '../billing/quotaService.js';

const INVITE_TTL_DAYS = 7;

export async function createInvitation(actor, { email, role }) {
  if (!canAssignRole(actor.role, role)) {
    logSecurityEvent('authz_denied', { action: 'invite_role', actorId: actor.userId, role });
    throw ApiError.forbidden('You cannot invite a user with this role');
  }

  const alreadyUser = await runAsSystem('invite:email-check', () => User.exists({ email }));
  if (alreadyUser) throw ApiError.conflict('This email already has an account');

  // Plan limit: active users + pending invites must stay within the plan's user limit.
  // (An invite for the SAME email replaces the old one below, so don't count that one twice.)
  await Invitation.updateMany({ email, status: 'PENDING' }, { $set: { status: 'REVOKED' } });
  await assertCanAddUser(actor.tenantId);

  const raw = generateOpaqueToken();
  const invitation = await Invitation.create({
    email,
    role,
    tokenHash: hashToken(raw),
    invitedBy: actor.userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  logSecurityEvent('invitation_created', { actorId: actor.userId, invitationId: String(invitation._id), role });
  const baseUrl = env.CORS_ORIGINS[0];
  return { invitation: invitation.toJSON(), inviteUrl: `${baseUrl}/accept-invite?token=${raw}` };
}

export async function listInvitations() {
  const items = await Invitation.find({ status: 'PENDING' }).sort({ createdAt: -1 }).limit(100);
  return items.map((i) => i.toJSON());
}

export async function revokeInvitation(actor, id) {
  const inv = await Invitation.findOneAndUpdate(
    { _id: id, status: 'PENDING' },
    { $set: { status: 'REVOKED' } },
    { new: true }
  );
  if (!inv) throw ApiError.notFound('Invitation not found');
  logSecurityEvent('invitation_revoked', { actorId: actor.userId, invitationId: String(id) });
  return inv.toJSON();
}

/** Public endpoint: the token itself proves the invite. Email + role come from the invite, NOT the request. */
export async function acceptInvitation({ token, name, password }, meta) {
  const tokenHash = hashToken(token);

  // Atomically claim the invite → it can be used only once, even with parallel requests
  const inv = await runAsSystem('invite:accept', () =>
    Invitation.findOneAndUpdate(
      { tokenHash, status: 'PENDING', expiresAt: { $gt: new Date() } },
      { $set: { status: 'ACCEPTED', acceptedAt: new Date() } },
      { new: true }
    )
  );
  if (!inv) throw ApiError.badRequest('This invitation is invalid or has expired');

  const tenant = await Tenant.findById(inv.tenantId);
  if (!isTenantActive(tenant)) {
    await runAsSystem('invite:rollback', () => Invitation.updateOne({ _id: inv._id }, { $set: { status: 'PENDING', acceptedAt: null } }));
    throw ApiError.forbidden('This organization is not active');
  }
  // Plan may have been downgraded since the invite was sent → check active users only
  try {
    await runWithTenant({ tenantId: inv.tenantId }, () => assertCanAddUser(inv.tenantId, { countPendingInvites: false }));
  } catch (err) {
    await runAsSystem('invite:rollback', () => Invitation.updateOne({ _id: inv._id }, { $set: { status: 'PENDING', acceptedAt: null } }));
    throw err;
  }

  let user;
  try {
    const passwordHash = await hashPassword(password);
    user = await runWithTenant({ tenantId: inv.tenantId }, async () => {
      const created = await User.create({
        name,
        email: inv.email,
        passwordHash,
        role: inv.role,
        invitedBy: inv.invitedBy,
        emailVerified: true, // they received the link at this email
      });
      await Invitation.updateOne({ _id: inv._id }, { $set: { acceptedUserId: created._id } });
      return created;
    });
  } catch (err) {
    // give the invite back so they can try again
    await runAsSystem('invite:rollback', () =>
      Invitation.updateOne({ _id: inv._id }, { $set: { status: 'PENDING', acceptedAt: null } })
    );
    if (err.code === 11000) throw ApiError.conflict('This email already has an account');
    throw err;
  }

  logSecurityEvent('invitation_accepted', { userId: String(user._id), tenantId: String(inv.tenantId) });
  return buildSession(user, tenant, meta);
}
