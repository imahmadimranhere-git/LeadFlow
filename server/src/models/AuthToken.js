// PHASE 27 — one-time links sent by email: password reset (30 min) and email verification (24 h).
// Only the SHA-256 HASH of the token is stored; a token works once (usedAt) and expires (TTL index).
// Platform-level (not tenant-scoped): these links are used BEFORE the person is logged in.
import mongoose from '../config/mongoose.js';

export const AUTH_TOKEN_PURPOSES = ['PASSWORD_RESET', 'EMAIL_VERIFY'];

const authTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    purpose: { type: String, enum: AUTH_TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true, private: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    requestedIp: { type: String, default: null, private: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' }
);

authTokenSchema.index({ tokenHash: 1 }, { unique: true });
authTokenSchema.index({ userId: 1, purpose: 1, createdAt: -1 });
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 3600 }); // deleted one day after expiry

const AuthToken = mongoose.models.AuthToken || mongoose.model('AuthToken', authTokenSchema);
export default AuthToken;
