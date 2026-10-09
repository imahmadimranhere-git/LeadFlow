// "Score many leads" runs in the background (database queue, like discovery runs).
// One active batch per company (unique index) → no double spending.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

export const BATCH_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED'];
export const BATCH_MAX = 200;

const aiBatchJobSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['LEAD_SCORE'], default: 'LEAD_SCORE' },
    status: { type: String, enum: BATCH_STATUSES, default: 'QUEUED' },
    activeLock: { type: Boolean, default: true }, // true while QUEUED/RUNNING (unique per tenant)
    leadIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    force: { type: Boolean, default: false },
    stats: {
      total: { type: Number, default: 0 },
      processed: { type: Number, default: 0 },
      succeeded: { type: Number, default: 0 },
      cached: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
    note: { type: String, maxlength: 200, default: null },
    lockedUntil: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, strict: 'throw' }
);

aiBatchJobSchema.plugin(tenantScopePlugin);
aiBatchJobSchema.index({ tenantId: 1, activeLock: 1 }, { unique: true, partialFilterExpression: { activeLock: true } });
aiBatchJobSchema.index({ status: 1, createdAt: 1 });
aiBatchJobSchema.index({ tenantId: 1, createdAt: -1 });

const AiBatchJob = mongoose.models.AiBatchJob || mongoose.model('AiBatchJob', aiBatchJobSchema);
export default AiBatchJob;
