// One row per AI request (spec A19). Metadata only — never prompts, lead text or keys.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { AI_PROVIDERS, AI_REQUEST_TYPES, AI_USAGE_STATUSES } from '../config/aiOptions.js';

const aiUsageLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    provider: { type: String, enum: AI_PROVIDERS, required: true },
    model: { type: String, maxlength: 82, required: true },
    requestType: { type: String, enum: AI_REQUEST_TYPES, required: true },
    keySource: { type: String, enum: ['TENANT', 'PLATFORM'], required: true },
    inputTokens: { type: Number, min: 0, default: 0 },
    outputTokens: { type: Number, min: 0, default: 0 },
    totalTokens: { type: Number, min: 0, default: 0 },
    estimatedCostUsd: { type: Number, min: 0, default: 0 },
    status: { type: String, enum: AI_USAGE_STATUSES, required: true },
    errorCode: { type: String, maxlength: 40, default: null },
    attempts: { type: Number, min: 1, default: 1 },
    durationMs: { type: Number, min: 0, default: 0 },
    targetType: { type: String, maxlength: 30, default: null },
    targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: 'throw' }
);

aiUsageLogSchema.plugin(tenantScopePlugin);
aiUsageLogSchema.index({ tenantId: 1, createdAt: -1 });
aiUsageLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 }); // ~13 months

const AiUsageLog = mongoose.models.AiUsageLog || mongoose.model('AiUsageLog', aiUsageLogSchema);
export default AiUsageLog;
