// AI usage & cost (Phase 26): today / this month, monthly budget, plan quota, daily cost, what the money
// went on (feature, model, person, key), errors, the most expensive leads, and every request (metadata only).
// All costs are ESTIMATES from the platform's price list — the AI provider's bill is the real cost.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import api from '../../lib/api.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader, Card, StatCard, Badge, Pager, Field, SelectField, Alert, ProgressBar, LoadingState, ErrorState, EmptyState } from '../../components/ui.jsx';
import { DailyBars, BreakdownTable, usd, num, label, daysAgo, PRESETS } from '../../components/usage/UsageBits.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

const STATUS_COLOR = { SUCCESS: 'green', FAILED: 'red', INVALID_OUTPUT: 'amber' };
const LEVEL = { NONE: ['gray', 'No budget set'], OK: ['green', 'Within budget'], WARN: ['amber', 'Near the budget'], EXCEEDED: ['red', 'Budget used up'] };
const TYPES = ['LEAD_SCORING', 'MESSAGE_GENERATION', 'REPLY_GENERATION', 'WEBSITE_AUDIT', 'CLASSIFICATION', 'OTHER'];
const opts = (list) => [{ value: '', label: 'All' }, ...list.map((v) => ({ value: v, label: label(v) }))];

function BudgetCard({ budget, canEdit }) {
  const [color, text] = LEVEL[budget.level] || LEVEL.NONE;
  return (
    <Card title="Monthly AI budget" action={canEdit && <Link to="/app/settings/company" className="text-xs text-brand-500 underline">Change</Link>}>
      {budget.level === 'NONE' ? (
        <p className="text-sm text-white/55">No budget set. Spent this month so far: <b>{usd(budget.spentUsd)}</b>. {canEdit ? 'Set a budget in Settings → Company → AI to get an alert before costs run away.' : ''}</p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge color={color}>{text}</Badge>
            <span><b>{usd(budget.spentUsd)}</b> of {usd(budget.monthlyBudgetUsd)} ({budget.percent}%)</span>
            {budget.hardStop && <Badge color="gray">hard stop on</Badge>}
          </div>
          <ProgressBar value={budget.spentUsd} max={budget.monthlyBudgetUsd} />
          <p className="text-xs text-white/45">
            Alert at {budget.alertPercent}% · {budget.remainingUsd !== null && `${usd(budget.remainingUsd)} left · `}
            {budget.projectedUsd !== null ? `at this pace about ${usd(budget.projectedUsd)} by the end of the month` : 'projection after the 3rd day of the month'}
          </p>
          {budget.level === 'EXCEEDED' && budget.hardStop && <Alert>New AI requests are paused until next month or until the budget is raised.</Alert>}
        </div>
      )}
    </Card>
  );
}

function QuotaCard({ quota }) {
  const row = (title, q) => (
    <div>
      <div className="mb-1 flex justify-between text-sm"><span>{title}</span><span className="font-mono text-white/60">{num(q.used)} / {q.unlimited ? '∞' : num(q.limit)}</span></div>
      <ProgressBar value={q.used} max={q.unlimited ? -1 : q.limit} />
    </div>
  );
  return (
    <Card title={`Plan limits (${quota.plan}, ${quota.period})`}>
      <div className="space-y-3">
        {row('AI requests', quota.aiRequests)}
        {row('AI tokens', quota.aiTokens)}
        <p className="text-xs text-white/40">When a limit is reached, AI features stop until next month or an upgrade (Settings → Billing).</p>
      </div>
    </Card>
  );
}

