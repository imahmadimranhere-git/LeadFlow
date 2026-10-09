// A message draft for one lead. Always starts as PENDING_REVIEW — nothing is ever sent automatically.
// Only APPROVED messages can be used by the outreach workflow (Phase 17).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { TEMPLATE_CHANNELS } from '../config/settingsOptions.js';
import { MESSAGE_STATUSES, MESSAGE_ORIGINS, SEND_VIA } from '../config/messageOptions.js';

const flagSchema = new mongoose.Schema(
  { code: { type: String, maxlength: 40 }, message: { type: String, maxlength: 300 }, blocking: Boolean },
  { _id: false }
);
const claimSchema = new mongoose.Schema(
  { statement: { type: String, maxlength: 300 }, quote: { type: String, maxlength: 300, default: null }, verified: Boolean },
  { _id: false }
);
const revisionSchema = new mongoose.Schema(
  { subject: String, body: String, origin: String, by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: { type: Date, default: Date.now } },
  { _id: false }
);

const outreachMessageSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true },
    channel: { type: String, enum: TEMPLATE_CHANNELS, required: true },
    subject: { type: String, maxlength: 150, default: '' },
    body: { type: String, maxlength: 3000, default: '' },
    status: { type: String, enum: MESSAGE_STATUSES, default: 'PENDING_REVIEW' },
    openDraft: { type: Boolean, default: true }, // true while GENERATING / PENDING_REVIEW → one open draft per lead + channel
    origin: { type: String, enum: MESSAGE_ORIGINS, required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'MessageTemplate', default: null },
    sensitive: { type: [String], default: [] },
    flags: { type: [flagSchema], default: [] },
    claims: { type: [claimSchema], default: [] },
    editedByHuman: { type: Boolean, default: false },
    revisions: { type: [revisionSchema], default: [] },
    aiModel: { type: String, maxlength: 82, default: null },
    usageLogId: { type: mongoose.Schema.Types.ObjectId, ref: 'AiUsageLog', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    rejectReason: { type: String, maxlength: 300, default: null },
    sensitiveConfirmed: { type: Boolean, default: false },
    // ---- replies (Phase 18)
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    replyIntent: { type: String, maxlength: 30, default: null },
    recommendedNextAction: { type: String, maxlength: 300, default: null },
    // ---- outreach (Phase 17)
    sentVia: { type: String, enum: [...SEND_VIA, null], default: null },
    sentTo: { type: String, maxlength: 254, default: null }, // email address used (snapshot)
    sentAt: { type: Date, default: null },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sendingStartedAt: { type: Date, default: null },
    sendAttempts: { type: Number, default: 0 },
    sendError: { type: String, maxlength: 200, default: null },
    providerMessageId: { type: String, maxlength: 300, default: null, private: true },
    repliedAt: { type: Date, default: null },
    followUpAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    outcomeNote: { type: String, maxlength: 300, default: null },
  },
  { timestamps: true, strict: 'throw' }
);

outreachMessageSchema.plugin(tenantScopePlugin);
outreachMessageSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
outreachMessageSchema.index({ tenantId: 1, leadId: 1, createdAt: -1 });
outreachMessageSchema.index({ tenantId: 1, sentVia: 1, sentAt: -1 });
outreachMessageSchema.index({ status: 1, sendingStartedAt: 1 });
outreachMessageSchema.index({ tenantId: 1, leadId: 1, channel: 1 }, { unique: true, partialFilterExpression: { openDraft: true } });

const OutreachMessage = mongoose.models.OutreachMessage || mongoose.model('OutreachMessage', outreachMessageSchema);
export default OutreachMessage;
