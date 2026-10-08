// Turns the company's settings into DIFFERENT queries per source (spec A2), without duplicates.
//   Web search:      "looking for web developer" "Islamabad"   ·  "website developer" "Islamabad" "real estate"
//   Local business:  "Dentist in Manchester, UK"
//   Instagram:       #needaplot (Phase 11)
// Pure function → easy to test. Every query remembers WHY it was built (matched keyword/phrase/location).

const quote = (s) => `"${String(s).replace(/"/g, '').trim()}"`;

export function buildQueries(settings, source, { max = 10 } = {}) {
  const d = settings?.discovery || {};
  const icp = settings?.icp || {};
  const cities = (icp.cities?.length ? icp.cities : icp.countries || []).slice(0, 5);
  const locations = cities.length ? cities : [null];
  const negatives = (d.negativeKeywords || []).filter((n) => !/\s/.test(n)).slice(0, 5); // single words work as -term
  const out = [];
  const seen = new Set();
  const add = (q) => {
    const key = q.query.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key) && out.length < max) {
      seen.add(key);
      out.push(q);
    }
  };

  if (source === 'GOOGLE_WEB') {
    const neg = negatives.map((n) => `-${n}`).join(' ');
    const withNeg = (q) => (neg ? `${q} ${neg}` : q);
    // 1) explicit buyer intent + location → most valuable
    for (const phrase of (d.intentPhrases || []).slice(0, 10)) {
      for (const loc of locations) add({ query: withNeg([quote(phrase), loc && quote(loc)].filter(Boolean).join(' ')), matchedIntentPhrase: phrase, location: loc });
    }
    // 2) keyword + location + industry
    const industries = icp.industries?.length ? icp.industries.slice(0, 3) : [null];
    for (const kw of (d.keywords || []).slice(0, 10)) {
      for (const loc of locations) {
        for (const ind of industries) add({ query: withNeg([quote(kw), loc && quote(loc), ind && quote(ind)].filter(Boolean).join(' ')), matchedKeyword: kw, location: loc });
      }
    }
  } else if (source === 'LOCAL_BUSINESS') {
    const country = icp.countries?.[0];
    for (const type of [...(icp.businessTypes || []), ...(icp.industries || [])].slice(0, 10)) {
      for (const city of (icp.cities?.length ? icp.cities : [null]).slice(0, 5)) {
        add({ query: [type, city && `in ${city}`, country && `, ${country}`].filter(Boolean).join(' ').replace(' ,', ','), matchedKeyword: type, location: city });
      }
    }
  } else if (source === 'INSTAGRAM') {
    for (const tag of (d.hashtags || []).slice(0, max)) add({ query: `#${tag}`, matchedHashtag: tag });
  }
  return out;
}
