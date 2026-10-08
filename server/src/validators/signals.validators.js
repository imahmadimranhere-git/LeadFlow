// Validation for Hashtag Watches, Signals inbox and Meta connection.
import { z, objectId, idParams, pagination, email, httpUrl } from './common.js';
import { hashtag, dedupe } from './settings.validators.js';
import { WATCH_PLATFORMS, WATCH_SCHEDULES } from '../models/HashtagWatch.js';
import { SIGNAL_STATUSES } from '../models/Signal.js';
import { LEAD_SOURCES } from '../config/leadOptions.js';
import { LAWFUL_BASES, PROFILE_TYPES } from '../models/captureSchemas.js';

export { idParams };

const word = z.string().trim().min(2).max(60).regex(/^[^<>{}$]+$/, 'No < > { } $ characters');
const list = (item, max) => z.array(item).max(max, `At most ${max} items`).transform(dedupe);

const watchFields = {
  name: z.string().trim().min(1).max(80),
  platform: z.enum(WATCH_PLATFORMS).default('INSTAGRAM'),
  // Instagram allows 30 unique hashtags per 7 days for the WHOLE account → max 10 per watch
  hashtags: list(hashtag, 10).refine((a) => a.length >= 1, 'Add at least one hashtag'),
  keywords: list(word, 20).default([]),
  locations: list(word, 10).default([]),
  scheduleHours: z.coerce.number().int().refine((n) => WATCH_SCHEDULES.includes(n), `Every ${WATCH_SCHEDULES.join(', ')} hours`).default(6),
  maxResultsPerHashtag: z.coerce.number().int().min(5).max(50).default(50),
  isActive: z.boolean().default(true),
};

export const createWatchBody = z.object(watchFields).strict();

export const updateWatchBody = z
  .object({
    name: watchFields.name,
    hashtags: watchFields.hashtags,
    keywords: list(word, 20),
    locations: list(word, 10),
    scheduleHours: z.coerce.number().int().refine((n) => WATCH_SCHEDULES.includes(n), `Every ${WATCH_SCHEDULES.join(', ')} hours`),
    maxResultsPerHashtag: z.coerce.number().int().min(5).max(50),
    isActive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');

const yesNo = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listSignalsQuery = z
  .object({
    ...pagination,
    status: z.enum(SIGNAL_STATUSES).optional(),
    source: z.enum(LEAD_SOURCES).optional(),
    watchId: objectId.optional(),
    intentLevel: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']).optional(),
    hasPublicContact: yesNo.optional(),
    search: z.string().trim().max(60).optional(),
  })
  .strict();

const optText = (max) => z.string().trim().max(max).transform((s) => s || null).nullable().optional();

/** What the person saw on the public profile (A28: stored as USER_ENTERED, never as a fact from the source). */
export const convertSignalBody = z
  .object({
    name: optText(150),
    companyName: optText(150),
    displayName: optText(120),
    handle: z.string().trim().regex(/^@?[A-Za-z0-9._]{1,30}$/, 'Instagram handle: letters, numbers, . and _').optional(),
    profileUrl: httpUrl.refine((u) => /^https:\/\/(www\.)?(instagram|facebook)\.com\//i.test(u), 'Must be an instagram.com or facebook.com link').optional(),
    profileType: z.enum(PROFILE_TYPES).optional(),
    phone: z.string().trim().regex(/^\+?[0-9][0-9\s\-().]{5,24}$/, 'Enter a valid phone number').optional(),
    email: email.optional(),
    publiclyStated: z.boolean().default(false), // "I saw this contact publicly on their profile/post"
    city: optText(60),
    lawfulBasis: z.enum(LAWFUL_BASES).optional(),
    force: z.boolean().default(false),
  })
  .strict();

export const signalIdsBody = z.object({ ids: z.array(objectId).min(1).max(100).transform((a) => [...new Set(a)]) }).strict();

export const selectAccountBody = z.object({ igUserId: z.string().regex(/^\d{5,30}$/, 'Invalid account id') }).strict();

export const oauthCallbackQuery = z
  .object({
    code: z.string().max(2000).optional(),
    state: z.string().max(200).optional(),
    error: z.string().max(200).optional(),
    error_reason: z.string().max(200).optional(),
    error_description: z.string().max(500).optional(),
    error_code: z.string().max(50).optional(),
  })
  .passthrough(); // Facebook may add params; we only READ the ones above
