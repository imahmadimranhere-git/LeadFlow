// Follow-ups (spec A15): a date + note on a lead. "Today / overdue / this week" use the COMPANY's time zone.
//
//  - Visibility = lead visibility (Sales: own leads; managers/admins: all).
//  - "Mine" = I am the owner (assigned to me, or unassigned and created by me).
//  - When the follow-up time arrives, the owner gets ONE notification for that date (runner, below);
//    changing the date makes a new one possible. Several servers can't double-notify (atomic claim).
//  - Daily email digest: opt-in per person, sent from the company's own mailbox at the company's hour.
import env from '../../config/env.js';
import Lead from '../../models/Lead.js';
import LeadActivity from '../../models/LeadActivity.js';
import User from '../../models/User.js';
import Tenant from '../../models/Tenant.js';
import TenantSettings from '../../models/TenantSettings.js';
import ApiError from '../../utils/ApiError.js';
import logger from '../../config/logger.js';
import { buildPagination } from '../../utils/queryBuilder.js';
import { runAsSystem, runWithTenant } from '../../utils/tenantContext.js';
import { followUpRanges, bucketOf, zonedDayKey, zonedParts, isValidTimeZone } from '../../utils/zonedTime.js';
import { DEFAULT_TIMEZONE, DEFAULT_DIGEST_HOUR } from '../../config/notificationOptions.js';
import { scopeFilter } from '../leads/leadService.js';
import { notify, leadOwnerIds } from '../notifications/notificationService.js';
import { getCredentials } from '../integrations/vaultService.js';
import { createSmtpTransport } from '../integrations/smtp.js';
import { buildDigestEmail } from './digestEmail.js';

const CLOSED_STATUSES = ['CONVERTED', 'LOST', 'NOT_INTERESTED'];
const SELECT = 'name companyName personName phone email status priority score assignedTo createdBy followUpDate followUpNote doNotContact lastActivityAt';

export async function companyClock(tenantId) {
  const s = await TenantSettings.findOne(tenantId ? { tenantId } : {}).select('general');
  const tz = s?.general?.timezone && isValidTimeZone(s.general.timezone) ? s.general.timezone : DEFAULT_TIMEZONE;
  return { timezone: tz, digestHour: s?.general?.digestHour ?? DEFAULT_DIGEST_HOUR };
}

const mineFilter = (userId) => ({ $or: [{ assignedTo: userId }, { assignedTo: null, createdBy: userId }] });

async function loadLead(auth, id) {
  const lead = await Lead.findOne({ _id: id, ...scopeFilter(auth) });
  if (!lead) throw ApiError.notFound('Lead not found');
  return lead;
}

// ---------------------------------------------------------------- list + counts

export async function listFollowUps(auth, { bucket, page, limit, mine }, now = new Date()) {
  const { timezone } = await companyClock();
  const ranges = followUpRanges(now, timezone);
  const { skip } = buildPagination(page, limit);
  const and = [scopeFilter(auth), { followUpDate: ranges[bucket] }];
  if (mine) and.push(mineFilter(auth.userId));
  const filter = { $and: and.filter((f) => Object.keys(f).length) };
  const [items, total] = await Promise.all([
    Lead.find(filter).select(SELECT).sort({ followUpDate: 1, _id: 1 }).skip(skip).limit(limit).populate('assignedTo', 'name'),
    Lead.countDocuments(filter),
  ]);
  return { items: items.map((l) => ({ ...l.toJSON(), bucket })), total, timezone };
}

export async function followUpSummary(auth, { mine } = {}, now = new Date()) {
  const { timezone } = await companyClock();
  const ranges = followUpRanges(now, timezone);
  const base = [scopeFilter(auth), ...(mine ? [mineFilter(auth.userId)] : [])].filter((f) => Object.keys(f).length);
  const count = (range) => Lead.countDocuments({ $and: [...base, { followUpDate: range }] });
  const [overdue, today, upcoming] = await Promise.all([count(ranges.overdue), count(ranges.today), count(ranges.upcoming)]);
  return { overdue, today, upcoming, timezone, todayKey: zonedDayKey(now, timezone) };
}

// ---------------------------------------------------------------- set / done

export async function setFollowUp(auth, leadId, { date, note }) {
  const lead = await loadLead(auth, leadId);
  if (date.getTime() < Date.now() - 60_000) throw ApiError.badRequest('Choose a follow-up time in the future');
  if (date.getTime() > Date.now() + 2 * 365 * 24 * 3600 * 1000) throw ApiError.badRequest('Choose a date within the next 2 years');
  await Lead.updateOne({ _id: lead._id }, { $set: { followUpDate: date, followUpNote: note ?? lead.followUpNote ?? null, lastActivityAt: new Date() } });
  await LeadActivity.create({ leadId: lead._id, type: 'FOLLOW_UP_SET', body: note || '', meta: { date: date.toISOString(), previous: lead.followUpDate ? lead.followUpDate.toISOString() : null }, actorId: auth.userId });
  return getFollowUp(auth, lead._id);
}

/** Done: clears the follow-up (optionally schedules the next one right away). */
export async function completeFollowUp(auth, leadId, { note, next }) {
  const lead = await loadLead(auth, leadId);
  if (!lead.followUpDate) throw ApiError.conflict('This lead has no open follow-up.');
  if (next && next.getTime() < Date.now() - 60_000) throw ApiError.badRequest('The next follow-up must be in the future');
  const r = await Lead.updateOne({ _id: lead._id, followUpDate: lead.followUpDate }, { $set: { followUpDate: next || null, followUpNote: null, lastActivityAt: new Date() } });
  if (!r.modifiedCount) throw ApiError.conflict('The follow-up was changed by someone else — reload.');
  await LeadActivity.create({ leadId: lead._id, type: 'FOLLOW_UP_DONE', body: note || '', meta: { was: lead.followUpDate.toISOString(), next: next ? next.toISOString() : null }, actorId: auth.userId });
  return getFollowUp(auth, lead._id);
}

