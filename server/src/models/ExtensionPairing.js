// One-time pairing code for the Chrome extension (shown in the web app, typed into the extension).
// Stored HASHED, valid 5 minutes, works once. No password ever goes into the extension.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

const extensionPairingSchema = new mongoose.Schema(
  {
    codeHash: { type: String, required: true, private: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

extensionPairingSchema.plugin(tenantScopePlugin);
extensionPairingSchema.index({ codeHash: 1 }, { unique: true });
extensionPairingSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
extensionPairingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

const ExtensionPairing = mongoose.models.ExtensionPairing || mongoose.model('ExtensionPairing', extensionPairingSchema);
export default ExtensionPairing;
