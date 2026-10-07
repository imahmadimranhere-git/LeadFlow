// Super admins (the SaaS owner). Completely separate from tenant users:
// separate collection, separate login, separate token audience, MFA mandatory.
import mongoose from '../config/mongoose.js';

const encryptedValue = new mongoose.Schema(
  { ciphertext: String, iv: String, authTag: String, keyVersion: Number },
  { _id: false }
);

const platformAdminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false, private: true },
    status: { type: String, enum: ['ACTIVE', 'DISABLED'], default: 'ACTIVE' },

    mfaEnabled: { type: Boolean, default: false },
    mfaSecretEnc: { type: encryptedValue, default: null, select: false, private: true },
    mfaPendingSecretEnc: { type: encryptedValue, default: null, select: false, private: true },
    lastTotpStep: { type: Number, default: -1, private: true },

    tokenVersion: { type: Number, default: 0, private: true },
    failedLoginCount: { type: Number, default: 0, private: true },
    lockUntil: { type: Date, default: null, private: true },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null, private: true },
  },
  { timestamps: true, strict: 'throw' }
);

platformAdminSchema.index({ email: 1 }, { unique: true });

const PlatformAdmin = mongoose.models.PlatformAdmin || mongoose.model('PlatformAdmin', platformAdminSchema);
export default PlatformAdmin;
