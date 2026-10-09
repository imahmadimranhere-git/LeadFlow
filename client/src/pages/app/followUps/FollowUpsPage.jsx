// Follow-ups: overdue / today / this week / later, in the COMPANY's time zone. Nothing is forgotten.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { PageHeader, Card, LoadingState, ErrorState, EmptyState, Pager } from '../../../components/ui.jsx';
import { StatusBadge } from '../../../components/leads/LeadBits.jsx';
import FollowUpActions from '../../../components/followUps/FollowUpActions.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { formatInZone } from '../../../utils/zoned.js';

const TABS = [['overdue', 'Overdue'], ['today', 'Today'], ['upcoming', 'Next 7 days'], ['later', 'Later']];

export default function FollowUpsPage() {
  useDocumentTitle('Follow-ups');
  const { can } = useAuth();
  const canWrite = can('leads:write');
  const [bucket, setBucket] = useState('today');
  const [mine, setMine] = useState(true);
  const [page, setPage] = useState(1);
  const params = { bucket, page, limit: 20, ...(mine && { mine: 'true' }) };
  const summary = useQuery({ queryKey: ['follow-ups', 'summary', mine], queryFn: async () => (await api.get('/follow-ups/summary', { params: mine ? { mine: 'true' } : {} })).data.data, refetchInterval: 60_000 });
  const list = useQuery({ queryKey: ['follow-ups', 'list', params], queryFn: async () => (await api.get('/follow-ups', { params })).data.data, placeholderData: keepPreviousData });
  const tz = summary.data?.timezone;
  const counts = summary.data || {};

  return (
    <>
      <PageHeader title="Follow-ups" description={`Times are shown in your company's time zone${tz ? ` (${tz})` : ''}. You get a notification when a follow-up is due.`} />
      <div className="mb-4 flex flex-wrap items-center gap-1" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={bucket === k} onClick={() => { setBucket(k); setPage(1); }} className={`rounded-lg px-3 py-2 text-sm ${bucket === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>
            {l}
            {counts[k] > 0 && <span className={`ml-1.5 rounded-full px-1.5 text-[11px] ${k === 'overdue' ? 'bg-red-500/20 text-red-300' : 'bg-white/10'}`}>{counts[k]}</span>}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-sm text-white/60">
          <input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setPage(1); }} /> Only mine
        </label>
      </div>
      <Card>
        {list.isLoading && <LoadingState rows={4} />}
        {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
        {list.data?.items.length === 0 && <EmptyState icon="clock" title={bucket === 'overdue' ? 'Nothing overdue 🎉' : 'Nothing here'} description="Plan follow-ups on a lead's page, or with “Follow up…” on a sent message." />}
        <ul className="divide-y divide-white/5">
          {list.data?.items.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/app/leads/${l.id}`} className="truncate font-medium hover:underline">{l.name}</Link>
                  <StatusBadge status={l.status} />
                  {l.doNotContact && <span className="text-xs text-red-300">do not contact</span>}
                </div>
                <p className={`text-xs ${bucket === 'overdue' ? 'text-red-300' : 'text-white/50'}`}>
                  {formatInZone(l.followUpDate, tz)}{l.assignedTo?.name ? ` · ${l.assignedTo.name}` : ''}
                </p>
                {l.followUpNote && <p className="mt-0.5 text-sm text-white/75">{l.followUpNote}</p>}
              </div>
              {canWrite && <FollowUpActions leadId={l.id} followUpDate={l.followUpDate} followUpNote={l.followUpNote} />}
            </li>
          ))}
        </ul>
        <Pager pagination={list.data?.pagination} onPage={setPage} />
      </Card>
    </>
  );
}
