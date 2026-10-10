// Saved AI results for a lead (Phase 13: facts from evidence; Phase 14 adds scoring).
// Only ONE analysis of a type can run per lead at a time (unique index) → no duplicate AI spend.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

export const ANALYSIS_TYPES = ['EVIDENCE_FACTS', 'LEAD_SCORE'];

const aiAnalysisSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    type: { type: String, enum: ANALYSIS_TYPES, required: true },
    status: { type: String, enum: ['RUNNING', 'COMPLETED', 'FAILED'], default: 'RUNNING' },
    inputHash: { type: String, maxlength: 64, required: true, private: true }, // same evidence + model → reuse result
    result: { type: mongoose.Schema.Types.Mixed, default: null }, // already validated against a strict schema
    droppedClaims: { type: Number, default: 0 }, // AI "facts" removed because their quote is not in the evidence
    provider: { type: String, maxlength: 20, default: null },
    model: { type: String, maxlength: 82, default: null },
    usageLogId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiUsageLog', default: null },
    error: { type: String, maxlength: 200, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

aiAnalysisSchema.plugin(tenantScopePlugin);
aiAnalysisSchema.index({ tenantId: 1, leadId: 1, type: 1, createdAt: -1 });
aiAnalysisSchema.index({ tenantId: 1, leadId: 1, type: 1 }, { unique: true, partialFilterExpression: { status: 'RUNNING' } });

const AiAnalysis = mongoose.models.AiAnalysis || mongoose.model('AiAnalysis', aiAnalysisSchema);
export default AiAnalysis;
