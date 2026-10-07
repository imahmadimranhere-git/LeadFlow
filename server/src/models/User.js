// User belongs to exactly one tenant (tenant-scoped).
// Exception: email is unique across the WHOLE platform, so login can find the user by email.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { ROLES } from '../config/permissions.js';

export const USER_STATUSES = ['ACTIVE', 'DISABLED'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false, private: true },
    role: { type: String, enum: ROLES, required: true, default: 'VIEWER' },
    status: { type: String, enum: USER_STATUSES, default: 'ACTIVE' },
    emailVerified: { type: Boolean, default: false },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Security internals — never sent to the API (private)
    tokenVersion: { type: Number, default: 0, private: true }, // +1 = all access tokens invalid
    failedLoginCount: { type: Number, default: 0, private: true },
    lockUntil: { type: Date, default: null, private: true },
    passwordChangedAt: { type: Date, default: null, private: true },
    lastLoginIp: { type: String, default: null, private: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw' }
);

userSchema.plugin(tenantScopePlugin);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, role: 1 });
userSchema.index({ tenantId: 1, createdAt: -1 });

const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;
