// Outreach (spec A15): APPROVED messages → sent → replied / follow-up → closed.
//
// Hard rules, checked again at the moment of sending (never trusting the UI):
//   - only the exact APPROVED text can be sent (editing resets approval — Phase 15)
//   - do-not-contact lead / withdrawn consent / address on the DNC list → refused
//   - email only through the company's own SMTP mailbox; daily limit; not the same lead twice in 24 h
//   - one send per message (atomic APPROVED → SENDING); a crash mid-send is NOT retried automatically
//     (the email may have gone out) — a person checks and retries
//   - every email gets an unsubscribe link (+ one-click List-Unsubscribe header)
// LinkedIn / Instagram / Facebook / WhatsApp / General: the person sends it in that app, then clicks "Mark as sent".
// WhatsApp Cloud API (Phase 18): free-text replies only inside Meta's 24-hour window (the customer wrote to
// the business number in the last 24 h). Every sent message is added to the lead's conversation.
import env from '../../config/env.js';
import Lead from '../../models/Lead.js';
import LeadActivity from '../../models/LeadActivity.js';
import OutreachMessage from '../../models/OutreachMessage.js';
import TenantSettings from '../../models/TenantSettings.js';
import DoNotContact from '../../models/DoNotContact.js';
import TenantIntegration from '../../models/TenantIntegration.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { PERMISSIONS as P, hasPermission } from '../../config/permissions.js';
import { CHANNEL_LABEL } from '../../config/messageOptions.js';
import { runAsSystem, runWithTenant } from '../../utils/tenantContext.js';
import { safeFetch, SafeFetchError } from '../../utils/safeFetch.js';
import Conversation from '../../models/Conversation.js';
import { recordOutbound } from '../conversations/conversationService.js';
import { windowOpen, windowClosesAt } from '../conversations/whatsappWebhook.js';
import { signUnsubscribe, verifyUnsubscribe } from '../../utils/unsubscribeToken.js';
import { recordAudit } from '../audit/auditService.js';
import { getCredentials } from '../integrations/vaultService.js';
import { createSmtpTransport } from '../integrations/smtp.js';
import { scopeFilter } from '../leads/leadService.js';
import { matchesDoNotContact } from '../leads/dncService.js';
import { identityKeys, normalizeEmail } from '../leads/normalize.js';
import { buildEmail, escapeHtml } from './emailBuilder.js';
import { advanceLead } from './leadProgress.js';

export { buildEmail };

const DAY = 24 * 60 * 60 * 1000;
const STUCK_MS = 10 * 60 * 1000;
const EMAIL_RX = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[A-Za-z]{2,}$/;

const isApprover = (auth) => hasPermission(auth.role, P.MESSAGES_APPROVE);
const visible = (auth) => (hasPermission(auth.role, P.LEADS_READ_ALL) || isApprover(auth) ? {} : { createdBy: auth.userId });

async function loadMessage(auth, id) {
  const m = await OutreachMessage.findOne({ _id: id, ...visible(auth) });
  if (!m) throw ApiError.notFound('Message not found');
  return m;
}
async function loadLead(auth, leadId) {
  const lead = await Lead.findOne({ _id: leadId, ...scopeFilter(auth) });
  if (!lead) throw ApiError.notFound('Lead not found');
  return lead;
}

const blocked = (message, code) => new ApiError(409, message, [{ code, field: '', message: code }]);

/** Every reason this lead may NOT be contacted right now. */
async function assertMayContact(lead) {
  if (lead.doNotContact) throw blocked('This lead is on your do-not-contact list.', 'DO_NOT_CONTACT');
  if (lead.compliance?.consentStatus === 'WITHDRAWN') throw blocked('This person withdrew consent / unsubscribed.', 'CONSENT_WITHDRAWN');
  if (await matchesDoNotContact(identityKeys(lead))) {
    await Lead.updateOne({ _id: lead._id }, { $set: { doNotContact: true } });
    throw blocked('This lead matches your do-not-contact list.', 'DO_NOT_CONTACT');
  }
}

const activity = (auth, leadId, type, body = '', meta = {}) => LeadActivity.create({ leadId, type, body, meta, actorId: auth?.userId || null });

// ---------------------------------------------------------------- what can I do with this message?

