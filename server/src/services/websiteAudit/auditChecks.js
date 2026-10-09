// Turns observed facts into checks. Spec A8: "Never invent website problems; if the site is good, say so."
//   PASS / WARN / FAIL  — each with the OBSERVED evidence (what we actually saw)
//   NOT_CHECKED         — we couldn't see it (e.g. no images on the page) → not counted, not a problem
// Pure functions.
const CATEGORY = { SECURITY: 'Security', SEO: 'Search (SEO)', MOBILE: 'Mobile', PERFORMANCE: 'Speed', ACCESSIBILITY: 'Accessibility', CONVERSION: 'Getting enquiries', CONTENT: 'Content' };
export { CATEGORY };

const RECOMMEND = {
  https: 'Install an SSL certificate (free with Let’s Encrypt) and serve the site over https.',
  httpsRedirect: 'Redirect http:// to https:// so visitors always get the secure version.',
  mixedContent: 'Load all images/scripts over https:// to avoid “not secure” warnings.',
  title: 'Give the homepage a clear title (about 10–70 characters) with the business name and main service.',
  description: 'Add a meta description (about 50–160 characters) — it is the text shown under your link on Google.',
  viewport: 'Add a mobile viewport tag and a responsive layout so the site works well on phones.',
  h1: 'Add one main heading (H1) that says what the business does.',
  altText: 'Add short descriptions (alt text) to images — helps blind visitors and Google.',
  lang: 'Set the page language (html lang="…") for accessibility tools.',
  contact: 'Show a phone number, email or WhatsApp button on the homepage.',
  cta: 'Add a clear call-to-action button such as “Get a quote”, “Book now” or “Order online”.',
  speed: 'Improve load time (image compression, caching, a faster host).',
  pageWeight: 'Reduce the size of the homepage HTML.',
  scripts: 'Remove unused third-party scripts.',
  structuredData: 'Add structured data (schema.org LocalBusiness) so Google understands the business.',
  openGraph: 'Add Open Graph tags so links look good when shared on WhatsApp/Facebook.',
  copyright: 'Update the footer year and recent content — an old year makes the site look inactive.',
  brokenLinks: 'Fix or remove links that lead to “page not found”.',
  noindex: 'Remove the “noindex” instruction if the business wants to be found on Google.',
};

const check = (id, category, weight, status, title, detail, evidence = null) => ({ id, category, weight, status, title, detail, evidence: evidence === null ? null : String(evidence).slice(0, 300) });

/**
 * @param f        facts from extractFacts()
 * @param observed { finalUrl, status, responseMs, htmlBytes, httpRedirectsToHttps (true|false|null), brokenLinks [{url,status}], linksChecked, now }
 */
