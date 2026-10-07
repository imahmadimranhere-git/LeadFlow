// Append-only audit trail: who did what, when, to which record.
// Updates and deletes are BLOCKED at the model level (tamper resistance).
import mongoose from '../config/mongoose.js';

export const ACTOR_TYPES = ['PLATFORM_ADMIN', 'USER', 'SYSTEM', 'ANONYMOUS'];

const auditLogSchema = new mongoose.Schema(
  {
    actorType: { type: String, enum: ACTOR_TYPES, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null },
    action: { type: String, required: true, maxlength: 80 },
    targetType: { type: String, default: null, maxlength: 40 },
    targetId: { type: String, default: null, maxlength: 64 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null, maxlength: 64 },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ tenantId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

class AuditImmutableError extends Error {
  constructor() {
    super('Audit logs cannot be modified or deleted');
    this.name = 'AuditImmutableError';
  }
}

const BLOCKED = [
  'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace',
  'deleteOne', 'deleteMany', 'findOneAndDelete',
];
auditLogSchema.pre(BLOCKED, async function () {
  throw new AuditImmutableError();
});
auditLogSchema.pre('save', async function () {
  if (!this.isNew) throw new AuditImmutableError();
});

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
