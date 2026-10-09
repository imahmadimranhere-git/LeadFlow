import { z, objectId, idParams, pagination } from './common.js';
import { TEMPLATE_CHANNELS } from '../config/settingsOptions.js';
import { CONVERSATION_STATUSES } from '../models/Conversation.js';

export { idParams };

// strip control characters but keep new lines / tabs
const clean = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
const yesNo = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listQuery = z
  .object({
    ...pagination,
    status: z.enum(CONVERSATION_STATUSES).optional(),
    channel: z.enum(TEMPLATE_CHANNELS).optional(),
    leadId: objectId.optional(),
    unmatched: yesNo.optional(),
    unread: yesNo.optional(),
    q: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const startBody = z.object({ leadId: objectId, channel: z.enum(TEMPLATE_CHANNELS) }).strict();

export const logBody = z
  .object({
    direction: z.enum(['INBOUND', 'OUTBOUND']),
    body: z.string().trim().min(1).max(5000).transform(clean),
    at: z.coerce.date().optional(),
  })
  .strict();

export const statusBody = z.object({ status: z.enum(CONVERSATION_STATUSES) }).strict();
export const linkBody = z.object({ leadId: objectId }).strict();
export const createLeadBody = z.object({ name: z.string().trim().min(1).max(120).transform(clean).optional() }).strict();
export const suggestBody = z.object({ instructions: z.string().trim().max(500).transform(clean).optional() }).strict();
export const draftBody = z.object({ subject: z.string().trim().max(150).optional(), body: z.string().trim().min(1).max(3000).transform(clean) }).strict();