export async function sendOptions(auth, id) {
  const m = await loadMessage(auth, id);
  const lead = await loadLead(auth, m.leadId);
  let blockedReason = null;
  try {
    await assertMayContact(lead);
  } catch (err) {
    blockedReason = err.message;
  }
  const smtp = m.channel === 'EMAIL' ? await getCredentials('SMTP', { purpose: 'outreach:check' }).catch(() => null) : null;
  let whatsappApi = null;
  if (m.channel === 'WHATSAPP') {
    const connected = await TenantIntegration.exists({ provider: 'WHATSAPP_CLOUD', status: { $in: ['CONNECTED', 'NOT_TESTED'] } });
    const conv = connected ? await Conversation.findOne({ leadId: lead._id, channel: 'WHATSAPP' }).select('apiInboundAt externalThreadId') : null;
    whatsappApi = { connected: Boolean(connected), windowOpen: Boolean(conv?.externalThreadId) && windowOpen(conv?.apiInboundAt), closesAt: windowClosesAt(conv?.apiInboundAt) };
  }
  const digits = String(lead.phone || '').replace(/\D/g, '');
  const text = encodeURIComponent(`${m.body}`.slice(0, 1500));
  return {
    channel: m.channel,
    status: m.status,
    blockedReason,
    email: m.channel === 'EMAIL' ? { to: lead.email || null, smtpConnected: Boolean(smtp) } : null,
    whatsappApi,
    whatsappUrl: m.channel === 'WHATSAPP' && digits.length >= 10 ? `https://wa.me/${digits}?text=${text}` : null,
    profileUrl: ['LINKEDIN', 'INSTAGRAM_DM', 'FACEBOOK_MESSAGE'].includes(m.channel) ? lead.socialProfileUrl || lead.postUrl || lead.sourceUrl || null : null,
  };
}

// ---------------------------------------------------------------- email

function smtpError(err) {
  if (err instanceof SafeFetchError) return 'The mail server address is not allowed (internal/private network).';
  if (err?.code === 'EAUTH') return 'Your mail server rejected the login — check Settings → Integrations → Email.';
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED'].includes(err?.code)) return 'Could not reach your mail server — try again.';
  if (err?.code === 'EENVELOPE') return 'The mail server refused this recipient address.';
  return 'Your mail server did not accept the email.';
}

export async function sendEmail(auth, id) {
  const m = await loadMessage(auth, id);
  if (m.channel !== 'EMAIL') throw ApiError.badRequest(`${CHANNEL_LABEL[m.channel]} messages are sent from that app — use “Mark as sent” afterwards.`);
  if (!['APPROVED', 'SEND_FAILED'].includes(m.status)) throw ApiError.conflict(m.status === 'PENDING_REVIEW' ? 'This message is not approved yet.' : 'This message was already sent (or is being sent).');
  const lead = await loadLead(auth, m.leadId);
  await assertMayContact(lead);
  const to = normalizeEmail(lead.email);
  if (!to || !EMAIL_RX.test(to)) throw ApiError.badRequest('This lead has no valid email address.');

  const smtp = await getCredentials('SMTP', { purpose: 'outreach:email', actor: auth });
  if (!smtp) throw ApiError.badRequest('Connect your email (SMTP) in Settings → Integrations first.', [{ code: 'NOT_CONNECTED', field: '', message: 'SMTP' }]);
  const settings = await TenantSettings.findOne({}).select('outreach');
  const limit = settings?.outreach?.dailyEmailLimit || 100;
  const sinceDay = new Date(Date.now() - DAY);
  const sentToday = await OutreachMessage.countDocuments({ sentVia: 'SMTP', sentAt: { $gte: sinceDay } });
  if (sentToday >= limit) throw new ApiError(429, `Daily email limit reached (${limit} in 24 hours). This protects your mailbox from being marked as spam — change it in Settings → Company → Outreach.`);
  if (await OutreachMessage.exists({ leadId: lead._id, channel: 'EMAIL', status: { $in: ['SENT', 'SENDING'] }, sentAt: { $gte: sinceDay }, _id: { $ne: m._id } })) {
    throw blocked('An email was already sent to this lead in the last 24 hours.', 'TOO_SOON');
  }

  // claim: exactly one sender for this message
  const claimed = await OutreachMessage.findOneAndUpdate(
    { _id: m._id, status: { $in: ['APPROVED', 'SEND_FAILED'] }, updatedAt: m.updatedAt },
    { $set: { status: 'SENDING', sendingStartedAt: new Date(), sendError: null }, $inc: { sendAttempts: 1 } },
    { new: true }
  );
  if (!claimed) throw ApiError.conflict('This message is already being sent.');

  const unsubscribeUrl = `${env.API_PUBLIC_URL.replace(/\/$/, '')}/api/v1/unsubscribe/${signUnsubscribe({ tenantId: auth.tenantId, leadId: lead._id, email: to })}`;
  const mail = buildEmail({ msg: claimed, lead: { email: to }, smtpConfig: smtp.config, settings, unsubscribeUrl });
  let transport;
  try {
    transport = await createSmtpTransport(smtp.secrets, smtp.config);
    const info = await transport.sendMail(mail);
    await OutreachMessage.updateOne(
      { _id: m._id },
      { $set: { status: 'SENT', sentVia: 'SMTP', sentTo: to, sentAt: new Date(), sentBy: auth.userId, providerMessageId: String(info?.messageId || '').slice(0, 300) || null } }
    );
  } catch (err) {
    await OutreachMessage.updateOne({ _id: m._id, status: 'SENDING' }, { $set: { status: 'SEND_FAILED', sendError: smtpError(err) } });
    logger.warn({ msgId: String(m._id), code: err?.code }, 'email send failed');
    throw new ApiError(502, smtpError(err));
  } finally {
    transport?.close?.();
  }
  await recordOutbound(claimed, { userId: auth.userId });
  await advanceLead(lead._id, 'CONTACTED');
  await activity(auth, lead._id, 'MESSAGE_SENT', '', { channel: 'EMAIL', messageId: String(m._id), via: 'SMTP' });
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'outreach.email_sent', targetType: 'OutreachMessage', targetId: m._id, metadata: { leadId: String(lead._id) } });
  return getPublic(m._id);
}

