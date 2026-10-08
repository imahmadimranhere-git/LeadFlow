// Timeline of a lead: notes written by people + automatic entries (status changed, assigned, merged...).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { ACTIVITY_TYPES } from '../config/leadOptions.js';

const leadActivitySchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    body: { type: String, trim: true, maxlength: 5000, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

leadActivitySchema.plugin(tenantScopePlugin);
leadActivitySchema.index({ tenantId: 1, leadId: 1, createdAt: -1 });

const LeadActivity = mongoose.models.LeadActivity || mongoose.model('LeadActivity', leadActivitySchema);
export default LeadActivity;
