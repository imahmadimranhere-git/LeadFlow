// What the Chrome extension can do: who am I, "is this page already a lead?", "save this lead",
// "add this page as a source of an existing lead". Everything is checked again here — the extension is
// just another untrusted client.
import env from '../../config/env.js';
import Lead from '../../models/Lead.js';
import Signal from '../../models/Signal.js';
import TenantSettings from '../../models/TenantSettings.js';
import ApiError from '../../utils/ApiError.js';
import { PERMISSIONS as P, hasPermission } from '../../config/permissions.js';
import { getEffectivePlan } from '../billing/planResolver.js';
import { createLead, addSource, addNote } from '../leads/leadService.js';
import { identityKeys } from '../leads/normalize.js';
import User from '../../models/User.js';
import { detectIntent } from '../leads/discovery/intentDetector.js';
import { matchService } from '../leads/discovery/serviceMatcher.js';
import { convertSignal } from '../signals/signalService.js';
import { extractHashtags, dataCompleteness } from '../signals/extract.js';
import { canonicalPageUrl, cleanPageTitle, detectPlatform, guessPageKind, urlVariants } from './pageUrl.js';

const OPEN_SIGNAL = ['NEW', 'NEEDS_REVIEW', 'FILTERED'];
const dashboardBase = () => env.CORS_ORIGINS[0].replace(/\/$/, '');
export const leadUrl = (id) => `${dashboardBase()}/app/leads/${id}`;

async function assertExtensionInPlan(tenantId) {
  const plan = await getEffectivePlan(tenantId);
  if (plan.code !== 'unconfigured' && !(plan.connectors || []).includes('CHROME_EXTENSION')) {
    throw new ApiError(402, `The Chrome extension is not included in your ${plan.name} plan. Please upgrade.`, [{ code: 'PLAN_FEATURE', field: 'source', message: 'CHROME_EXTENSION' }]);
  }
}

async function loadSettings() {
  return (await TenantSettings.findOne({}).select('services discovery profile'))?.toObject() || {};
}

export async function extensionMe(auth) {
  const [settings, user] = await Promise.all([loadSettings(), User.findById(auth.userId).select('name')]);
  return {
    user: { name: user?.name, role: auth.role },
    services: (settings.services || []).map((s) => s.name).slice(0, 100),
    dashboardUrl: dashboardBase(),
  };
}

/** Leads that match this page / these contacts — details only for leads the user may see. */
export async function checkPage(auth, { url, email, phone, website, profileUrl }) {
  const variants = urlVariants(url);
  if (!variants.length) throw ApiError.badRequest('This page cannot be saved (only normal web pages)');
  const kind = guessPageKind(url);
  const keys = identityKeys({ email, phone, website, socialProfileUrl: profileUrl || (kind === 'PROFILE' ? variants[0] : null) });

  const or = [
    { postUrl: { $in: variants } },
    { sourceUrl: { $in: variants } },
    { 'sourcesHistory.postUrl': { $in: variants } },
    { 'sourcesHistory.sourceUrl': { $in: variants } },
  ];
  for (const k of ['emailNormalized', 'phoneNormalized', 'websiteNormalized', 'socialNormalized']) if (keys[k]) or.push({ [k]: keys[k] });

  const found = await Lead.find({ $or: or }).select('name status assignedTo createdBy').limit(10);
  const readAll = hasPermission(auth.role, P.LEADS_READ_ALL);
  const mine = (l) => readAll || [String(l.assignedTo), String(l.createdBy)].includes(auth.userId);
  const visible = found.filter(mine);

  const signal = await Signal.findOne({ 'capture.postUrl': { $in: variants }, status: { $in: OPEN_SIGNAL } }).select('status matchedHashtag');
  return {
    canonicalUrl: variants[0],
    platform: detectPlatform(url),
    pageKind: kind,
    leads: visible.map((l) => ({ id: String(l._id), name: l.name, status: l.status, url: leadUrl(l._id) })),
    hiddenMatches: found.length - visible.length, // a colleague's lead — existence only
    openSignal: signal ? { id: String(signal._id), matchedHashtag: signal.matchedHashtag } : null,
  };
}

function buildContacts(input, postUrl, auth) {
  const provenance = input.contactSource || 'USER_ENTERED';
  const at = new Date();
  const contacts = [];
  for (const [type, value] of [['PHONE', input.phone], ['EMAIL', input.email], ['WEBSITE', input.website]]) {
    if (!value) continue;
    contacts.push({
      type,
      value,
      provenance,
      provenanceUrl: provenance === 'PUBLIC_BIO' && input.profileUrl ? input.profileUrl : postUrl,
      capturedAt: at,
      capturedBy: auth.userId,
      publiclyStatedByAuthor: provenance !== 'USER_ENTERED',
    });
  }
  return contacts;
}

