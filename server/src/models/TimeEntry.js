// Time logged by one person. Minutes are whole numbers. A running timer has `running: true` and no minutes yet
// (only ONE running timer per person). Invoiced entries are locked (they are on an invoice).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { TIME_STATUSES } from '../config/erpOptions.js';

const timeEntrySchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    day: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, required: true }, // the work day (company time zone)
    minutes: { type: Number, min: 0, max: 1440, default: 0, validate: Number.isInteger },
    note: { type: String, trim: true, maxlength: 500, default: '' },
    billable: { type: Boolean, default: true },
    rateMinor: { type: Number, min: 0, default: 0 }, // hourly rate when logged (later rate changes don't change it)
    running: { type: Boolean, default: false },
    startedAt: { type: Date, default: null },
    status: { type: String, enum: TIME_STATUSES, default: 'OPEN' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'ClientInvoice', default: null },
    claimKey: { type: String, default: null, private: true },
  },
  { timestamps: true, strict: 'throw' }
);

timeEntrySchema.plugin(tenantScopePlugin);
timeEntrySchema.index({ tenantId: 1, projectId: 1, day: -1 });
timeEntrySchema.index({ tenantId: 1, userId: 1, day: -1 });
timeEntrySchema.index({ tenantId: 1, invoiceId: 1 });
timeEntrySchema.index({ tenantId: 1, userId: 1 }, { unique: true, partialFilterExpression: { running: true } });

const TimeEntry = mongoose.models.TimeEntry || mongoose.model('TimeEntry', timeEntrySchema);
export default TimeEntry;
