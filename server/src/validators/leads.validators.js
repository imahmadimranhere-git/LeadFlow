import { z, objectId, idParams, pagination, sortBy, email, httpUrl } from './common.js';
import { hashtag, dedupe } from './settings.validators.js';
import { LEAD_STATUSES, LEAD_PRIORITIES, LEAD_SOURCES, LEAD_LIMITS, DNC_TYPES } from '../config/leadOptions.js';
import { normalizeWebsite } from '../services/leads/normalize.js';
import { LAWFUL_BASES, CONSENT_STATUSES } from '../models/captureSchemas.js';

export { idParams };

const text = (max) => z.string().trim().max(max);
const optText = (max) => text(max).transform((s) => s || null).nullable().optional();
const optUrl = z.union([httpUrl, z.literal('')]).transform((s) => s || null).nullable().optional();

// "acme.com" is fine for a website → stored as "https://acme.com"
const website = z
  .string()
  .trim()
  .max(2048)
  .transform((s) => (s && !/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? `https://${s}` : s))
  .refine((s) => !s || (/^https?:\/\//i.test(s) && normalizeWebsite(s)), 'Enter a valid website (e.g. acme.com)')
  .transform((s) => s || null)
  .nullable()
  .optional();

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s\-().]{5,24}$/, 'Enter a valid phone number')
  .or(z.literal(''))
  .transform((s) => s || null)
  .nullable()
  .optional();

const tag = z
  .string()
  .transform((s) => s.trim().toLowerCase().replace(/\s+/g, '-'))
  .pipe(z.string().regex(/^[\p{L}\p{M}\p{N}_-]{1,40}$/u, 'Tags: letters, numbers, - and _ only'));
export const tags = z.array(tag).max(LEAD_LIMITS.tags).transform(dedupe);

const customFields = z
  .record(z.string().regex(/^[A-Za-z][\w ]{0,39}$/, 'Field names: letters, numbers, spaces'), z.string().trim().max(500))
  .refine((o) => Object.keys(o).length <= LEAD_LIMITS.customFields, `At most ${LEAD_LIMITS.customFields} custom fields`);

// re-used by the Chrome extension endpoint
export { website as websiteField, phone as phoneField };

// Fields a person may edit
const editable = {
  name: text(150).min(1),
  personName: optText(120),
  companyName: optText(150),
  industry: optText(80),
  country: optText(60),
  city: optText(60),
  website,
  email: z.union([email, z.literal('')]).transform((s) => s || null).nullable().optional(),
  phone,
  socialProfileUrl: optUrl,
  language: optText(30),
  description: optText(3000),
  businessProblem: optText(1000),
  requiredService: optText(150),
  interestedItems: z.array(text(80).min(1)).max(LEAD_LIMITS.interestedItems).transform(dedupe).optional(),
  budgetStated: optText(120),
  status: z.enum(LEAD_STATUSES).optional(),
  pipelineStage: text(40).min(1).optional(),
  priority: z.enum(LEAD_PRIORITIES).optional(),
  tags: tags.optional(),
  customFields: customFields.optional(),
  assignedTo: objectId.nullable().optional(),
  followUpDate: z.coerce.date().nullable().optional(),
};

// Where the lead was found — set when created, then only ADDED to (never edited) for honest provenance
const discoveryFields = {
  source: z.enum(LEAD_SOURCES).default('MANUAL'),
  sourceUrl: optUrl,
  postUrl: optUrl,
  searchQuery: optText(300),
  matchedKeyword: optText(120),
  matchedHashtag: hashtag.nullable().optional(),
  matchedIntentPhrase: optText(120),
  evidence: optText(5000),
  evidenceSnippet: optText(1000),
};

export const createLeadBody = z
  .object({
    ...editable,
    name: text(150).optional(), // derived from company/person if missing
    ...discoveryFields,
    force: z.boolean().default(false), // only overrides the WEAK "same company + city" warning
  })
  .strict()
  .refine((d) => d.name || d.companyName || d.personName, { message: 'Enter a lead name, company or person', path: ['name'] });

// A28 block 5 — compliance & consent (only via PATCH; never set from the browser on create)
export const complianceBody = z
  .object({
    lawfulBasis: z.enum(LAWFUL_BASES).nullable().optional(),
    consentStatus: z.enum(CONSENT_STATUSES).optional(),
    consentProof: optText(500),
    contactPolicyNotes: optText(500),
    dataRetentionUntil: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

export const updateLeadBody = z
  .object({ ...editable, compliance: complianceBody })
  .partial()
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

export const addSourceBody = z
  .object({ ...discoveryFields, source: z.enum(LEAD_SOURCES) })
  .strict()
  .refine((d) => d.sourceUrl || d.postUrl || d.evidenceSnippet || d.searchQuery, 'Add at least a URL, a search query or an evidence snippet');

export const checkDuplicatesBody = z
  .object({ email: z.string().max(254).optional(), website: z.string().max(2048).optional(), phone: z.string().max(30).optional(), socialProfileUrl: z.string().max(2048).optional(), companyName: z.string().max(150).optional(), city: z.string().max(60).optional() })
  .strict();

const yesNo = z.enum(['true', 'false']).transform((v) => v === 'true');
export const listLeadsQuery = z
  .object({
    ...pagination,
    search: z.string().trim().max(60).optional(),
    status: z.enum(LEAD_STATUSES).optional(),
    pipelineStage: z.string().trim().max(40).optional(),
    priority: z.enum(LEAD_PRIORITIES).optional(),
    source: z.enum(LEAD_SOURCES).optional(),
    tag: tag.optional(),
    assignedTo: z.union([z.enum(['me', 'unassigned']), objectId]).optional(),
    doNotContact: yesNo.optional(),
    minScore: z.coerce.number().int().min(0).max(100).optional(),
    sort: sortBy(['createdAt', 'updatedAt', 'lastActivityAt', 'score', 'name', 'followUpDate']),
  })
  .strict();

export const stageBody = z.object({ pipelineStage: text(40).min(1) }).strict();

export const bulkBody = z
  .object({
    ids: z.array(objectId).min(1).max(LEAD_LIMITS.bulk).transform((a) => [...new Set(a)]),
    action: z.enum(['status', 'stage', 'priority', 'assign', 'addTag', 'removeTag', 'delete']),
    value: z.string().trim().max(60).nullable().optional(),
  })
  .strict();

export const mergeBody = z.object({ duplicateId: objectId }).strict();
export const noteBody = z.object({ body: text(5000).min(1) }).strict();
export const noteParams = z.object({ id: objectId, noteId: objectId }).strict();
export const activitiesQuery = z.object({ ...pagination }).strict();

export const dncBody = z.object({ type: z.enum(DNC_TYPES), value: text(300).min(1), reason: text(300).optional() }).strict();
export const dncListQuery = z.object({ ...pagination, type: z.enum(DNC_TYPES).optional() }).strict();
