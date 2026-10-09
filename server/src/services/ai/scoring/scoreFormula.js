// Lead score = YOUR formula, not the AI's opinion.
//
//   1. Each factor gets a value 0–10:
//        - from DATA (computed by the server, no AI): contactability, location match, industry match,
//          profile completeness  (website condition arrives with the Website Audit, Phase 16)
//        - from the AI, but ONLY with an exact quote from the evidence for anything above 3
//   2. score = Σ(weight × value) / Σ(weight × 10) × 100   — over the factors that HAVE a value
//      (a factor we know nothing about is left out, not counted as 0 or 10)
//   3. The AI never sends a score — there is no "score" field it could fill.
// Pure functions → tested without a database.
import { quoteIsInEvidence, normalizeForMatch } from '../factCheck.js';

export const AI_FACTORS = ['explicitBuyerIntent', 'businessRelevance', 'serviceMatch', 'publicActivity', 'evidenceStrength'];
export const DATA_FACTORS = ['contactability', 'locationMatch', 'industryMatch', 'profileCompleteness', 'websiteCondition'];
export const FACTOR_LABEL = {
  explicitBuyerIntent: 'Explicit buyer intent',
  websiteCondition: 'Website condition',
  businessRelevance: 'Business relevance',
  serviceMatch: 'Service match',
  industryMatch: 'Industry match',
  locationMatch: 'Location match',
  contactability: 'Contactability',
  publicActivity: 'Public activity',
  evidenceStrength: 'Evidence strength',
  profileCompleteness: 'Profile completeness',
};
export const MIN_VALUE_WITHOUT_QUOTE = 3; // a factor above this needs proof

const has = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const inList = (value, list) => {
  const v = normalizeForMatch(value);
  return (list || []).some((x) => normalizeForMatch(x) === v);
};

/** Factors computed from the lead's own fields + the company's ICP (no AI, no guessing). */
export function dataFactors(lead, settings = {}, { websiteAudit = null } = {}) {
  const icp = settings.icp || {};
  const out = {};

  const channels = [has(lead.email), has(lead.phone), has(lead.website), has(lead.socialProfileUrl) || has(lead.postUrl)].filter(Boolean).length;
  out.contactability = lead.doNotContact
    ? { value: 0, reason: 'On your do-not-contact list' }
    : { value: Math.min(10, channels * 3 + (channels ? 1 : 0)), reason: channels ? `${channels} way(s) to reach them` : 'No contact details' };

  const cities = icp.cities || [];
  const countries = icp.countries || [];
  if (!cities.length && !countries.length) out.locationMatch = { value: null, reason: 'No target locations set in your Ideal customers' };
  else if (!has(lead.city) && !has(lead.country)) out.locationMatch = { value: null, reason: 'Lead location unknown' };
  else if (has(lead.city) && inList(lead.city, cities)) out.locationMatch = { value: 10, reason: `${lead.city} is a target city` };
  else if (has(lead.country) && inList(lead.country, countries)) out.locationMatch = { value: 7, reason: `${lead.country} is a target country` };
  else out.locationMatch = { value: 0, reason: 'Outside your target locations' };

  const industries = icp.industries || [];
  if (!industries.length) out.industryMatch = { value: null, reason: 'No target industries set' };
  else if (!has(lead.industry)) out.industryMatch = { value: null, reason: 'Lead industry unknown' };
  else out.industryMatch = inList(lead.industry, industries) ? { value: 10, reason: `${lead.industry} is a target industry` } : { value: 0, reason: 'Not a target industry' };

  const fields = ['name', 'companyName', 'personName', 'city', 'country', 'industry', 'website', 'description'];
  const filled = fields.filter((f) => has(lead[f])).length;
  out.profileCompleteness = { value: Math.round((filled / fields.length) * 10), reason: `${filled} of ${fields.length} profile fields filled` };

  // "Website condition" = opportunity: the WEAKER their website, the HIGHER this value
  // (useful if you sell web/SEO services — give it weight 0 otherwise)
  if (websiteAudit && Number.isFinite(websiteAudit.score)) {
    out.websiteCondition = { value: Math.max(0, Math.min(10, Math.round((100 - websiteAudit.score) / 10))), reason: `Website audit ${websiteAudit.score}/100 — ${websiteAudit.issues?.length || 0} issue(s) observed` };
  } else {
    out.websiteCondition = { value: null, reason: lead.website ? 'Website not audited yet' : 'No website on the lead' };
  }
  for (const k of Object.keys(out)) out[k].source = 'DATA';
  return out;
}

