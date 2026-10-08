// Hashtag watches: scheduled, official Instagram hashtag searches. New posts land in the Signals inbox.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { PageHeader, Card, Button, Badge, Field, SelectField, Modal, Alert, LoadingState, ErrorState, EmptyState, ProgressBar, DropdownMenu, Icon } from '../../../components/ui.jsx';
import { TagInput } from '../../../components/forms.jsx';
import { normalizeHashtag, normalizePhrase } from '../../../utils/settingsOptions.js';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';
import { formatDateTime } from '../../../utils/platform.js';

const RUN_COLOR = { OK: 'green', PARTIAL: 'amber', FAILED: 'red' };

function WatchModal({ watch, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    name: watch?.name || '',
    hashtags: watch?.hashtags || [],
    keywords: watch?.keywords || [],
    locations: watch?.locations || [],
    scheduleHours: watch?.scheduleHours || 6,
    maxResultsPerHashtag: watch?.maxResultsPerHashtag || 50,
  });
  const save = useMutation({
    mutationFn: () => (watch ? api.patch(`/hashtag-watches/${watch.id}`, f) : api.post('/hashtag-watches', f)),
    onSuccess: () => {
      toast.success(watch ? 'Watch saved' : 'Watch created — the first check runs within a minute');
      queryClient.invalidateQueries({ queryKey: ['hashtag-watches'] });
      onClose();
    },
  });
  const errs = apiFieldErrors(save.error);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={watch ? 'Edit watch' : 'New hashtag watch'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError && !Object.keys(errs).length && <Alert>{apiErrorMessage(save.error)}</Alert>}
        <Field label="Name" name="name" maxLength={80} placeholder="Plot buyers Islamabad" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errs.name} />
        <TagInput label="Hashtags (max 10)" prefix="#" max={10} normalize={normalizeHashtag} value={f.hashtags} onChange={(hashtags) => setF({ ...f, hashtags })} placeholder="needaplot" error={errs.hashtags} hint="Instagram allows 30 different hashtags per 7 days for your whole account — keep the list short." />
        <TagInput label="Extra keywords (optional)" max={20} normalize={normalizePhrase} value={f.keywords} onChange={(keywords) => setF({ ...f, keywords })} error={errs.keywords} hint="Your buyer-intent phrases and negative keywords from Settings → Discovery are used too." />
        <TagInput label="Locations (optional)" max={10} normalize={normalizePhrase} value={f.locations} onChange={(locations) => setF({ ...f, locations })} error={errs.locations} hint="If set, posts that mention none of these places go to “Filtered”." />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Check every" name="scheduleHours" value={f.scheduleHours} onChange={(e) => setF({ ...f, scheduleHours: Number(e.target.value) })} options={[6, 12, 24].map((h) => ({ value: h, label: `${h} hours` }))} />
          <Field label="Max posts per hashtag" name="max" type="number" min={5} max={50} value={f.maxResultsPerHashtag} onChange={(e) => setF({ ...f, maxResultsPerHashtag: Number(e.target.value) })} error={errs.maxResultsPerHashtag} />
        </div>
        <p className="text-xs text-white/40">Each hashtag check uses 1 “discovery search” from your monthly plan.</p>
      </div>
    </Modal>
  );
}

function HonestNotes() {
  return (
    <Card title="What Instagram really gives us">
      <ul className="list-disc space-y-1.5 pl-5 text-sm text-white/60">
        <li>Only public posts from the <strong>last 24 hours</strong> with that hashtag (so we check every few hours).</li>
        <li><strong>Not who posted</strong> — Instagram does not share the username. A person opens the post and fills it in when converting.</li>
        <li>No stories, no private accounts, no comments search.</li>
        <li>Max <strong>30 different hashtags per 7 days</strong> per Instagram account.</li>
        <li>Your Meta app needs the “Instagram Public Content Access” feature approved by Meta.</li>
        <li>Facebook has <strong>no</strong> public hashtag/post search — we do not scrape it.</li>
      </ul>
    </Card>
  );
}

