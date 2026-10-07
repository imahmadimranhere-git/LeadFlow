// Tenant = one customer business. Platform-level model → NOT tenant-scoped.
// Only auth (register) and super-admin code touch this collection.
import mongoose from '../config/mongoose.js';
import softDeletePlugin from './plugins/softDelete.js';

export const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'];
// Why a tenant is suspended: NON_PAYMENT → the owner may still open Billing to pay; ADMIN → fully blocked
export const SUSPENSION_TYPES = ['NON_PAYMENT', 'ADMIN'];

const tenantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 60,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    status: { type: String, enum: TENANT_STATUSES, default: 'TRIAL', index: true },
    industryPack: { type: String, trim: true, maxlength: 60, default: null },
    trialEndsAt: { type: Date, default: null },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', default: null, index: true },
    statusReason: { type: String, trim: true, maxlength: 500, default: null },
    suspensionType: { type: String, enum: [...SUSPENSION_TYPES, null], default: null },
    statusChangedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw' }
);

tenantSchema.index({ slug: 1 }, { unique: true });
tenantSchema.plugin(softDeletePlugin);

const Tenant = mongoose.models.Tenant || mongoose.model('Tenant', tenantSchema);
export default Tenant;
