// Outreach: approved messages → send (email from your mailbox, or by hand in the app) → replies → follow-ups.
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { PageHeader, Card, SelectField, LoadingState, ErrorState, EmptyState, Pager } from '../../../components/ui.jsx';
import MessageCard from '../../../components/messages/MessageCard.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { CHANNELS } from '../../../utils/messageOptions.js';

const TABS = [['APPROVED', 'Ready to send'], ['SENT', 'Sent'], ['REPLIED', 'Replied'], ['FOLLOW_UP', 'Follow-up'], ['SEND_FAILED', 'Failed'], ['CLOSED', 'Closed']];

export default function OutreachPage() {
  useDocumentTitle('Outreach');
  const [status, setStatus] = useState('APPROVED');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['messages', 'outreach', status, channel, page],
    queryFn: async () => (await api.get('/messages', { params: { page, limit: 20, status, ...(channel && { channel }) } })).data.data,
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Outreach" description="Send approved messages and track replies. Do-not-contact and unsubscribes are enforced automatically." />
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={status === k} onClick={() => { setStatus(k); setPage(1); }} className={`rounded-lg px-3 py-2 text-sm ${status === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>{l}</button>
        ))}
      </div>
      <Card>
        <div className="mb-4"><SelectField name="channel" aria-label="Channel" value={channel} onChange={(e) => { setChannel(e.target.value); setPage(1); }} options={[{ value: '', label: 'All channels' }, ...CHANNELS.map(([value, label]) => ({ value, label }))]} /></div>
        {q.isLoading && <LoadingState rows={4} />}
        {q.isError && <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />}
        {q.data?.items.length === 0 && <EmptyState icon="send" title="Nothing here" description={status === 'APPROVED' ? 'Approve drafts in the Approval queue first.' : undefined} />}
        <div className="space-y-3">{q.data?.items.map((m) => <MessageCard key={m.id} message={m} />)}</div>
        <Pager pagination={q.data?.pagination} onPage={setPage} />
      </Card>
    </>
  );
}
