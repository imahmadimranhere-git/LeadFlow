// Ready-made PDFs (spec A29): Lead Dossier (one lead, A to Z) and Hashtag Watch Report.
// Built from our own template code (PdfDoc) — lead text is only ever written as text, never interpreted.
// Generated on request (small), permission-checked and audit-logged.
import Lead from '../../models/Lead.js';
import LeadActivity from '../../models/LeadActivity.js';
import OutreachMessage from '../../models/OutreachMessage.js';
import ConversationMessage from '../../models/ConversationMessage.js';
import WebsiteAudit from '../../models/WebsiteAudit.js';
import HashtagWatch from '../../models/HashtagWatch.js';
import Signal from '../../models/Signal.js';
import User from '../../models/User.js';
import Tenant from '../../models/Tenant.js';
import ApiError from '../../utils/ApiError.js';
import { recordAudit } from '../audit/auditService.js';
import { scopeFilter } from '../leads/leadService.js';
import { PdfDoc } from './pdf.js';
import { safeFileName } from './csv.js';

const dt = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '—');
const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const MISSING = 'Not provided by the source';

async function header(auth, title, pii) {
  const [tenant, user] = await Promise.all([Tenant.findById(auth.tenantId).select('name'), User.findById(auth.userId).select('name')]);
  const doc = new PdfDoc({ title, footer: `${tenant?.name || ''} · exported by ${user?.name || ''} · ${dt(new Date())} UTC${pii ? ' · Confidential — contains personal data' : ''}` });
  return { doc, tenantName: tenant?.name || '' };
}

