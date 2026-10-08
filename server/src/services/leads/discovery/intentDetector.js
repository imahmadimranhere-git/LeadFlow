// Finds which of the company's keywords / buyer-intent phrases / hashtags / negative keywords
// actually appear in a piece of text. Pure function — no AI, no guessing: if the phrase isn't in the
// text, it isn't reported. (AI-based analysis comes in Phase 14 and must also stay evidence-based.)

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Phrase match on word boundaries, case-insensitive, works for non-English letters too. */
function containsPhrase(text, phrase) {
  if (!phrase) return false;
  const rx = new RegExp(`(^|[^\\p{L}\\p{N}_])${escape(phrase.trim()).replace(/\s+/g, '\\s+')}($|[^\\p{L}\\p{N}_])`, 'iu');
  return rx.test(text);
}

function containsHashtag(text, tag) {
  return new RegExp(`#${escape(tag)}($|[^\\p{L}\\p{M}\\p{N}_])`, 'iu').test(text);
}

/**
 * @returns {{ matchedIntentPhrase, matchedKeyword, matchedHashtag, negativeKeyword, intentLevel: 'HIGH'|'MEDIUM'|'LOW'|'NONE' }}
 * HIGH   = a buyer-intent phrase is literally in the text ("looking for a web developer")
 * MEDIUM = a keyword or hashtag matched
 * NONE   = nothing matched
 */
export function detectIntent(text, { keywords = [], intentPhrases = [], hashtags = [], negativeKeywords = [] } = {}) {
  const t = String(text || '');
  const matchedIntentPhrase = intentPhrases.find((p) => containsPhrase(t, p)) || null;
  const matchedKeyword = keywords.find((k) => containsPhrase(t, k)) || null;
  const matchedHashtag = hashtags.find((h) => containsHashtag(t, h)) || null;
  const negativeKeyword = negativeKeywords.find((n) => containsPhrase(t, n)) || null;
  let intentLevel = 'NONE';
  if (matchedIntentPhrase) intentLevel = 'HIGH';
  else if (matchedKeyword || matchedHashtag) intentLevel = 'MEDIUM';
  return { matchedIntentPhrase, matchedKeyword, matchedHashtag, negativeKeyword, intentLevel };
}