export async function clearFollowUp(auth, leadId) {
  const lead = await loadLead(auth, leadId);
  await Lead.updateOne({ _id: lead._id }, { $set: { followUpDate: null, followUpNote: null } });
  await LeadActivity.create({ leadId: lead._id, type: 'FOLLOW_UP_SET', body: 'Follow-up removed', meta: { date: null }, actorId: auth.userId });
  return getFollowUp(auth, lead._id);
}

export async function getFollowUp(auth, leadId, now = new Date()) {
  const lead = await Lead.findOne({ _id: leadId, ...scopeFilter(auth) }).select('followUpDate followUpNote');
  if (!lead) throw ApiError.notFound('Lead not found');
  const { timezone } = await companyClock();
  return { followUpDate: lead.followUpDate, followUpNote: lead.followUpNote, bucket: bucketOf(lead.followUpDate, now, timezone), timezone };
}

// ---------------------------------------------------------------- runner: "due" notifications

/** Leads whose follow-up time has come and who weren't notified for THIS date yet. */
export async function notifyDueFollowUps(now = new Date(), { batch = 200 } = {}) {
  const due = await runAsSystem('followups:due', () =>
    Lead.find({ followUpDate: { $lte: now }, status: { $nin: CLOSED_STATUSES }, $expr: { $ne: ['$followUpNotifiedFor', '$followUpDate'] } })
      .select('_id tenantId name followUpDate followUpNote assignedTo createdBy')
      .sort({ followUpDate: 1 })
      .limit(batch)
  );
  let sent = 0;
  for (const lead of due) {
    // claim (only one server notifies for this date)
    const claimed = await runAsSystem('followups:claim', () =>
      Lead.updateOne({ _id: lead._id, followUpDate: lead.followUpDate, followUpNotifiedFor: { $ne: lead.followUpDate } }, { $set: { followUpNotifiedFor: lead.followUpDate } })
    );
    if (!claimed.modifiedCount) continue;
    await runWithTenant({ tenantId: lead.tenantId }, async () => {
      const ids = await leadOwnerIds(lead);
      sent += await notify({
        userIds: ids,
        type: 'FOLLOW_UP_DUE',
        title: `Follow up with ${lead.name}`,
        body: lead.followUpNote || '',
        link: `/app/leads/${lead._id}`,
        leadId: lead._id,
        dedupeKey: `followup:${lead._id}:${lead.followUpDate.toISOString()}`,
      });
    });
  }
  return sent;
}

// ---------------------------------------------------------------- runner: daily email digest (opt-in)

export async function sendDailyDigests(now = new Date(), { batch = 200 } = {}) {
  const users = await runAsSystem('followups:digest-users', () =>
    User.find({ 'notificationPrefs.emailDigest': true, status: 'ACTIVE' }).select('_id tenantId name email role digestSentFor').limit(batch * 5)
  );
  const byTenant = new Map();
  for (const u of users) {
    const k = String(u.tenantId);
    if (!byTenant.has(k)) byTenant.set(k, []);
    byTenant.get(k).push(u);
  }
  let sent = 0;
  for (const [tenantId, list] of byTenant) {
    await runWithTenant({ tenantId }, async () => {
      const { timezone, digestHour } = await companyClock();
      const day = zonedDayKey(now, timezone);
      if (zonedParts(now, timezone).hour < digestHour) return; // not time yet today
      const pending = list.filter((u) => u.digestSentFor !== day);
      if (!pending.length) return;
      const smtp = await getCredentials('SMTP', { purpose: 'followups:digest' });
      const tenant = await Tenant.findById(tenantId).select('name');
      const ranges = followUpRanges(now, timezone);
      for (const u of pending) {
        const claim = await User.updateOne({ _id: u._id, digestSentFor: { $ne: day } }, { $set: { digestSentFor: day } });
        if (!claim.modifiedCount) continue; // another server is doing it
        if (!smtp) continue; // no company mailbox → nothing we can send from (in-app notifications still work)
        const auth = { userId: String(u._id), tenantId, role: u.role };
        const scope = [scopeFilter(auth), mineFilter(u._id)].filter((f) => Object.keys(f).length);
        const items = await Lead.find({ $and: [...scope, { followUpDate: { $lt: ranges.today.$lt } }, { status: { $nin: CLOSED_STATUSES } }] }).select('name companyName followUpDate followUpNote').sort({ followUpDate: 1 }).limit(50);
        if (!items.length) continue; // nothing due → no email
        const mail = buildDigestEmail({
          userName: u.name,
          companyName: tenant?.name || 'LeadFlow',
          items: items.map((l) => ({ id: String(l._id), name: l.name, date: l.followUpDate, note: l.followUpNote, overdue: l.followUpDate < ranges.today.$gte })),
          appUrl: String(env.CLIENT_URL).split(',')[0],
          timezone,
          day,
        });
        let transport;
        try {
          transport = await createSmtpTransport(smtp.secrets, smtp.config);
          const from = smtp.config.fromName ? `"${String(smtp.config.fromName).replace(/["\r\n]/g, '')}" <${smtp.config.fromEmail}>` : smtp.config.fromEmail;
          await transport.sendMail({ from, to: u.email, subject: mail.subject, text: mail.text, html: mail.html });
          sent += 1;
        } catch (err) {
          logger.warn({ code: err?.code, userId: String(u._id) }, 'follow-up digest email failed');
        } finally {
          transport?.close?.();
        }
      }
    });
  }
  return sent;
}
