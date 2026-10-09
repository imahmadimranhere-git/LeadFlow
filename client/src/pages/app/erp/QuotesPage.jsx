// Quotes list. Totals shown here come from the server.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { PageHeader, Card, Field, Badge, LoadingState, ErrorState, EmptyState, Pager } from '../../../components/ui.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { formatDate } from '../../../utils/platform.js';
import { money, QUOTE_STATUS_COLOR, QUOTE_STATUS_LABEL } from '../../../utils/money.js';

const TABS = [['', 'All'], ['DRAFT', 'Drafts'], ['SENT', 'Sent'], ['ACCEPTED', 'Accepted'], ['DECLINED', 'Declined'], ['EXPIRED', 'Expired']];

export default function QuotesPage() {
  useDocumentTitle('Quotes');
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const params = { page, limit: 20, ...(status && { status }), ...(q.trim() && { q: q.trim() }) };
  const list = useQuery({ queryKey: ['quotes', 'list', params], queryFn: async () => (await api.get('/quotes', { params })).data.data, placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader
        title="Quotes"
        description="Proposals for leads and clients. Totals are always calculated on the server."
        actions={can('leads:write') && <Link to="/app/quotes/new" className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-ink-950 hover:opacity-90">New quote</Link>}
      />
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k || 'all'} type="button" role="tab" aria-selected={status === k} onClick={() => { setStatus(k); setPage(1); }} className={`rounded-lg px-3 py-2 text-sm ${status === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>{l}</button>
        ))}
      </div>
      <Card>
        <div className="mb-4 max-w-sm"><Field label="Search" name="q" maxLength={80} placeholder="Number or title" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        {list.isLoading && <LoadingState rows={4} />}
        {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
        {list.data?.items.length === 0 && <EmptyState icon="file" title="No quotes" description="Open a lead or a client and click “Create quote”." />}
        <ul className="divide-y divide-white/5">
          {list.data?.items.map((x) => (
            <li key={x.id}>
              <Link to={`/app/quotes/${x.id}`} className="flex flex-col gap-1 rounded-lg px-2 py-3 hover:bg-white/5 sm:flex-row sm:items-center sm:gap-4">
                <span className="font-mono text-xs text-white/60">{x.number}</span>
                <span className="min-w-0 flex-1 truncate">{x.title || '—'} <span className="text-white/45">· {x.clientId?.name || x.leadId?.name || '—'}</span></span>
                <Badge color={QUOTE_STATUS_COLOR[x.status]}>{QUOTE_STATUS_LABEL[x.status]}</Badge>
                <span className="w-24 text-xs text-white/40">{formatDate(x.issueDate)}</span>
                <span className="font-mono sm:w-40 sm:text-right">{money(x.totalMinor, x.currency)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Pager pagination={list.data?.pagination} onPage={setPage} />
      </Card>
    </>
  );
}
