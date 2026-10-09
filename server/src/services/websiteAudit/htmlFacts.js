// Reads FACTS from a page's HTML — no browser, no JavaScript execution, no dependencies.
// Only what is really in the HTML is reported; anything we can't see is "not checked", never "bad".
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©' };
export function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d{1,7});/g, (_, n) => safeChar(Number(n)))
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
function safeChar(code) {
  try {
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

const clean = (s, max = 300) => decodeEntities(String(s || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, max);

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '').trim() : null;
}
const tagsOf = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);

const CTA_RX = /\b(contact|call( us| now)?|book|order|buy|shop now|get (a |your )?(free )?(quote|estimate|started)|whatsapp|appointment|enquir|inquir|sign ?up|subscribe|hire|request|schedule|reserve|add to cart|checkout)\b/i;

/** → facts object (all strings capped, counts as numbers) */
export function extractFacts(html, pageUrl) {
  const raw = String(html || '').slice(0, 2_000_000);
  const doc = raw.replace(/<!--[\s\S]*?-->/g, '');
  const page = safeUrl(pageUrl);

  const htmlTag = (doc.match(/<html\b[^>]*>/i) || [''])[0];
  const metas = tagsOf(doc, 'meta').map((t) => ({ name: (attr(t, 'name') || attr(t, 'property') || '').toLowerCase(), content: attr(t, 'content'), httpEquiv: attr(t, 'http-equiv') }));
  const meta = (n) => metas.find((m) => m.name === n)?.content ?? null;
  const linkTags = tagsOf(doc, 'link').map((t) => ({ rel: (attr(t, 'rel') || '').toLowerCase(), href: attr(t, 'href') }));

  const title = clean((doc.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1], 300) || null;
  const h1s = [...doc.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => clean(m[1], 150)).filter(Boolean);

  const imgs = tagsOf(doc, 'img');
  const imgMissingAlt = imgs.filter((t) => attr(t, 'alt') === null).length;

  const anchors = [...doc.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({ href: attr(` ${m[1]}`, 'href') || '', text: clean(m[2], 80) }));
  const buttons = [...doc.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => clean(m[1], 80));
  const inputsSubmit = tagsOf(doc, 'input').filter((t) => /type\s*=\s*["']?submit/i.test(t)).map((t) => attr(t, 'value') || '');

  const tel = anchors.filter((a) => /^tel:/i.test(a.href)).map((a) => a.href.slice(4, 40));
  const mailto = anchors.filter((a) => /^mailto:/i.test(a.href)).map((a) => a.href.slice(7).split('?')[0].slice(0, 100));
  const whatsapp = anchors.filter((a) => /^(https?:)?\/\/(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com)\//i.test(a.href)).length;

  const text = clean(doc.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' '), 200_000);
  const emailsInText = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) => e.toLowerCase()))].slice(0, 5);
  const copyright = text.match(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})/i);

  const ctas = [...new Set([...anchors.map((a) => a.text), ...buttons, ...inputsSubmit].filter((t) => t && t.length <= 60 && CTA_RX.test(t)))].slice(0, 5);

  const internalLinks = [];
  for (const a of anchors) {
    const u = page && safeUrl(a.href, page);
    if (!u || !['http:', 'https:'].includes(u.protocol) || u.hostname !== page.hostname) continue;
    u.hash = '';
    const s = u.toString();
    if (s !== page.toString() && !internalLinks.includes(s)) internalLinks.push(s);
    if (internalLinks.length >= 30) break;
  }

  let mixedContent = [];
  if (page?.protocol === 'https:') {
    const resources = [
      ...tagsOf(doc, 'img').map((t) => attr(t, 'src')),
      ...tagsOf(doc, 'script').map((t) => attr(t, 'src')),
      ...tagsOf(doc, 'iframe').map((t) => attr(t, 'src')),
      ...linkTags.filter((l) => /stylesheet|icon/.test(l.rel)).map((l) => l.href),
    ];
    mixedContent = [...new Set(resources.filter((r) => r && /^http:\/\//i.test(r)))].slice(0, 5);
  }

  return {
    title,
    metaDescription: meta('description') ? clean(meta('description'), 400) : null,
    viewport: meta('viewport'),
    robotsMeta: meta('robots'),
    lang: attr(htmlTag, 'lang'),
    h1s: h1s.slice(0, 5),
    h1Count: h1s.length,
    images: imgs.length,
    imagesMissingAlt: imgMissingAlt,
    canonical: linkTags.find((l) => l.rel.split(/\s+/).includes('canonical'))?.href || null,
    favicon: linkTags.some((l) => l.rel.split(/\s+/).includes('icon')),
    ogTitle: meta('og:title'),
    structuredData: /<script\b[^>]*type\s*=\s*["']application\/ld\+json/i.test(doc),
    scriptsExternal: tagsOf(doc, 'script').filter((t) => attr(t, 'src')).length,
    forms: tagsOf(doc, 'form').length,
    tel: [...new Set(tel)].slice(0, 3),
    mailto: [...new Set(mailto)].slice(0, 3),
    whatsapp,
    emailsInText,
    ctas,
    copyrightYear: copyright ? Number(copyright[1]) : null,
    wordCount: text ? text.split(/\s+/).length : 0,
    internalLinks,
    mixedContent,
  };
}

function safeUrl(u, base) {
  try {
    return new URL(u, base);
  } catch {
    return null;
  }
}

/** Minimal robots.txt reader: does "User-agent: *" (or ours) disallow the homepage? */
export function robotsDisallowsHome(robotsTxt, userAgentToken = 'leadflowauditbot') {
  const groups = [];
  let current = null;
  for (const rawLine of String(robotsTxt || '').split(/\r?\n/).slice(0, 2000)) {
    const line = rawLine.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = m;
    if (key.toLowerCase() === 'user-agent') {
      if (!current || current.rules.length) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
    } else if (current && ['allow', 'disallow'].includes(key.toLowerCase())) {
      current.rules.push({ type: key.toLowerCase(), path: value });
    }
  }
  const mine = groups.find((g) => g.agents.some((a) => a && userAgentToken.includes(a))) || groups.find((g) => g.agents.includes('*'));
  if (!mine) return false;
  const matching = mine.rules.filter((r) => r.path && '/'.startsWith(r.path.replace(/\*$/, '')));
  if (!matching.length) return false;
  const best = matching.sort((a, b) => b.path.length - a.path.length || (a.type === 'allow' ? -1 : 1))[0];
  return best.type === 'disallow';
}
