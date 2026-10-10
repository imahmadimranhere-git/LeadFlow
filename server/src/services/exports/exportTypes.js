// What can be exported, and which columns — an ALLOW-LIST (spec A29). PURE (unit-tested).
//
// Every column is a named function over a plain record; nothing else ever leaves the database:
// no internal fields (normalized keys, tokens, secrets), no raw documents.
// `pii: true` marks personal data (names, phones, emails, profiles) → extra checks when exported.
// Lead CSV column names match the CSV importer, so an exported file can be imported again.

const iso = (d) => (d ? new Date(d).toISOString() : '');
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const money = (minor) => (minor === null || minor === undefined ? '' : (minor / 100).toFixed(2));
const contact = (r, type) => (r.capture?.contacts || []).find((c) => c.type === type);
const name = (ref) => (ref && typeof ref === 'object' ? ref.name || '' : '');

export const EXPORT_TYPES = {
  LEADS: {
    label: 'Leads',
    columns: [
      { key: 'leadId', header: 'leadId', get: (r) => String(r._id) },
      { key: 'name', header: 'name', get: (r) => r.name },
      { key: 'personName', header: 'personName', pii: true, get: (r) => r.personName },
      { key: 'companyName', header: 'companyName', get: (r) => r.companyName },
      { key: 'industry', header: 'industry', get: (r) => r.industry },
      { key: 'country', header: 'country', get: (r) => r.country },
      { key: 'city', header: 'city', get: (r) => r.city },
      { key: 'website', header: 'website', get: (r) => r.website },
      { key: 'email', header: 'email', pii: true, get: (r) => r.email },
      { key: 'phone', header: 'phone', pii: true, get: (r) => r.phone },
      { key: 'socialProfileUrl', header: 'socialProfileUrl', pii: true, get: (r) => r.socialProfileUrl },
      { key: 'source', header: 'source', get: (r) => r.source },
      { key: 'notes', header: 'notes', get: (r) => r.description },
      { key: 'displayName', header: 'displayName', pii: true, get: (r) => r.capture?.author?.displayName },
      { key: 'handle', header: 'handle', pii: true, get: (r) => r.capture?.author?.handle },
      { key: 'profileUrl', header: 'profileUrl', pii: true, get: (r) => r.capture?.author?.profileUrl },
      { key: 'platform', header: 'platform', get: (r) => r.capture?.platform },
      { key: 'matchedHashtag', header: 'matchedHashtag', get: (r) => r.matchedHashtag },
      { key: 'hashtagsUsed', header: 'hashtagsUsed', get: (r) => r.capture?.hashtagsUsed },
      { key: 'matchedKeyword', header: 'matchedKeyword', get: (r) => r.matchedKeyword },
      { key: 'matchedIntentPhrase', header: 'matchedIntentPhrase', get: (r) => r.matchedIntentPhrase },
      { key: 'postUrl', header: 'postUrl', get: (r) => r.postUrl || r.capture?.postUrl },
      { key: 'captionSnippet', header: 'captionSnippet', get: (r) => r.capture?.captionSnippet },
      { key: 'postTimestamp', header: 'postTimestamp', get: (r) => iso(r.capture?.postTimestamp) },
      { key: 'discoveredAt', header: 'discoveredAt', get: (r) => iso(r.discoveryTimestamp || r.createdAt) },
      { key: 'phoneProvenance', header: 'phoneProvenance', get: (r) => contact(r, 'PHONE')?.provenance },
      { key: 'whatsapp', header: 'whatsapp', pii: true, get: (r) => contact(r, 'WHATSAPP')?.value },
      { key: 'emailProvenance', header: 'emailProvenance', get: (r) => contact(r, 'EMAIL')?.provenance },
      { key: 'publiclyStatedByAuthor', header: 'publiclyStatedByAuthor', get: (r) => ((r.capture?.contacts || []).some((c) => c.publiclyStatedByAuthor) ? 'yes' : 'no') },
      { key: 'dataCompleteness', header: 'dataCompleteness', get: (r) => r.capture?.dataCompleteness },
      { key: 'leadType', header: 'leadType', get: (r) => r.leadType },
      { key: 'score', header: 'score', get: (r) => r.score },
      { key: 'intent', header: 'intent', get: (r) => r.intent },
      { key: 'evidenceSummary', header: 'evidenceSummary', get: (r) => r.evidenceSnippet || (r.evidence ? String(r.evidence).slice(0, 500) : '') },
      { key: 'status', header: 'status', get: (r) => r.status },
      { key: 'priority', header: 'priority', get: (r) => r.priority },
      { key: 'pipelineStage', header: 'pipelineStage', get: (r) => r.pipelineStage },
      { key: 'assignedTo', header: 'assignedTo', get: (r) => name(r.assignedTo) },
      { key: 'tags', header: 'tags', get: (r) => r.tags },
      { key: 'followUpDate', header: 'followUpDate', get: (r) => iso(r.followUpDate) },
      { key: 'consentStatus', header: 'consentStatus', get: (r) => r.compliance?.consentStatus },
      { key: 'doNotContact', header: 'doNotContact', get: (r) => (r.doNotContact ? 'yes' : 'no') },
      { key: 'createdAt', header: 'createdAt', get: (r) => iso(r.createdAt) },
    ],
    defaults: ['leadId', 'name', 'personName', 'companyName', 'city', 'country', 'website', 'email', 'phone', 'source', 'matchedHashtag', 'matchedKeyword', 'score', 'status', 'priority', 'assignedTo', 'tags', 'consentStatus', 'doNotContact', 'notes'],
    contactable: true, // has do-not-contact / consent → excluded by default
  },
  SIGNALS: {
    label: 'Signals / hashtag captures',
    columns: [
      { key: 'signalId', header: 'signalId', get: (r) => String(r._id) },
      { key: 'source', header: 'source', get: (r) => r.source },
      { key: 'platform', header: 'platform', get: (r) => r.capture?.platform },
      { key: 'displayName', header: 'displayName', pii: true, get: (r) => r.capture?.author?.displayName },
      { key: 'handle', header: 'handle', pii: true, get: (r) => r.capture?.author?.handle },
      { key: 'profileUrl', header: 'profileUrl', pii: true, get: (r) => r.capture?.author?.profileUrl },
      { key: 'authorStatus', header: 'authorStatus', get: (r) => r.capture?.author?.status },
      { key: 'matchedHashtag', header: 'matchedHashtag', get: (r) => r.matchedHashtag },
      { key: 'matchedKeyword', header: 'matchedKeyword', get: (r) => r.matchedKeyword },
      { key: 'postUrl', header: 'postUrl', get: (r) => r.capture?.postUrl },
      { key: 'captionSnippet', header: 'captionSnippet', get: (r) => r.capture?.captionSnippet },
      { key: 'location', header: 'location', get: (r) => r.matchedLocation },
      { key: 'postTimestamp', header: 'postTimestamp', get: (r) => iso(r.capture?.postTimestamp) },
      { key: 'publicContact', header: 'publicContact', get: (r) => (r.hasPublicContact ? 'yes' : 'no') },
      { key: 'phone', header: 'phone', pii: true, get: (r) => contact(r, 'PHONE')?.value },
      { key: 'email', header: 'email', pii: true, get: (r) => contact(r, 'EMAIL')?.value },
      { key: 'intentLevel', header: 'intentLevel', get: (r) => r.intentLevel },
      { key: 'dataCompleteness', header: 'dataCompleteness', get: (r) => r.capture?.dataCompleteness },
      { key: 'status', header: 'status', get: (r) => r.status },
      { key: 'discoveredAt', header: 'discoveredAt', get: (r) => iso(r.discoveredAt) },
    ],
    defaults: ['signalId', 'platform', 'displayName', 'handle', 'matchedHashtag', 'postUrl', 'captionSnippet', 'location', 'postTimestamp', 'publicContact', 'intentLevel', 'status'],
    contactable: true,
  },
  FOLLOW_UPS: {
    label: 'Follow-ups',
    columns: [
      { key: 'leadId', header: 'leadId', get: (r) => String(r._id) },
      { key: 'name', header: 'name', get: (r) => r.name },
      { key: 'followUpDate', header: 'followUpDate', get: (r) => iso(r.followUpDate) },
      { key: 'followUpNote', header: 'followUpNote', get: (r) => r.followUpNote },
      { key: 'status', header: 'status', get: (r) => r.status },
      { key: 'assignedTo', header: 'assignedTo', get: (r) => name(r.assignedTo) },
      { key: 'phone', header: 'phone', pii: true, get: (r) => r.phone },
      { key: 'email', header: 'email', pii: true, get: (r) => r.email },
    ],
    defaults: ['name', 'followUpDate', 'followUpNote', 'status', 'assignedTo'],
    contactable: true,
  },
  OUTREACH: {
    label: 'Outreach log',
    columns: [
      { key: 'messageId', header: 'messageId', get: (r) => String(r._id) },
      { key: 'lead', header: 'lead', get: (r) => name(r.leadId) },
      { key: 'channel', header: 'channel', get: (r) => r.channel },
      { key: 'status', header: 'status', get: (r) => r.status },
      { key: 'origin', header: 'origin', get: (r) => r.origin },
      { key: 'sentVia', header: 'sentVia', get: (r) => r.sentVia },
      { key: 'sentTo', header: 'sentTo', pii: true, get: (r) => r.sentTo },
      { key: 'sentAt', header: 'sentAt', get: (r) => iso(r.sentAt) },
      { key: 'repliedAt', header: 'repliedAt', get: (r) => iso(r.repliedAt) },
      { key: 'subject', header: 'subject', get: (r) => r.subject },
      { key: 'body', header: 'body', get: (r) => r.body },
      { key: 'approvedBy', header: 'approvedBy', get: (r) => name(r.reviewedBy) },
    ],
    defaults: ['lead', 'channel', 'status', 'origin', 'sentVia', 'sentAt', 'repliedAt', 'approvedBy'],
  },
  QUOTES: {
    label: 'Quotes',
    module: 'quotes',
    columns: [
      { key: 'number', header: 'number', get: (r) => r.number },
      { key: 'title', header: 'title', get: (r) => r.title },
      { key: 'client', header: 'client', get: (r) => name(r.clientId) || name(r.leadId) },
      { key: 'status', header: 'status', get: (r) => r.status },
      { key: 'issueDate', header: 'issueDate', get: (r) => day(r.issueDate) },
      { key: 'validUntil', header: 'validUntil', get: (r) => day(r.validUntil) },
      { key: 'currency', header: 'currency', get: (r) => r.currency },
      { key: 'subtotal', header: 'subtotal', get: (r) => money(r.subtotalMinor) },
      { key: 'discount', header: 'discount', get: (r) => money(r.discountMinor) },
      { key: 'tax', header: 'tax', get: (r) => money(r.taxMinor) },
      { key: 'total', header: 'total', get: (r) => money(r.totalMinor) },
    ],
    defaults: ['number', 'title', 'client', 'status', 'issueDate', 'currency', 'total'],
  },
  INVOICES: {
    label: 'Invoices',
    module: 'invoices',
    columns: [
      { key: 'number', header: 'number', get: (r) => r.number || 'DRAFT' },
      { key: 'client', header: 'client', get: (r) => name(r.clientId) },
      { key: 'status', header: 'status', get: (r) => r.status },
      { key: 'issueDate', header: 'issueDate', get: (r) => day(r.issueDate) },
      { key: 'dueDate', header: 'dueDate', get: (r) => day(r.dueDate) },
      { key: 'currency', header: 'currency', get: (r) => r.currency },
      { key: 'total', header: 'total', get: (r) => money(r.totalMinor) },
      { key: 'tax', header: 'tax', get: (r) => money(r.taxMinor) },
      { key: 'paid', header: 'paid', get: (r) => money(r.paidMinor) },
      { key: 'balance', header: 'balance', get: (r) => money(r.balanceMinor) },
      { key: 'voidReason', header: 'voidReason', get: (r) => r.voidReason },
    ],
    defaults: ['number', 'client', 'status', 'issueDate', 'dueDate', 'currency', 'total', 'paid', 'balance'],
  },
  EXPENSES: {
    label: 'Expenses',
    module: 'accounting',
    permission: 'accounting:manage',
    columns: [
      { key: 'day', header: 'day', get: (r) => r.day },
      { key: 'category', header: 'category', get: (r) => r.category },
      { key: 'vendor', header: 'vendor', get: (r) => r.vendor },
      { key: 'description', header: 'description', get: (r) => r.description },
      { key: 'currency', header: 'currency', get: (r) => r.currency },
      { key: 'amount', header: 'amount', get: (r) => money(r.amountMinor) },
      { key: 'method', header: 'method', get: (r) => r.method },
      { key: 'reference', header: 'reference', get: (r) => r.reference },
      { key: 'project', header: 'project', get: (r) => name(r.projectId) },
      { key: 'status', header: 'status', get: (r) => r.status },
    ],
    defaults: ['day', 'category', 'vendor', 'description', 'currency', 'amount', 'method', 'reference'],
  },
  AI_USAGE: {
    label: 'AI usage',
    permission: 'integrations:manage',
    columns: [
      { key: 'createdAt', header: 'createdAt', get: (r) => iso(r.createdAt) },
      { key: 'requestType', header: 'requestType', get: (r) => r.requestType },
      { key: 'provider', header: 'provider', get: (r) => r.provider },
      { key: 'model', header: 'model', get: (r) => r.model },
      { key: 'keySource', header: 'keySource', get: (r) => r.keySource },
      { key: 'inputTokens', header: 'inputTokens', get: (r) => r.inputTokens },
      { key: 'outputTokens', header: 'outputTokens', get: (r) => r.outputTokens },
      { key: 'estimatedCostUsd', header: 'estimatedCostUsd', get: (r) => r.estimatedCostUsd },
      { key: 'status', header: 'status', get: (r) => r.status },
    ],
    defaults: ['createdAt', 'requestType', 'provider', 'model', 'inputTokens', 'outputTokens', 'estimatedCostUsd', 'status'],
  },
  AUDIT_LOGS: {
    label: 'Audit log',
    permission: 'audit:read',
    columns: [
      { key: 'createdAt', header: 'createdAt', get: (r) => iso(r.createdAt) },
      { key: 'action', header: 'action', get: (r) => r.action },
      { key: 'actorType', header: 'actorType', get: (r) => r.actorType },
      { key: 'actorId', header: 'actorId', get: (r) => (r.actorId ? String(r.actorId) : '') },
      { key: 'targetType', header: 'targetType', get: (r) => r.targetType },
      { key: 'targetId', header: 'targetId', get: (r) => (r.targetId ? String(r.targetId) : '') },
    ],
    defaults: ['createdAt', 'action', 'actorType', 'actorId', 'targetType', 'targetId'],
  },
};

