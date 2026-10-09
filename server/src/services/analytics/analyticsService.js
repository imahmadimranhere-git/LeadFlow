// Analytics + performance feedback (spec A20 / phase 24).
//
// Cohort view: the leads CREATED in the chosen period, and what happened to them since:
//   qualified  = score ≥ the company's threshold, or moved to Qualified / Negotiation / Converted
//   contacted  = at least one message marked sent
//   replied    = at least one reply logged / received
//   converted  = status Converted, or became a client
// Revenue = payments received from the clients those leads became (per currency).
// Costs = AI cost in the period (estimated USD, from the AI usage log).
import Lead from '../../models/Lead.js';
import LeadActivity from '../../models/LeadActivity.js';
import Client from '../../models/Client.js';
import ClientPayment from '../../models/ClientPayment.js';
import OutreachMessage from '../../models/OutreachMessage.js';
import MessageTemplate from '../../models/MessageTemplate.js';
import AiUsageLog from '../../models/AiUsageLog.js';
import User from '../../models/User.js';
import ApiError from '../../utils/ApiError.js';
import { zonedDayKey, zonedMidnight } from '../../utils/zonedTime.js';
import { companyClock } from '../followUps/followUpService.js';
import { funnelRow, compareSources, costPer, weekStart, weeksBetween, rangeDays, wilson, MIN_SENT } from './analyticsMath.js';

const MAX_LEADS = 50000;
const QUALIFIED_STATUSES = ['QUALIFIED', 'NEGOTIATION', 'CONVERTED'];

/** "YYYY-MM-DD".."YYYY-MM-DD" (company days) → instants [start, end). Default: last 90 days. */
async function resolveRange({ from, to }) {
  const { timezone } = await companyClock();
  const today = zonedDayKey(new Date(), timezone);
  const t = to || today;
  const [ty, tm, td] = t.split('-').map(Number);
  const f = from || new Date(Date.UTC(ty, tm - 1, td - 89)).toISOString().slice(0, 10);
  const days = rangeDays(f, t, 366);
  if (!days) throw ApiError.badRequest('Validation failed', [{ field: 'from', message: 'Choose a valid range of at most 366 days' }]);
  const [fy, fm, fd] = f.split('-').map(Number);
  const next = new Date(Date.UTC(ty, tm - 1, td + 1));
  return { from: f, to: t, days, timezone, start: zonedMidnight(fy, fm, fd, timezone), end: zonedMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timezone) };
}

/** Score at or above this counts as "qualified" (same scale as AI scoring: 0–100). */
const QUALIFIED_SCORE = 60;
const qualifiedThreshold = async () => QUALIFIED_SCORE;

function bump(map, key, field, by = 1) {
  if (!map.has(key)) map.set(key, { leads: 0, qualified: 0, contacted: 0, replied: 0, converted: 0 });
  map.get(key)[field] += by;
}

