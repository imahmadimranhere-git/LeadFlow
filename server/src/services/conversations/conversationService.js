// Conversations (spec A14): the whole back-and-forth with a lead in one place.
//
//  - Outbound: every message sent through Outreach (email / WhatsApp API / "mark as sent") is added
//    automatically. Inbound: pasted by a person ("Log a reply") or received by the WhatsApp webhook.
//  - Inbound text is written by the lead → UNTRUSTED: shown as plain text, given to the AI only as data,
//    and checked for prompt-injection phrases.
//  - Visibility follows the lead: Sales sees conversations of their own leads only; a WhatsApp message
//    from an unknown number (no lead yet) is visible to managers/admins, who can link it to a lead.
import Conversation from '../../models/Conversation.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import Lead from '../../models/Lead.js';
import LeadActivity from '../../models/LeadActivity.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { buildPagination } from '../../utils/queryBuilder.js';
import { PERMISSIONS as P, hasPermission } from '../../config/permissions.js';
import { recordAudit } from '../audit/auditService.js';
import { scopeFilter, createLead } from '../leads/leadService.js';
import { looksLikePromptInjection } from '../leads/normalize.js';
import { advanceLead, markLatestSentReplied } from '../outreach/leadProgress.js';
import { windowOpen, windowClosesAt } from './whatsappWebhook.js';

const THREAD_LIMIT = 200;
const snippet = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 160);
const seesUnmatched = (auth) => hasPermission(auth.role, P.LEADS_READ_ALL);

// ---------------------------------------------------------------- internal building blocks

/** One conversation per lead + channel (race-safe: the unique index decides). */
export async function ensureConversation(leadId, channel, { userId = null, externalThreadId = null, contactName = null } = {}) {
  const existing = await Conversation.findOne({ leadId, channel });
  if (existing) return existing;
  try {
    return await Conversation.create({ leadId, channel, externalThreadId, contactName, createdBy: userId });
  } catch (err) {
    if (err.code === 11000) {
      const again = await Conversation.findOne({ leadId, channel });
      if (again) return again;
    }
    throw err;
  }
}

/** Adds one message and updates the thread summary. Status: inbound → ACTIVE, outbound → WAITING (CONVERTED stays). */
export async function appendMessage(conv, { direction, body, source, at = new Date(), userId = null, senderName = null, outreachMessageId = null, externalId = null, deliveryStatus = null }) {
  const text = String(body || '').slice(0, 5000);
  const doc = await ConversationMessage.create({
    conversationId: conv._id,
    leadId: conv.leadId || null,
    direction,
    body: text || '(empty)',
    source,
    at,
    userId,
    senderName,
    outreachMessageId,
    externalId,
    deliveryStatus,
    suspectedInjection: direction === 'INBOUND' && looksLikePromptInjection(text),
  });
  const set = {};
  if (!conv.lastMessageAt || at >= conv.lastMessageAt) Object.assign(set, { lastMessageAt: at, lastDirection: direction, lastSnippet: snippet(text) });
  if (direction === 'INBOUND') {
    set.lastInboundAt = !conv.lastInboundAt || at > conv.lastInboundAt ? at : conv.lastInboundAt;
    if (source === 'WHATSAPP_WEBHOOK') set.apiInboundAt = !conv.apiInboundAt || at > conv.apiInboundAt ? at : conv.apiInboundAt;
    if (conv.status !== 'CONVERTED') set.status = 'ACTIVE';
  } else if (conv.status !== 'CONVERTED' && conv.status !== 'CLOSED') {
    set.status = 'WAITING';
  }
  await Conversation.updateOne({ _id: conv._id }, { $set: set, $inc: { messageCount: 1, unread: direction === 'INBOUND' ? 1 : 0 } });
  Object.assign(conv, set);
  return doc;
}

/**
 * Called by Outreach after a message really went out (email / WhatsApp API / marked as sent).
 * Never breaks the send: a failure here is only logged.
 */
export async function recordOutbound(msg, { userId = null, source = 'OUTREACH', externalId = null, deliveryStatus = null } = {}) {
  try {
    const conv = msg.conversationId ? await Conversation.findById(msg.conversationId) : await ensureConversation(msg.leadId, msg.channel, { userId });
    if (!conv) return null;
    const body = msg.channel === 'EMAIL' && msg.subject ? `Subject: ${msg.subject}\n\n${msg.body}` : msg.body;
    await appendMessage(conv, { direction: 'OUTBOUND', body, source, userId, outreachMessageId: msg._id, externalId, deliveryStatus });
    return conv;
  } catch (err) {
    logger.warn({ err: err.message, msgId: String(msg._id) }, 'could not add sent message to the conversation');
    return null;
  }
}