export async function leadDossier(auth, leadId, meta = {}) {
  const lead = await Lead.findOne({ _id: leadId, ...scopeFilter(auth) }).populate('assignedTo', 'name').lean();
  if (!lead) throw ApiError.notFound('Lead not found');
  const [notes, messages, convo, audit] = await Promise.all([
    LeadActivity.find({ leadId: lead._id, type: 'NOTE' }).sort({ createdAt: -1 }).limit(30).populate('actorId', 'name').lean(),
    OutreachMessage.find({ leadId: lead._id, status: { $in: ['SENT', 'REPLIED', 'FOLLOW_UP', 'CLOSED'] } }).sort({ sentAt: 1 }).limit(50).lean(),
    ConversationMessage.find({ leadId: lead._id }).sort({ at: 1 }).limit(100).lean(),
    WebsiteAudit.findOne({ leadId: lead._id, status: 'COMPLETED' }).sort({ createdAt: -1 }).lean(),
  ]);
  const { doc, tenantName } = await header(auth, `Lead dossier — ${lead.name}`, true);
  const c = lead.capture || {};
  const contacts = c.contacts || [];

  doc.heading(`Lead dossier: ${lead.name}`);
  doc.text(`${tenantName} · status ${lead.status} · priority ${lead.priority}${lead.doNotContact ? ' · DO NOT CONTACT' : ''}`, { size: 9, color: [0.35, 0.35, 0.35] });

  doc.heading('1. Who', 2);
  doc.kv([
    ['Name / company', [lead.personName, lead.companyName].filter(Boolean).join(' — ') || lead.name],
    ['Author (as given by the source)', c.author?.status === 'NOT_PROVIDED_BY_SOURCE' ? MISSING : [c.author?.displayName, c.author?.handle && `@${c.author.handle}`].filter(Boolean).join(' ') || null],
    ['Profile', c.author?.profileUrl || lead.socialProfileUrl],
    ['Location', [lead.city, lead.country].filter(Boolean).join(', ')],
    ['Industry', lead.industry],
    ['Assigned to', lead.assignedTo?.name],
  ]);

  doc.heading('2. Contact (with where it came from)', 2);
  if (contacts.length) {
    doc.table([{ header: 'Type', width: 1 }, { header: 'Value', width: 3 }, { header: 'Provenance', width: 2 }, { header: 'Stated publicly by author', width: 1.5 }],
      contacts.map((x) => [x.type, x.value, x.provenance, x.publiclyStatedByAuthor ? 'yes' : 'no']));
  } else {
    doc.kv([['Email', lead.email], ['Phone', lead.phone], ['Website', lead.website]]);
    if (!lead.email && !lead.phone) doc.text('No public contact found.', { size: 9 });
  }

  doc.heading('3. Where it was found', 2);
  doc.kv([
    ['Source', lead.source],
    ['Platform', c.platform],
    ['Post', lead.postUrl || c.postUrl],
    ['Posted at', c.postTimestamp ? dt(c.postTimestamp) : null],
    ['Hashtags used', (c.hashtagsUsed || []).join(' ')],
    ['Matched', [lead.matchedHashtag && `#${lead.matchedHashtag}`, lead.matchedKeyword, lead.matchedIntentPhrase].filter(Boolean).join(' · ')],
    ['Discovered', dt(lead.discoveryTimestamp || lead.createdAt)],
    ['Data completeness', c.dataCompleteness ? `${c.dataCompleteness}${c.completenessReasons?.length ? ` (${c.completenessReasons.join('; ')})` : ''}` : null],
  ]);

  doc.heading('4. Evidence (why it was discovered)', 2);
  doc.text(c.captionSnippet || lead.evidence || lead.evidenceSnippet || 'No evidence text stored.', { size: 9.5, maxLines: 40 });

  doc.heading('5. Compliance & consent', 2);
  doc.kv([
    ['Lawful basis', lead.compliance?.lawfulBasis],
    ['Consent', lead.compliance?.consentStatus],
    ['Consent proof', lead.compliance?.consentProof],
    ['Opted out', lead.compliance?.optOutAt ? dt(lead.compliance.optOutAt) : null],
    ['Do not contact', lead.doNotContact ? 'YES' : 'no'],
  ]);

  doc.heading('6. Score & assessment', 2);
  doc.kv([
    ['Score', lead.score === null || lead.score === undefined ? 'Not scored' : `${lead.score} / 100`],
    ['Why', lead.scoreReason],
    ['Lead type / intent', [lead.leadType, lead.intent].filter(Boolean).join(' / ')],
    ['Recommended action', lead.recommendedAction],
    ['Required service', lead.requiredService],
    ['Budget (only if stated)', lead.budgetStated],
  ]);

  if (audit) {
    doc.heading('Website audit', 2);
    doc.kv([['Website', audit.finalUrl || audit.url], ['Checked', dt(audit.createdAt)], ['Result', `${audit.score ?? '—'} / 100 — ${audit.summary || ''}`]]);
    const problems = (audit.checks || []).filter((x) => ['FAIL', 'WARN'].includes(x.status)).slice(0, 12);
    if (problems.length) doc.table([{ header: 'Check', width: 2 }, { header: 'Result', width: 1 }, { header: 'Detail', width: 4 }], problems.map((x) => [x.title, x.status, x.detail]));
  }

  doc.heading('Outreach & conversation', 2);
  if (!messages.length && !convo.length) doc.text('No messages yet.', { size: 9 });
  if (messages.length) doc.table([{ header: 'Sent', width: 1.3 }, { header: 'Channel', width: 1 }, { header: 'Status', width: 1 }, { header: 'Message', width: 5 }], messages.map((m) => [dt(m.sentAt), m.channel, m.status, `${m.subject ? `${m.subject}: ` : ''}${m.body}`]));
  if (convo.length) doc.table([{ header: 'When', width: 1.3 }, { header: 'Who', width: 0.8 }, { header: 'Text', width: 6 }], convo.map((m) => [dt(m.at), m.direction === 'INBOUND' ? 'Lead' : 'Us', m.body]));

  doc.heading('Follow-up & notes', 2);
  doc.kv([['Next follow-up', lead.followUpDate ? `${dt(lead.followUpDate)}${lead.followUpNote ? ` — ${lead.followUpNote}` : ''}` : 'None planned']]);
  for (const n of notes) doc.text(`${dateOnly(n.createdAt)} · ${n.actorId?.name || ''}: ${n.body}`, { size: 9 });

  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'export.dossier', targetType: 'Lead', targetId: lead._id, ip: meta.ip });
  return { data: doc.toBuffer(), fileName: safeFileName(`lead-dossier-${lead.name}`, 'pdf'), replacedChars: doc.replacedChars };
}

