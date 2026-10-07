// Team invitation (tenant-scoped). Only the HASH of the invite token is stored.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { ASSIGNABLE_ROLES } from '../config/permissions.js';

export const INVITATION_STATUSES = ['PENDING', 'ACCEPTED', 'REVOKED'];

const invitationSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    role: { type: String, enum: ASSIGNABLE_ROLES, required: true },
    tokenHash: { type: String, required: true, private: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: INVITATION_STATUSES, default: 'PENDING' },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    acceptedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

invitationSchema.plugin(tenantScopePlugin);
invitationSchema.index({ tokenHash: 1 }, { unique: true });
invitationSchema.index({ tenantId: 1, email: 1, status: 1 });

const Invitation = mongoose.models.Invitation || mongoose.model('Invitation', invitationSchema);
export default Invitation;
