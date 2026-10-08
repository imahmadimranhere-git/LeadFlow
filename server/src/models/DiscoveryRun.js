// One discovery run = a set of search queries sent to ONE source, processed in the background.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { LEAD_SOURCES } from '../config/leadOptions.js';

export const RUN_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'];

const runQuerySchema = new mongoose.Schema(
  {
    query: { type: String, required: true, maxlength: 300 },
    matchedKeyword: { type: String, maxlength: 120, default: null },
    matchedIntentPhrase: { type: String, maxlength: 120, default: null },
    matchedHashtag: { type: String, maxlength: 60, default: null },
    location: { type: String, maxlength: 60, default: null },
    status: { type: String, enum: ['PENDING', 'DONE', 'FAILED', 'SKIPPED'], default: 'PENDING' },
    resultCount: { type: Number, default: 0 },
    error: { type: String, maxlength: 200, default: null },
  },
  { _id: false }
);

const discoveryRunSchema = new mongoose.Schema(
  {
    source: { type: String, enum: LEAD_SOURCES, required: true },
    status: { type: String, enum: RUN_STATUSES, default: 'QUEUED' },
    queries: { type: [runQuerySchema], default: [] },
    stats: {
      results: { type: Number, default: 0 },
      candidates: { type: Number, default: 0 },
      duplicates: { type: Number, default: 0 },
      filtered: { type: Number, default: 0 },
      highIntent: { type: Number, default: 0 },
    },
    error: { type: String, maxlength: 300, default: null },
    // true while QUEUED/RUNNING (set to false when it ends) → unique index = only ONE active run per company
    activeLock: { type: Boolean, default: true },
    workerId: { type: String, default: null, private: true },
    heartbeatAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

discoveryRunSchema.plugin(tenantScopePlugin);
discoveryRunSchema.index({ tenantId: 1, createdAt: -1 });
discoveryRunSchema.index({ status: 1, createdAt: 1 });
discoveryRunSchema.index({ tenantId: 1, activeLock: 1 }, { unique: true, partialFilterExpression: { activeLock: true } });

const DiscoveryRun = mongoose.models.DiscoveryRun || mongoose.model('DiscoveryRun', discoveryRunSchema);
export default DiscoveryRun;
