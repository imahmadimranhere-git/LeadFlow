// Analytics: which sources, keywords, people and messages actually work — with honest uncertainty.
// Every rate shows its 95% range; small samples are marked, and a "best source" is only named when
// the data clearly says so.
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import api from '../../lib/api.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { PageHeader, Card, Field, Badge, Alert, LoadingState, ErrorState } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { moneyMap } from '../../utils/money.js';
import { SOURCE_LABEL } from '../../utils/leadOptions.js';
import { CHANNEL_LABEL, ORIGIN_LABEL } from '../../utils/messageOptions.js';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };
const PRESETS = [[29, '30 days'], [89, '90 days'], [179, '6 months'], [364, '12 months']];
const label = (k) => SOURCE_LABEL?.[k] || k;

/** "20% (11–35%)" with the range in a tooltip; dash when there is no data. */
function Rate({ r }) {
  if (!r) return <span className="text-white/30">—</span>;
  return <span title={`95% range: ${r.low}% – ${r.high}% (${r.k} of ${r.n})`}>{r.rate}% <span className="text-[11px] text-white/35">({r.low}–{r.high})</span></span>;
}

function Verdict({ title, v }) {
  const color = v.status === 'CLEAR' ? 'green' : v.status === 'NO_CLEAR_WINNER' ? 'amber' : 'gray';
  const text = v.status === 'CLEAR' ? `Winner: ${label(v.best)}` : v.status === 'NO_CLEAR_WINNER' ? 'No clear winner yet' : 'Not enough data';
  return (
    <div className="rounded-xl bg-white/[0.03] p-4 ring-1 ring-white/10">
      <p className="text-xs text-white/45">{title}</p>
      <p className="mt-1"><Badge color={color}>{text}</Badge></p>
      <p className="mt-2 text-sm text-white/70">{v.message}</p>
    </div>
  );
}

