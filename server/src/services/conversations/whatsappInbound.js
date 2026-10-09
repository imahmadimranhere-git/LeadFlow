// WhatsApp Cloud API → LeadFlow (public webhook, no login).
//
//  GET  /api/v1/webhooks/whatsapp   Meta's one-time "verify" call: hub.verify_token must equal the token the
//                                    company typed in Settings → Integrations → WhatsApp → we echo hub.challenge.
//  POST /api/v1/webhooks/whatsapp   Messages + delivery statuses. The body is only used to find WHICH company's
//                                    number it is for (phone_number_id); nothing is stored or changed until the
//                                    X-Hub-Signature-256 matches that company's App Secret.
//
// Received messages: matched to a lead by phone number (last 10 digits). Unknown number → a conversation
// without a lead (a manager links it). "STOP" → do-not-contact + consent withdrawn. Same message twice
// (Meta retries) → stored once.
import TenantIntegration from '../../models/TenantIntegration.js';
import Conversation from '../../models/Conversation.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import Lead from '../../models/Lead.js';
import LeadActivity from '../../models/LeadActivity.js';
import DoNotContact from '../../models/DoNotContact.js';
import ApiError from '../../utils/ApiError.js';
import { decrypt } from '../../utils/crypto.js';
import { runAsSystem, runWithTenant } from '../../utils/tenantContext.js';
import { logSecurityEvent } from '../../utils/securityLogger.js';
import { recordAudit } from '../audit/auditService.js';
import { appendMessage, onInbound } from './conversationService.js';
import { notify, leadOwnerIds, managerIds } from '../notifications/notificationService.js';
import { verifyMetaSignature, parseWhatsAppPayload, isOptOut, phoneKey } from './whatsappWebhook.js';

const PROVIDER = 'WHATSAPP_CLOUD';
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Meta's subscription check. Returns the challenge to echo, or throws 403. */
export async function verifySubscription(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || typeof token !== 'string' || !TOKEN_RE.test(token) || typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(challenge)) {
    throw new ApiError(403, 'Verification failed');
  }
  const found = await runAsSystem('webhook:whatsapp-verify', () => TenantIntegration.exists({ provider: PROVIDER, 'config.webhookVerifyToken': token, status: { $ne: 'DISABLED' } }));
  if (!found) throw new ApiError(403, 'Verification failed');
  return challenge;
}

const ORDER = { sent: 1, delivered: 2, read: 3, failed: 4 };

async function saveInbound(m, integrationId) {
  if (await ConversationMessage.exists({ externalId: m.id })) return { duplicate: true };
  const key = phoneKey(m.from);
  const lead = key ? await Lead.findOne({ phoneNormalized: key }).sort({ updatedAt: -1 }).select('_id compliance') : null;

  let conv = await Conversation.findOne({ channel: 'WHATSAPP', externalThreadId: m.from });
  if (!conv && lead) {
    conv = await Conversation.findOne({ channel: 'WHATSAPP', leadId: lead._id });
    if (conv && !conv.externalThreadId) {
      await Conversation.updateOne({ _id: conv._id }, { $set: { externalThreadId: m.from } });
      conv.externalThreadId = m.from;
    }
  }
  if (!conv) {
    try {
      conv = await Conversation.create({ leadId: lead?._id || null, channel: 'WHATSAPP', externalThreadId: m.from, contactName: m.contactName, status: 'ACTIVE' });
    } catch (err) {
      if (err.code !== 11000) throw err;
      conv = await Conversation.findOne({ channel: 'WHATSAPP', externalThreadId: m.from });
      if (!conv) throw err;
    }
  }
  if (m.contactName && !conv.contactName) await Conversation.updateOne({ _id: conv._id }, { $set: { contactName: m.contactName } });

  const wasRead = !conv.unread;
  try {
    await appendMessage(conv, { direction: 'INBOUND', body: m.body, source: 'WHATSAPP_WEBHOOK', at: m.at, senderName: m.contactName, externalId: m.id });
  } catch (err) {
    if (err.code === 11000) return { duplicate: true }; // a parallel retry stored it a moment ago
    throw err;
  }
  if (conv.leadId) await onInbound(conv, { at: m.at, viaText: 'Reply received on WhatsApp' });
  if (wasRead) {
    // one notification per unread streak (not one per message)
    const lead = conv.leadId ? await Lead.findById(conv.leadId).select('_id name assignedTo createdBy') : null;
    await notify({
      userIds: lead ? await leadOwnerIds(lead) : await managerIds(),
      type: 'NEW_REPLY',
      title: lead ? `WhatsApp reply from ${lead.name}` : `WhatsApp message from an unknown number (${m.contactName || `+${m.from}`})`,
      body: m.body.slice(0, 120),
      link: `/app/conversations?open=${conv._id}`,
      leadId: lead?._id || null,
      dedupeKey: `reply:${m.id}`,
    });
  }

  if (isOptOut(m.body)) await optOut(conv, m.from);
  await TenantIntegration.updateOne({ _id: integrationId }, { $set: { lastUsedAt: new Date() } });
  return { stored: true };
}

