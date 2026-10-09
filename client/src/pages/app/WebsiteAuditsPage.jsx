import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import api from '../../lib/api.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { PageHeader, Card, Badge, LoadingState, ErrorState, EmptyState, Pager } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

const STATUS = { COMPLETED: ['green', 'done'], FAILED: ['red', 'failed'], BLOCKED_BY_ROBOTS: ['gray', 'site asked bots not to visit'] };

export default function WebsiteAuditsPage() {
  useDocumentTitle('Website audits');
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['audits', 'list', page], queryFn: async () => (await api.get('/website-audits', { params: { page, limit: 25 } })).data.data, placeholderData: keepPreviousData });
  if (q.isLoading) return <LoadingState rows={5} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;
  return (
    <>
      <PageHeader title="Website audits" description="Safe checks of leads' public homepages. Run a check from a lead's page (“Check website”)." />
      <Card>
        {q.data.items.length === 0 ? (
          <EmptyState icon="globe" title="No website checks yet" description="Open a lead with a website and click “Check website”." />
        ) : (
          <ul className="divide-y divide-white/5">
            {q.data.items.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link to={`/app/leads/${a.leadId?.id}`} className="text-sm text-brand-500 underline">{a.leadId?.name || 'Lead'}</Link>
                  <p className="break-all text-xs text-white/45">{a.finalUrl || a.url} · {formatDateTime(a.createdAt)}</p>
                  {a.summary && <p className="text-xs text-white/60">{a.summary}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {a.score !== null && <span className="text-sm font-semibold">{a.score}/100</span>}
                  <Badge color={STATUS[a.status]?.[0]}>{STATUS[a.status]?.[1] || a.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pager pagination={q.data.pagination} onPage={setPage} />
      </Card>
    </>
  );
}
