// One-time "state" value for an OAuth login (Login with Facebook...). It proves that the callback
// belongs to a login WE started for THIS user in THIS company (stops CSRF / login-swapping attacks).
// Single use, expires after 10 minutes.
import mongoose from '../config/mongoose.js';

const oauthStateSchema = new mongoose.Schema(
  {
    stateHash: { type: String, required: true },
    provider: { type: String, required: true, maxlength: 40 },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

oauthStateSchema.index({ stateHash: 1 }, { unique: true });
oauthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 }); // cleaned up an hour after expiry

const OAuthState = mongoose.models.OAuthState || mongoose.model('OAuthState', oauthStateSchema);
export default OAuthState;