async function optOut(conv, waId) {
  try {
    await DoNotContact.create({ type: 'PHONE', value: phoneKey(waId), reason: 'Replied STOP on WhatsApp' });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  const now = new Date();
  const leads = await Lead.find({ phoneNormalized: phoneKey(waId) }).select('_id compliance').limit(100);
  for (const lead of leads) {
    const c = lead.compliance?.toObject ? lead.compliance.toObject() : lead.compliance || {};
    await Lead.updateOne({ _id: lead._id }, { $set: { doNotContact: true, compliance: { ...c, consentStatus: 'WITHDRAWN', optOutAt: c.optOutAt || now } } });
    await LeadActivity.create({ leadId: lead._id, type: 'UNSUBSCRIBED', body: 'Replied STOP on WhatsApp', meta: { channel: 'WHATSAPP' }, actorId: null });
  }
  await Conversation.updateOne({ _id: conv._id }, { $set: { status: 'CLOSED' } });
  await recordAudit({ actorType: 'SYSTEM', tenantId: conv.tenantId, action: 'outreach.unsubscribed', targetType: 'Conversation', targetId: conv._id, metadata: { channel: 'WHATSAPP', leads: leads.length } });
}

async function saveStatus(s) {
  const msg = await ConversationMessage.findOne({ externalId: s.id }).select('_id deliveryStatus');
  if (!msg || (ORDER[msg.deliveryStatus] || 0) >= ORDER[s.status]) return; // never go backwards (read → delivered)
  await ConversationMessage.updateOne({ _id: msg._id }, { $set: { deliveryStatus: s.status } });
}

/**
 * POST handler. 200 { received } when at least one company's App Secret matches,
 * 401 when the signature matches none of the companies using that number.
 */
export async function receiveWhatsAppWebhook(rawBody, headers, meta = {}) {
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''), 'utf8');
  let json;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    throw ApiError.badRequest('Body must be JSON');
  }
  const payload = parseWhatsAppPayload(json);
  if (!payload.phoneNumberIds.length) return { received: true, ignored: true }; // nothing for us (other event types)

  const candidates = await runAsSystem('webhook:whatsapp-lookup', () =>
    TenantIntegration.find({ provider: PROVIDER, 'config.phoneNumberId': { $in: payload.phoneNumberIds }, status: { $ne: 'DISABLED' } }).select('+encryptedCredentials').limit(20)
  );
  const signature = headers['x-hub-signature-256'];
  const verified = candidates.filter((doc) => {
    try {
      return verifyMetaSignature(raw, signature, JSON.parse(decrypt(doc.encryptedCredentials)).appSecret);
    } catch {
      return false;
    }
  });
  if (!verified.length) {
    logSecurityEvent('whatsapp_webhook_bad_signature', { ip: meta.ip, candidates: candidates.length });
    throw new ApiError(401, 'Invalid signature');
  }

  let stored = 0;
  let duplicates = 0;
  for (const doc of verified) {
    const phoneNumberId = doc.config.get('phoneNumberId');
    await runWithTenant({ tenantId: doc.tenantId }, async () => {
      for (const m of payload.messages.filter((x) => x.phoneNumberId === phoneNumberId)) {
        const r = await saveInbound(m, doc._id);
        if (r.stored) stored += 1;
        if (r.duplicate) duplicates += 1;
      }
      for (const s of payload.statuses.filter((x) => x.phoneNumberId === phoneNumberId)) await saveStatus(s);
    });
  }
  return { received: true, stored, duplicates };
}