export async function overview(query) {
  const range = await resolveRange(query);
  const threshold = await qualifiedThreshold();
  const leads = await Lead.find({ createdAt: { $gte: range.start, $lt: range.end } })
    .select('_id source score status matchedKeyword matchedHashtag assignedTo createdAt')
    .limit(MAX_LEADS + 1);
  const truncated = leads.length > MAX_LEADS;
  if (truncated) leads.pop();
  const ids = leads.map((l) => l._id);

  const [sent, replied, clients, ai] = await Promise.all([
    LeadActivity.distinct('leadId', { leadId: { $in: ids }, type: 'MESSAGE_SENT' }),
    LeadActivity.distinct('leadId', { leadId: { $in: ids }, type: 'MESSAGE_REPLIED' }),
    Client.find({ leadId: { $in: ids }, deletedAt: { $not: { $type: 'string' } } }).select('_id leadId'),
    AiUsageLog.find({ createdAt: { $gte: range.start, $lt: range.end } }).select('estimatedCostUsd targetType targetId status').limit(200000),
  ]);
  const sentSet = new Set(sent.map(String));
  const repliedSet = new Set(replied.map(String));
  const clientLead = new Map(clients.map((c) => [String(c._id), String(c.leadId)]));
  const convertedSet = new Set(clients.map((c) => String(c.leadId)));
  const sourceOf = new Map(leads.map((l) => [String(l._id), l.source]));

  const bySource = new Map();
  const byKeyword = new Map();
  const byOwner = new Map();
  const total = { leads: 0, qualified: 0, contacted: 0, replied: 0, converted: 0 };
  const weeks = weeksBetween(range.from, range.to);
  const series = new Map(weeks.map((w) => [w, { week: w, leads: 0, converted: 0 }]));

  for (const l of leads) {
    const id = String(l._id);
    const flags = {
      leads: true,
      qualified: (l.score !== null && l.score >= threshold) || QUALIFIED_STATUSES.includes(l.status),
      contacted: sentSet.has(id),
      replied: repliedSet.has(id),
      converted: l.status === 'CONVERTED' || convertedSet.has(id),
    };
    const kw = l.matchedHashtag ? `#${l.matchedHashtag.replace(/^#/, '')}` : l.matchedKeyword || null;
    for (const [field, on] of Object.entries(flags)) {
      if (!on) continue;
      bump(bySource, l.source, field);
      if (kw) bump(byKeyword, kw, field);
      bump(byOwner, l.assignedTo ? String(l.assignedTo) : '-', field);
      total[field] += 1;
    }
    const w = series.get(weekStart(zonedDayKey(l.createdAt, range.timezone)));
    if (w) {
      w.leads += 1;
      if (flags.converted) w.converted += 1;
    }
  }

  // revenue per source (payments from the clients these leads became)
  const revenue = new Map();
  if (clients.length) {
    const pays = await ClientPayment.find({ clientId: { $in: clients.map((c) => c._id) }, voided: false }).select('clientId currency amountMinor').limit(100000);
    for (const p of pays) {
      const src = sourceOf.get(clientLead.get(String(p.clientId)));
      if (!src) continue;
      const m = revenue.get(src) || {};
      m[p.currency] = (m[p.currency] || 0) + p.amountMinor;
      revenue.set(src, m);
    }
  }

  // AI cost (estimated): total in the period + per source where the request was about one lead
  let aiCost = 0;
  const aiBySource = new Map();
  for (const a of ai) {
    aiCost += a.estimatedCostUsd || 0;
    if (a.targetType === 'Lead' && a.targetId) {
      const src = sourceOf.get(String(a.targetId));
      if (src) aiBySource.set(src, (aiBySource.get(src) || 0) + (a.estimatedCostUsd || 0));
    }
  }

  const sourceRows = [...bySource.entries()]
    .map(([k, c]) => ({ ...funnelRow(k, c), revenue: revenue.get(k) || {}, aiCostUsd: Math.round((aiBySource.get(k) || 0) * 100) / 100, aiCostPerQualifiedUsd: costPer(aiBySource.get(k) || 0, c.qualified) }))
    .sort((a, b) => b.leads - a.leads);
  const owners = await User.find({ _id: { $in: [...byOwner.keys()].filter((k) => k !== '-') } }).select('name');
  const ownerName = new Map(owners.map((u) => [String(u._id), u.name]));

  return {
    range: { from: range.from, to: range.to, days: range.days, timezone: range.timezone },
    qualifiedThreshold: threshold,
    truncated,
    totals: { ...funnelRow('ALL', total), aiCostUsd: Math.round(aiCost * 100) / 100, aiCostPerQualifiedUsd: costPer(aiCost, total.qualified) },
    bySource: sourceRows,
    comparison: { conversion: compareSources(sourceRows, 'conversionRate'), reply: compareSources(sourceRows, 'replyRate') },
    byKeyword: [...byKeyword.entries()].map(([k, c]) => funnelRow(k, c)).sort((a, b) => b.leads - a.leads).slice(0, 15),
    byOwner: [...byOwner.entries()].map(([k, c]) => ({ ...funnelRow(k, c), name: k === '-' ? 'Unassigned' : ownerName.get(k) || '(removed user)' })).sort((a, b) => b.leads - a.leads),
    series: [...series.values()],
  };
}

/** Outreach: reply rates by channel, by who/what wrote the message, by template — with sample-size warnings. */
export async function outreachStats(query) {
  const range = await resolveRange(query);
  const msgs = await OutreachMessage.find({ sentAt: { $gte: range.start, $lt: range.end }, status: { $in: ['SENT', 'REPLIED', 'FOLLOW_UP', 'CLOSED'] } })
    .select('channel origin templateId status repliedAt')
    .limit(MAX_LEADS);
  const group = (keyFn) => {
    const m = new Map();
    for (const x of msgs) {
      const k = keyFn(x);
      if (!k) continue;
      const g = m.get(k) || { sent: 0, replied: 0 };
      g.sent += 1;
      if (x.repliedAt || x.status === 'REPLIED') g.replied += 1;
      m.set(k, g);
    }
    return [...m.entries()].map(([key, g]) => ({ key, sent: g.sent, replied: g.replied, replyRate: wilson(g.replied, g.sent), enoughData: g.sent >= MIN_SENT })).sort((a, b) => b.sent - a.sent);
  };
  const byTemplate = group((x) => (x.templateId ? String(x.templateId) : null));
  const names = new Map((await MessageTemplate.find({ _id: { $in: byTemplate.map((t) => t.key) }, deletedAt: { $not: { $type: 'string' } } }).select('name')).map((t) => [String(t._id), t.name]));
  const all = group(() => 'ALL')[0] || { sent: 0, replied: 0, replyRate: null, enoughData: false };
  return {
    range: { from: range.from, to: range.to, timezone: range.timezone },
    minSent: MIN_SENT,
    totals: all,
    byChannel: group((x) => x.channel),
    byOrigin: group((x) => x.origin),
    byTemplate: byTemplate.map((t) => ({ ...t, name: names.get(t.key) || '(deleted template)' })),
  };
}
