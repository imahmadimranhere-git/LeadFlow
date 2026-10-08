// Shared building blocks of the "Hashtag Lead Capture Record" (spec A28) — used by Signal and Lead.
import mongoose from '../config/mongoose.js';

export const PROVENANCES = ['POST_TEXT', 'PUBLIC_BIO', 'BUSINESS_CONTACT_BUTTON', 'LEAD_FORM', 'USER_ENTERED', 'CSV_IMPORT'];
export const CONTACT_TYPES = ['PHONE', 'WHATSAPP', 'EMAIL', 'WEBSITE'];
export const AUTHOR_STATUSES = ['PROVIDED', 'NOT_PROVIDED_BY_SOURCE', 'USER_ENTERED'];
export const PROFILE_TYPES = ['PERSONAL', 'BUSINESS', 'CREATOR', 'UNKNOWN'];
export const COMPLETENESS = ['COMPLETE', 'PARTIAL', 'MINIMAL'];

/** Every contact value remembers WHERE it came from (provenance) and whether the author stated it publicly. */
export const contactSchema = new mongoose.Schema(
  {
    type: { type: String, enum: CONTACT_TYPES, required: true },
    value: { type: String, required: true, maxlength: 2048 },
    provenance: { type: String, enum: PROVENANCES, required: true },
    provenanceUrl: { type: String, maxlength: 2048, default: null },
    capturedAt: { type: Date, default: Date.now },
    capturedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    publiclyStatedByAuthor: { type: Boolean, default: false },
    verified: { type: Boolean, default: false },
  },
  { _id: false }
);

export const authorSchema = new mongoose.Schema(
  {
    status: { type: String, enum: AUTHOR_STATUSES, default: 'NOT_PROVIDED_BY_SOURCE' },
    displayName: { type: String, maxlength: 120, default: null },
    handle: { type: String, maxlength: 60, default: null },
    profileUrl: { type: String, maxlength: 2048, default: null },
    profileType: { type: String, enum: PROFILE_TYPES, default: 'UNKNOWN' },
  },
  { _id: false }
);

/** A28 block 3 (WHERE) + who/contacts, as captured from the source */
export const captureSchema = new mongoose.Schema(
  {
    platform: { type: String, maxlength: 30, default: null },
    postId: { type: String, maxlength: 100, default: null },
    postType: { type: String, maxlength: 30, default: null },
    postUrl: { type: String, maxlength: 2048, default: null },
    hashtagsUsed: { type: [String], default: [] },
    captionSnippet: { type: String, maxlength: 1000, default: null },
    postTimestamp: { type: Date, default: null },
    engagement: { likes: { type: Number, default: null }, comments: { type: Number, default: null } },
    author: { type: authorSchema, default: () => ({}) },
    contacts: { type: [contactSchema], default: [] },
    signalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Signal', default: null },
    watchId: { type: mongoose.Schema.Types.ObjectId, ref: 'HashtagWatch', default: null },
    dataCompleteness: { type: String, enum: [...COMPLETENESS, null], default: null },
    completenessReasons: { type: [String], default: [] },
  },
  { _id: false }
);

export const LAWFUL_BASES = ['LEGITIMATE_INTEREST', 'CONSENT', 'CONTRACT', 'OTHER'];
export const CONSENT_STATUSES = ['NONE', 'REQUESTED', 'GIVEN', 'WITHDRAWN'];

/** A28 block 5 (COMPLIANCE & CONSENT) */
export const complianceSchema = new mongoose.Schema(
  {
    lawfulBasis: { type: String, enum: [...LAWFUL_BASES, null], default: null },
    consentStatus: { type: String, enum: CONSENT_STATUSES, default: 'NONE' },
    consentProof: { type: String, maxlength: 500, default: null },
    optOutAt: { type: Date, default: null },
    dataRetentionUntil: { type: Date, default: null },
    contactPolicyNotes: { type: String, maxlength: 500, default: null },
  },
  { _id: false }
);
