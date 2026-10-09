// WhatsApp Cloud API webhooks — PURE helpers (no database), unit-tested on their own.
//
//  - Meta signs every POST:  X-Hub-Signature-256: sha256=<HMAC-SHA256(appSecret, rawBody)>
//    → we verify it with a constant-time compare BEFORE reading anything from the body.
//  - The body is untrusted JSON: only the fields we need are copied, with size limits.
//  - Free-text replies are only allowed inside the 24-hour "customer service window"
//    (the customer wrote to the business in the last 24 hours) — Meta's rule.
import crypto from 'node:crypto';

export const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 4096;

/** true only for a valid "sha256=<64 hex>" signature of exactly these bytes. */
export function verifyMetaSignature(rawBody, header, appSecret) {
  if (!appSecret || typeof header !== 'string') return false;
  const m = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!m) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ''), 'utf8');
  const expected = crypto.createHmac('sha256', appSecret).update(body).digest();
  const given = Buffer.from(m[1].toLowerCase(), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
const digitsOnly = (v) => (typeof v === 'string' && /^[0-9]{6,20}$/.test(v) ? v : null);
const toDate = (ts) => {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
};

/** Text we can show for a message of any type (non-text messages get a short label, never the media). */
function textOf(msg) {
  switch (msg.type) {
    case 'text':
      return str(msg.text?.body, MAX_TEXT);
    case 'button':
      return str(msg.button?.text, 500);
    case 'interactive':
      return str(msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title, 500);
    case 'reaction':
      return msg.reaction?.emoji ? `[reaction ${str(msg.reaction.emoji, 10)}]` : null;
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
    case 'location':
    case 'contacts':
      return `[${msg.type}${msg[msg.type]?.caption ? `: ${str(msg[msg.type].caption, 1000)}` : ''} — open WhatsApp to see it]`;
    default:
      return '[unsupported message — open WhatsApp to see it]';
  }
}

/**
 * Meta webhook body → { phoneNumberIds[], messages[], statuses[] } (only what we use).
 * Throws nothing: anything malformed is skipped.
 */
export function parseWhatsAppPayload(json) {
  const out = { phoneNumberIds: [], messages: [], statuses: [] };
  if (!json || json.object !== 'whatsapp_business_account' || !Array.isArray(json.entry)) return out;
  for (const entry of json.entry.slice(0, 20)) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : []).slice(0, 20)) {
      if (change?.field !== 'messages') continue;
      const v = change.value || {};
      const phoneNumberId = digitsOnly(v.metadata?.phone_number_id);
      if (!phoneNumberId) continue;
      if (!out.phoneNumberIds.includes(phoneNumberId)) out.phoneNumberIds.push(phoneNumberId);
      const names = new Map((Array.isArray(v.contacts) ? v.contacts : []).map((c) => [digitsOnly(c?.wa_id), str(c?.profile?.name, 120)]));
      for (const msg of (Array.isArray(v.messages) ? v.messages : []).slice(0, 100)) {
        const from = digitsOnly(msg?.from);
        const id = str(msg?.id, 200);
        if (!from || !id) continue;
        const body = textOf(msg);
        if (!body) continue;
        out.messages.push({ phoneNumberId, from, id, at: toDate(msg.timestamp), type: str(msg.type, 20), body, contactName: names.get(from) || null });
      }
      for (const s of (Array.isArray(v.statuses) ? v.statuses : []).slice(0, 100)) {
        const id = str(s?.id, 200);
        if (!id || !['sent', 'delivered', 'read', 'failed'].includes(s?.status)) continue;
        out.statuses.push({ phoneNumberId, id, status: s.status, at: toDate(s.timestamp) });
      }
    }
  }
  return out;
}

/** "STOP" style replies = the person does not want messages any more (English / Urdu / Roman Urdu). */
const OPT_OUT = /^\s*(stop|stop all|unsubscribe|opt[\s-]?out|cancel|end|quit|band karo|band kro|mat bhejo|message mat karo|بند کرو|بند|رکو)\s*[.!]*\s*$/i;
export const isOptOut = (text) => OPT_OUT.test(String(text || ''));

/** Inside Meta's 24-hour customer-service window? */
export function windowOpen(lastInboundAt, now = new Date()) {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  return Number.isFinite(t) && now.getTime() - t < WINDOW_MS && t <= now.getTime() + 5 * 60 * 1000;
}

/** When the window closes (for the UI), or null. */
export function windowClosesAt(lastInboundAt) {
  if (!lastInboundAt) return null;
  return new Date(new Date(lastInboundAt).getTime() + WINDOW_MS);
}

/** Last 10 digits — same rule as normalizePhone, so a WhatsApp number finds the lead. */
export const phoneKey = (waId) => {
  const d = String(waId || '').replace(/\D/g, '');
  if (d.length < 7 || d.length > 15) return null;
  return d.length > 10 ? d.slice(-10) : d;
};
