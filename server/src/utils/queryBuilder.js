// Safe helpers to turn VALIDATED user input into Mongo queries.
// Rule: never pass req.query / req.body directly to Mongo. Always go through these.

/** Only allow-listed fields, only primitive values (no objects → no operators). */
export function buildFilter(input = {}, allowedFields = []) {
  const filter = {};
  for (const field of allowedFields) {
    const value = input[field];
    if (value === undefined || value === null || value === '') continue;
    const type = typeof value;
    if (type === 'string' || type === 'number' || type === 'boolean') filter[field] = value;
  }
  return filter;
}

/** "-createdAt" → { createdAt: -1 }. Unknown fields fall back to the default. */
export function buildSort(sort, allowedFields = [], fallback = '-createdAt') {
  const candidate = typeof sort === 'string' ? sort : '';
  const chosen = allowedFields.includes(candidate.replace(/^-/, '')) ? candidate : fallback;
  const field = chosen.replace(/^-/, '');
  return { [field]: chosen.startsWith('-') ? -1 : 1 };
}

export function buildPagination(page = 1, limit = 20) {
  return { skip: (page - 1) * limit, limit };
}

/** Escape regex special chars so user text is matched literally (prevents ReDoS / regex injection). */
export function escapeRegex(text = '') {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "starts with" search on user text, length-capped. */
export function prefixSearch(text, maxLength = 100) {
  return new RegExp(`^${escapeRegex(String(text).slice(0, maxLength))}`, 'i');
}
