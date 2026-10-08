// Signals inbox: list, open, convert to lead (with the full A28 capture record), dismiss.
import Signal from '../../models/Signal.js';
import ApiError from '../../utils/ApiError.js';
import { buildPagination, escapeRegex } from '../../utils/queryBuilder.js';
import { createLead } from '../leads/leadService.js';
import { dataCompleteness } from './extract.js';

export async function listSignals({ page, limit, status, source, watchId, intentLevel, hasPublicContact, search }) {
  const filter = {};
  if (status) filter.status = status;
  if (source) filter.source = source;
  if (watchId) filter.watchId = watchId;
  if (intentLevel) filter.intentLevel = intentLevel;
  if (hasPublicContact !== undefined) filter.hasPublicContact = hasPublicContact;
  if (search) filter.fullPublicText = new RegExp(escapeRegex(search), 'i');
  const { skip } = buildPagination(page, limit);
  const [items, total] = await Promise.all([
    Signal.find(filter).select('-fullPublicText -formFields').sort({ discoveredAt: -1 }).skip(skip).limit(limit).populate('watchId', 'name'),
    Signal.countDocuments(filter),
  ]);
  return { items: items.map((s) => s.toJSON()), total };
}

export async function getSignal(id) {
  const s = await Signal.findById(id).populate('watchId', 'name');
  if (!s) throw ApiError.notFound('Signal not found');
  return s.toJSON();
}

const firstOf = (contacts, ...types) => contacts.find((c) => types.includes(c.type))?.value || null;

/**
 * Turns a signal into a lead. When the source didn't say who posted (Instagram), the person converting
 * can type what THEY saw on the public profile — stored with provenance USER_ENTERED, never as a fact
 * from the source.
 */
export async function convertSignal(auth, id, input) {
  // claim first → double click can't create two leads
  const signal = await Signal.findOneAndUpdate({ _id: id, status: { $in: ['NEW', 'NEEDS_REVIEW', 'FILTERED'] } }, { $set: { status: 'CONVERTED' } }, { new: false });
  if (!signal) {
    if (!(await Signal.exists({ _id: id }))) throw ApiError.notFound('Signal not found'); // incl. other companies' signals
    throw ApiError.conflict('This signal was already converted or dismissed');
  }

  try {
    const cap = signal.capture?.toObject ? signal.capture.toObject() : signal.capture;
    const contacts = [...(cap.contacts || [])];
    for (const [type, value] of [['PHONE', input.phone], ['EMAIL', input.email], ['WEBSITE', input.website]]) {
      // (the Chrome extension may say WHERE the person saw it: post text, public bio, contact button)
      const provenance = input.contactProvenance || 'USER_ENTERED';
      if (value) contacts.push({ type, value, provenance, provenanceUrl: provenance === 'PUBLIC_BIO' && input.profileUrl ? input.profileUrl : cap.postUrl, capturedAt: new Date(), capturedBy: auth.userId, publiclyStatedByAuthor: provenance !== 'USER_ENTERED' || Boolean(input.publiclyStated) });
    }
    const author = input.handle || input.displayName
      ? { status: 'USER_ENTERED', displayName: input.displayName || null, handle: input.handle ? input.handle.replace(/^@/, '') : null, profileUrl: input.profileUrl || null, profileType: input.profileType || 'UNKNOWN' }
      : cap.author;
    const completeness = dataCompleteness({ authorProvided: author.status !== 'NOT_PROVIDED_BY_SOURCE', contactCount: contacts.length });

    const lead = await createLead(auth, {
      name: input.name || author.displayName || (author.handle && `@${author.handle}`) || `${signal.source.toLowerCase()} post #${signal.matchedHashtag || ''}`.trim(),
      personName: author.displayName || null,
      companyName: input.companyName || signal.formFields?.get?.('company') || null,
      city: input.city || signal.matchedLocation || null,
      email: firstOf(contacts, 'EMAIL'),
      phone: firstOf(contacts, 'PHONE', 'WHATSAPP'),
      website: firstOf(contacts, 'WEBSITE'),
      socialProfileUrl: author.profileUrl || null,
      source: signal.source,
      postUrl: cap.postUrl,
      sourceUrl: cap.postUrl,
      matchedHashtag: signal.matchedHashtag,
      matchedKeyword: signal.matchedKeyword,
      matchedIntentPhrase: signal.matchedIntentPhrase,
      evidenceSnippet: cap.captionSnippet || null,
      evidence: signal.fullPublicText || null,
      requiredService: signal.matchedService,
      force: Boolean(input.force),
    });

    // attach the A28 record + compliance to the new lead
    lead.capture = { ...cap, author, contacts, signalId: signal._id, dataCompleteness: completeness.level, completenessReasons: completeness.reasons };
    const sigCompliance = signal.compliance?.toObject ? signal.compliance.toObject() : signal.compliance;
    lead.compliance = { ...sigCompliance, lawfulBasis: input.lawfulBasis || sigCompliance?.lawfulBasis || null };
    if (signal.suspectedInjection) lead.suspectedInjection = true;
    await lead.save();

    await Signal.updateOne({ _id: signal._id }, { $set: { leadId: lead._id, expiresAt: null } });
    return lead;
  } catch (err) {
    await Signal.updateOne({ _id: signal._id, status: 'CONVERTED', leadId: null }, { $set: { status: signal.status } }); // give it back
    throw err;
  }
}

export async function dismissSignals(ids) {
  const r = await Signal.updateMany({ _id: { $in: ids }, status: { $in: ['NEW', 'NEEDS_REVIEW', 'FILTERED'] } }, { $set: { status: 'DISMISSED' } });
  return { dismissed: r.modifiedCount };
}
