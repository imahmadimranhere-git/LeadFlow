// Export requests: type + format + ALLOW-LISTED filters per type (anything else is rejected).
import { z, objectId, pagination } from './common.js';
import { EXPORT_TYPE_KEYS } from '../services/exports/exportTypes.js';
import { LEAD_SOURCES, LEAD_STATUSES, LEAD_PRIORITIES } from '../config/leadOptions.js';
import { MESSAGE_STATUSES } from '../config/messageOptions.js';
import { TEMPLATE_CHANNELS } from '../config/settingsOptions.js';
import { QUOTE_STATUSES } from '../config/erpOptions.js';
import { SIGNAL_STATUSES } from '../models/Signal.js';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const text = (max) => z.string().trim().min(1).max(max);
const range = { from: day.optional(), to: day.optional() };

const FILTERS = {
  LEADS: z.object({ ...range, source: z.enum(LEAD_SOURCES).optional(), status: z.enum(LEAD_STATUSES).optional(), priority: z.enum(LEAD_PRIORITIES).optional(), city: text(60).optional(), country: text(60).optional(), matchedHashtag: text(60).optional(), tag: text(40).optional(), minScore: z.number().int().min(0).max(100).optional(), assignedTo: objectId.optional() }).strict(),
  SIGNALS: z.object({ ...range, status: z.enum(SIGNAL_STATUSES).optional(), source: z.enum(LEAD_SOURCES).optional(), matchedHashtag: text(60).optional(), watchId: objectId.optional() }).strict(),
  FOLLOW_UPS: z.object(range).strict(),
  OUTREACH: z.object({ ...range, channel: z.enum(TEMPLATE_CHANNELS).optional(), status: z.enum(MESSAGE_STATUSES).optional() }).strict(),
  QUOTES: z.object({ ...range, status: z.enum(QUOTE_STATUSES).optional() }).strict(),
  INVOICES: z.object({ ...range, status: z.enum(['DRAFT', 'ISSUED', 'PAID', 'VOID']).optional() }).strict(),
  EXPENSES: z.object({ ...range, category: text(40).optional(), status: z.enum(['RECORDED', 'VOID']).optional() }).strict(),
  AI_USAGE: z.object(range).strict(),
  AUDIT_LOGS: z.object({ ...range, action: z.string().regex(/^[a-z_.]{2,80}$/, 'Invalid action').optional() }).strict(),
};

/** Filter names per type (sent to the browser so the form shows only allowed filters). */
export const FILTER_KEYS = Object.fromEntries(Object.entries(FILTERS).map(([k, schema]) => [k, Object.keys(schema.shape)]));

export const createExportBody = z
  .object({
    type: z.enum(EXPORT_TYPE_KEYS),
    format: z.enum(['CSV', 'PDF']),
    filters: z.record(z.unknown()).optional(),
    columns: z.array(z.string().regex(/^[A-Za-z]{1,40}$/)).max(60).optional(),
    includeDoNotContact: z.boolean().optional(),
    overrideReason: z.string().trim().max(300).optional(),
    password: z.string().max(200).optional(),
  })
  .strict()
  .transform((d, ctx) => {
    const r = FILTERS[d.type].safeParse(d.filters ?? {});
    if (!r.success) {
      for (const i of r.error.issues) ctx.addIssue({ ...i, path: ['filters', ...i.path] });
      return z.NEVER;
    }
    if (r.data.from && r.data.to && r.data.from > r.data.to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['filters', 'from'], message: '"from" must be before "to"' });
      return z.NEVER;
    }
    return { ...d, filters: r.data };
  });

export const idParams = z.object({ id: objectId }).strict();
export const listQuery = z.object(pagination).strict();
export const tokenParams = z.object({ token: z.string().max(400) }).strict();
export const reportBody = z
  .object({ format: z.enum(['PDF', 'CSV']).default('PDF'), from: day, to: day, password: z.string().max(200).optional() })
  .strict()
  .refine((d) => d.from <= d.to, '"from" must be before "to"')
  .refine((d) => (Date.parse(d.to) - Date.parse(d.from)) / 86400000 <= 366, 'At most 366 days');
