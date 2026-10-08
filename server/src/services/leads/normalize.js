// Normalising contact details so duplicates are found even when written differently:
//   "Info@Acme.com " = "info@acme.com"   ·   "https://www.Acme.com/about" = "acme.com"
//   "+92 300-1234567" = "923001234567"   ·   "instagram.com/Acme/" = "instagram.com/acme"
// Pure functions (no database) → easy to unit-test.

export function normalizeEmail(email) {
  if (!email) return null;
  const e = String(email).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

function parseUrlish(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

/** Website → bare host without "www." (the business identity), e.g. "acme.com" */
export function normalizeWebsite(website) {
  const url = parseUrlish(website);
  if (!url || !['http:', 'https:'].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return host.includes('.') ? host : null;
}

/** Domain of an email, unless it is a free mailbox (gmail.com etc. would match everyone) */
const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'aol.com', 'proton.me', 'protonmail.com', 'yandex.com', 'mail.com', 'gmx.com']);
export function businessDomainOfEmail(email) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const domain = e.split('@')[1];
  return FREE_MAIL.has(domain) ? null : domain;
}

/**
 * Phone → a comparison key: digits only, and for long numbers only the LAST 10 digits.
 * Why: "0300 1234567", "+92 300 1234567" and "0092 300 1234567" are the same phone, but one has the
 * country code and the other a leading 0. The last 10 digits are the same in all of them — in Pakistan,
 * the UK, the US, India, the Gulf... — so no country setting is needed. (Two different countries'
 * numbers with the same last 10 digits inside ONE company's leads is extremely unlikely.)
 */
export function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Social profile → "host/path" lowercase, no query/fragment/trailing slash, no "www." / "m." */
export function normalizeSocial(url) {
  const u = parseUrlish(url);
  if (!u || !['http:', 'https:'].includes(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  const path = u.pathname.toLowerCase().replace(/\/+$/, '');
  return path ? `${host}${path}` : null;
}

/** "Acme Ltd." + "Islamabad" → "acme ltd|islamabad" (weak match: same company name in same city) */
export function companyCityKey(companyName, city) {
  const clean = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const c = clean(companyName);
  const t = clean(city);
  return c && t ? `${c}|${t}` : null;
}

/** All identity keys of a lead, used for duplicate checks + indexes. */
export function identityKeys(lead) {
  return {
    emailNormalized: normalizeEmail(lead.email),
    websiteNormalized: normalizeWebsite(lead.website),
    phoneNormalized: normalizePhone(lead.phone),
    socialNormalized: normalizeSocial(lead.socialProfileUrl),
    companyCityKey: companyCityKey(lead.companyName, lead.city),
  };
}

// ---------------------------------------------------------------- prompt-injection flag

// Public posts / websites / CSV notes may contain text written to trick our AI later
// ("ignore previous instructions..."). We only FLAG it here; the AI phases treat all lead text as data.
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)/i,
  /disregard\s+(all\s+|the\s+)?(previous|prior|above)\s+/i,
  /\b(system|developer)\s+prompt\b/i,
  /\byou\s+are\s+now\s+(a|an|the)\b/i,
  /<\s*\/?\s*(script|iframe|system|instructions?)\b/i,
  /\bnew\s+instructions\s*:/i,
  /\bdo\s+not\s+follow\s+(your|the)\s+(rules|instructions)/i,
];

export function looksLikePromptInjection(...texts) {
  return texts.some((t) => typeof t === 'string' && t.length > 0 && INJECTION_PATTERNS.some((rx) => rx.test(t)));
}
