// Checks the access token on every protected request, then binds the tenant context.
// The user is re-loaded from the DB each time, so disabling a user / changing a role works instantly.
//
//   authenticate                  → normal routes (company must be active)
//   authenticateAllowBillingOnly  → billing + "me" routes: also lets the OWNER of a company that is
//                                   suspended for non-payment in, so they can pay and get unblocked.
import mongoose from '../config/mongoose.js';
import User from '../models/User.js';
import Tenant from '../models/Tenant.js';
import ApiError from '../utils/ApiError.js';
import { verifyAccessToken } from '../services/auth/tokenService.js';
import { tenantAccess, accessDeniedError } from '../services/auth/authService.js';
import { runAsSystem, runWithTenant } from '../utils/tenantContext.js';

function makeAuthenticate({ allowBillingOnly }) {
  return async function authenticate(req, _res, next) {
    try {
      const header = req.get('Authorization') || '';
      const [scheme, token] = header.split(' ');
      if (scheme !== 'Bearer' || !token || token.length > 2000) throw ApiError.unauthorized();

      let payload;
      try {
        payload = verifyAccessToken(token);
      } catch {
        throw ApiError.unauthorized('Invalid or expired token');
      }

      const { sub, tid, tv } = payload;
      if (!mongoose.isValidObjectId(sub) || !mongoose.isValidObjectId(tid)) throw ApiError.unauthorized();

      const [user, tenant] = await runAsSystem('auth:authenticate', () =>
        Promise.all([User.findOne({ _id: sub, tenantId: tid }), Tenant.findById(tid)])
      );

      if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== tv) {
        throw ApiError.unauthorized('Invalid or expired token');
      }

      const access = tenantAccess(tenant, user.role);
      if (access === 'NONE') throw accessDeniedError(tenant);
      if (access === 'BILLING_ONLY' && !allowBillingOnly) {
        throw new ApiError(402, 'Your subscription is suspended. Please renew it from the Billing page.', [
          { code: 'SUBSCRIPTION_SUSPENDED', field: '', message: 'billing only' },
        ]);
      }

      // Role comes from the DATABASE, not from the token
      req.auth = Object.freeze({
        userId: String(user._id),
        tenantId: String(user.tenantId),
        role: user.role,
        access,
      });

      runWithTenant({ tenantId: user.tenantId, userId: user._id }, () => next());
    } catch (err) {
      next(err);
    }
  };
}

const authenticate = makeAuthenticate({ allowBillingOnly: false });
export const authenticateAllowBillingOnly = makeAuthenticate({ allowBillingOnly: true });
export default authenticate;