// ---------------------------------------------------------------- WhatsApp Cloud API

// Tests replace the network; production = SafeFetch (fixed Meta host, size/time limits).
let waTransport = async ({ url, token, payload }) => {
  const res = await safeFetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    timeoutMs: 15_000,
    maxBytes: 64 * 1024,
    maxRedirects: 0,
  });
  let json = null;
  try {
    json = res.json();
  } catch {
    /* not JSON */
  }
  return { status: res.status, json };
};
export function setWhatsAppTransport(fn) {
  waTransport = fn;
}

function waError(status, json) {
  const code = json?.error?.code;
  if (status === 401 || code === 190) return 'WhatsApp rejected your access token — update it in Settings → Integrations → WhatsApp.';
  if (code === 131047 || code === 131026) return 'WhatsApp did not deliver: the 24-hour window is closed or the number cannot receive messages.';
  if (code === 131056 || status === 429) return 'WhatsApp rate limit — wait a little and retry.';
  return 'WhatsApp did not accept the message.';
}

export async function sendWhatsApp(auth, id) {
  const m = await loadMessage(auth, id);
  if (m.channel !== 'WHATSAPP') throw ApiError.badRequest('Only WhatsApp messages can be sent through the WhatsApp API.');
  if (!['APPROVED', 'SEND_FAILED'].includes(m.status)) throw ApiError.conflict(m.status === 'PENDING_REVIEW' ? 'This message is not approved yet.' : 'This message was already sent (or is being sent).');
  const lead = await loadLead(auth, m.leadId);
  await assertMayContact(lead);
  const conv = await Conversation.findOne({ leadId: lead._id, channel: 'WHATSAPP' });
  if (!conv?.externalThreadId || !windowOpen(conv.apiInboundAt)) {
    throw blocked('WhatsApp only allows free-text messages within 24 hours after the customer wrote to your business number. Send it from your own WhatsApp instead (Copy text → Mark as sent).', 'WINDOW_CLOSED');
  }
  const wa = await getCredentials('WHATSAPP_CLOUD', { purpose: 'outreach:whatsapp', actor: auth });
  if (!wa) throw ApiError.badRequest('Connect WhatsApp Cloud API in Settings → Integrations first.', [{ code: 'NOT_CONNECTED', field: '', message: 'WHATSAPP_CLOUD' }]);
  const phoneNumberId = String(wa.config.phoneNumberId || '');
  if (!/^[0-9]{6,30}$/.test(phoneNumberId)) throw ApiError.badRequest('The WhatsApp phone number ID is missing — check Settings → Integrations.');

  const claimed = await OutreachMessage.findOneAndUpdate(
    { _id: m._id, status: { $in: ['APPROVED', 'SEND_FAILED'] }, updatedAt: m.updatedAt },
    { $set: { status: 'SENDING', sendingStartedAt: new Date(), sendError: null }, $inc: { sendAttempts: 1 } },
    { new: true }
  );
  if (!claimed) throw ApiError.conflict('This message is already being sent.');

  let wamid = null;
  try {
    const { status, json } = await waTransport({
      url: `https://graph.facebook.com/${env.META_GRAPH_VERSION}/${phoneNumberId}/messages`,
      token: wa.secrets.accessToken,
      payload: { messaging_product: 'whatsapp', recipient_type: 'individual', to: conv.externalThreadId, type: 'text', text: { preview_url: false, body: claimed.body } },
    });
    wamid = typeof json?.messages?.[0]?.id === 'string' ? json.messages[0].id.slice(0, 200) : null;
    if (status >= 300 || !wamid) {
      const reason = waError(status, json);
      await OutreachMessage.updateOne({ _id: m._id, status: 'SENDING' }, { $set: { status: 'SEND_FAILED', sendError: reason } });
      throw new ApiError(502, reason);
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    await OutreachMessage.updateOne({ _id: m._id, status: 'SENDING' }, { $set: { status: 'SEND_FAILED', sendError: 'Could not reach WhatsApp — check the Sent messages in WhatsApp Manager before retrying.' } });
    logger.warn({ msgId: String(m._id), code: err?.code }, 'whatsapp send failed');
    throw new ApiError(502, 'Could not reach WhatsApp — try again.');
  }
  await OutreachMessage.updateOne(
    { _id: m._id },
    { $set: { status: 'SENT', sentVia: 'WHATSAPP_API', sentTo: `+${conv.externalThreadId}`, sentAt: new Date(), sentBy: auth.userId, providerMessageId: wamid, conversationId: conv._id } }
  );
  claimed.conversationId = conv._id;
  await recordOutbound(claimed, { userId: auth.userId, source: 'WHATSAPP_API', externalId: wamid, deliveryStatus: 'sent' });
  await advanceLead(lead._id, 'CONTACTED');
  await activity(auth, lead._id, 'MESSAGE_SENT', '', { channel: 'WHATSAPP', messageId: String(m._id), via: 'WHATSAPP_API' });
  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'outreach.whatsapp_sent', targetType: 'OutreachMessage', targetId: m._id, metadata: { leadId: String(lead._id) } });
  return getPublic(m._id);
}

