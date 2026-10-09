import { z, objectId, pagination } from './common.js';
import { FOLLOW_UP_BUCKETS } from '../utils/zonedTime.js';
import { NOTIFICATION_TYPES } from '../config/notificationOptions.js';

const clean = (s) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
const yesNo = z.enum(['true', 'false']).transform((v) => v === 'true');
const note = z.string().trim().max(300).transform(clean);
const futureDate = z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), 'Invalid date');

export const leadParams = z.object({ leadId: objectId }).strict();
export const listQuery = z.object({ ...pagination, bucket: z.enum(FOLLOW_UP_BUCKETS).default('today'), mine: yesNo.optional() }).strict();
export const summaryQuery = z.object({ mine: yesNo.optional() }).strict();
export const setBody = z.object({ date: futureDate, note: note.optional() }).strict();
export const doneBody = z.object({ note: note.optional(), next: futureDate.optional() }).strict();

// ---- notifications
export const idParams = z.object({ id: objectId }).strict();
export const notificationsQuery = z.object({ ...pagination, unread: yesNo.optional() }).strict();
export const prefsBody = z
  .object({ emailDigest: z.boolean().optional(), muted: z.array(z.enum(NOTIFICATION_TYPES)).max(NOTIFICATION_TYPES.length).optional() })
  .strict()
  .refine((d) => d.emailDigest !== undefined || d.muted !== undefined, 'Nothing to update');
