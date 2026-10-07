// Team management inside ONE tenant (tenant plugin scopes every query automatically).
import User from '../../models/User.js';
import ApiError from '../../utils/ApiError.js';
import { canAssignRole, canManageUser } from '../../config/permissions.js';
import { buildFilter, buildSort, buildPagination } from '../../utils/queryBuilder.js';
import { revokeAllForUser } from '../auth/tokenService.js';
import { logSecurityEvent } from '../../utils/securityLogger.js';

const SORTABLE = ['name', 'email', 'role', 'createdAt'];

export async function listUsers({ page, limit, role, sort }) {
  const filter = buildFilter({ role }, ['role']);
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    User.find(filter).sort(buildSort(sort, SORTABLE, 'createdAt')).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return { items: items.map((u) => u.toJSON()), total };
}

async function loadManageableUser(actor, targetId) {
  const target = await User.findById(targetId); // other tenant's id → null → 404
  if (!target) throw ApiError.notFound('User not found');
  if (!canManageUser(actor, target)) {
    logSecurityEvent('authz_denied', { action: 'manage_user', actorId: actor.userId, targetId: String(targetId) });
    throw ApiError.forbidden('You cannot change this user');
  }
  return target;
}

export async function updateUserRole(actor, targetId, role) {
  const target = await loadManageableUser(actor, targetId);
  if (!canAssignRole(actor.role, role)) {
    logSecurityEvent('authz_denied', { action: 'assign_role', actorId: actor.userId, role });
    throw ApiError.forbidden('You cannot assign this role');
  }
  const previous = target.role;
  target.role = role;
  await target.save();
  logSecurityEvent('role_changed', { actorId: actor.userId, targetId: String(target._id), from: previous, to: role });
  return target.toJSON();
}

export async function updateUserStatus(actor, targetId, status) {
  const target = await loadManageableUser(actor, targetId);
  target.status = status;
  if (status === 'DISABLED') target.tokenVersion += 1; // kick out immediately
  await target.save();
  if (status === 'DISABLED') await revokeAllForUser(target._id, 'USER_DISABLED');
  logSecurityEvent('user_status_changed', { actorId: actor.userId, targetId: String(target._id), status });
  return target.toJSON();
}
