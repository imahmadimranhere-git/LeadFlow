// The generated file of an export (private — only served through a signed, short-lived link).
// Deleted automatically by MongoDB when it expires (TTL index). Max ~15 MB (one document).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

const exportFileSchema = new mongoose.Schema(
  {
    jobId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExportJob', required: true },
    contentType: { type: String, enum: ['text/csv; charset=utf-8', 'application/pdf'], required: true },
    data: { type: Buffer, required: true, private: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, strict: 'throw' }
);

exportFileSchema.plugin(tenantScopePlugin);
exportFileSchema.index({ tenantId: 1, jobId: 1 }, { unique: true });
exportFileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ExportFile = mongoose.models.ExportFile || mongoose.model('ExportFile', exportFileSchema, 'exportFiles');
export default ExportFile;
