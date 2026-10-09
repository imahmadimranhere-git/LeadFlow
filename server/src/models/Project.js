// A project (usually after a deal is won). Milestones are small and live inside the project.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import softDeletePlugin from './plugins/softDelete.js';
import { CURRENCIES, PROJECT_STATUSES } from '../config/erpOptions.js';

const milestoneSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 120, required: true },
    dueDate: { type: Date, default: null },
    status: { type: String, enum: ['OPEN', 'DONE'], default: 'OPEN' },
    completedAt: { type: Date, default: null },
  },
  { _id: true }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 150, required: true },
    description: { type: String, trim: true, maxlength: 3000, default: '' },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },
    quoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quote', default: null },
    status: { type: String, enum: PROJECT_STATUSES, default: 'ACTIVE' },
    startDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    managerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] }, // can see it, add tasks, log time
    milestones: { type: [milestoneSchema], default: [] },
    currency: { type: String, enum: CURRENCIES, required: true },
    billable: { type: Boolean, default: true },
    hourlyRateMinor: { type: Number, min: 0, default: 0, validate: Number.isInteger }, // time is billed at this rate
    budgetMinutes: { type: Number, min: 0, default: null }, // planned hours × 60
    budgetMinor: { type: Number, min: 0, default: null }, // e.g. the accepted quote total
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    invoicingAt: { type: Date, default: null, private: true }, // lock while unbilled time is being put on an invoice
  },
  { timestamps: true, strict: 'throw', optimisticConcurrency: true }
);

projectSchema.plugin(tenantScopePlugin);
projectSchema.plugin(softDeletePlugin);
projectSchema.index({ tenantId: 1, status: 1, updatedAt: -1 });
projectSchema.index({ tenantId: 1, members: 1 });
projectSchema.index({ tenantId: 1, clientId: 1 });
projectSchema.index({ tenantId: 1, quoteId: 1 }, { unique: true, partialFilterExpression: { quoteId: { $type: 'objectId' }, deletedAt: null } });

const Project = mongoose.models.Project || mongoose.model('Project', projectSchema);
export default Project;
