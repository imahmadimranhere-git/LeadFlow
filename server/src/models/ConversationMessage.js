// One message in a conversation. Inbound text is UNTRUSTED (written by the lead) — always shown as text,
// and given to the AI only as data.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { REPLY_INTENTS } from './Conversation.js';

export const CONV_MESSAGE_SOURCES = ['MANUAL_LOG', 'OUTREACH', 'WHATSAPP_WEBHOOK', 'WHATSAPP_API'];

const conversationMessageSchema = new mongoose.Schema(
  {
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    direction: { type: String, enum: ['INBOUND', 'OUTBOUND'], required: true },
    body: { type: String, maxlength: 5000, required: true },
    senderName: { type: String, maxlength: 120, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who logged / sent it
    source: { type: String, enum: CONV_MESSAGE_SOURCES, required: true },
    outreachMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'OutreachMessage', default: null },
    externalId: { type: String, maxlength: 200, default: null, private: true }, // WhatsApp message id (dedupe)
    deliveryStatus: { type: String, enum: ['sent', 'delivered', 'read', 'failed', null], default: null },
    aiIntent: { type: String, enum: [...REPLY_INTENTS, null], default: null },
    suspectedInjection: { type: Boolean, default: false },
    at: { type: Date, default: Date.now }, // when it was written (may be earlier than createdAt for pasted replies)
  },
  { timestamps: true, strict: 'throw' }
);

conversationMessageSchema.plugin(tenantScopePlugin);
conversationMessageSchema.index({ tenantId: 1, conversationId: 1, at: 1 });
conversationMessageSchema.index({ tenantId: 1, externalId: 1 }, { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } });

const ConversationMessage = mongoose.models.ConversationMessage || mongoose.model('ConversationMessage', conversationMessageSchema);
export default ConversationMessage;
