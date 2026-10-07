// Puts the logged-in user's tenant into the request context.
// tenantId comes ONLY from req.auth (set by the auth middleware from the verified JWT — Phase 3).
// Never from headers, query, params or body.
import ApiError from '../utils/ApiError.js';
import { runWithTenant } from '../utils/tenantContext.js';

export default function bindTenantContext(req, _res, next) {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) return next(ApiError.unauthorized());
  return runWithTenant({ tenantId, userId: req.auth.userId }, () => next());
}