/** "Save lead" from the extension. If the page is a post waiting in the Signals inbox, that signal is converted. */
export async function saveFromExtension(auth, input) {
  await assertExtensionInPlan(auth.tenantId);
  const canonical = canonicalPageUrl(input.pageUrl);
  if (!canonical) throw ApiError.badRequest('This page cannot be saved (only normal web pages)');
  const platform = detectPlatform(canonical);
  const kind = guessPageKind(canonical);
  const settings = await loadSettings();

  const serviceNames = (settings.services || []).map((s) => s.name);
  if (input.requiredService && !serviceNames.includes(input.requiredService)) {
    throw ApiError.badRequest('Validation failed', [{ field: 'requiredService', message: 'Choose one of your services' }]);
  }

  const snippet = input.snippet || '';
  const d = settings.discovery || {};
  const intent = detectIntent(snippet, { keywords: d.keywords || [], intentPhrases: d.intentPhrases || [], hashtags: d.hashtags || [], negativeKeywords: d.negativeKeywords || [] });
  const hashtagsUsed = extractHashtags(snippet);
  const matchedHashtag = input.matchedHashtag || hashtagsUsed.find((h) => (d.hashtags || []).includes(h)) || null;
  const profileUrl = input.profileUrl || (kind === 'PROFILE' ? canonical : null);

  // 1) A post waiting in the inbox → convert THAT signal (keeps its original evidence)
  const signal = await Signal.findOne({ 'capture.postUrl': { $in: urlVariants(canonical) }, status: { $in: OPEN_SIGNAL } }).select('_id');
  let lead;
  let convertedSignal = false;
  if (signal) {
    lead = await convertSignal(auth, signal._id, {
      name: input.name,
      companyName: input.companyName,
      displayName: input.personName,
      handle: input.handle,
      profileUrl,
      profileType: input.profileType,
      phone: input.phone,
      email: input.email,
      website: input.website,
      contactProvenance: input.contactSource,
      city: input.city,
      lawfulBasis: input.lawfulBasis,
      force: input.force,
    });
    convertedSignal = true;
  } else {
    // 2) A new lead from what the person saw on the page
    const author = input.personName || input.handle || profileUrl
      ? { status: 'USER_ENTERED', displayName: input.personName || null, handle: input.handle ? input.handle.replace(/^@/, '') : null, profileUrl, profileType: input.profileType || 'UNKNOWN' }
      : { status: 'NOT_PROVIDED_BY_SOURCE' };
    const postUrl = kind === 'PROFILE' ? null : canonical;
    const contacts = buildContacts({ ...input, profileUrl }, canonical, auth);
    const completeness = dataCompleteness({ authorProvided: author.status !== 'NOT_PROVIDED_BY_SOURCE', contactCount: contacts.length });

    lead = await createLead(auth, {
      name: input.name || input.companyName || input.personName || (input.handle && `@${input.handle.replace(/^@/, '')}`) || cleanPageTitle(input.pageTitle).slice(0, 150) || `${platform.toLowerCase()} lead`,
      personName: input.personName || null,
      companyName: input.companyName || null,
      city: input.city || null,
      country: input.country || null,
      email: input.email || null,
      phone: input.phone || null,
      website: input.website || null,
      socialProfileUrl: profileUrl ? canonicalPageUrl(profileUrl) : null,
      source: 'CHROME_EXTENSION',
      sourceUrl: canonical,
      postUrl,
      matchedHashtag,
      matchedKeyword: intent.matchedKeyword,
      matchedIntentPhrase: intent.matchedIntentPhrase,
      evidenceSnippet: snippet.slice(0, 1000) || null,
      evidence: snippet || null,
      requiredService: input.requiredService || matchService(snippet, settings.services || []),
      force: Boolean(input.force),
    });
    lead.capture = {
      platform,
      postUrl,
      postType: kind === 'POST' ? 'post' : kind === 'PROFILE' ? 'profile' : 'page',
      hashtagsUsed,
      captionSnippet: snippet.slice(0, 1000) || null,
      author,
      contacts,
      dataCompleteness: completeness.level,
      completenessReasons: completeness.reasons,
    };
    if (input.lawfulBasis) lead.compliance = { ...(lead.compliance?.toObject?.() || {}), lawfulBasis: input.lawfulBasis };
    await lead.save();
  }

  if (input.requiredService && lead.requiredService !== input.requiredService) {
    lead.requiredService = input.requiredService;
    await lead.save();
  }
  if (input.notes) await addNote(auth, lead._id, input.notes);
  return { lead: { id: String(lead._id), name: lead.name, doNotContact: lead.doNotContact }, url: leadUrl(lead._id), convertedSignal };
}

/** Existing lead → add this page as another source ("seen again on LinkedIn"). */
export async function addPageAsSource(auth, leadId, { pageUrl, snippet, notes }) {
  const canonical = canonicalPageUrl(pageUrl);
  if (!canonical) throw ApiError.badRequest('This page cannot be saved (only normal web pages)');
  const lead = await addSource(auth, leadId, {
    source: 'CHROME_EXTENSION',
    sourceUrl: canonical,
    postUrl: guessPageKind(canonical) === 'PROFILE' ? null : canonical,
    evidenceSnippet: snippet ? snippet.slice(0, 1000) : null,
  });
  if (notes) await addNote(auth, lead._id, notes);
  return { lead: { id: String(lead._id), name: lead.name }, url: leadUrl(lead._id) };
}

