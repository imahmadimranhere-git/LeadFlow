// Pure helpers (no chrome.* APIs → tested from server/tests/extensionExtract.test.js).
// They turn what is VISIBLE on the page the user opened (a Google Maps place, or text the user
// selected) into suggested form values. Nothing is looked up elsewhere; the user checks and saves.

const MAPS_HOST = /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/i;

/** A single Google Maps place page (not the search list). */
export function isMapsPlaceUrl(url) {
  try {
    const u = new URL(url);
    return MAPS_HOST.test(u.hostname) && /^\/maps\/place\//.test(u.pathname);
  } catch {
    return false;
  }
}

/** A Google Maps page that is NOT a single place (search results list, plain map). */
export function isMapsListUrl(url) {
  try {
    const u = new URL(url);
    return MAPS_HOST.test(u.hostname) && /^\/maps(\/|$)/.test(u.pathname) && !isMapsPlaceUrl(url);
  } catch {
    return false;
  }
}

/** "Ideal Rent a Car - Google Maps" → "Ideal Rent a Car" */
export const cleanTitle = (title) => String(title || '').replace(/\s*[-–|]\s*Google\s+Maps\s*$/i, '').trim();

const oneLine = (s, max) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Google wraps some outgoing links: https://www.google.com/url?q=https://site.pk/ → https://site.pk/ */
export function unwrapGoogleLink(href) {
  try {
    const u = new URL(href);
    if (MAPS_HOST.test(u.hostname) && u.pathname === '/url') {
      const q = u.searchParams.get('q') || u.searchParams.get('url');
      if (q && /^https?:\/\//i.test(q)) return q;
    }
    return /^https?:\/\//i.test(href) ? href : '';
  } catch {
    return '';
  }
}

/** Keeps only what the server accepts as a phone: digits, spaces, + - ( ) . */
export function cleanPhone(raw) {
  const s = String(raw || '').replace(/[^\d+\s\-().]/g, ' ').replace(/\s+/g, ' ').trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  return /^\+?[0-9][0-9\s\-().]{5,24}$/.test(s) ? s : '';
}

const COUNTRIES = /^(pakistan|india|bangladesh|uae|united arab emirates|saudi arabia|qatar|oman|uk|united kingdom|usa|united states|australia|canada|new zealand|ireland|germany|france)$/i;

/** "Office 13-A, G-10 Markaz, Islamabad 44000, Pakistan" → "Islamabad" */
export function cityFromAddress(address) {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  let i = parts.length - 1;
  if (COUNTRIES.test(parts[i])) i -= 1;
  if (i < 1) return '';
  // drop post codes / plus codes / state abbreviations: "Islamabad 44000" → "Islamabad", "NSW 2000" → ""
  const city = parts[i].replace(/\b[A-Z0-9]{4,8}\+[A-Z0-9]{2,3}\b/g, '').replace(/\b\d{3,6}\b/g, '').replace(/\s+/g, ' ').trim();
  if (!city || /^[A-Z]{2,3}$/.test(city)) return i >= 2 ? cityFromAddress(parts.slice(0, i).join(', ')) : '';
  return city.slice(0, 60);
}

const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
const PHONE_RX = /(?:\+|00)?\d[\d\s\-().]{6,20}\d/g;
const SITE_RX = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9-]{1,63})*\.[a-z]{2,24}(?:\/[^\s,;)]*)?/gi;
const NOT_A_BUSINESS_SITE = /(^|\.)(google\.[a-z.]+|goo\.gl|facebook\.com|fb\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|wa\.me|whatsapp\.com|gmail\.com|yahoo\.com|hotmail\.com|outlook\.com)$/i;

/** Phones, e-mails and websites written in a piece of text (the user's selection). */
export function contactsFromText(text) {
  const t = String(text || '').slice(0, 5000);
  const emails = [...new Set((t.match(EMAIL_RX) || []).map((e) => e.toLowerCase()))];
  const withoutEmails = t.replace(EMAIL_RX, ' ');
  const phones = [...new Set((withoutEmails.match(PHONE_RX) || []).map(cleanPhone).filter(Boolean))];
  const websites = [];
  for (const m of withoutEmails.match(SITE_RX) || []) {
    const href = /^https?:\/\//i.test(m) ? m : `https://${m}`;
    try {
      const host = new URL(href).hostname.replace(/^www\./, '');
      if (/^\d+(\.\d+)+$/.test(host) || NOT_A_BUSINESS_SITE.test(host)) continue;
      if (!websites.includes(host)) websites.push(host);
    } catch {
      // not a URL
    }
  }
  return { phones, emails, websites };
}

/**
 * Suggested form values for the page the user opened.
 * page = { url, title, selection, maps? } where maps = raw values read from the open Maps place panel.
 * Returns only fields we could actually see; the popup fills EMPTY inputs only.
 */
export function suggestFields(page) {
  const out = {};
  const notes = [];
  const fromText = contactsFromText(page?.selection);
  const m = page?.maps;

  if (m && isMapsPlaceUrl(page.url)) {
    const name = oneLine(m.name, 150) || cleanTitle(page.title);
    if (name) {
      out.name = name;
      out.companyName = name;
    }
    out.profileType = 'BUSINESS';
    out.contactSource = 'BUSINESS_CONTACT_BUTTON';
    const phone = cleanPhone(m.phone);
    if (phone) out.phone = phone;
    const site = unwrapGoogleLink(m.website || '');
    if (site) {
      try {
        out.website = new URL(site).hostname.replace(/^www\./, '');
      } catch {
        // ignore
      }
    }
    const address = oneLine(String(m.address || '').replace(/^address:\s*/i, ''), 300);
    const city = cityFromAddress(address);
    if (city) out.city = city;

    const facts = ['Google Maps'];
    if (m.category) facts.push(oneLine(m.category, 80));
    const rating = /(\d(?:[.,]\d)?)/.exec(String(m.rating || ''))?.[1];
    const reviews = /([\d,.]+)/.exec(String(m.reviews || '').replace(/[()]/g, ''))?.[1];
    if (rating) facts.push(`⭐ ${rating.replace(',', '.')}${reviews ? ` (${reviews} reviews)` : ''}`);
    notes.push(facts.join(' · '));
    if (address) notes.push(`Address: ${address}`);
    notes.push(out.website ? `Website: ${out.website}` : 'NO WEBSITE on Google Maps');
  } else if (isMapsPlaceUrl(page?.url)) {
    const name = cleanTitle(page.title);
    if (name) {
      out.name = name;
      out.companyName = name;
    }
    out.profileType = 'BUSINESS';
    out.contactSource = 'BUSINESS_CONTACT_BUTTON';
  }

  if (!out.phone && fromText.phones[0]) out.phone = fromText.phones[0];
  if (!out.email && fromText.emails[0]) out.email = fromText.emails[0];
  if (!out.website && fromText.websites[0]) out.website = fromText.websites[0];
  if (notes.length) out.notes = notes.join('\n').slice(0, 2000);
  return out;
}
