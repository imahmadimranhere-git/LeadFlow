// Invoices: money overview + list. Overdue / partly paid are calculated by the server from payments + due date.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { PageHeader, Card, Field, Badge, StatCard, LoadingState, ErrorState, EmptyState, Pager } from '../../../components/ui.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { formatDate } from '../../../utils/platform.js';
import { money, moneyMap, invoiceBadge } from '../../../utils/money.js';

const TABS = [['', 'All'], ['DRAFT', 'Drafts'], ['ISSUED', 'Unpaid'], ['overdue', 'Overdue'], ['PAID', 'Paid'], ['VOID', 'Void']];

export default function InvoicesPage() {
  useDocumentTitle('Invoices');
  const { can } = useAuth();
  const [tab, setTab] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const params = { page, limit: 20, ...(tab === 'overdue' ? { overdue: 'true' } : tab ? { status: tab } : {}), ...(q.trim() && { q: q.trim() }) };
  const summary = useQuery({ queryKey: ['invoices', 'summary'], queryFn: async () => (await api.get('/invoices/summary')).data.data });
  const list = useQuery({ queryKey: ['invoices', 'list', params], queryFn: async () => (await api.get('/invoices', { params })).data.data, placeholderData: keepPreviousData });
  const s = summary.data;
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Issued invoices can't be edited — mistakes are voided with a reason. Payments are recorded against each invoice."
        actions={can('invoices:manage') && <Link to="/app/invoices/new" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-950 hover:opacity-90">New invoice</Link>}
      />
      {s && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Outstanding" value={moneyMap(s.outstanding)} hint={`${s.openCount} open invoice(s)`} />
          <StatCard label="Overdue" value={moneyMap(s.overdue)} hint={`${s.overdueCount} invoice(s)`} />
          <StatCard label="Received this month" value={moneyMap(s.receivedThisMonth)} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k || 'all'} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setPage(1); }} className={`rounded-lg px-3 py-2 text-sm ${tab === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>{l}</button>
        ))}
      </div>
      <Card>
        <div className="mb-4 max-w-sm"><Field label="Search" name="q" maxLength={80} placeholder="Number or title" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        {list.isLoading && <LoadingState rows={4} />}
        {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
        {list.data?.items.length === 0 && <EmptyState icon="receipt" title="No invoices" description="Create one from an accepted quote, or with “New invoice”." />}
        <ul className="divide-y divide-white/5">
          {list.data?.items.map((x) => {
            const [color, label] = invoiceBadge(x);
            return (
              <li key={x.id}>
                <Link to={`/app/invoices/${x.id}`} className="flex flex-col gap-1 rounded-lg px-2 py-3 hover:bg-white/5 sm:flex-row sm:items-center sm:gap-4">
                  <span className="w-32 font-mono text-xs text-white/60">{x.number || 'draft'}</span>
                  <span className="min-w-0 flex-1 truncate">{x.clientId?.name || '—'} <span className="text-white/45">{x.title ? `· ${x.title}` : ''}</span></span>
                  <Badge color={color}>{label}</Badge>
                  <span className="w-24 text-xs text-white/40">{x.dueDate ? `due ${formatDate(x.dueDate)}` : ''}</span>
                  <span className="text-right font-mono sm:w-44">{money(x.totalMinor, x.currency)}{x.status === 'ISSUED' && x.paidMinor > 0 && <span className="block text-xs text-white/45">open {money(x.balanceMinor)}</span>}</span>
                </Link>
              </li>
            );
          })}
        </ul>
        <Pager pagination={list.data?.pagination} onPage={setPage} />
      </Card>
    </>
  );
}
