// Approval queue: every message waits here for a person. Nothing is sent automatically.
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { PageHeader, Card, SelectField, LoadingState, ErrorState, EmptyState, Pager } from '../../../components/ui.jsx';
import MessageCard from '../../../components/messages/MessageCard.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { CHANNELS } from '../../../utils/messageOptions.js';

const TABS = [['PENDING_REVIEW', 'Pending review'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['', 'All']];

export default function ApprovalQueuePage() {
  useDocumentTitle('Approval queue');
  const [status, setStatus] = useState('PENDING_REVIEW');
  const [channel, setChannel] = useState('');
  const [sensitive, setSensitive] = useState(false);
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['messages', 'queue', status, channel, sensitive, page],
    queryFn: async () => (await api.get('/messages', { params: { page, limit: 20, ...(status && { status }), ...(channel && { channel }), ...(sensitive && { sensitive: 'true' }) } })).data.data,
    placeholderData: keepPreviousData,
  });
  const reset = () => setPage(1);

  return (
    <>
      <PageHeader title="Approval queue" description="Every AI-written or template message waits here. Approve, edit, reject or regenerate — nothing is sent automatically." />
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={l} type="button" role="tab" aria-selected={status === k} onClick={() => { setStatus(k); reset(); }} className={`rounded-lg px-3 py-2 text-sm ${status === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>{l}</button>
        ))}
      </div>
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SelectField name="channel" aria-label="Channel" value={channel} onChange={(e) => { setChannel(e.target.value); reset(); }} options={[{ value: '', label: 'All channels' }, ...CHANNELS.map(([value, label]) => ({ value, label }))]} />
          <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={sensitive} onChange={(e) => { setSensitive(e.target.checked); reset(); }} /> Only sensitive (prices, deadlines, promises…)</label>
        </div>
        {q.isLoading && <LoadingState rows={4} />}
        {q.isError && <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />}
        {q.data?.items.length === 0 && <EmptyState icon="checkCircle" title="Nothing here" description="Open a lead and click “Write message” to create a draft." />}
        <div className="space-y-3">{q.data?.items.map((m) => <MessageCard key={m.id} message={m} />)}</div>
        <Pager pagination={q.data?.pagination} onPage={setPage} />
      </Card>
    </>
  );
}
