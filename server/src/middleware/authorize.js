// RBAC guards:
//   authorize(A, B)      → user needs ALL listed permissions
//   authorizeAny(A, B)   → user needs AT LEAST ONE of them
import ApiError from '../utils/ApiError.js';
import { hasPermission } from '../config/permissions.js';
import { logSecurityEvent } from '../utils/securityLogger.js';

function guard(check) {
  return (...permissions) =>
    (req, _res, next) => {
      const role = req.auth?.role;
      if (!role) return next(ApiError.unauthorized());
      if (check(permissions, (p) => hasPermission(role, p))) return next();

      logSecurityEvent('authz_denied', {
        userId: req.auth.userId,
        tenantId: req.auth.tenantId,
        role,
        required: permissions,
        path: req.originalUrl,
      });
      return next(ApiError.forbidden());
    };
}

const authorize = guard((perms, has) => perms.every(has));
export const authorizeAny = guard((perms, has) => perms.some(has));
export default authorize;
