// Validation for Tenant Settings and Industry Packs (same rules for both).
import { isValidTimeZone } from '../utils/zonedTime.js';
import { z, email, httpUrl, safeText, objectId, idParams } from './common.js';
import {
  LEAD_SOURCES, BRAND_TONES, COMPANY_SIZES, TEMPLATE_CHANNELS, SCORING_FACTORS, LIST_LIMITS,
} from '../config/settingsOptions.js';

export { idParams };

/** Removes case-insensitive duplicates, keeps the first spelling. */
export function dedupe(list) {
  const seen = new Set();
  return list.filter((item) => {
    const key = (typeof item === 'string' ? item : item.name).toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// "  need   a plot " → "need a plot"
const phrase = (max = 120) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().min(1, 'Empty item').max(max, `Each item must be at most ${max} characters`))
    .refine((s) => !/[<>{}]/.test(s), 'Characters < > { } are not allowed');

// "#NeedAPlot" → "needaplot". Letters (any language), numbers and _ only — like the platforms allow.
export const hashtag = z
  .string()
  .transform((s) => s.trim().replace(/^#+/, '').normalize('NFKC').toLocaleLowerCase())
  // \p{M} = vowel signs/diacritics used in Urdu, Hindi, Arabic...
  .pipe(z.string().regex(/^[\p{L}\p{M}\p{N}_]{1,60}$/u, 'Hashtags may contain only letters, numbers and _ (no spaces)'));

const list = (item, max) => z.array(item).max(max, `At most ${max} items`).transform(dedupe);

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

const optionalUrl = z
  .union([httpUrl, z.literal('')])
  .transform((s) => (s === '' ? null : s))
  .nullable()
  .optional();

const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s\-()]{5,24}$/, 'Enter a valid phone number')
  .or(z.literal(''))
  .transform((s) => (s === '' ? null : s))
  .nullable()
  .optional();

export const serviceItem = z
  .object({ name: phrase(80), description: z.string().trim().max(300).default('') })
  .strict();

export const templateItem = z
  .object({
    name: phrase(80),
    channel: z.enum(TEMPLATE_CHANNELS),
    subject: z.string().trim().max(150).default(''),
    body: z.string().trim().min(1).max(2000),
  })
  .strict();

const weight = z.number().int().min(0).max(100);
export const scoringWeights = z
  .object(Object.fromEntries(SCORING_FACTORS.map((f) => [f, weight])))
  .strict()
  .refine((w) => Object.values(w).some((v) => v > 0), 'At least one weight must be above 0');

export const pipelineStages = z
  .array(phrase(40))
  .min(2, 'At least 2 stages')
  .max(LIST_LIMITS.pipelineStages)
  .refine((arr) => new Set(arr.map((s) => s.toLocaleLowerCase())).size === arr.length, 'Stage names must be unique');

// ---------------- tenant settings sections ----------------

export const profileBody = z
  .object({
    companyName: safeText(120).optional(), // updates Tenant.name
    description: optionalText(1000),
    email: z.union([email, z.literal('')]).transform((s) => (s === '' ? null : s)).nullable().optional(),
    phone,
    website: optionalUrl,
    address: optionalText(200),
    country: optionalText(60),
    city: optionalText(60),
    socialLinks: z
      .object({ linkedin: optionalUrl, facebook: optionalUrl, instagram: optionalUrl, x: optionalUrl, youtube: optionalUrl })
      .strict()
      .optional(),
  })
  .strict();

// AI settings (spec A21). A specific model needs a specific provider ("Auto" = default models).
export const aiBody = z
  .object({
    provider: z.enum(['AUTO', 'OPENAI', 'ANTHROPIC']).optional(),
    model: z.string().trim().regex(/^[a-z0-9][a-z0-9._:-]{1,80}$/, 'Invalid model id').nullable().optional(),
    temperature: z.number().min(0).max(1).nullable().optional(),
    maxOutputTokens: z.number().int().min(200).max(4000).optional(),
    maxRetries: z.number().int().min(0).max(2).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

export const outreachBody = z
  .object({
    dailyEmailLimit: z.number().int().min(1).max(1000).optional(),
    emailSignature: z.string().trim().max(500).optional(),
    postalAddress: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

export const generalBody = z
  .object({
    timezone: z.string().trim().max(64).refine(isValidTimeZone, 'Unknown time zone (use a name like Asia/Karachi)').optional(),
    digestHour: z.number().int().min(0).max(23).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

export const servicesBody = z.object({ services: list(serviceItem, LIST_LIMITS.services) }).strict();

export const icpBody = z
  .object({
    countries: list(phrase(60), LIST_LIMITS.icpItems).optional(),
    cities: list(phrase(60), LIST_LIMITS.icpItems).optional(),
    industries: list(phrase(60), LIST_LIMITS.icpItems).optional(),
    businessTypes: list(phrase(60), LIST_LIMITS.icpItems).optional(),
    companySizes: z.array(z.enum(COMPANY_SIZES)).max(COMPANY_SIZES.length).transform((a) => [...new Set(a)]).optional(),
    targetRoles: list(phrase(60), LIST_LIMITS.icpItems).optional(),
  })
  .strict();

export const discoveryBody = z
  .object({
    keywords: list(phrase(), LIST_LIMITS.keywords).optional(),
    hashtags: list(hashtag, LIST_LIMITS.hashtags).optional(),
    intentPhrases: list(phrase(), LIST_LIMITS.intentPhrases).optional(),
    negativeKeywords: list(phrase(), LIST_LIMITS.negativeKeywords).optional(),
    preferredSources: z.array(z.enum(LEAD_SOURCES)).max(LEAD_SOURCES.length).transform((a) => [...new Set(a)]).optional(),
  })
  .strict();

export const brandVoiceBody = z
  .object({
    tone: z.enum(BRAND_TONES),
    customInstructions: z.string().trim().max(1000).default(''),
  })
  .strict();

export const brandingBody = z
  .object({
    accentColor: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour like #16a34a')
      .transform((s) => s.toLowerCase())
      .nullable(), // null = back to the default green
  })
  .strict();

export const pipelineBody = z.object({ pipelineStages }).strict();
export const scoringBody = z.object({ scoringWeights }).strict();

export const applyPackBody = z.object({ packId: objectId, mode: z.enum(['REPLACE', 'MERGE']).default('MERGE') }).strict();
export const onboardingCompleteBody = z.object({ skipped: z.boolean().default(false) }).strict();

// ---------------- industry packs (super admin) ----------------

const packFields = {
  name: safeText(80),
  description: z.string().trim().max(500).default(''),
  icon: z.string().trim().regex(/^[a-zA-Z]{1,30}$/).default('sparkles'),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
  services: list(serviceItem, LIST_LIMITS.services).default([]),
  keywords: list(phrase(), LIST_LIMITS.keywords).default([]),
  hashtags: list(hashtag, LIST_LIMITS.hashtags).default([]),
  intentPhrases: list(phrase(), LIST_LIMITS.intentPhrases).default([]),
  negativeKeywords: list(phrase(), LIST_LIMITS.negativeKeywords).default([]),
  sources: z.array(z.enum(LEAD_SOURCES)).max(LEAD_SOURCES.length).transform((a) => [...new Set(a)]).default([]),
  icp: z
    .object({
      industries: list(phrase(60), LIST_LIMITS.icpItems).default([]),
      businessTypes: list(phrase(60), LIST_LIMITS.icpItems).default([]),
      targetRoles: list(phrase(60), LIST_LIMITS.icpItems).default([]),
    })
    .strict()
    .default({}),
  pipelineStages,
  scoringWeights,
  messageTemplates: z.array(templateItem).max(LIST_LIMITS.templates).default([]),
};

export const createPackBody = z
  .object({
    code: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes').max(40),
    ...packFields,
  })
  .strict();

// PATCH: everything optional, no defaults (so missing fields are not reset), code never changes
export const updatePackBody = z
  .object(
    Object.fromEntries(
      Object.entries(packFields).map(([k, schema]) => [k, (schema instanceof z.ZodDefault ? schema.removeDefault() : schema).optional()])
    )
  )
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

// ?v=<logoVersion> only busts the browser cache after a new upload
export const logoQuery = z.object({ v: z.string().regex(/^[a-f0-9]{1,20}$/).optional() }).strict();
