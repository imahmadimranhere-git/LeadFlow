// A potential customer. Tenant-scoped + soft delete.
// Every lead keeps WHY and WHERE it was found (source fields + evidence + sourcesHistory) —
// the "Why was this lead discovered?" panel is never hidden.
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import softDeletePlugin from './plugins/softDelete.js';
import { LEAD_STATUSES, LEAD_PRIORITIES, LEAD_TYPES, LEAD_INTENTS, LEAD_SOURCES } from '../config/leadOptions.js';
import { captureSchema, complianceSchema } from './captureSchemas.js';

const str = (max) => ({ type: String, trim: true, maxlength: max, default: null });

const sourceEntrySchema = new mongoose.Schema(
  {
    source: { type: String, enum: LEAD_SOURCES, required: true },
    sourceUrl: str(2048),
    postUrl: str(2048),
    searchQuery: str(300),
    matchedKeyword: str(120),
    matchedHashtag: str(60),
    matchedIntentPhrase: str(120),
    evidenceSnippet: str(1000),
    discoveredAt: { type: Date, default: Date.now },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    // ---- who ----
    name: { type: String, required: true, trim: true, maxlength: 150 }, // lead title, e.g. "Acme Bakery — website"
    personName: str(120),
    companyName: str(150),
    industry: str(80),
    country: str(60),
    city: str(60),
    website: str(2048),
    email: str(254),
    phone: str(30),
    socialProfileUrl: str(2048),
    language: str(30),

    // normalised identity keys (duplicate detection) — internal: `private` keeps them out of API responses
    emailNormalized: { type: String, default: null, private: true },
    websiteNormalized: { type: String, default: null, private: true },
    phoneNormalized: { type: String, default: null, private: true },
    socialNormalized: { type: String, default: null, private: true },
    companyCityKey: { type: String, default: null, private: true },

    // ---- why discovered ----
    source: { type: String, enum: LEAD_SOURCES, default: 'MANUAL' },
    sourceUrl: str(2048),
    postUrl: str(2048),
    searchQuery: str(300),
    matchedKeyword: str(120),
    matchedHashtag: str(60),
    matchedIntentPhrase: str(120),
    evidence: str(5000),
    evidenceSnippet: str(1000),
    discoveryTimestamp: { type: Date, default: Date.now },
    sourcesHistory: { type: [sourceEntrySchema], default: [] },
    placeId: { type: String, maxlength: 300, default: null }, // Google place ID (allowed to be stored by Google's terms)

    // ---- what they need (only what was actually stated/observed) ----
    description: str(3000),
    businessProblem: str(1000),
    requiredService: str(150),
    interestedItems: { type: [String], default: [] },
    budgetStated: str(120), // ONLY if the lead really said it

    // ---- CRM ----
    status: { type: String, enum: LEAD_STATUSES, default: 'NEW' },
    pipelineStage: { type: String, trim: true, maxlength: 40, default: null },
    priority: { type: String, enum: LEAD_PRIORITIES, default: 'MEDIUM' },
    tags: { type: [String], default: [] },
    customFields: { type: Map, of: String, default: {} },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    followUpDate: { type: Date, default: null },
    followUpNote: { type: String, trim: true, maxlength: 300, default: null },
    followUpNotifiedFor: { type: Date, default: null, private: true }, // = followUpDate once the "due" notification went out
    lastActivityAt: { type: Date, default: Date.now },

    // ---- AI (filled from Phase 14; read-only for users) ----
    score: { type: Number, min: 0, max: 100, default: null },
    scoreReason: str(2000),
    intent: { type: String, enum: [...LEAD_INTENTS, null], default: null },
    leadType: { type: String, enum: [...LEAD_TYPES, null], default: null },
    recommendedAction: str(500),
    potentialService: str(120),
    scoredAt: { type: Date, default: null },

    // ---- Hashtag Lead Capture Record (A28) — only for leads from posts / forms ----
    capture: { type: captureSchema, default: null },
    compliance: { type: complianceSchema, default: () => ({}) },

    // ---- safety ----
    suspectedInjection: { type: Boolean, default: false }, // text looks like an attempt to manipulate AI
    doNotContact: { type: Boolean, default: false }, // matches the company's do-not-contact list
    mergedInto: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, strict: 'throw' }
);

leadSchema.plugin(tenantScopePlugin);
leadSchema.plugin(softDeletePlugin);

// List / filter indexes (tenantId first: every query is tenant-scoped)
leadSchema.index({ tenantId: 1, deletedAt: 1, createdAt: -1 });
leadSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
leadSchema.index({ tenantId: 1, pipelineStage: 1, lastActivityAt: -1 });
leadSchema.index({ tenantId: 1, assignedTo: 1, createdAt: -1 });
leadSchema.index({ followUpDate: 1 }, { partialFilterExpression: { followUpDate: { $type: 'date' } } });
leadSchema.index({ tenantId: 1, tags: 1 });
leadSchema.index({ tenantId: 1, score: -1 });
// one lead per Google place per company
leadSchema.index({ tenantId: 1, placeId: 1 }, { unique: true, partialFilterExpression: { placeId: { $type: 'string' }, deletedAt: { $type: 'null' } } });
// "Is this page already a lead?" (Chrome extension)
leadSchema.index({ tenantId: 1, postUrl: 1 }, { partialFilterExpression: { postUrl: { $type: 'string' } } });
leadSchema.index({ tenantId: 1, 'sourcesHistory.sourceUrl': 1 });
// Duplicate protection. Strong keys (email, website, phone, social profile) are UNIQUE per company
// among non-deleted leads → even two requests at the exact same moment can't create a duplicate.
// (Same lead in two DIFFERENT companies is fine — tenantId is part of the key.)
for (const key of ['emailNormalized', 'websiteNormalized', 'phoneNormalized', 'socialNormalized']) {
  leadSchema.index(
    { tenantId: 1, [key]: 1 },
    { unique: true, partialFilterExpression: { [key]: { $type: 'string' }, deletedAt: { $type: 'null' } } }
  );
}
// Weak key (same company name in same city) is only a warning → normal index
leadSchema.index({ tenantId: 1, companyCityKey: 1 }, { partialFilterExpression: { companyCityKey: { $type: 'string' } } });

const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
export default Lead;