/**
 * Checks the AI's factors: values above 3 need a quote that is really in the evidence; otherwise the
 * value is capped at 3 and marked unsupported. Also enforces consistency of intent / leadType / service.
 */
export function verifyAiScoring(ai, evidence, services = [], { suspicious = false } = {}) {
  const factors = {};
  let unsupported = 0;
  for (const key of AI_FACTORS) {
    const f = ai.factors?.[key] || { value: 0, reason: '', quote: null };
    const quoted = f.quote && quoteIsInEvidence(f.quote, evidence);
    let value = Math.max(0, Math.min(10, Math.round(f.value)));
    let flag = false;
    // the text tries to talk to the AI → its "proof" can't be trusted either: no AI factor above 3
    if (value > MIN_VALUE_WITHOUT_QUOTE && (!quoted || suspicious)) {
      value = MIN_VALUE_WITHOUT_QUOTE;
      flag = true;
      unsupported += 1;
    }
    factors[key] = { value, reason: f.reason || '', quote: quoted ? f.quote : null, source: 'AI', unsupported: flag, ...(flag && suspicious ? { suspicious: true } : {}) };
  }

  const explicit = factors.explicitBuyerIntent;
  const strongIntent = explicit.value >= 7 && explicit.quote && !explicit.unsupported;
  let intent = ai.intent;
  if (intent === 'HIGH' && !strongIntent) intent = 'MEDIUM';
  let leadType = ai.leadType;
  if (leadType === 'EXPLICIT_BUYER_INTENT' && !strongIntent) leadType = 'POSSIBLE_OPPORTUNITY';
  const potentialService = ai.potentialService && inList(ai.potentialService, services) ? services.find((s) => normalizeForMatch(s) === normalizeForMatch(ai.potentialService)) : null;

  return { factors, intent, leadType, potentialService, unsupported };
}

/** The configurable formula. Returns { score (0-100 or null), used, excluded }. */
export function computeScore(factors, weights) {
  let num = 0;
  let den = 0;
  const used = [];
  const excluded = [];
  for (const [key, f] of Object.entries(factors)) {
    const w = Number(weights?.[key] || 0);
    if (w <= 0) continue;
    if (f.value === null || f.value === undefined) {
      excluded.push(key);
      continue;
    }
    num += w * f.value;
    den += w * 10;
    used.push(key);
  }
  return { score: den ? Math.round((num / den) * 100) : null, used, excluded };
}

/** Plain-language reason, built from the breakdown (not written by the AI). */
export function buildReason(factors, weights, { score }) {
  const lines = [];
  const ranked = Object.entries(factors)
    .filter(([k, f]) => Number(weights?.[k]) > 0 && f.value !== null)
    .sort((a, b) => Number(weights[b[0]]) * b[1].value - Number(weights[a[0]]) * a[1].value);
  for (const [k, f] of ranked.slice(0, 5)) {
    lines.push(`${FACTOR_LABEL[k]}: ${f.value}/10${f.unsupported ? ' (capped — no proof in the evidence)' : ''} — ${f.reason}${f.quote ? ` [“${f.quote.slice(0, 120)}”]` : ''}`);
  }
  const missing = Object.entries(factors).filter(([k, f]) => Number(weights?.[k]) > 0 && f.value === null).map(([k]) => FACTOR_LABEL[k]);
  if (missing.length) lines.push(`Not counted (no data): ${missing.join(', ')}`);
  return `${score === null ? 'No score' : `Score ${score}/100`} — your weights × the factors below.\n${lines.join('\n')}`.slice(0, 2000);
}
