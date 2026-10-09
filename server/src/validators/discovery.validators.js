import { z, objectId, idParams, pagination } from './common.js';
import { LEAD_SOURCES } from '../config/leadOptions.js';
import { CANDIDATE_STATUSES } from '../models/DiscoveryCandidate.js';
import { IMPORT_FIELDS } from '../services/leads/import/csvParser.js';

export { idParams };

const optText = (max) => z.string().trim().max(max).nullable().optional();

export const queriesQuery = z.object({ source: z.enum(LEAD_SOURCES) }).strict();

export const createRunBody = z
  .object({
    source: z.enum(LEAD_SOURCES),
    queries: z
      .array(
        z
          .object({
            query: z.string().trim().min(2).max(300),
            matchedKeyword: optText(120),
            matchedIntentPhrase: optText(120),
            matchedHashtag: optText(60),
            location: optText(60),
          })
          .strict()
      )
      .min(1)
      .max(10, 'At most 10 queries per run'),
  })
  .strict();

export const runsQuery = z.object({ ...pagination }).strict();
export const candidatesQuery = z
  .object({ ...pagination, status: z.enum(CANDIDATE_STATUSES).optional(), intentLevel: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']).optional() })
  .strict();
export const candidateIdsBody = z.object({ ids: z.array(objectId).min(1).max(100).transform((a) => [...new Set(a)]) }).strict();

// CSV import
export const previewBody = z
  .object({
    mapping: z.record(z.string().max(200), z.enum(IMPORT_FIELDS).nullable()).refine((m) => Object.keys(m).length <= 50, 'Too many columns'),
    options: z.object({ importPossibleDuplicates: z.boolean().optional(), assignToMe: z.boolean().optional() }).strict().optional(),
  })
  .strict();

// ---- Local business (Google Places, live)
export const localSearchBody = z
  .object({
    query: z.string().trim().min(2).max(200),
    pageToken: z.string().max(2000).optional(),
    regionCode: z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()).optional(),
  })
  .strict();
export const localImportBody = z
  .object({
    query: z.string().trim().max(200).optional(),
    city: z.string().trim().max(60).optional(),
    places: z
      .array(z.object({ placeId: z.string().regex(/^[A-Za-z0-9_-]{10,300}$/, 'Invalid place id'), name: z.string().trim().min(1).max(150) }).strict())
      .min(1)
      .max(50),
  })
  .strict();
