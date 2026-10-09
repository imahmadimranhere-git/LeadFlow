// One in-app notification for ONE user. Only ever shown to that user (every query filters by userId).
// Kept for 90 days (TTL index). dedupeKey stops the same event notifying twice (e.g. the runner on two servers).
import mongoose from '../config/mongoose.js';
import tenantScopePlugin from './plugins/tenantScope.js';
import { NOTIFICATION_TYPES, NOTIFICATION_RETENTION_DAYS } from '../config/notificationOptions.js';

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, maxlength: 160, required: true },
    body: { type: String, maxlength: 300, default: '' }, // may contain a lead's words → shown as plain text
    link: { type: String, maxlength: 200, default: null, match: /^\/app\/[A-Za-z0-9/_?=&.-]*$/ }, // in-app path only (no open redirect)
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    readAt: { type: Date, default: null },
    dedupeKey: { type: String, maxlength: 200, default: null, private: true },
  },
  { timestamps: true, strict: 'throw' }
);

notificationSchema.plugin(tenantScopePlugin);
notificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ tenantId: 1, userId: 1, readAt: 1 });
notificationSchema.index({ tenantId: 1, userId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_RETENTION_DAYS * 24 * 3600 });

const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
export default Notification;
