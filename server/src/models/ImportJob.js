// A CSV import in progress: uploaded → previewed → imported. The raw rows contain personal data, so the
// whole job is deleted automatically after 24 hours (TTL index) and the rows are never sent back in full.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';

export const IMPORT_STATUSES = ['UPLOADED', 'PREVIEWED', 'IMPORTING', 'COMPLETED', 'FAILED'];

const importJobSchema = new mongoose.Schema(
  {
    status: { type: String, enum: IMPORT_STATUSES, default: 'UPLOADED' },
    fileName: { type: String, maxlength: 120, default: 'import.csv' },
    headers: { type: [String], default: [] },
    rows: { type: [[String]], default: [], select: false, private: true },
    rowCount: { type: Number, default: 0 },
    mapping: { type: Map, of: String, default: {} },
    options: {
      importPossibleDuplicates: { type: Boolean, default: false },
      assignToMe: { type: Boolean, default: false },
    },
    summary: {
      total: { type: Number, default: 0 },
      valid: { type: Number, default: 0 },
      invalid: { type: Number, default: 0 },
      duplicatesInDb: { type: Number, default: 0 },
      duplicatesInFile: { type: Number, default: 0 },
      possibleDuplicates: { type: Number, default: 0 },
      toImport: { type: Number, default: 0 },
      imported: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    issues: {
      type: [
        new mongoose.Schema(
          {
            row: Number, // 1-based data row number (header = row 0)
            type: { type: String, enum: ['INVALID', 'DUPLICATE_DB', 'DUPLICATE_FILE', 'POSSIBLE_DUPLICATE'] },
            field: { type: String, maxlength: 60 },
            message: { type: String, maxlength: 200 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    completedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
  },
  { timestamps: true, strict: 'throw' }
);

importJobSchema.plugin(tenantScopePlugin);
importJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
importJobSchema.index({ tenantId: 1, createdAt: -1 });

const ImportJob = mongoose.models.ImportJob || mongoose.model('ImportJob', importJobSchema);
export default ImportJob;