export function runChecks(f, observed) {
  const out = [];
  const https = /^https:/i.test(observed.finalUrl || '');
  out.push(check('https', 'SECURITY', 3, https ? 'PASS' : 'FAIL', 'Secure connection (HTTPS)', https ? 'The site uses https.' : 'The site does not use https — browsers show “Not secure”.', observed.finalUrl));
  if (https) {
    if (observed.httpRedirectsToHttps === true) out.push(check('httpsRedirect', 'SECURITY', 1, 'PASS', 'http → https redirect', 'http:// visitors are sent to the secure version.'));
    else if (observed.httpRedirectsToHttps === false) out.push(check('httpsRedirect', 'SECURITY', 1, 'WARN', 'http → https redirect', 'The http:// address does not redirect to https://.'));
    else out.push(check('httpsRedirect', 'SECURITY', 1, 'NOT_CHECKED', 'http → https redirect', 'Could not test the http:// address.'));
    out.push(f.mixedContent.length
      ? check('mixedContent', 'SECURITY', 2, 'FAIL', 'Insecure resources on a secure page', `${f.mixedContent.length} file(s) are loaded over http://.`, f.mixedContent.join(', '))
      : check('mixedContent', 'SECURITY', 2, 'PASS', 'No insecure resources', 'All images/scripts we saw use https.'));
  }

  if (!f.title) out.push(check('title', 'SEO', 2, 'FAIL', 'Page title', 'The homepage has no title.'));
  else if (f.title.length < 10 || f.title.length > 70) out.push(check('title', 'SEO', 2, 'WARN', 'Page title', `The title is ${f.title.length} characters (best: 10–70).`, f.title));
  else out.push(check('title', 'SEO', 2, 'PASS', 'Page title', 'Clear title.', f.title));

  if (!f.metaDescription) out.push(check('description', 'SEO', 2, 'FAIL', 'Meta description', 'No meta description — Google will pick random text for the search result.'));
  else if (f.metaDescription.length < 50 || f.metaDescription.length > 160) out.push(check('description', 'SEO', 2, 'WARN', 'Meta description', `The description is ${f.metaDescription.length} characters (best: 50–160).`, f.metaDescription));
  else out.push(check('description', 'SEO', 2, 'PASS', 'Meta description', 'Good description for search results.', f.metaDescription));

  if (f.robotsMeta && /noindex/i.test(f.robotsMeta)) out.push(check('noindex', 'SEO', 3, 'FAIL', 'Hidden from Google', 'The homepage asks search engines NOT to list it (noindex).', f.robotsMeta));

  const vp = f.viewport && /width\s*=\s*device-width/i.test(f.viewport);
  out.push(check('viewport', 'MOBILE', 3, vp ? 'PASS' : 'FAIL', 'Mobile setup', vp ? 'The page has a mobile viewport tag.' : 'No mobile viewport tag found — the page may not display well on phones.', f.viewport || '(none)'));

  out.push(f.h1Count ? check('h1', 'SEO', 1, 'PASS', 'Main heading', 'The page has a main heading.', f.h1s[0]) : check('h1', 'SEO', 1, 'WARN', 'Main heading', 'No main heading (H1) on the homepage.'));

  if (!f.images) out.push(check('altText', 'ACCESSIBILITY', 1, 'NOT_CHECKED', 'Image descriptions', 'No images on the homepage.'));
  else if (f.imagesMissingAlt / f.images > 0.3) out.push(check('altText', 'ACCESSIBILITY', 1, 'WARN', 'Image descriptions', `${f.imagesMissingAlt} of ${f.images} images have no alt text.`));
  else out.push(check('altText', 'ACCESSIBILITY', 1, 'PASS', 'Image descriptions', 'Most images have alt text.'));

  out.push(f.lang ? check('lang', 'ACCESSIBILITY', 1, 'PASS', 'Page language', 'Page language is set.', f.lang) : check('lang', 'ACCESSIBILITY', 1, 'WARN', 'Page language', 'The page language is not set.'));

  const contacts = [...f.tel.map((t) => `tel:${t}`), ...f.mailto.map((m) => `mailto:${m}`), ...(f.whatsapp ? ['WhatsApp link'] : []), ...f.emailsInText];
  out.push(contacts.length ? check('contact', 'CONVERSION', 2, 'PASS', 'Contact details', 'Visitors can find a way to contact the business.', contacts.slice(0, 3).join(', ')) : check('contact', 'CONVERSION', 2, 'WARN', 'Contact details', 'No phone link, email or WhatsApp button found on the homepage.'));
  out.push(f.ctas.length || f.forms ? check('cta', 'CONVERSION', 2, 'PASS', 'Call to action', 'There is a clear next step for visitors.', f.ctas.join(' · ') || `${f.forms} form(s)`) : check('cta', 'CONVERSION', 2, 'WARN', 'Call to action', 'No clear button like “Contact us”, “Get a quote” or “Order” found.'));

  if (Number.isFinite(observed.responseMs)) {
    const ms = observed.responseMs;
    out.push(check('speed', 'PERFORMANCE', 2, ms < 1500 ? 'PASS' : ms < 4000 ? 'WARN' : 'FAIL', 'Server response time', `The homepage HTML arrived in ${(ms / 1000).toFixed(1)} s (one measurement from our server).`, `${ms} ms`));
  }
  if (Number.isFinite(observed.htmlBytes)) {
    out.push(check('pageWeight', 'PERFORMANCE', 1, observed.htmlBytes < 500_000 ? 'PASS' : 'WARN', 'Homepage size', `The HTML is ${Math.round(observed.htmlBytes / 1024)} KB.`));
  }
  if (f.scriptsExternal > 30) out.push(check('scripts', 'PERFORMANCE', 1, 'WARN', 'Many scripts', `${f.scriptsExternal} external scripts are loaded.`));

  out.push(f.structuredData ? check('structuredData', 'SEO', 1, 'PASS', 'Structured data', 'schema.org data found.') : check('structuredData', 'SEO', 1, 'WARN', 'Structured data', 'No schema.org structured data found.'));
  out.push(f.ogTitle ? check('openGraph', 'CONTENT', 1, 'PASS', 'Link preview (Open Graph)', 'Shared links get a proper preview.', f.ogTitle) : check('openGraph', 'CONTENT', 1, 'WARN', 'Link preview (Open Graph)', 'No Open Graph tags — shared links may look plain.'));

  const year = (observed.now || new Date()).getFullYear();
  if (f.copyrightYear) {
    out.push(f.copyrightYear < year - 2
      ? check('copyright', 'CONTENT', 1, 'WARN', 'Up-to-date footer', `The footer says © ${f.copyrightYear}.`, `© ${f.copyrightYear}`)
      : check('copyright', 'CONTENT', 1, 'PASS', 'Up-to-date footer', `The footer year is recent (${f.copyrightYear}).`));
  }

  if (observed.linksChecked) {
    const broken = observed.brokenLinks || [];
    out.push(broken.length
      ? check('brokenLinks', 'CONTENT', 2, 'FAIL', 'Broken links', `${broken.length} of ${observed.linksChecked} checked links lead to an error page.`, broken.slice(0, 3).map((b) => `${b.url} (${b.status})`).join(', '))
      : check('brokenLinks', 'CONTENT', 2, 'PASS', 'Links work', `All ${observed.linksChecked} checked links work.`));
  } else {
    out.push(check('brokenLinks', 'CONTENT', 2, 'NOT_CHECKED', 'Links', 'No internal links were checked.'));
  }
  return out;
}

