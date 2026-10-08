// Chrome extension: get a one-time pairing code, see which browsers are connected, disconnect them.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { PageHeader, Card, Button, Badge, LoadingState, ErrorState, EmptyState, Modal } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

function useCountdown(until) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) return undefined;
    const tick = () => setLeft(Math.max(0, Math.round((new Date(until) - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

function PairingCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [pairing, setPairing] = useState(null);
  const left = useCountdown(pairing?.expiresAt);
  const create = useMutation({
    mutationFn: async () => (await api.post('/extension/pairing-codes')).data.data,
    onSuccess: setPairing,
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  // when the code is used, the new browser shows up in the list
  useEffect(() => {
    if (!pairing || left === 0) return undefined;
    const t = setInterval(() => queryClient.invalidateQueries({ queryKey: ['extension', 'sessions'] }), 5000);
    return () => clearInterval(t);
  }, [pairing, left, queryClient]);

  const active = pairing && left > 0;
  return (
    <Card title="Connect the extension">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-white/65">
        <li>Install the extension (see the guide: Chrome → <code>chrome://extensions</code> → Developer mode → <b>Load unpacked</b> → choose the <code>extension</code> folder).</li>
        <li>Click <b>Get pairing code</b> below.</li>
        <li>Click the LeadFlow icon in Chrome, type the code, press <b>Connect</b>.</li>
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <Button loading={create.isPending} onClick={() => create.mutate()}>{active ? 'New code' : 'Get pairing code'}</Button>
        {active && (
          <div>
            <p className="font-mono text-3xl tracking-widest text-brand-500" aria-live="polite">{pairing.code}</p>
            <p className="text-xs text-white/45">Works once · expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</p>
          </div>
        )}
        {pairing && left === 0 && <Badge color="amber">Code expired — get a new one</Badge>}
      </div>
      <p className="mt-4 text-xs text-white/40">You never type your password into the extension. Don't share the code — whoever types it first is connected as you.</p>
    </Card>
  );
}

export default function ExtensionPage() {
  useDocumentTitle('Chrome extension');
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState(null);
  const sessions = useQuery({ queryKey: ['extension', 'sessions'], queryFn: async () => (await api.get('/extension/sessions')).data.data.items });
  const revoke = useMutation({
    mutationFn: (id) => api.delete(`/extension/sessions/${id}`),
    onSuccess: () => {
      toast.success('Disconnected');
      setRevoking(null);
      queryClient.invalidateQueries({ queryKey: ['extension', 'sessions'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const team = can('users:manage');

  return (
    <>
      <PageHeader title="Chrome extension" description="Save the post or profile you are looking at — Instagram, Facebook, LinkedIn or any website — as a lead." />
      <div className="space-y-6">
        <PairingCard />

        <Card title={team ? 'Connected browsers (whole team)' : 'Your connected browsers'}>
          {sessions.isLoading && <LoadingState rows={2} />}
          {sessions.isError && <ErrorState message={apiErrorMessage(sessions.error)} onRetry={sessions.refetch} />}
          {sessions.data?.length === 0 && <EmptyState icon="globe" title="No browser connected yet" />}
          {sessions.data?.length > 0 && (
            <ul className="divide-y divide-white/5">
              {sessions.data.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm">{s.deviceName}{s.mine && <span className="ml-2 text-xs text-white/40">(you)</span>}</p>
                    <p className="text-xs text-white/45">
                      {team && !s.mine && <>{s.userId?.name} · </>}
                      Connected {formatDateTime(s.createdAt)} · last used {formatDateTime(s.lastUsedAt)} · until {formatDateTime(s.expiresAt)}
                    </p>
                  </div>
                  <Button variant="ghost" className="px-3 py-1.5" onClick={() => setRevoking(s)}>Disconnect</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="What the extension does — and doesn't">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-white/60">
            <li>It reads only the page <b>address</b>, its <b>title</b> and the text <b>you selected</b> — and only when you click it.</li>
            <li>You type what you see (name, handle, public contact). It is saved as “typed in by your team”, with where you saw it.</li>
            <li>It shows if the page is <b>already a lead</b>, and if a post is waiting in your <b>Signals inbox</b> it converts that signal.</li>
            <li>It does <b>not</b> scroll, click, message, follow or collect anything by itself. No automation on LinkedIn, Instagram or Facebook.</li>
            <li><b>LinkedIn:</b> LinkedIn gives normal apps no API to search posts or people, so this extension is the honest way to save LinkedIn leads.</li>
          </ul>
        </Card>
      </div>

      <Modal
        open={Boolean(revoking)}
        onClose={() => setRevoking(null)}
        title="Disconnect this browser?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRevoking(null)}>Cancel</Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate(revoking.id)}>Disconnect</Button>
          </>
        }
      >
        <p className="text-sm text-white/70">The extension in that browser stops working immediately and needs a new pairing code.</p>
      </Modal>
    </>
  );
}
