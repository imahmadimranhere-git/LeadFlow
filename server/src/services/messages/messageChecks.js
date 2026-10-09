// Safety checks on every draft (AI-written, template or typed). They don't change the text — they FLAG it,
// and some flags block approval until a person fixes or confirms them. Pure functions.
import { quoteIsInEvidence, normalizeForMatch } from '../ai/factCheck.js';

// Topics that always need a careful human look (spec 13.2 / A13)
const SENSITIVE = {
  PRICING: /(\brs\.?\s?\d|\bpkr\b|\$\s?\d|£\s?\d|€\s?\d|\b\d+\s?(k|lakh|lac|crore|million)\b|\bprice[sd]?\b|\bpricing\b|\bcost[s]?\b|\bdiscount|\b\d+\s?%\s?off\b|\bfee[s]?\b|\bquotation\b|\bقیمت)/i,
  CONTRACT: /\b(contract|agreement|terms and conditions|sign(ed|ing)? (the|a|an)\b|nda\b|invoice|legally)/i,
  DEADLINE: /\b(deadline|within \d+\s?(hours?|days?|weeks?)|by (monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|end of)|deliver(ed)? (in|by)|guaranteed delivery|in \d+\s?(days?|weeks?))\b/i,
  GUARANTEE: /\b(guarantee[sd]?|100\s?%|promise[sd]?|risk[- ]free|refund|warranty|no risk|assured)\b/i,
  PROPERTY: /\b(marla|kanal|sq\.?\s?ft|square feet|possession|installments?|plot (is|are) available|file (rate|price)|booking)\b/i,
};

// Pretending a relationship that doesn't exist ("no false personalisation")
const FALSE_FAMILIARITY = /\b(as (we )?discussed|as per our (call|conversation|discussion|chat|meeting)|you (told|asked|mentioned to) (us|me)|following up on our|our (previous|last|earlier) (call|conversation|chat|meeting)|(nice|great|lovely) (talking|speaking|chatting) (to|with) you|thanks for (your|the) (call|time on the phone)|as promised)\b/i;

const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RX = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/gi;
const PHONE_RX = /(?:\+?\d[\d\s().-]{8,}\d)/g;

const hostOf = (u) => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
};
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);

/**
 * @param text    subject + body
 * @param allowed { hosts: [...], emails: [...], phones: [...] } — your own website/socials/email/phone + the lead's
 * @param claims  AI personalisation claims [{ statement, quote }] (empty for templates/manual)
 * @param evidence lead evidence text
 * → { sensitive[], flags[{ code, message, blocking }], unverifiedClaims[] }
 */
export function checkMessage({ text, allowed = {}, claims = [], evidence = '', hasConversation = false }) {
  const t = String(text || '');
  const sensitive = Object.entries(SENSITIVE).filter(([, rx]) => rx.test(t)).map(([k]) => k);
  const flags = [];

  if (/\{\{[^}]*\}\}|\[\[|\bTODO\b|\[(name|company|your name)\]/i.test(t)) {
    flags.push({ code: 'UNFILLED_PLACEHOLDER', message: 'There is a placeholder left in the text — fill it in before approving.', blocking: true });
  }
  if (!hasConversation && FALSE_FAMILIARITY.test(t)) {
    flags.push({ code: 'FALSE_FAMILIARITY', message: 'Mentions a previous conversation/promise that never happened.', blocking: true });
  }

  const hosts = new Set((allowed.hosts || []).map(hostOf).filter(Boolean));
  const unknownLinks = [...t.matchAll(URL_RX)].map((m) => m[0]).filter((u) => {
    const h = hostOf(u);
    return !h || ![...hosts].some((a) => h === a || h.endsWith(`.${a}`));
  });
  if (unknownLinks.length) flags.push({ code: 'UNKNOWN_LINK', message: `Link(s) not from your company or the lead: ${unknownLinks.slice(0, 3).join(', ')}`, blocking: true });

  const emails = new Set((allowed.emails || []).map((e) => String(e).toLowerCase()));
  const unknownEmails = [...t.matchAll(EMAIL_RX)].map((m) => m[0].toLowerCase()).filter((e) => !emails.has(e));
  if (unknownEmails.length) flags.push({ code: 'UNKNOWN_CONTACT', message: `Email address(es) that are not yours or the lead's: ${unknownEmails.slice(0, 3).join(', ')}`, blocking: true });

  const phones = new Set((allowed.phones || []).map(digits).filter((d) => d.length >= 7));
  const unknownPhones = [...t.replace(EMAIL_RX, ' ').replace(URL_RX, ' ').matchAll(PHONE_RX)].map((m) => m[0]).filter((p) => digits(p).length >= 9 && !phones.has(digits(p)));
  if (unknownPhones.length) flags.push({ code: 'UNKNOWN_CONTACT', message: `Phone number(s) that are not yours or the lead's: ${unknownPhones.slice(0, 3).join(', ')}`, blocking: true });

  const unverifiedClaims = (claims || []).filter((c) => !c.quote || !quoteIsInEvidence(c.quote, evidence));
  if (unverifiedClaims.length) {
    flags.push({ code: 'UNVERIFIED_CLAIM', message: `${unverifiedClaims.length} personal statement(s) could not be matched to the lead's evidence.`, blocking: false });
  }
  if (sensitive.length) {
    flags.push({ code: 'SENSITIVE', message: `Mentions ${sensitive.map((s) => s.toLowerCase()).join(', ')} — check every number, date and promise.`, blocking: false });
  }
  return { sensitive, flags, unverifiedClaims };
}

/** Normalised fingerprint → the same text isn't created twice for one lead. */
export const textFingerprint = (s) => normalizeForMatch(s).slice(0, 2000);