const POINTS = { PASS: 1, WARN: 0.5, FAIL: 0 };

/** Score 0–100 over the checks we could actually do; plus the honest summary. */
export function summarize(checks, services = []) {
  let num = 0;
  let den = 0;
  for (const c of checks) {
    if (!(c.status in POINTS)) continue;
    num += c.weight * POINTS[c.status];
    den += c.weight;
  }
  const score = den ? Math.round((num / den) * 100) : null;
  const fails = checks.filter((c) => c.status === 'FAIL');
  const warns = checks.filter((c) => c.status === 'WARN');
  const good = checks.filter((c) => c.status === 'PASS');
  const looksGood = fails.length === 0 && warns.length <= 2;
  const summary = looksGood
    ? `This website looks good — no major problems found${warns.length ? ` (${warns.length} small suggestion${warns.length > 1 ? 's' : ''})` : ''}.`
    : `${fails.length} problem(s) and ${warns.length} suggestion(s) found.`;

  const categories = new Set([...fails, ...warns].map((c) => c.category));
  const wants = [];
  if (categories.has('SEO')) wants.push(/seo|search|marketing|google/i);
  if (['MOBILE', 'SECURITY', 'CONVERSION', 'ACCESSIBILITY', 'CONTENT'].some((c) => categories.has(c))) wants.push(/web|site|design|develop|redesign|e-?commerce|landing/i);
  if (categories.has('PERFORMANCE')) wants.push(/web|speed|performance|hosting|maintenance/i);
  const potentialServices = services.filter((s) => wants.some((rx) => rx.test(s))).slice(0, 5);

  return {
    score,
    looksGood,
    summary,
    goodPoints: good.map((c) => c.title),
    issues: [...fails, ...warns].map((c) => ({ id: c.id, severity: c.status, title: c.title, detail: c.detail, evidence: c.evidence })),
    recommendations: [...fails, ...warns].map((c) => RECOMMEND[c.id]).filter(Boolean),
    potentialServices,
  };
}

/** Plain text of OBSERVED findings for AI prompts / fact checking (never anything we didn't see). */
export function findingsText(audit) {
  if (!audit?.checks?.length) return '';
  return audit.checks
    .filter((c) => c.status === 'FAIL' || c.status === 'WARN')
    .map((c) => `Website check — ${c.title}: ${c.detail}${c.evidence ? ` (observed: ${c.evidence})` : ''}`)
    .join('\n');
}
