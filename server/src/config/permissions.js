// RBAC — who can do what. Stored as config (data), not scattered if-statements.
// Higher rank = more power. A user can only manage users with a LOWER rank.

export const ROLES = ['TENANT_OWNER', 'ADMIN', 'MANAGER', 'SALES', 'VIEWER'];
export const ASSIGNABLE_ROLES = ['ADMIN', 'MANAGER', 'SALES', 'VIEWER']; // owner is never assigned/invited

export const ROLE_RANK = Object.freeze({
  TENANT_OWNER: 5,
  ADMIN: 4,
  MANAGER: 3,
  SALES: 2,
  VIEWER: 1,
});

export const PERMISSIONS = Object.freeze({
  TENANT_READ: 'tenant:read',
  TENANT_UPDATE: 'tenant:update',
  USERS_READ: 'users:read',
  USERS_INVITE: 'users:invite',
  USERS_MANAGE: 'users:manage',
  BILLING_MANAGE: 'billing:manage',
  INTEGRATIONS_MANAGE: 'integrations:manage',
  LEADS_READ_ALL: 'leads:read:all',
  LEADS_READ_OWN: 'leads:read:own',
  LEADS_WRITE: 'leads:write',
  LEADS_ASSIGN: 'leads:assign', // give a lead to another team member
  LEADS_DELETE: 'leads:delete', // delete / merge leads, manage the do-not-contact list
  WATCHES_MANAGE: 'watches:manage', // create/edit hashtag watches (they spend the company's quota)
  EXPORT_RUN: 'export:run',
  AUDIT_READ: 'audit:read',
});

const P = PERMISSIONS;
const ALL = Object.values(P);

export const ROLE_PERMISSIONS = Object.freeze({
  TENANT_OWNER: ALL,
  ADMIN: ALL.filter((p) => p !== P.BILLING_MANAGE),
  MANAGER: [P.TENANT_READ, P.USERS_READ, P.LEADS_READ_ALL, P.LEADS_WRITE, P.LEADS_ASSIGN, P.LEADS_DELETE, P.WATCHES_MANAGE, P.EXPORT_RUN],
  SALES: [P.TENANT_READ, P.LEADS_READ_OWN, P.LEADS_WRITE],
  VIEWER: [P.TENANT_READ, P.LEADS_READ_ALL],
});

export function hasPermission(role, permission) {
  return (ROLE_PERMISSIONS[role] || []).includes(permission);
}

/** Actor can give `targetRole` only if it is strictly below their own rank (and never OWNER). */
export function canAssignRole(actorRole, targetRole) {
  return ASSIGNABLE_ROLES.includes(targetRole) && ROLE_RANK[actorRole] > ROLE_RANK[targetRole];
}

/** Actor can manage another user only if that user is strictly below them, and not themselves. */
export function canManageUser(actor, targetUser) {
  if (String(actor.userId) === String(targetUser._id)) return false;
  return ROLE_RANK[actor.role] > ROLE_RANK[targetUser.role];
}
