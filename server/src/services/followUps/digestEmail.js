// Daily follow-up email — PURE (unit-tested). Lead names/notes are user data → escaped in HTML, one line in
// the subject (no header injection). Links only point to our own app.
import { escapeHtml, oneLine } from '../outreach/emailBuilder.js';

const fmt = (d, timezone) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d));

export function buildDigestEmail({ userName, companyName, items, appUrl, timezone, day }) {
  const base = String(appUrl || '').replace(/\/$/, '');
  const overdue = items.filter((i) => i.overdue).length;
  const subject = oneLine(`${items.length} follow-up${items.length === 1 ? '' : 's'} today${overdue ? ` (${overdue} overdue)` : ''} — ${companyName}`).slice(0, 150);
  const lines = items.map((i) => `- ${oneLine(i.name)} — ${fmt(i.date, timezone)}${i.overdue ? ' (OVERDUE)' : ''}${i.note ? `\n  ${oneLine(i.note)}` : ''}\n  ${base}/app/leads/${i.id}`);
  const text = [`Hi ${oneLine(userName)},`, '', `Your follow-ups for ${day}:`, '', ...lines, '', `All follow-ups: ${base}/app/follow-ups`, '', 'You get this email because you turned on the daily follow-up email in LeadFlow (Notifications → My settings).'].join('\n');
  const rows = items
    .map((i) => `<li style="margin:0 0 10px"><a href="${escapeHtml(`${base}/app/leads/${i.id}`)}">${escapeHtml(i.name)}</a> — ${escapeHtml(fmt(i.date, timezone))}${i.overdue ? ' <b style="color:#b45309">overdue</b>' : ''}${i.note ? `<br><span style="color:#555">${escapeHtml(i.note)}</span>` : ''}</li>`)
    .join('');
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222"><p>Hi ${escapeHtml(userName)},</p><p>Your follow-ups for ${escapeHtml(day)}:</p><ul style="padding-left:18px">${rows}</ul><p><a href="${escapeHtml(`${base}/app/follow-ups`)}">Open all follow-ups</a></p><p style="color:#888;font-size:12px">You get this email because you turned on the daily follow-up email in LeadFlow (Notifications → My settings).</p></div>`;
  return { subject, text, html };
}
