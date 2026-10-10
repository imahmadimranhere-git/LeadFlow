// One export request (spec A29). Runs in the background; the file lives in ExportFile and expires after 24 h.
// Everything needed for the audit trail is kept: who, type, filters, columns, PII, rows, override reason.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { EXPORT_TYPE_KEYS } from '../services/exports/exportTypes.js';

export const EXPORT_STATUSES = ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED'];

const exportJobSchema = new mongoose.Schema(
  {
    type: { type: String, enum: EXPORT_TYPE_KEYS, required: true },
    format: { type: String, enum: ['CSV', 'PDF'], required: true },
    filters: { type: mongoose.Schema.Types.Mixed, default: {} }, // validated + allow-listed before saving
    columns: { type: [String], default: [] },
    includesPii: { type: Boolean, default: false },
    includeDoNotContact: { type: Boolean, default: false },
    overrideReason: { type: String, maxlength: 300, default: null },
    status: { type: String, enum: EXPORT_STATUSES, default: 'QUEUED' },
    rowCount: { type: Number, default: null },
    truncated: { type: Boolean, default: false },
    replacedChars: { type: Number, default: 0 }, // PDF: characters that could not be shown (non-Latin)
    fileName: { type: String, maxlength: 120, default: null },
    sizeBytes: { type: Number, default: null },
    error: { type: String, maxlength: 300, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    downloads: { type: Number, default: 0 },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ip: { type: String, maxlength: 64, default: null, private: true },
  },
  { timestamps: true, strict: 'throw' }
);

exportJobSchema.plugin(tenantScopePlugin);
exportJobSchema.index({ tenantId: 1, createdAt: -1 });
exportJobSchema.index({ status: 1, createdAt: 1 });

const ExportJob = mongoose.models.ExportJob || mongoose.model('ExportJob', exportJobSchema, 'exportJobs');
export default ExportJob;