// ---------------------------------------------------------------- manual channels + lifecycle

export async function markSent(auth, id, { note } = {}) {
  const m = await loadMessage(auth, id);
  if (m.status !== 'APPROVED' && m.status !== 'SEND_FAILED') throw ApiError.conflict(m.status === 'PENDING_REVIEW' ? 'This message is not approved yet.' : 'Already marked as sent.');
  const lead = await loadLead(auth, m.leadId);
  await assertMayContact(lead);
  const r = await OutreachMessage.findOneAndUpdate(
    { _id: m._id, status: { $in: ['APPROVED', 'SEND_FAILED'] } },
    { $set: { status: 'SENT', sentVia: 'MANUAL', sentAt: new Date(), sentBy: auth.userId, outcomeNote: note || null, sendError: null } },
    { new: true }
  );
  if (!r) throw ApiError.conflict('Already marked as sent.');
  await recordOutbound(r, { userId: auth.userId });
  await advanceLead(lead._id, 'CONTACTED');
  await activity(auth, lead._id, 'MESSAGE_SENT', note || '', { channel: m.channel, messageId: String(m._id), via: 'MANUAL' });
  return getPublic(m._id);
}

async function transition(auth, id, from, set, { leadStatus, leadExtra = {}, activityType, note }) {
  const m = await loadMessage(auth, id);
  const r = await OutreachMessage.findOneAndUpdate({ _id: m._id, status: { $in: from } }, { $set: { ...set, ...(note ? { outcomeNote: note } : {}) } }, { new: true });
  if (!r) throw ApiError.conflict(`Not possible from the current status (${m.status.toLowerCase().replace('_', ' ')}).`);
  if (leadStatus) await advanceLead(m.leadId, leadStatus, leadExtra);
  else if (Object.keys(leadExtra).length) await Lead.updateOne({ _id: m.leadId }, { $set: leadExtra });
  if (activityType) await activity(auth, m.leadId, activityType, note || '', { channel: m.channel, messageId: String(m._id) });
  return getPublic(m._id);
}

