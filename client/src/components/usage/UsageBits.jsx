// Shared pieces for the AI usage dashboards (company + super admin).
import { Badge } from '../ui.jsx';

export const usd = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(Number(n) !== 0 && Math.abs(n) < 0.01 ? 4 : 2)}`);
export const num = (n) => Number(n || 0).toLocaleString();
export const label = (k) => String(k || '—').toLowerCase().replace(/_/g, ' ');

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
export const PRESETS = [[6, '7 days'], [29, '30 days'], [89, '90 days'], [364, '12 months']];

/** Cost per day as simple bars (no chart library). Empty days are shown, not skipped. */
export function DailyBars({ days, field = 'costUsd', format = usd }) {
  const max = Math.max(...days.map((d) => d[field]), 0);
  if (!days.length) return null;
  return (
    <div>
      <div className="flex h-32 items-end gap-px" role="img" aria-label="Daily AI cost">
        {days.map((d) => (
          <div key={d.day} className="group relative flex-1" style={{ height: '100%' }} title={`${d.day}: ${format(d[field])} · ${d.requests} requests${d.failed ? ` (${d.failed} failed)` : ''}`}>
            <div className="absolute bottom-0 w-full rounded-t bg-brand-500/70 group-hover:bg-brand-500" style={{ height: max > 0 ? `${Math.max(d[field] > 0 ? 2 : 0, (d[field] / max) * 100)}%` : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-white/35"><span>{days[0].day}</span><span>max {format(max)}/day</span><span>{days[days.length - 1].day}</span></div>
    </div>
  );
}

/** Breakdown table: name, requests, failed, tokens, cost, share. */
export function BreakdownTable({ rows, nameOf, empty = 'No AI requests in this period.', extraHead, extraCell }) {
  if (!rows?.length) return <p className="text-sm text-white/45">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-white/45">
          <tr><th className="py-2 pr-3">Name</th><th className="pr-3 text-right">Requests</th><th className="pr-3 text-right">Failed</th><th className="pr-3 text-right">Tokens</th><th className="pr-3 text-right">Est. cost</th><th className="pr-3 text-right">Share</th>{extraHead}</tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-2 pr-3">{nameOf(r)}</td>
              <td className="pr-3 text-right font-mono">{num(r.requests)}</td>
              <td className="pr-3 text-right font-mono">{r.failed ? <Badge color="red">{r.failed}</Badge> : 0}</td>
              <td className="pr-3 text-right font-mono">{num(r.tokens)}</td>
              <td className="pr-3 text-right font-mono">{usd(r.costUsd)}</td>
              <td className="pr-3 text-right text-white/60">{r.costShare}%</td>
              {extraCell && extraCell(r)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