export const EXPORT_TYPE_KEYS = Object.keys(EXPORT_TYPES);
export const PDF_MAX_COLUMNS = 8;

/** Chosen columns → allow-listed definitions (unknown names rejected), in the order the type defines. */
export function resolveColumns(type, requested) {
  const def = EXPORT_TYPES[type];
  if (!def) return { error: 'Unknown export type' };
  const wanted = requested && requested.length ? requested : def.defaults;
  const unknown = wanted.filter((k) => !def.columns.some((c) => c.key === k));
  if (unknown.length) return { error: `Unknown column(s): ${unknown.slice(0, 5).join(', ')}` };
  // The user's chosen order is kept; duplicates are dropped.
  const columns = [...new Set(wanted)].map((k) => def.columns.find((c) => c.key === k));
  return { columns, includesPii: columns.some((c) => c.pii) };
}

/** Records → plain rows for the chosen columns (only these values leave the server). */
export const toRows = (columns, records) => records.map((r) => Object.fromEntries(columns.map((c) => [c.key, c.get(r) ?? ''])));

/** Public catalogue for the UI (no functions). */
export const exportCatalog = () =>
  Object.fromEntries(Object.entries(EXPORT_TYPES).map(([k, d]) => [k, { label: d.label, columns: d.columns.map((c) => ({ key: c.key, pii: Boolean(c.pii) })), defaults: d.defaults, contactable: Boolean(d.contactable), module: d.module || null, permission: d.permission || null }]));
