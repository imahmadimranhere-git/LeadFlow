// Super admin (Phase 26): AI usage & cost across ALL companies. The key question for the platform:
// how much do WE pay (platform key) vs. companies paying with their own key — and who uses the most.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { PageHeader, Card, StatCard, Field, Badge, Alert, LoadingState } from '../../components/ui.jsx';
import { DailyBars, BreakdownTable, usd, num, label, PRESETS } from '../../components/usage/UsageBits.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';

const utcDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export default function AiUsageAdminPage() {
  useDocumentTitle('AI usage — platform');
  const [range, setRange] = useState({ from: utcDaysAgo(29), to: utcDaysAgo(0) });
  const [tenant, setTenant] = useState(null); // { id, name }
  const params = { ...range, ...(tenant && { tenantId: tenant.id }) };
  const q = useQuery({ queryKey: ['admin', 'ai-usage', params], queryFn: async () => (await adminApi.get('/ai-usage', { params })).data.data, placeholderData: keepPreviousData });
  const d = q.data;
  return (
    <>
      <PageHeader title="AI usage & cost" description="All companies. Days are UTC. Costs are estimates from the AI model price list." />
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-2">
          {PRESETS.map(([n, l]) => <button key={n} type="button" onClick={() => setRange({ from: utcDaysAgo(n), to: utcDaysAgo(0) })} className={`rounded-lg px-3 py-2 text-sm ring-1 ring-white/15 ${range.from === utcDaysAgo(n) && range.to === utcDaysAgo(0) ? 'bg-brand-500/15 text-brand-500' : 'hover:bg-white/5'}`}>{l}</button>)}
          <Field label="From" name="from" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <Field label="To" name="to" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          {tenant && <button type="button" className="mb-2 text-sm text-brand-500 underline" onClick={() => setTenant(null)}>Only {tenant.name} — show all</button>}
        </div>
        {q.isError && <Alert>{apiErrorMessage(q.error)}</Alert>}
        {q.isLoading && <LoadingState rows={5} />}
        {d && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total est. cost" value={usd(d.totals.costUsd)} hint={`${num(d.totals.requests)} requests · ${d.totals.activeTenants} companies`} />
              <StatCard label="Paid by the platform" value={usd(d.totals.platformCostUsd)} hint="requests on the platform key" />
              <StatCard label="Platform key this month" value={usd(d.platformKeyThisMonth.costUsd)} hint={`${num(d.platformKeyThisMonth.requests)} requests (UTC month)`} />
              <StatCard label="Failure rate" value={d.totals.failureRate === null ? '—' : `${d.totals.failureRate}%`} />
            </div>
            <Card title="Cost per day"><DailyBars days={d.daily} /></Card>
            <Card title="Companies by cost">
              <BreakdownTable
                rows={d.byTenant}
                nameOf={(t) => (
                  <span className="flex items-center gap-2">
                    <Link className="underline" to={`/super-admin/tenants/${t.tenantId}`}>{t.name}</Link>
                    {t.status && t.status !== 'ACTIVE' && <Badge color="gray">{label(t.status)}</Badge>}
                    {!tenant && <button type="button" className="text-xs text-white/40 hover:text-white" onClick={() => setTenant({ id: t.tenantId, name: t.name })}>filter</button>}
                  </span>
                )}
                extraHead={<th className="text-right">Platform paid</th>}
                extraCell={(t) => <td className="text-right font-mono">{usd(t.platformCostUsd)}</td>}
              />
            </Card>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card title="Whose key"><BreakdownTable rows={d.byKey} nameOf={(x) => (x.key === 'PLATFORM' ? 'Platform key (we pay)' : 'Company keys (they pay)')} /></Card>
              <Card title="By feature"><BreakdownTable rows={d.byType} nameOf={(x) => label(x.key)} /></Card>
              <Card title="By model">
                <BreakdownTable rows={d.byModel} nameOf={(x) => <span className="font-mono text-xs">{x.model} <span className="text-white/40">({label(x.provider)})</span></span>} extraHead={<th className="text-right">Fail %</th>} extraCell={(x) => <td className="text-right">{x.failureRate ?? '—'}</td>} />
              </Card>
              <Card title="Errors by provider">
                {d.errors.length === 0 ? <p className="text-sm text-white/45">No errors.</p> : (
                  <ul className="space-y-1 text-sm">{d.errors.map((e) => <li key={`${e.provider}-${e.code}`} className="flex justify-between"><span>{label(e.provider)} · {label(e.code)}</span><span className="font-mono">{e.count}</span></li>)}</ul>
                )}
                <p className="mt-3 text-xs text-white/40">Many "key invalid" errors on the platform key = rotate the platform key now. Prices: AI models page.</p>
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}
