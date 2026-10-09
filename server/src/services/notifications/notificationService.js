// In-app notifications.
//  - notify() is called by other services INSIDE the tenant context; it never throws (a notification must
//    never break the action that caused it).
//  - A notification about a lead only goes to people who can see that lead (its owner, or managers/admins).
//  - Each user only ever reads/changes their OWN notifications (every query filters by userId).
//  - People can mute types they don't want.
import Notification from '../../models/Notification.js';
import User from '../../models/User.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { buildPagination } from '../../utils/queryBuilder.js';
import { ROLE_PERMISSIONS, PERMISSIONS as P } from '../../config/permissions.js';
import { NOTIFICATION_TYPES } from '../../config/notificationOptions.js';

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Roles that see ALL leads and can act on them (owner, admin, manager). */
export const LEAD_MANAGER_ROLES = Object.entries(ROLE_PERMISSIONS)
  .filter(([, perms]) => perms.includes(P.LEADS_READ_ALL) && perms.includes(P.LEADS_WRITE))
  .map(([role]) => role);

export async function managerIds() {
  const users = await User.find({ role: { $in: LEAD_MANAGER_ROLES }, status: 'ACTIVE' }).select('_id').limit(50);
  return users.map((u) => u._id);
}

/** Who is responsible for a lead: assigned person → creator → (nobody active) managers. */
export async function leadOwnerIds(lead) {
  const owner = lead.assignedTo || lead.createdBy;
  if (owner) {
    const u = await User.findOne({ _id: owner, status: 'ACTIVE' }).select('_id');
    if (u) return [u._id];
  }
  return managerIds();
}

/**
 * @param userIds   recipients (ObjectIds/strings); duplicates and `exceptUserId` removed
 * @param dedupeKey optional — the same key for the same user is stored once
 */
export async function notify({ userIds, type, title, body = '', link = null, leadId = null, dedupeKey = null, exceptUserId = null }) {
  try {
    const ids = [...new Set((userIds || []).map(String))].filter((id) => id && id !== String(exceptUserId || ''));
    if (!ids.length) return 0;
    const users = await User.find({ _id: { $in: ids }, status: 'ACTIVE', 'notificationPrefs.muted': { $ne: type } }).select('_id').limit(100);
    if (!users.length) return 0;
    const docs = users.map((u) => ({ userId: u._id, type, title: clip(title, 160), body: clip(body, 300), link, leadId, dedupeKey }));
    try {
      const r = await Notification.insertMany(docs, { ordered: false });
      return r.length;
    } catch (err) {
      if (err.code === 11000 || err.writeErrors) return err.insertedDocs?.length ?? err.result?.insertedCount ?? 0; // already notified
      throw err;
    }
  } catch (err) {
    logger.warn({ err: err.message, type }, 'notification failed');
    return 0;
  }
}

// ---------------------------------------------------------------- API (own notifications only)

const mine = (auth) => ({ userId: auth.userId });

export async function listNotifications(auth, { page, limit, unread }) {
  const { skip } = buildPagination(page, limit);
  const filter = { ...mine(auth), ...(unread ? { readAt: null } : {}) };
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...mine(auth), readAt: null }),
  ]);
  return { items: items.map((n) => n.toJSON()), total, unreadCount };
}

export async function unreadCount(auth) {
  return { unread: await Notification.countDocuments({ ...mine(auth), readAt: null }) };
}

export async function markRead(auth, id) {
  const r = await Notification.findOneAndUpdate({ _id: id, ...mine(auth) }, { $set: { readAt: new Date() } }, { new: true });
  if (!r) throw ApiError.notFound('Notification not found'); // someone else's = "not found"
  return r.toJSON();
}

export async function markAllRead(auth) {
  const r = await Notification.updateMany({ ...mine(auth), readAt: null }, { $set: { readAt: new Date() } });
  return { updated: r.modifiedCount };
}

export async function getPreferences(auth) {
  const u = await User.findById(auth.userId).select('notificationPrefs email');
  if (!u) throw ApiError.notFound('User not found');
  const p = u.notificationPrefs?.toObject ? u.notificationPrefs.toObject() : u.notificationPrefs || {};
  return { emailDigest: Boolean(p.emailDigest), muted: p.muted || [], email: u.email, types: NOTIFICATION_TYPES };
}

export async function updatePreferences(auth, { emailDigest, muted }) {
  const set = {};
  if (emailDigest !== undefined) set['notificationPrefs.emailDigest'] = emailDigest;
  if (muted !== undefined) set['notificationPrefs.muted'] = [...new Set(muted)];
  await User.updateOne({ _id: auth.userId }, { $set: set });
  return getPreferences(auth);
}
