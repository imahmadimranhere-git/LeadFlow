// All my notifications + my own notification settings (what to mute, daily follow-up email).
import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { useToast } from '../../components/Toast.jsx';
import { PageHeader, Card, Button, LoadingState, ErrorState, EmptyState, Pager, Alert } from '../../components/ui.jsx';
import { NotificationItem, useOpenNotification } from '../../components/notifications/NotificationBell.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { NOTIFICATION_LABEL } from '../../utils/notificationOptions.js';

function Preferences() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: ['notifications', 'prefs'], queryFn: async () => (await api.get('/notifications/preferences')).data.data });
  const save = useMutation({
    mutationFn: async (body) => (await api.patch('/notifications/preferences', body)).data.data,
    onSuccess: (d) => { queryClient.setQueryData(['notifications', 'prefs'], d); toast.success('Saved'); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  if (prefs.isLoading) return <LoadingState rows={3} />;
  if (prefs.isError) return <ErrorState message={apiErrorMessage(prefs.error)} onRetry={prefs.refetch} />;
  const p = prefs.data;
  const toggleMute = (type) => save.mutate({ muted: p.muted.includes(type) ? p.muted.filter((t) => t !== type) : [...p.muted, type] });
  return (
    <div className="space-y-5 text-sm">
      <div>
        <p className="mb-2 font-medium">Show me in the app</p>
        <ul className="space-y-2">
          {p.types.map((t) => (
            <li key={t}>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!p.muted.includes(t)} disabled={save.isPending} onChange={() => toggleMute(t)} />
                {NOTIFICATION_LABEL[t] || t}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-white/5 pt-4">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={p.emailDigest} disabled={save.isPending} onChange={(e) => save.mutate({ emailDigest: e.target.checked })} />
          <span>
            Daily follow-up email to <span className="font-mono">{p.email}</span>
            <span className="block text-xs text-white/45">Sent once a day (company time — Settings → Company → Time zone) from your company mailbox, only when you have follow-ups due. Needs Email (SMTP) connected in Integrations.</span>
          </span>
        </label>
      </div>
    </div>
  );
}

export default function NotificationsPage() {
  useDocumentTitle('Notifications');
  const queryClient = useQueryClient();
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['notifications', 'list', unread, page],
    queryFn: async () => (await api.get('/notifications', { params: { page, limit: 20, ...(unread && { unread: 'true' }) } })).data.data,
    placeholderData: keepPreviousData,
  });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }) });
  const openItem = useOpenNotification();
  return (
    <>
      <PageHeader title="Notifications" description="Only you see your notifications. They are kept for 90 days." actions={list.data?.unreadCount > 0 && <Button variant="ghost" loading={readAll.isPending} onClick={() => readAll.mutate()}>Mark all read</Button>} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card>
          <div className="mb-3 flex gap-1" role="tablist">
            {[[false, 'All'], [true, 'Unread']].map(([k, l]) => (
              <button key={l} type="button" role="tab" aria-selected={unread === k} onClick={() => { setUnread(k); setPage(1); }} className={`rounded-lg px-3 py-1.5 text-sm ${unread === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>{l}</button>
            ))}
          </div>
          {list.isLoading && <LoadingState rows={5} />}
          {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
          {list.data?.items.length === 0 && <EmptyState icon="bell" title="No notifications" />}
          <div className="divide-y divide-white/5">{list.data?.items.map((n) => <NotificationItem key={n.id} n={n} onOpen={openItem} />)}</div>
          <Pager pagination={list.data?.pagination} onPage={setPage} />
        </Card>
        <Card title="My settings">
          {readAll.isError && <Alert>{apiErrorMessage(readAll.error)}</Alert>}
          <Preferences />
        </Card>
      </div>
    </>
  );
}
