// One conversation thread per lead + channel (spec A14). WhatsApp threads are also keyed by the
// sender's WhatsApp id, so replies from unknown numbers can be linked to a lead later.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { TEMPLATE_CHANNELS } from '../config/settingsOptions.js';

export const CONVERSATION_STATUSES = ['ACTIVE', 'WAITING', 'FOLLOW_UP', 'CLOSED', 'CONVERTED'];
export const REPLY_INTENTS = ['INTERESTED', 'QUESTION', 'PRICE_REQUEST', 'NEEDS_MORE_INFO', 'NOT_INTERESTED', 'MEETING_REQUEST', 'UNKNOWN'];

const conversationSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null }, // null = unknown WhatsApp sender
    channel: { type: String, enum: TEMPLATE_CHANNELS, required: true },
    status: { type: String, enum: CONVERSATION_STATUSES, default: 'WAITING' },
    externalThreadId: { type: String, maxlength: 40, default: null }, // WhatsApp wa_id (digits)
    contactName: { type: String, maxlength: 120, default: null }, // as shown by WhatsApp (profile name)
    lastMessageAt: { type: Date, default: null },
    lastInboundAt: { type: Date, default: null }, // last reply from the lead (any source)
    apiInboundAt: { type: Date, default: null }, // last message RECEIVED by the WhatsApp Business API → 24-hour window
    lastDirection: { type: String, enum: ['INBOUND', 'OUTBOUND', null], default: null },
    lastSnippet: { type: String, maxlength: 160, default: null },
    lastIntent: { type: String, enum: [...REPLY_INTENTS, null], default: null },
    unread: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

conversationSchema.plugin(tenantScopePlugin);
conversationSchema.index({ tenantId: 1, lastMessageAt: -1 });
conversationSchema.index({ tenantId: 1, leadId: 1, channel: 1 }, { unique: true, partialFilterExpression: { leadId: { $type: 'objectId' } } });
conversationSchema.index({ tenantId: 1, channel: 1, externalThreadId: 1 }, { unique: true, partialFilterExpression: { externalThreadId: { $type: 'string' } } });

const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
export default Conversation;
