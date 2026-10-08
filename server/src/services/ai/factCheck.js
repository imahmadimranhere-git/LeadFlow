// "No false personalisation": every FACT the AI returns must quote the evidence word for word.
// If the quote is not really in the evidence, the fact is DROPPED (and counted), never shown.
export const FACT_LABELS = ['REQUIREMENT', 'LOCATION', 'BUDGET', 'TIMELINE', 'SIZE', 'CONTACT_PREFERENCE', 'OTHER'];
const REQUIREMENT_FROM_LABEL = { REQUIREMENT: 'service', LOCATION: 'location', BUDGET: 'budget', TIMELINE: 'timeline', SIZE: 'size' };

export const normalizeForMatch = (s) =>
  String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

export function quoteIsInEvidence(quote, evidence) {
  const q = normalizeForMatch(quote);
  if (q.length < 3) return false; // "a" or "" proves nothing
  return normalizeForMatch(evidence).includes(q);
}

/**
 * Keeps only facts whose quote is in the evidence, and only those statedRequirement fields that are
 * backed by a kept fact of the matching label. Returns { result, dropped }.
 */
export function verifyFacts(result, evidence) {
  const kept = [];
  let dropped = 0;
  for (const f of result.facts || []) {
    if (quoteIsInEvidence(f.quote, evidence)) kept.push(f);
    else dropped += 1;
  }
  const backed = new Set(kept.map((f) => REQUIREMENT_FROM_LABEL[f.label]).filter(Boolean));
  const stated = {};
  for (const key of ['service', 'location', 'budget', 'timeline', 'size']) {
    const v = result.statedRequirement?.[key] ?? null;
    if (v !== null && !backed.has(key)) dropped += 1;
    stated[key] = v !== null && backed.has(key) ? v : null;
  }
  return { result: { ...result, facts: kept, statedRequirement: stated }, dropped };
}
