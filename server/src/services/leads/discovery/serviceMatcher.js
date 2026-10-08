// Which of the company's services does this text relate to? Simple word-overlap scoring (no AI).
const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'our', 'your', 'we', 'you', 'is', 'are']);
const words = (s) => (String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 2 && !STOP.has(w));

/** @returns {string|null} the best matching service name, or null if nothing really matches */
export function matchService(text, services = []) {
  const textWords = new Set(words(text));
  let best = null;
  let bestScore = 0;
  for (const s of services) {
    const nameWords = words(s.name);
    if (!nameWords.length) continue;
    const hits = nameWords.filter((w) => textWords.has(w) || textWords.has(w.replace(/s$/, ''))).length;
    const score = hits / nameWords.length;
    if (hits > 0 && score > bestScore) {
      best = s.name;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}
