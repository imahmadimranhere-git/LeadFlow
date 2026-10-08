// A search result waiting for a human to review it. Only when someone clicks "Import" does it become a Lead.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { LEAD_SOURCES } from '../config/leadOptions.js';

export const CANDIDATE_STATUSES = ['NEW', 'DUPLICATE', 'FILTERED', 'IMPORTED', 'DISMISSED'];

const discoveryCandidateSchema = new mongoose.Schema(
  {
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'DiscoveryRun', required: true },
    source: { type: String, enum: LEAD_SOURCES, required: true },
    title: { type: String, maxlength: 300, required: true },
    url: { type: String, maxlength: 2048, required: true },
    domain: { type: String, maxlength: 255, default: null },
    snippet: { type: String, maxlength: 1000, default: '' },
    searchQuery: { type: String, maxlength: 300, default: null },
    matchedKeyword: { type: String, maxlength: 120, default: null },
    matchedIntentPhrase: { type: String, maxlength: 120, default: null },
    matchedHashtag: { type: String, maxlength: 60, default: null },
    negativeKeyword: { type: String, maxlength: 120, default: null },
    intentLevel: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW', 'NONE'], default: 'NONE' },
    matchedService: { type: String, maxlength: 80, default: null },
    isPlatformPage: { type: Boolean, default: false }, // facebook.com/..., a directory... → not the business's own website
    suspectedInjection: { type: Boolean, default: false },
    status: { type: String, enum: CANDIDATE_STATUSES, default: 'NEW' },
    duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  },
  { timestamps: true, strict: 'throw' }
);

discoveryCandidateSchema.plugin(tenantScopePlugin);
discoveryCandidateSchema.index({ tenantId: 1, runId: 1, url: 1 }, { unique: true });
discoveryCandidateSchema.index({ tenantId: 1, runId: 1, status: 1, intentLevel: 1 });
discoveryCandidateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const DiscoveryCandidate = mongoose.models.DiscoveryCandidate || mongoose.model('DiscoveryCandidate', discoveryCandidateSchema);
export default DiscoveryCandidate;
