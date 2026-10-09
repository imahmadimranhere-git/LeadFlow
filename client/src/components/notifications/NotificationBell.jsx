// Bell in the top bar: unread count (checked every minute) + the latest notifications.
// Text is rendered as plain text; links are only followed inside the app (safeAppLink).
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { Icon } from '../ui.jsx';
import { NOTIFICATION_ICON, safeAppLink, timeAgo } from '../../utils/notificationOptions.js';

export function NotificationItem({ n, onOpen }) {
  return (
    <button type="button" onClick={() => onOpen(n)} className={`flex w-full gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-white/5 ${n.readAt ? 'opacity-60' : ''}`}>
      <Icon name={NOTIFICATION_ICON[n.type] || 'bell'} className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-white/90">{n.title}</span>
        {n.body && <span className="block truncate text-xs text-white/50">{n.body}</span>}
        <span className="block text-[11px] text-white/35">{timeAgo(n.createdAt)}</span>
      </span>
      {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" aria-label="unread" />}
    </button>
  );
}

export function useOpenNotification(after) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const read = useMutation({ mutationFn: (id) => api.post(`/notifications/${id}/read`), onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }) });
  return (n) => {
    if (!n.readAt) read.mutate(n.id);
    const to = safeAppLink(n.link);
    after?.();
    if (to) navigate(to);
  };
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const queryClient = useQueryClient();
  const count = useQuery({ queryKey: ['notifications', 'count'], queryFn: async () => (await api.get('/notifications/unread-count')).data.data.unread, refetchInterval: 60_000 });
  const latest = useQuery({ queryKey: ['notifications', 'latest'], queryFn: async () => (await api.get('/notifications', { params: { limit: 8 } })).data.data.items, enabled: open });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }) });
  const openItem = useOpenNotification(() => setOpen(false));

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const unread = count.data || 0;
  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="relative grid h-9 w-9 place-items-center rounded-lg text-white/70 hover:bg-white/5">
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand-500 px-1 text-center text-[10px] font-semibold leading-[18px] text-ink-950">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,360px)] rounded-xl bg-ink-900 p-2 shadow-2xl ring-1 ring-white/10">
          <div className="flex items-center justify-between px-2 pb-2">
            <p className="text-sm font-medium">Notifications</p>
            {unread > 0 && <button type="button" className="text-xs text-brand-500 hover:underline" onClick={() => readAll.mutate()}>Mark all read</button>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {latest.isLoading && <p className="px-3 py-4 text-sm text-white/40">Loading…</p>}
            {latest.data?.length === 0 && <p className="px-3 py-6 text-center text-sm text-white/40">Nothing yet.</p>}
            {latest.data?.map((n) => <NotificationItem key={n.id} n={n} onOpen={openItem} />)}
          </div>
          <Link to="/app/notifications" onClick={() => setOpen(false)} className="mt-1 block rounded-lg px-3 py-2 text-center text-xs text-white/60 hover:bg-white/5">See all · settings</Link>
        </div>
      )}
    </div>
  );
}
