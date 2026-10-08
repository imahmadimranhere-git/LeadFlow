// Validation for the Chrome extension API. Everything the extension sends is untrusted.
import { z, idParams, email, httpUrl } from './common.js';
import { hashtag } from './settings.validators.js';
import { websiteField, phoneField } from './leads.validators.js';
import { LAWFUL_BASES, PROFILE_TYPES } from '../models/captureSchemas.js';

export { idParams };

const optText = (max) => z.string().trim().max(max).transform((s) => s || null).nullable().optional();
// page text from the browser: strip control characters (keeps new lines and tabs)
const pageText = (max) =>
  z.string().max(max * 2).transform((s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max)).optional();

export const pairBody = z
  .object({
    code: z.string().trim().min(8).max(12),
    deviceName: z.string().trim().max(60).optional(),
  })
  .strict();

export const tokenBody = z.object({ refreshToken: z.string().min(20).max(200) }).strict();

export const checkBody = z
  .object({
    url: httpUrl,
    email: email.optional(),
    phone: z.string().trim().max(30).optional(),
    website: z.string().trim().max(2048).optional(),
    profileUrl: httpUrl.optional(),
  })
  .strict();

export const saveLeadBody = z
  .object({
    pageUrl: httpUrl,
    pageTitle: pageText(300),
    snippet: pageText(3000), // only what the user selected / typed
    name: optText(150),
    personName: optText(120),
    handle: z.string().trim().regex(/^@?[A-Za-z0-9._-]{1,60}$/, 'Handle: letters, numbers, . _ -').optional(),
    profileUrl: httpUrl.optional(),
    profileType: z.enum(PROFILE_TYPES).optional(),
    companyName: optText(150),
    city: optText(60),
    country: optText(60),
    email: z.union([email, z.literal('')]).transform((s) => s || null).nullable().optional(),
    phone: phoneField,
    website: websiteField,
    contactSource: z.enum(['POST_TEXT', 'PUBLIC_BIO', 'BUSINESS_CONTACT_BUTTON', 'USER_ENTERED']).default('USER_ENTERED'),
    requiredService: optText(150),
    matchedHashtag: hashtag.optional(),
    notes: pageText(2000),
    lawfulBasis: z.enum(LAWFUL_BASES).optional(),
    force: z.boolean().default(false),
  })
  .strict();

export const addSourceBody = z
  .object({
    pageUrl: httpUrl,
    snippet: pageText(1000),
    notes: pageText(2000),
  })
  .strict();
