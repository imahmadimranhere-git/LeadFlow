import { z, objectId, idParams, pagination } from './common.js';
import { TEMPLATE_CHANNELS } from '../config/settingsOptions.js';
import { MESSAGE_STATUSES } from '../config/messageOptions.js';

export { idParams };

const channel = z.enum(TEMPLATE_CHANNELS);
const subject = z.string().trim().max(150);
const body = z.string().trim().min(1).max(3000);
// strip control characters but keep new lines
const clean = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

export const generateBody = z
  .object({
    leadId: objectId,
    channel,
    templateId: objectId.optional(),
    instructions: z.string().trim().max(500).transform(clean).optional(),
  })
  .strict();

export const fromTemplateBody = z.object({ leadId: objectId, templateId: objectId }).strict();

export const manualBody = z.object({ leadId: objectId, channel, subject: subject.optional(), body: body.transform(clean) }).strict();

export const editBody = z
  .object({ subject: subject.optional(), body: body.transform(clean).optional() })
  .strict()
  .refine((d) => d.subject !== undefined || d.body !== undefined, 'Nothing to update');

export const regenerateBody = z.object({ instructions: z.string().trim().max(500).transform(clean).optional() }).strict();
export const approveBody = z.object({ confirmSensitive: z.boolean().default(false) }).strict();
export const rejectBody = z.object({ reason: z.string().trim().max(300).optional() }).strict();
export const saveTemplateBody = z.object({ name: z.string().trim().min(1).max(80) }).strict();

const yesNo = z.enum(['true', 'false']).transform((v) => v === 'true');
export const listQuery = z
  .object({ ...pagination, status: z.enum(MESSAGE_STATUSES).optional(), channel: channel.optional(), leadId: objectId.optional(), sensitive: yesNo.optional() })
  .strict();

// ---- templates
const optLabel = z.string().trim().max(80).transform((s) => s || null).nullable().optional();
export const createTemplateBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    channel,
    subject: subject.default(''),
    body: body.transform(clean),
    service: optLabel,
    industry: optLabel,
    isActive: z.boolean().default(true),
  })
  .strict();
export const updateTemplateBody = z
  .object({ name: z.string().trim().min(1).max(80), channel, subject, body: body.transform(clean), service: optLabel, industry: optLabel, isActive: z.boolean() })
  .partial()
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'Nothing to update');
export const templatesQuery = z.object({ channel: channel.optional(), all: yesNo.optional() }).strict();
export const previewBody = z.object({ leadId: objectId }).strict();

// ---- outreach
const note = z.string().trim().max(300).transform(clean).optional();
export const noteBody = z.object({ note }).strict();
export const followUpBody = z.object({ date: z.coerce.date(), note }).strict();
