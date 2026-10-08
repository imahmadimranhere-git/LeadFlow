// The company's opt-out list. Leads matching it are flagged doNotContact and outreach (Phase 17)
// must refuse to message them.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { DNC_TYPES } from '../config/leadOptions.js';

const doNotContactSchema = new mongoose.Schema(
  {
    type: { type: String, enum: DNC_TYPES, required: true },
    value: { type: String, required: true, maxlength: 300 }, // normalised
    reason: { type: String, trim: true, maxlength: 300, default: '' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

doNotContactSchema.plugin(tenantScopePlugin);
doNotContactSchema.index({ tenantId: 1, type: 1, value: 1 }, { unique: true });

const DoNotContact = mongoose.models.DoNotContact || mongoose.model('DoNotContact', doNotContactSchema);
export default DoNotContact;