/** The lead answered (pasted or received) → CRM moves forward + activity. */
export async function onInbound(conv, { at = new Date(), actorId = null, viaText = 'Reply logged' } = {}) {
  if (!conv.leadId) return;
  await markLatestSentReplied(conv.leadId, conv.channel, at);
  await advanceLead(conv.leadId, 'REPLIED');
  await LeadActivity.create({ leadId: conv.leadId, type: 'MESSAGE_REPLIED', body: viaText, meta: { channel: conv.channel, conversationId: String(conv._id) }, actorId });
}

// ---------------------------------------------------------------- access

async function leadInScope(auth, leadId) {
  const lead = await Lead.findOne({ _id: leadId, ...scopeFilter(auth) });
  if (!lead) throw ApiError.notFound('Lead not found');
  return lead;
}

/** 404 for anything the user may not see (never "403 — it exists"). */
export async function loadConversation(auth, id) {
  const conv = await Conversation.findOne({ _id: id });
  if (!conv) throw ApiError.notFound('Conversation not found');
  if (conv.leadId) {
    const lead = await Lead.findOne({ _id: conv.leadId, ...scopeFilter(auth) }).select('_id');
    if (!lead) throw ApiError.notFound('Conversation not found');
  } else if (!seesUnmatched(auth)) {
    throw ApiError.notFound('Conversation not found');
  }
  return conv;
}

async function visibleFilter(auth) {
  if (!Object.keys(scopeFilter(auth)).length) return {};
  const mine = await Lead.find(scopeFilter(auth)).select('_id').limit(5000);
  return { leadId: { $in: mine.map((l) => l._id) } };
}

// ---------------------------------------------------------------- API

export async function listConversations(auth, { page, limit, status, channel, leadId, unmatched, unreadOnly, q }) {
  const { skip } = buildPagination(page, limit);
  const filter = { ...(await visibleFilter(auth)) };
  if (status) filter.status = status;
  if (channel) filter.channel = channel;
  if (unreadOnly) filter.unread = { $gt: 0 };
  if (leadId) {
    if (filter.leadId && !filter.leadId.$in.some((x) => String(x) === String(leadId))) return { items: [], total: 0 };
    filter.leadId = leadId;
  }
  if (unmatched) {
    if (!seesUnmatched(auth)) return { items: [], total: 0 };
    filter.leadId = null;
  }
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const leads = await Lead.find({ ...scopeFilter(auth), $or: [{ name: rx }, { companyName: rx }, { personName: rx }] }).select('_id').limit(500);
    filter.$or = [{ leadId: { $in: leads.map((l) => l._id) } }, ...(seesUnmatched(auth) ? [{ leadId: null, contactName: rx }] : [])];
  }
  const [items, total] = await Promise.all([
    Conversation.find(filter).sort({ lastMessageAt: -1, _id: -1 }).skip(skip).limit(limit).populate('leadId', 'name companyName status doNotContact'),
    Conversation.countDocuments(filter),
  ]);
  return { items: items.map(toPublicConv), total };
}

function toPublicConv(c) {
  const o = c.toJSON();
  if (o.channel === 'WHATSAPP') {
    o.whatsappWindow = { open: windowOpen(c.apiInboundAt), closesAt: windowClosesAt(c.apiInboundAt) };
  }
  if (o.externalThreadId) o.externalThreadId = `+${o.externalThreadId}`; // shown as a phone number
  return o;
}

export async function getConversation(auth, id) {
  const conv = await loadConversation(auth, id);
  await conv.populate('leadId', 'name companyName personName status doNotContact phone email');
  const messages = await ConversationMessage.find({ conversationId: conv._id }).sort({ at: -1, _id: -1 }).limit(THREAD_LIMIT).populate('userId', 'name');
  return { conversation: toPublicConv(conv), messages: messages.reverse().map((m) => m.toJSON()), truncated: messages.length === THREAD_LIMIT };
}

export async function markRead(auth, id) {
  const conv = await loadConversation(auth, id);
  await Conversation.updateOne({ _id: conv._id }, { $set: { unread: 0 } });
  return { read: true };
}

export async function startConversation(auth, { leadId, channel }) {
  const lead = await leadInScope(auth, leadId);
  const conv = await ensureConversation(lead._id, channel, { userId: auth.userId });
  return toPublicConv(conv);
}

