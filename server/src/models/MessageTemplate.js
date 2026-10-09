// Reusable message templates (spec A16). Plain text with {{variables}} only.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import softDeletePlugin from './plugins/softDelete.js';
import { TEMPLATE_CHANNELS } from '../config/settingsOptions.js';

const messageTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    channel: { type: String, enum: TEMPLATE_CHANNELS, required: true },
    subject: { type: String, trim: true, maxlength: 150, default: '' },
    body: { type: String, required: true, maxlength: 3000 },
    service: { type: String, trim: true, maxlength: 80, default: null },
    industry: { type: String, trim: true, maxlength: 80, default: null },
    variables: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    source: { type: String, enum: ['MANUAL', 'STARTER', 'FROM_MESSAGE'], default: 'MANUAL' },
    timesUsed: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

messageTemplateSchema.plugin(tenantScopePlugin);
messageTemplateSchema.plugin(softDeletePlugin);
messageTemplateSchema.index({ tenantId: 1, deletedAt: 1, channel: 1, name: 1 });
messageTemplateSchema.index({ tenantId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: { $type: 'null' } } });

const MessageTemplate = mongoose.models.MessageTemplate || mongoose.model('MessageTemplate', messageTemplateSchema);
export default MessageTemplate;
