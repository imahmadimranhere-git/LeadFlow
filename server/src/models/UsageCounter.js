// Monthly usage per tenant (leads created, AI requests, exports...). One document per metric per month.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

export const MONTHLY_METRICS = {
  leads: 'leadsPerMonth',
  discoverySearches: 'discoverySearchesPerMonth',
  aiRequests: 'aiRequestsPerMonth',
  aiTokens: 'aiTokensPerMonth',
  exports: 'exportsPerMonth',
};

const usageCounterSchema = new mongoose.Schema(
  {
    metric: { type: String, enum: Object.keys(MONTHLY_METRICS), required: true },
    period: { type: String, required: true, match: /^\d{4}-\d{2}$/ }, // "2026-10"
    count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

usageCounterSchema.plugin(tenantScopePlugin);
usageCounterSchema.index({ tenantId: 1, metric: 1, period: 1 }, { unique: true });

const UsageCounter = mongoose.models.UsageCounter || mongoose.model('UsageCounter', usageCounterSchema);
export default UsageCounter;
