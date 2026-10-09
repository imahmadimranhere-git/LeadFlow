// A website audit of a lead's PUBLIC homepage. Only extracted facts are stored — never the page itself.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

const checkSchema = new mongoose.Schema(
  {
    id: { type: String, maxlength: 40 },
    category: { type: String, maxlength: 20 },
    weight: Number,
    status: { type: String, enum: ['PASS', 'WARN', 'FAIL', 'NOT_CHECKED'] },
    title: { type: String, maxlength: 80 },
    detail: { type: String, maxlength: 300 },
    evidence: { type: String, maxlength: 300, default: null },
  },
  { _id: false }
);

const websiteAuditSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    url: { type: String, maxlength: 2048, required: true },
    finalUrl: { type: String, maxlength: 2048, default: null },
    status: { type: String, enum: ['RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED_BY_ROBOTS'], default: 'RUNNING' },
    running: { type: Boolean, default: true }, // one audit at a time per lead
    httpStatus: { type: Number, default: null },
    responseMs: { type: Number, default: null },
    score: { type: Number, min: 0, max: 100, default: null },
    looksGood: { type: Boolean, default: null },
    summary: { type: String, maxlength: 300, default: null },
    checks: { type: [checkSchema], default: [] },
    goodPoints: { type: [String], default: [] },
    issues: { type: [{ _id: false, id: String, severity: String, title: String, detail: String, evidence: String }], default: [] },
    recommendations: { type: [String], default: [] },
    potentialServices: { type: [String], default: [] },
    requests: { type: Number, default: 0 },
    error: { type: String, maxlength: 200, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

websiteAuditSchema.plugin(tenantScopePlugin);
websiteAuditSchema.index({ tenantId: 1, leadId: 1, createdAt: -1 });
websiteAuditSchema.index({ tenantId: 1, createdAt: -1 });
websiteAuditSchema.index({ tenantId: 1, leadId: 1 }, { unique: true, partialFilterExpression: { running: true } });

const WebsiteAudit = mongoose.models.WebsiteAudit || mongoose.model('WebsiteAudit', websiteAuditSchema);
export default WebsiteAudit;
