// Template variables: {{firstName}}, {{companyName|your team}} (text after | = fallback if empty).
// Plain text in, plain text out — no HTML, no code, no expressions. Unknown variable names are refused
// when a template is saved, so a template can never reach into other data.
export const TEMPLATE_VARIABLES = Object.freeze({
  firstName: 'First name of the person (from the lead)',
  personName: 'Full name of the person',
  companyName: "Lead's company",
  industry: "Lead's industry",
  city: "Lead's city",
  service: 'The service that matches this lead (your service list)',
  evidence: 'A short REAL quote from the lead’s evidence — the template can’t be used if the lead has none',
  myCompany: 'Your company name',
  myService: 'Your main service',
  senderName: 'Your name (the user writing the message)',
});

const VAR_RX = /\{\{\s*([a-zA-Z]+)\s*(?:\|([^{}]{0,60}))?\}\}/g;

/** Variables used in a text, and any that are not allowed. */
export function inspectTemplate(text) {
  const used = new Set();
  const unknown = new Set();
  for (const m of String(text || '').matchAll(VAR_RX)) (TEMPLATE_VARIABLES[m[1]] ? used : unknown).add(m[1]);
  const broken = /\{\{(?![^{}]*\}\})|(?<!\{)\{(?!\{)[a-zA-Z]+\}\}/.test(String(text || '')); // "{{name" or "{name}}"
  return { used: [...used], unknown: [...unknown], broken };
}

const oneLine = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Values for one lead. `evidence` is cut at a word boundary, never invented. */
export function templateContext({ lead = {}, company = {}, sender = {} }) {
  const person = oneLine(lead.personName, 120);
  let evidence = oneLine(lead.evidenceSnippet || lead.evidence || lead.capture?.captionSnippet, 400);
  if (evidence.length > 180) evidence = `${evidence.slice(0, 180).replace(/\s+\S*$/, '')}…`;
  return {
    firstName: person.split(' ')[0] || '',
    personName: person,
    companyName: oneLine(lead.companyName, 150),
    industry: oneLine(lead.industry, 80),
    city: oneLine(lead.city, 60),
    service: oneLine(lead.potentialService || lead.requiredService, 120),
    evidence,
    myCompany: oneLine(company.name, 150),
    myService: oneLine(company.mainService, 120),
    senderName: oneLine(sender.name, 120),
  };
}

/** → { text, missing[] }  Missing values WITHOUT a fallback stay as {{name}} so they can't slip through. */
export function renderTemplate(text, ctx) {
  const missing = new Set();
  const out = String(text || '').replace(VAR_RX, (whole, name, fallback) => {
    if (!TEMPLATE_VARIABLES[name]) return whole;
    const v = ctx[name];
    if (v) return v;
    if (fallback !== undefined && name !== 'evidence') return fallback.trim();
    missing.add(name);
    return `{{${name}}}`;
  });
  return { text: out, missing: [...missing] };
}
