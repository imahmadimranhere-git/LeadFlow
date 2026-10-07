// Re-usable Zod building blocks. Every endpoint schema uses .strict() → unknown fields are rejected.
import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const idParams = z.object({ id: objectId }).strict();

export const pagination = {
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
};

/** sort must be one of the allowed fields, optionally prefixed with "-" */
export const sortBy = (allowedFields) =>
  z
    .string()
    .max(50)
    .refine((v) => allowedFields.includes(v.replace(/^-/, '')), {
      message: `sort must be one of: ${allowedFields.join(', ')}`,
    })
    .optional();

export const safeText = (max = 200) => z.string().trim().min(1).max(max);
export const optionalText = (max = 200) => z.string().trim().max(max).optional();

export const email = z.string().trim().toLowerCase().max(254).email();

// Only http/https — blocks javascript:, data:, file: etc.
export const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Only http/https URLs are allowed');

export { z };