function RequestList({ range }) {
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ requestType: '', status: '', keySource: '' });
  const params = { page, limit: 25, from: range.from, to: range.to, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) };
  const list = useQuery({ queryKey: ['ai', 'usage', 'list', params], queryFn: async () => (await api.get('/ai/usage', { params })).data.data, placeholderData: keepPreviousData });
  const set = (k) => (e) => { setPage(1); setF({ ...f, [k]: e.target.value }); };
  return (
    <Card title="Requests" action={<Link to="/app/exports" className="text-xs text-brand-500 underline">Export CSV</Link>}>
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <SelectField label="Feature" name="requestType" value={f.requestType} onChange={set('requestType')} options={opts(TYPES)} />
        <SelectField label="Status" name="status" value={f.status} onChange={set('status')} options={opts(['SUCCESS', 'FAILED', 'INVALID_OUTPUT'])} />
        <SelectField label="Key" name="keySource" value={f.keySource} onChange={set('keySource')} options={[{ value: '', label: 'All' }, { value: 'TENANT', label: 'Your own key' }, { value: 'PLATFORM', label: 'Platform key' }]} />
      </div>
      {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
      {list.isLoading && <LoadingState rows={4} />}
      {list.data?.items.length === 0 && <EmptyState icon="cpu" title="No AI requests match" />}
      {list.data?.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-white/40">
              <tr><th className="py-2 pr-4">When</th><th className="pr-4">Feature</th><th className="pr-4">Model</th><th className="pr-4">Key</th><th className="pr-4">Tokens</th><th className="pr-4">Cost</th><th className="pr-4">Status</th><th>User</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {list.data.items.map((l) => (
                <tr key={l.id}>
                  <td className="py-2 pr-4 text-xs text-white/60">{formatDateTime(l.createdAt)}</td>
                  <td className="pr-4">{label(l.requestType)}</td>
                  <td className="pr-4 font-mono text-xs">{l.model}</td>
                  <td className="pr-4 text-xs">{l.keySource === 'TENANT' ? 'yours' : 'platform'}</td>
                  <td className="pr-4">{num(l.totalTokens)}</td>
                  <td className="pr-4">{usd(l.estimatedCostUsd)}</td>
                  <td className="pr-4"><Badge color={STATUS_COLOR[l.status]}>{label(l.status)}</Badge>{l.attempts > 1 && <span className="ml-1 text-xs text-white/40">×{l.attempts}</span>}{l.errorCode && <span className="ml-1 text-xs text-white/40">{label(l.errorCode)}</span>}</td>
                  <td className="text-xs text-white/60">{l.userId?.name || 'background job'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager pagination={list.data?.pagination} onPage={setPage} />
    </Card>
  );
}

export default function AiUsagePage() {
  useDocumentTitle('AI usage');
  const { can } = useAuth();
  const [range, setRange] = useState({ from: daysAgo(29), to: daysAgo(0) });
  const summary = useQuery({ queryKey: ['ai', 'usage', 'summary'], queryFn: async () => (await api.get('/ai/usage/summary')).data.data, refetchInterval: 60_000 });
  const report = useQuery({ queryKey: ['ai', 'usage', 'report', range], queryFn: async () => (await api.get('/ai/usage/report', { params: range })).data.data, placeholderData: keepPreviousData, enabled: Boolean(range.from && range.to) });

  if (summary.isLoading) return <LoadingState rows={4} />;
  if (summary.isError) return <ErrorState message={apiErrorMessage(summary.error)} onRetry={summary.refetch} />;
  const { today, month, budget, quota, timezone } = summary.data;
  const r = report.data;

  return (
    <>
      <PageHeader title="AI usage & cost" description={`Estimated from the platform's price list — your AI provider's bill is the real cost. Days follow your company time zone (${timezone}).`} />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Cost today (est.)" value={usd(today.costUsd)} hint={`${num(today.requests)} requests${today.failed ? ` · ${today.failed} failed` : ''}`} />
          <StatCard label="Cost this month (est.)" value={usd(month.costUsd)} hint={`${num(month.requests)} requests`} />
          <StatCard label="Tokens this month" value={num(month.inputTokens + month.outputTokens)} hint={`${num(month.inputTokens)} in / ${num(month.outputTokens)} out`} />
          <StatCard label="End of month (est.)" value={budget.projectedUsd !== null ? usd(budget.projectedUsd) : '—'} hint={budget.projectedUsd !== null ? 'if usage continues at this pace' : 'shown after the 3rd day'} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <BudgetCard budget={budget} canEdit={can('tenant:update')} />
          <QuotaCard quota={quota} />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {PRESETS.map(([n, l]) => <button key={n} type="button" onClick={() => setRange({ from: daysAgo(n), to: daysAgo(0) })} className={`rounded-lg px-3 py-2 text-sm ring-1 ring-white/15 ${range.from === daysAgo(n) && range.to === daysAgo(0) ? 'bg-brand-500/15 text-brand-500' : 'hover:bg-white/5'}`}>{l}</button>)}
          <Field label="From" name="from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Field label="To" name="to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
        </div>
        {report.isError && <Alert>{apiErrorMessage(report.error)}</Alert>}
        {report.isLoading && <LoadingState rows={4} />}
        {r && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Cost in period (est.)" value={usd(r.totals.costUsd)} hint={r.totals.avgCostUsd !== null ? `${usd(r.totals.avgCostUsd)} per request` : undefined} />
              <StatCard label="Requests" value={num(r.totals.requests)} hint={r.totals.retries ? `${num(r.totals.retries)} retries` : undefined} />
              <StatCard label="Failure rate" value={r.totals.failureRate === null ? '—' : `${r.totals.failureRate}%`} hint={r.totals.invalidOutput ? `${r.totals.invalidOutput} unusable answers` : undefined} />
              <StatCard label="Avg. answer time" value={r.totals.avgDurationMs === null ? '—' : `${(r.totals.avgDurationMs / 1000).toFixed(1)} s`} />
            </div>
            <Card title="Cost per day"><DailyBars days={r.daily} /></Card>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="By feature"><BreakdownTable rows={r.byType} nameOf={(x) => label(x.key)} /></Card>
              <Card title="By model"><BreakdownTable rows={r.byModel} nameOf={(x) => <span className="font-mono text-xs">{x.model} <span className="text-white/40">({label(x.provider)})</span></span>} /></Card>
              <Card title="By person"><BreakdownTable rows={r.byUser} nameOf={(x) => x.name} /></Card>
              <Card title="Whose key paid">
                <BreakdownTable rows={r.byKey} nameOf={(x) => (x.key === 'TENANT' ? 'Your own key (billed to you by the provider)' : 'Platform key (included in your plan)')} />
              </Card>
              <Card title="Most expensive leads">
                {r.topLeads.length === 0 ? <p className="text-sm text-white/45">No lead-related AI requests in this period.</p> : (
                  <ul className="divide-y divide-white/5 text-sm">
                    {r.topLeads.map((l) => (
                      <li key={l.leadId} className="flex items-center justify-between py-2">
                        {l.deleted ? <span className="text-white/45">{l.name}</span> : <Link className="underline" to={`/app/leads/${l.leadId}`}>{l.name}</Link>}
                        <span className="font-mono text-white/60">{num(l.requests)} req · {usd(l.costUsd)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Errors">
                {r.errors.length === 0 ? <p className="text-sm text-white/45">No errors in this period.</p> : (
                  <ul className="space-y-1 text-sm">{r.errors.map((e) => <li key={e.code} className="flex justify-between"><span>{label(e.code)}</span><span className="font-mono">{e.count}</span></li>)}</ul>
                )}
                <p className="mt-3 text-xs text-white/40">Failed requests that used no tokens don't count against your plan. Rate limits and provider outages usually fix themselves — a rejected key needs a new key in Integrations.</p>
              </Card>
            </div>
          </>
        )}
        <RequestList range={range} />
      </div>
    </>
  );
}