/** Per watch: what was found in a period, honestly including what the source did NOT provide. */
export async function hashtagReport(auth, watchId, { from, to }, meta = {}) {
  const watch = await HashtagWatch.findOne({ _id: watchId }).lean();
  if (!watch) throw ApiError.notFound('Watch not found');
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + 86400000);
  const signals = await Signal.find({ watchId: watch._id, discoveredAt: { $gte: start, $lt: end } }).sort({ discoveredAt: -1 }).limit(2001).lean();
  const truncated = signals.length > 2000;
  if (truncated) signals.pop();
  const leadsCreated = signals.filter((s) => s.leadId).length;
  const count = (fn) => signals.reduce((m, s) => {
    const k = fn(s) || 'unknown';
    m.set(k, (m.get(k) || 0) + 1);
    return m;
  }, new Map());
  const top = (m, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  const noAuthor = signals.filter((s) => s.capture?.author?.status === 'NOT_PROVIDED_BY_SOURCE').length;
  const noContact = signals.filter((s) => !s.hasPublicContact).length;

  const { doc } = await header(auth, `Hashtag report — ${watch.name}`, true);
  doc.heading(`Hashtag report: ${watch.name}`);
  doc.text(`${(watch.hashtags || []).map((h) => `#${String(h).replace(/^#/, '')}`).join(' ')} · ${watch.platform} · ${from} to ${to}`, { size: 9.5, color: [0.35, 0.35, 0.35] });
  doc.heading('Summary', 2);
  doc.kv([
    ['Posts found', `${signals.length}${truncated ? ' (showing the latest 2,000)' : ''}`],
    ['Converted to leads', String(leadsCreated)],
    ['Filtered / dismissed', String(signals.filter((s) => ['FILTERED', 'DISMISSED'].includes(s.status)).length)],
    ['With public contact', String(signals.length - noContact)],
  ]);
  doc.heading('Breakdown', 2);
  doc.table([{ header: 'Platform', width: 2 }, { header: 'Posts', width: 1 }], top(count((s) => s.capture?.platform || s.source)).map(([k, v]) => [k, String(v)]));
  doc.table([{ header: 'Top locations', width: 2 }, { header: 'Posts', width: 1 }], top(count((s) => s.matchedLocation)).map(([k, v]) => [k, String(v)]));
  doc.table([{ header: 'Intent', width: 2 }, { header: 'Posts', width: 1 }], top(count((s) => s.intentLevel)).map(([k, v]) => [k, String(v)]));
  doc.heading('Posts', 2);
  doc.table(
    [{ header: 'Author', width: 1.6 }, { header: 'Post', width: 2.4 }, { header: 'Posted', width: 1.1 }, { header: 'Public contact', width: 0.9 }, { header: 'Status', width: 0.9 }],
    signals.slice(0, 500).map((s) => [s.capture?.author?.displayName || s.capture?.author?.handle || MISSING, s.capture?.postUrl || '', dateOnly(s.capture?.postTimestamp), s.hasPublicContact ? 'yes' : 'no', s.status])
  );
  doc.heading('Data limitations', 2);
  doc.text(`${noAuthor} of ${signals.length} posts had no author information provided by the source (the official API often does not return it). ${noContact} posts had no public contact. Missing data is shown as missing — never guessed.`, { size: 9 });

  await recordAudit({ actorType: 'USER', actorId: auth.userId, tenantId: auth.tenantId, action: 'export.hashtag_report', targetType: 'HashtagWatch', targetId: watch._id, ip: meta.ip, metadata: { from, to, posts: signals.length } });
  return { data: doc.toBuffer(), fileName: safeFileName(`hashtag-report-${watch.name}-${from}-${to}`, 'pdf'), replacedChars: doc.replacedChars };
}

// ---------------------------------------------------------------- quote / invoice PDFs (server-side, from our template)

const money = (minor, cur) => (Number.isInteger(minor) ? `${cur ? `${cur} ` : ''}${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '');
const qty = (milli) => String(milli / 1000);

function businessDoc({ kind, doc: d, party, company, extra, footerText, stamp, userName }) {
  const doc = new PdfDoc({ title: `${kind} ${d.number || 'draft'}`, footer: `${company.name || ''} · generated by ${userName || ''} · ${dt(new Date())} UTC` });
  doc.heading(company.name || '');
  doc.text([company.address, [company.city, company.country].filter(Boolean).join(', '), company.phone, company.email, company.website, company.taxId && `Tax ID: ${company.taxId}`].filter(Boolean).join(' · '), { size: 8.5, color: [0.35, 0.35, 0.35] });
  doc.heading(`${kind} ${d.number || '(draft)'}${stamp ? ` — ${stamp}` : ''}`, 2);
  doc.kv([['For', [party.name, party.address, [party.city, party.country].filter(Boolean).join(', '), party.email, party.phone, party.taxId && `Tax ID: ${party.taxId}`].filter(Boolean).join(' · ')], ...extra, ...(d.title ? [['Subject', d.title]] : [])]);
  doc.table(
    [{ header: 'Description', width: 4.2 }, { header: 'Qty', width: 1 }, { header: 'Price', width: 1.4 }, { header: 'Disc.', width: 0.8 }, { header: 'Tax', width: 0.8 }, { header: 'Amount', width: 1.8 }],
    d.lines.map((l) => [l.description, `${qty(l.qtyMilli)}${l.unit ? ` ${l.unit}` : ''}`, money(l.unitPriceMinor), l.discountBp ? `${l.discountBp / 100}%` : '—', l.taxBp ? `${l.taxBp / 100}%` : '—', money(l.netMinor)])
  );
  const totals = [['Subtotal', money(d.subtotalMinor - d.lineDiscountMinor, d.currency)], ...(d.orderDiscountMinor > 0 ? [['Discount', `- ${money(d.orderDiscountMinor, d.currency)}`]] : []), ['Tax', money(d.taxMinor, d.currency)], ['TOTAL', money(d.totalMinor, d.currency)]];
  if (d.paidMinor !== undefined && !['DRAFT', 'VOID'].includes(d.status)) totals.push(['Paid', money(d.paidMinor, d.currency)], ['Balance due', money(d.balanceMinor, d.currency)]);
  doc.kv(totals, { labelWidth: 380 });
  if (d.notes) doc.text(`Notes: ${d.notes}`, { size: 9 });
  if (d.terms) doc.text(`Terms: ${d.terms}`, { size: 9 });
  if (footerText) doc.text(footerText, { size: 9 });
  return doc;
}

export async function quotePdfFor(auth, id) {
  const { getQuote } = await import('../erp/quoteService.js'); // scope check: 404 for quotes you can't see
  const { quote, company } = await getQuote(auth, id);
  const user = await User.findById(auth.userId).select('name');
  const stamp = quote.status === 'DRAFT' ? 'DRAFT' : ['CANCELLED', 'DECLINED', 'EXPIRED'].includes(quote.status) ? quote.status : null;
  const doc = businessDoc({ kind: 'Quotation', doc: quote, party: quote.clientId || quote.leadId || {}, company, extra: [['Date', dateOnly(quote.issueDate)], ['Valid until', dateOnly(quote.validUntil)]], stamp, userName: user?.name });
  return { data: doc.toBuffer(), fileName: safeFileName(`quote-${quote.number}`, 'pdf'), replacedChars: doc.replacedChars };
}

export async function invoicePdfFor(auth, id) {
  const { getInvoice } = await import('../erp/invoiceService.js');
  const { invoice, company } = await getInvoice(auth, id);
  const user = await User.findById(auth.userId).select('name');
  const stamp = ['PAID', 'VOID', 'DRAFT'].includes(invoice.status) ? invoice.status : invoice.overdue ? 'OVERDUE' : null;
  const doc = businessDoc({ kind: 'Invoice', doc: invoice, party: invoice.clientId || {}, company, extra: [['Date', dateOnly(invoice.issueDate)], ['Due', dateOnly(invoice.dueDate)]], footerText: invoice.footer, stamp, userName: user?.name });
  return { data: doc.toBuffer(), fileName: safeFileName(`invoice-${invoice.number || 'draft'}`, 'pdf'), replacedChars: doc.replacedChars };
}