/** A person pastes a reply they received (or something they sent outside the app). */
export async function logMessage(auth, id, { direction, body, at }) {
  const conv = await loadConversation(auth, id);
  if (!conv.leadId) throw ApiError.badRequest('Link this conversation to a lead first.');
  const when = at || new Date();
  if (when.getTime() > Date.now() + 5 * 60 * 1000) throw ApiError.badRequest('The time cannot be in the future.');
  const doc = await appendMessage(conv, { direction, body, source: 'MANUAL_LOG', at: when, userId: auth.userId });
  if (direction === 'INBOUND') {
    await onInbound(conv, { at: when, actorId: auth.userId, viaText: 'Reply logged by hand' });
    await Conversation.updateOne({ _id: conv._id }, { $set: { unread: 0 } }); // the person who pasted it has read it
  } else {
    await advanceLead(conv.leadId, 'CONTACTED');
    await LeadActivity.create({ leadId: conv.leadId, type: 'MESSAGE_SENT', body: 'Sent outside the app (logged by hand)', meta: { channel: conv.channel, conversationId: String(conv._id), via: 'MANUAL_LOG' }, actorId: auth.userId });
  }
  return { message: doc.toJSON(), suspectedInjection: doc.suspectedInjection };
}

export async function setStatus(auth, id, { status }) {
  const conv = await loadConversation(auth, id);
  await Conversation.updateOne({ _id: conv._id }, { $set: { status } });
  if (status === 'CONVERTED' && conv.leadId) {
    await Lead.updateOne({ _id: conv.leadId, status: { $nin: ['CONVERTED'] } }, { $set: { status: 'CONVERTED', lastActivityAt: new Date() } });
    await LeadActivity.create({ leadId: conv.leadId, type: 'STATUS_CHANGED', body: 'Converted (from the conversation)', meta: { to: 'CONVERTED', conversationId: String(conv._id) }, actorId: auth.userId });
  }
  return toPublicConv(await Conversation.findById(conv._id));
}

/**
 * WhatsApp message from an unknown number → link it to an existing lead.
 * If that lead already has a WhatsApp conversation, the two threads are merged.
 */
export async function linkToLead(auth, id, { leadId }) {
  const conv = await loadConversation(auth, id);
  if (conv.leadId) throw ApiError.conflict('This conversation already belongs to a lead.');
  const lead = await leadInScope(auth, leadId);
  const target = await Conversation.findOne({ leadId: lead._id, channel: conv.channel });
  let result;
  if (target) {
    if (target.externalThreadId && conv.externalThreadId && target.externalThreadId !== conv.externalThreadId) {
      throw ApiError.conflict('This lead already has a WhatsApp conversation with a different number.');
    }
    await ConversationMessage.updateMany({ conversationId: conv._id }, { $set: { conversationId: target._id, leadId: lead._id } });
    const thread = conv.externalThreadId;
    await Conversation.deleteOne({ _id: conv._id }); // frees the unique WhatsApp-number index first
    const latest = await ConversationMessage.findOne({ conversationId: target._id }).sort({ at: -1 });
    const set = {
      externalThreadId: target.externalThreadId || thread,
      contactName: target.contactName || conv.contactName,
      apiInboundAt: [target.apiInboundAt, conv.apiInboundAt].filter(Boolean).sort((a, b) => b - a)[0] || null,
      lastInboundAt: [target.lastInboundAt, conv.lastInboundAt].filter(Boolean).sort((a, b) => b - a)[0] || null,
      ...(latest ? { lastMessageAt: latest.at, lastDirection: latest.direction, lastSnippet: snippet(latest.body) } : {}),
      status: target.status === 'CONVERTED' ? 'CONVERTED' : 'ACTIVE',
    };
    await Conversation.updateOne({ _id: target._id }, { $set: set, $inc: { messageCount: conv.messageCount, unread: conv.unread } });
    result = await Conversation.findById(target._id);
  } else {
    await Conversation.updateOne({ _id: conv._id }, { $set: { leadId: lead._id } });
    await ConversationMessage.updateMany({ conversationId: conv._id }, { $set: { leadId: lead._id } });
    result = await Conversation.findById(conv._id);
  }
  if (conv.lastInboundAt) await onInbound(result, { at: conv.lastInboundAt, actorId: auth.userId, viaText: 'WhatsApp conversation linked to this lead' });
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'conversation.linked', targetType: 'Conversation', targetId: result._id, metadata: { leadId: String(lead._id), merged: Boolean(target) } });
  return toPublicConv(result);
}

/** Unknown WhatsApp number → new lead (normal lead rules: duplicates, plan quota), then linked. */
export async function createLeadFromConversation(auth, id, { name }) {
  const conv = await loadConversation(auth, id);
  if (conv.leadId) throw ApiError.conflict('This conversation already belongs to a lead.');
  if (!conv.externalThreadId) throw ApiError.badRequest('No phone number on this conversation.');
  const person = name || conv.contactName || null;
  const lead = await createLead(auth, {
    name: person || `WhatsApp +${conv.externalThreadId}`,
    ...(person ? { personName: person } : {}),
    phone: `+${conv.externalThreadId}`,
    source: 'MANUAL',
  });
  return linkToLead(auth, id, { leadId: lead._id });
}
