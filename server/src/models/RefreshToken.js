// Refresh tokens are stored HASHED (sha256). Even if the DB leaks, the tokens can't be used.
// Platform-level (not tenant-scoped) because refresh happens before we know the tenant.
import mongoose from '../config/mongoose.js';

export const REVOKE_REASONS = ['ROTATED', 'LOGOUT', 'LOGOUT_ALL', 'REUSE_DETECTED', 'PASSWORD_CHANGED', 'USER_DISABLED'];

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
    tokenHash: { type: String, required: true, private: true },
    familyId: { type: String, required: true, index: true }, // all rotations of one login session
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokeReason: { type: String, enum: [...REVOKE_REASONS, null], default: null },
    replacedByHash: { type: String, default: null, private: true },
    createdByIp: { type: String, default: null, private: true },
    userAgent: { type: String, default: null, maxlength: 200 },
  },
  { timestamps: true }
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB auto-deletes expired tokens

const RefreshToken = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);
export default RefreshToken;
