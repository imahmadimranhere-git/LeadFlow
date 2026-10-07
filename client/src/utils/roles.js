// UI-only copy of role ranks (to hide buttons). The SERVER is the real security check.
export const ROLE_LABELS = {
  TENANT_OWNER: 'Owner',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  SALES: 'Sales',
  VIEWER: 'Viewer',
};

const RANK = { TENANT_OWNER: 5, ADMIN: 4, MANAGER: 3, SALES: 2, VIEWER: 1 };

export const canSeeTeam = (role) => ['TENANT_OWNER', 'ADMIN', 'MANAGER'].includes(role);
export const canInvite = (role) => ['TENANT_OWNER', 'ADMIN'].includes(role);
export const assignableRoles = (actorRole) =>
  ['ADMIN', 'MANAGER', 'SALES', 'VIEWER'].filter((r) => RANK[actorRole] > RANK[r]);