export const markReplied = (auth, id, { note } = {}) =>
  transition(auth, id, ['SENT', 'FOLLOW_UP'], { status: 'REPLIED', repliedAt: new Date() }, { leadStatus: 'REPLIED', activityType: 'MESSAGE_REPLIED', note });

export function setFollowUp(auth, id, { date, note }) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || date.getTime() < Date.now() - 60_000) throw ApiError.badRequest('Choose a follow-up date in the future');
  return transition(auth, id, ['SENT', 'REPLIED', 'FOLLOW_UP'], { status: 'FOLLOW_UP', followUpAt: date }, { leadStatus: 'FOLLOW_UP', leadExtra: { followUpDate: date }, note });
}

export const closeMessage = (auth, id, { note } = {}) =>
  transition(auth, id, ['SENT', 'REPLIED', 'FOLLOW_UP', 'SEND_FAILED'], { status: 'CLOSED', closedAt: new Date() }, { note });

async function getPublic(id) {
  const m = await OutreachMessage.findById(id).select('-revisions').populate('leadId', 'name companyName doNotContact').populate('createdBy', 'name').populate('reviewedBy', 'name').populate('sentBy', 'name');
  const o = m.toJSON();
  o.canApprove = false;
  return o;
}

/** Runner: a send that never finished (server crash) → SEND_FAILED for a human to check. Never auto-resent. */
export async function recoverStuckSending(now = new Date()) {
  const r = await runAsSystem('outreach:recover', () =>
    OutreachMessage.updateMany(
      { status: 'SENDING', sendingStartedAt: { $lt: new Date(now.getTime() - STUCK_MS) } },
      { $set: { status: 'SEND_FAILED', sendError: 'Sending was interrupted — check your mailbox “Sent” folder before retrying.' } }
    )
  );
  return r.modifiedCount;
}

// ---------------------------------------------------------------- unsubscribe (public link in every email)

export async function unsubscribe(token) {
  const t = verifyUnsubscribe(token);
  if (!t) throw ApiError.badRequest('This unsubscribe link is not valid.');
  await runWithTenant({ tenantId: t.tenantId }, async () => {
    const email = normalizeEmail(t.email);
    if (!email) return;
    try {
      await DoNotContact.create({ type: 'EMAIL', value: email, reason: 'Unsubscribed via email link' });
    } catch (err) {
      if (err.code !== 11000) throw err; // already on the list = fine
    }
    const now = new Date();
    const leads = await Lead.find({ emailNormalized: email }).select('_id compliance').limit(100);
    for (const lead of leads) {
      const c = lead.compliance?.toObject ? lead.compliance.toObject() : lead.compliance || {};
      await Lead.updateOne({ _id: lead._id }, { $set: { doNotContact: true, compliance: { ...c, consentStatus: 'WITHDRAWN', optOutAt: c.optOutAt || now } } });
      await LeadActivity.create({ leadId: lead._id, type: 'UNSUBSCRIBED', body: 'Unsubscribed via the email link', meta: {}, actorId: null });
    }
    await recordAudit({ actorType: 'SYSTEM', tenantId: t.tenantId, action: 'outreach.unsubscribed', targetType: 'Lead', targetId: t.leadId, metadata: { leads: leads.length } });
  });
  return { unsubscribed: true };
}

export function unsubscribePage({ done, error, actionUrl }) {
  const body = error
    ? `<h1>Link not valid</h1><p>${escapeHtml(error)}</p>`
    : done
      ? '<h1>You are unsubscribed</h1><p>You will not receive further emails from this sender through LeadFlow.</p>'
      : `<h1>Unsubscribe?</h1><p>Click the button to stop receiving emails from this sender.</p><form method="post" action="${escapeHtml(actionUrl)}"><button type="submit" style="padding:10px 18px;font-size:15px">Unsubscribe</button></form>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Unsubscribe</title></head><body style="font-family:Arial,sans-serif;max-width:480px;margin:60px auto;padding:0 16px;color:#222">${body}</body></html>`;
}
