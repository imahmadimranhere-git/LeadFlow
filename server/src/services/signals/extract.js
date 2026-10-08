// Extracts ONLY what the author publicly wrote in the post text (A28 rule (a)):
// emails, phone/WhatsApp numbers, website links and hashtags. Nothing is looked up, guessed or enriched.
// Pure functions → unit-tested.

const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;
// phone-like: optional +, 10–15 digits possibly separated by spaces, dashes, dots or brackets
const PHONE_RX = /(?:\+|00)?\d[\d\s\-().]{8,20}\d/g;
const URL_RX = /\bhttps?:\/\/[^\s<>"')]+/gi;
const HASHTAG_RX = /#([\p{L}\p{M}\p{N}_]{1,60})/gu;
const WHATSAPP_HINT = /(whats\s?app|wa\.me|واٹس\s?ایپ|watsapp)/i;

const uniq = (arr) => [...new Set(arr)];

export function extractHashtags(text) {
  return uniq([...String(text || '').matchAll(HASHTAG_RX)].map((m) => m[1].normalize('NFKC').toLocaleLowerCase())).slice(0, 50);
}

/**
 * @returns {Array<{type:'EMAIL'|'PHONE'|'WHATSAPP'|'WEBSITE', value:string}>}
 * Phones need 10–15 digits (avoids prices, dates, plot sizes like "5 marla" or "2025").
 */
export function extractPublicContacts(text) {
  const t = String(text || '').slice(0, 10000);
  const out = [];

  for (const email of uniq((t.match(EMAIL_RX) || []).map((e) => e.toLowerCase()))) out.push({ type: 'EMAIL', value: email });

  const textWithoutEmailsAndUrls = t.replace(EMAIL_RX, ' ').replace(URL_RX, ' ');
  const whatsappContext = WHATSAPP_HINT.test(t);
  for (const raw of uniq(textWithoutEmailsAndUrls.match(PHONE_RX) || [])) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) continue;
    if (/^(\d)\1+$/.test(digits)) continue; // 0000000000 etc.
    out.push({ type: whatsappContext ? 'WHATSAPP' : 'PHONE', value: raw.trim() });
  }

  for (const url of uniq(t.match(URL_RX) || [])) {
    const clean = url.replace(/[.,;:!?]+$/, '');
    try {
      const u = new URL(clean);
      if (u.hostname === 'wa.me') out.push({ type: 'WHATSAPP', value: `+${u.pathname.replace(/\D/g, '')}` });
      else out.push({ type: 'WEBSITE', value: clean.slice(0, 2048) });
    } catch {
      /* not a valid URL → ignore */
    }
  }
  return out.slice(0, 20);
}

/**
 * A30 accuracy label: how complete is what the SOURCE gave us?
 * COMPLETE = author + public contact · PARTIAL = one of them · MINIMAL = neither (post text only)
 */
export function dataCompleteness({ authorProvided, contactCount }) {
  const reasons = [];
  if (!authorProvided) reasons.push('The source did not provide who posted this');
  if (!contactCount) reasons.push('No public contact found in the post');
  const level = authorProvided && contactCount ? 'COMPLETE' : authorProvided || contactCount ? 'PARTIAL' : 'MINIMAL';
  return { level, reasons };
}