export default function HashtagWatchesPage() {
  useDocumentTitle('Hashtag watches');
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null); // null | 'new' | watch
  const [deleting, setDeleting] = useState(null);
  const canManage = can('watches:manage');

  const watches = useQuery({ queryKey: ['hashtag-watches', 'list'], queryFn: async () => (await api.get('/hashtag-watches')).data.data.items, refetchInterval: 30_000 });
  const usage = useQuery({ queryKey: ['hashtag-watches', 'usage'], queryFn: async () => (await api.get('/hashtag-watches/usage')).data.data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['hashtag-watches'] });

  const runNow = useMutation({
    mutationFn: (id) => api.post(`/hashtag-watches/${id}/run`),
    onSuccess: () => { toast.success('Queued — results appear in the Signals inbox shortly'); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: (w) => api.patch(`/hashtag-watches/${w.id}`, { isActive: !w.isActive }),
    onSuccess: refresh,
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/hashtag-watches/${id}`),
    onSuccess: () => { setDeleting(null); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  if (watches.isLoading || usage.isLoading) return <LoadingState rows={5} />;
  if (watches.isError) return <ErrorState message={apiErrorMessage(watches.error)} onRetry={watches.refetch} />;
  const u = usage.data;

  return (
    <>
      <PageHeader
        title="Hashtag watches"
        description="Official Instagram hashtag search on a schedule. Matching posts go to the Signals inbox for review."
        actions={canManage && <Button onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" /> New watch</Button>}
      />
      <div className="space-y-6">
        {u && !u.connected && (
          <Alert type="info">
            Instagram is not connected yet. {can('integrations:manage') ? <Link className="underline" to="/app/settings/integrations">Connect it in Integrations</Link> : 'Ask an owner or admin to connect it in Integrations.'}
          </Alert>
        )}
        {u?.connected && (
          <Card title="Instagram hashtags used (rolling 7 days)">
            <ProgressBar value={u.used} max={u.limit} />
            <p className="mt-2 text-sm text-white/60">{u.used} of {u.limit} different hashtags</p>
            {u.hashtags.length > 0 && <p className="mt-1 text-xs text-white/40">{u.hashtags.slice(0, 10).map((h) => `#${h.hashtag} (free ${formatDateTime(h.freesUpAt)})`).join(' · ')}</p>}
          </Card>
        )}

        {watches.data.length === 0 ? (
          <Card><EmptyState icon="hash" title="No watches yet" description="Create a watch like #needaplot or #needwebsite and we check it for you every few hours." /></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {watches.data.map((w) => (
              <div key={w.id} className="rounded-2xl bg-ink-800 p-5 ring-1 ring-white/10">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{w.name}</p>
                    <p className="mt-1 text-sm text-brand-500">{w.hashtags.map((h) => `#${h}`).join(' ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color={w.isActive ? 'green' : 'gray'}>{w.isActive ? `every ${w.scheduleHours}h` : 'paused'}</Badge>
                    {canManage && (
                      <DropdownMenu
                        label={`Actions for ${w.name}`}
                        trigger={<Icon name="list" className="h-4 w-4" />}
                        items={[
                          { label: 'Run now', onSelect: () => runNow.mutate(w.id) },
                          { label: 'Edit', onSelect: () => setEditing(w) },
                          { label: w.isActive ? 'Pause' : 'Resume', onSelect: () => toggle.mutate(w) },
                          { label: 'Delete', danger: true, onSelect: () => setDeleting(w) },
                        ]}
                      />
                    )}
                  </div>
                </div>
                {(w.locations.length > 0 || w.keywords.length > 0) && (
                  <p className="mt-2 text-xs text-white/50">
                    {w.locations.length > 0 && <>Places: {w.locations.join(', ')}. </>}
                    {w.keywords.length > 0 && <>Keywords: {w.keywords.join(', ')}.</>}
                  </p>
                )}
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-ink-900 p-2"><dt className="text-white/40">Posts seen</dt><dd className="mt-1 text-base">{w.totals.postsSeen}</dd></div>
                  <div className="rounded-lg bg-ink-900 p-2"><dt className="text-white/40">Signals</dt><dd className="mt-1 text-base">{w.totals.signals}</dd></div>
                  <div className="rounded-lg bg-ink-900 p-2"><dt className="text-white/40">High intent</dt><dd className="mt-1 text-base">{w.totals.highIntent}</dd></div>
                </dl>
                <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/40">
                  {w.lastRunStatus && <Badge color={RUN_COLOR[w.lastRunStatus]}>{w.lastRunStatus.toLowerCase()}</Badge>}
                  Last run {formatDateTime(w.lastRunAt)} · next {w.isActive ? formatDateTime(w.nextRunAt) : '—'}
                </p>
                {w.lastError && <p className="mt-1 text-xs text-amber-300">{w.lastError}</p>}
                <Link to="/app/signals" className="mt-3 inline-block text-xs text-brand-500 underline">Open Signals inbox</Link>
              </div>
            ))}
          </div>
        )}
        <HonestNotes />
      </div>

      {editing && <WatchModal key={editing === 'new' ? 'new' : editing.id} watch={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title="Delete this watch?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(deleting.id)}>Delete</Button>
          </>
        }
      >
        <p className="text-sm text-white/70">Signals already found stay in the inbox.</p>
      </Modal>
    </>
  );
}
