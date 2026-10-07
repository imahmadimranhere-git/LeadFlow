import { z, email, safeText, idParams, pagination, sortBy } from './common.js';
import { ASSIGNABLE_ROLES, ROLES } from '../config/permissions.js';
import { strongPassword } from './auth.validators.js';

export { idParams };

export const listUsersQuery = z
  .object({
    ...pagination,
    role: z.enum(ROLES).optional(),
    sort: sortBy(['name', 'email', 'role', 'createdAt']),
  })
  .strict();

export const updateRoleBody = z.object({ role: z.enum(ASSIGNABLE_ROLES) }).strict();
export const updateStatusBody = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).strict();

export const createInvitationBody = z.object({ email, role: z.enum(ASSIGNABLE_ROLES) }).strict();

export const acceptInvitationBody = z
  .object({
    token: z.string().min(20).max(200),
    name: safeText(80),
    password: strongPassword,
  })
  .strict();