function FunnelTable({ rows, nameOf = (r) => label(r.key), extra }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-white/45">
          <tr><th className="py-2 pr-3">Name</th><th className="pr-3 text-right">Leads</th><th className="pr-3 text-right">Qualified</th><th className="pr-3 text-right">Contacted</th><th className="pr-3 text-right">Reply rate</th><th className="pr-3 text-right">Conversion</th>{extra && extra.head}</tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="py-2 pr-3">{nameOf(r)} {!r.enoughData && <Badge color="gray">few data</Badge>}</td>
              <td className="pr-3 text-right font-mono">{r.leads}</td>
              <td className="pr-3 text-right"><Rate r={r.qualifiedRate} /></td>
              <td className="pr-3 text-right"><Rate r={r.contactRate} /></td>
              <td className="pr-3 text-right"><Rate r={r.replyRate} /></td>
              <td className="pr-3 text-right"><Rate r={r.conversionRate} /></td>
              {extra && extra.cells(r)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RateRows({ rows, nameOf }) {
  if (!rows.length) return <p className="text-sm text-white/45">Nothing sent in this period.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-white/45"><tr><th className="py-2">Name</th><th className="text-right">Sent</th><th className="text-right">Replied</th><th className="text-right">Reply rate</th></tr></thead>
      <tbody className="divide-y divide-white/5">
        {rows.map((r) => <tr key={r.key}><td className="py-2">{nameOf(r)} {!r.enoughData && <Badge color="gray">few data</Badge>}</td><td className="text-right font-mono">{r.sent}</td><td className="text-right font-mono">{r.replied}</td><td className="text-right"><Rate r={r.replyRate} /></td></tr>)}
      </tbody>
    </table>
  );
}

export default function AnalyticsPage() {
  useDocumentTitle('Analytics');
  const [range, setRange] = useState({ from: daysAgo(89), to: daysAgo(0) });
  const ov = useQuery({ queryKey: ['analytics', 'overview', range], queryFn: async () => (await api.get('/analytics/overview', { params: range })).data.data, placeholderData: keepPreviousData });
  const out = useQuery({ queryKey: ['analytics', 'outreach', range], queryFn: async () => (await api.get('/analytics/outreach', { params: range })).data.data, placeholderData: keepPreviousData });
  const d = ov.data;
  const maxWeek = Math.max(1, ...(d?.series || []).map((w) => w.leads));
  return (
    <>
      <PageHeader title="Analytics" description="Leads created in the period and what happened to them since. Ranges in brackets show how sure we can be (95%)." />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          {PRESETS.map(([n, l]) => <button key={n} type="button" onClick={() => setRange({ from: daysAgo(n), to: daysAgo(0) })} className={`rounded-lg px-3 py-2 text-sm ring-1 ring-white/15 ${range.from === daysAgo(n) && range.to === daysAgo(0) ? 'bg-brand-500/15 text-brand-500' : 'hover:bg-white/5'}`}>{l}</button>)}
          <Field label="From" name="from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Field label="To" name="to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </div>
      </Card>
      {ov.isLoading && <div className="mt-6"><LoadingState rows={6} /></div>}
      {ov.isError && <div className="mt-6"><ErrorState message={apiErrorMessage(ov.error)} onRetry={ov.refetch} /></div>}
      {d && (
        <div className="mt-6 space-y-6">
          {d.truncated && <Alert type="info">Very many leads in this period — only the first 50,000 were counted. Choose a shorter range for exact numbers.</Alert>}
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[['Leads', d.totals.leads, null], ['Qualified', d.totals.qualified, d.totals.qualifiedRate], ['Contacted', d.totals.contacted, d.totals.contactRate], ['Replied', d.totals.replied, d.totals.replyRate], ['Converted', d.totals.converted, d.totals.conversionRate]].map(([l, n, r]) => (
              <div key={l} className="rounded-2xl bg-ink-800 p-4 ring-1 ring-white/10"><p className="text-xs text-white/50">{l}</p><p className="mt-1 text-2xl font-semibold">{n}</p>{r && <p className="text-xs text-white/45"><Rate r={r} /></p>}</div>
            ))}
            <div className="rounded-2xl bg-ink-800 p-4 ring-1 ring-white/10"><p className="text-xs text-white/50">AI cost / qualified lead</p><p className="mt-1 text-2xl font-semibold">{d.totals.aiCostPerQualifiedUsd !== null ? `$${d.totals.aiCostPerQualifiedUsd}` : '—'}</p><p className="text-xs text-white/45">${d.totals.aiCostUsd} total (estimate)</p></div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Verdict title="Best source for conversions" v={d.comparison.conversion} />
            <Verdict title="Best source for replies" v={d.comparison.reply} />
          </div>
          <Card title="By source">
            {d.bySource.length === 0 ? <p className="text-sm text-white/45">No leads in this period.</p> : (
              <FunnelTable rows={d.bySource} extra={{
                head: <><th className="pr-3 text-right">Revenue</th><th className="text-right">AI $ / qualified</th></>,
                cells: (r) => <><td className="pr-3 text-right font-mono text-xs">{Object.keys(r.revenue).length ? moneyMap(r.revenue) : '—'}</td><td className="text-right font-mono">{r.aiCostPerQualifiedUsd !== null ? `$${r.aiCostPerQualifiedUsd}` : '—'}</td></>,
              }} />
            )}
            <p className="mt-3 text-xs text-white/40">Qualified = score ≥ {d.qualifiedThreshold} or moved to Qualified/Negotiation/Converted. Revenue = payments received from the clients these leads became. AI cost is an estimate from your AI usage log.</p>
          </Card>
          <Card title="New leads per week">
            <div className="flex h-32 items-end gap-1">
              {d.series.map((w) => (
                <div key={w.week} className="flex flex-1 flex-col items-center justify-end" title={`Week of ${w.week}: ${w.leads} leads, ${w.converted} converted`}>
                  <div className="w-full rounded-t bg-brand-500/70" style={{ height: `${(w.leads / maxWeek) * 100}%` }} />
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/40">{d.series[0]?.week} → {d.series.at(-1)?.week} (weeks start on Monday)</p>
          </Card>
          <div className="grid gap-6 xl:grid-cols-2">
            <Card title="Keywords & hashtags (top 15)">{d.byKeyword.length ? <FunnelTable rows={d.byKeyword} nameOf={(r) => r.key} /> : <p className="text-sm text-white/45">No keyword data.</p>}</Card>
            <Card title="By owner">{d.byOwner.length ? <FunnelTable rows={d.byOwner} nameOf={(r) => r.name} /> : <p className="text-sm text-white/45">—</p>}</Card>
          </div>
          {out.data && (
            <Card title={`Outreach — ${out.data.totals.sent} sent, reply rate ${out.data.totals.replyRate ? `${out.data.totals.replyRate.rate}%` : '—'}`}>
              <div className="grid gap-6 lg:grid-cols-3">
                <div><p className="mb-1 text-xs text-white/45">By channel</p><RateRows rows={out.data.byChannel} nameOf={(r) => CHANNEL_LABEL[r.key] || r.key} /></div>
                <div><p className="mb-1 text-xs text-white/45">By who wrote it</p><RateRows rows={out.data.byOrigin} nameOf={(r) => ORIGIN_LABEL[r.key] || r.key} /></div>
                <div><p className="mb-1 text-xs text-white/45">By template</p><RateRows rows={out.data.byTemplate} nameOf={(r) => r.name} /></div>
              </div>
              <p className="mt-3 text-xs text-white/40">“few data” = fewer than {out.data.minSent} messages — don't change your strategy because of it yet.</p>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
