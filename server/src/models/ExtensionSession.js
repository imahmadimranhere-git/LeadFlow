// A connected Chrome extension ("Chrome on Ali's laptop").
// Holds the HASH of its current refresh token (rotated on every use) and the previous one
// (if an old token is used again → it was copied/stolen → the whole session is revoked).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

const extensionSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deviceName: { type: String, trim: true, maxlength: 60, default: 'Chrome' },
    tokenHash: { type: String, required: true, private: true },
    previousTokenHash: { type: String, default: null, private: true },
    rotatedAt: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0, private: true }, // user's tokenVersion at pairing (password change → dead)
    userAgent: { type: String, maxlength: 200, default: null },
    lastUsedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, maxlength: 40, default: null },
  },
  { timestamps: true, strict: 'throw' }
);

extensionSessionSchema.plugin(tenantScopePlugin);
extensionSessionSchema.index({ tokenHash: 1 }, { unique: true });
extensionSessionSchema.index({ previousTokenHash: 1 }, { partialFilterExpression: { previousTokenHash: { $type: 'string' } } });
extensionSessionSchema.index({ tenantId: 1, userId: 1, revokedAt: 1 });
// cleaned up 30 days after expiry
extensionSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

const ExtensionSession = mongoose.models.ExtensionSession || mongoose.model('ExtensionSession', extensionSessionSchema);
export default ExtensionSession;
