// Guard for /api/v1/super-admin/*. Completely separate from tenant authentication.
// After checking, the request runs in an explicit, logged "system" context
// (super admins legitimately see data across all tenants).
import mongoose from '../config/mongoose.js';
import PlatformAdmin from '../models/PlatformAdmin.js';
import ApiError from '../utils/ApiError.js';
import { verifyAdminAccessToken } from '../services/superAdmin/adminAuthService.js';
import { runAsSystem } from '../utils/tenantContext.js';

export default async function superAdminAuth(req, _res, next) {
  try {
    const header = req.get('Authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token || token.length > 2000) throw ApiError.unauthorized();

    let payload;
    try {
      payload = verifyAdminAccessToken(token);
    } catch {
      throw ApiError.unauthorized('Invalid or expired token');
    }
    if (!mongoose.isValidObjectId(payload.sub)) throw ApiError.unauthorized();

    const admin = await PlatformAdmin.findById(payload.sub);
    if (!admin || admin.status !== 'ACTIVE' || !admin.mfaEnabled || admin.tokenVersion !== payload.tv) {
      throw ApiError.unauthorized('Invalid or expired token');
    }

    req.admin = Object.freeze({ adminId: String(admin._id), email: admin.email, name: admin.name });
    runAsSystem(`super-admin:${admin._id}`, () => next());
  } catch (err) {
    next(err);
  }
}
