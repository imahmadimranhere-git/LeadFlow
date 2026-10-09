// My time: a timer (one at a time) + what I logged recently.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { useToast } from '../../../components/Toast.jsx';
import { PageHeader, Card, Button, Field, SelectField, Alert, Badge, LoadingState, EmptyState, Pager } from '../../../components/ui.jsx';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { fmtMinutes } from '../../../utils/projects.js';

function Elapsed({ since }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 1000));
  return <span className="font-mono text-3xl">{String(Math.floor(s / 3600)).padStart(2, '0')}:{String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}</span>;
}

function Timer() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState({ projectId: '', taskId: '', note: '' });
  const current = useQuery({ queryKey: ['time', 'timer'], queryFn: async () => (await api.get('/time/timer')).data.data.timer });
  const projects = useQuery({ queryKey: ['projects', 'picker'], queryFn: async () => (await api.get('/projects', { params: { status: 'ACTIVE', limit: 100 } })).data.data.items });
  const tasks = useQuery({ queryKey: ['projects', 'tasks', f.projectId, false], queryFn: async () => (await api.get(`/projects/${f.projectId}/tasks`)).data.data.items, enabled: Boolean(f.projectId) });
  const refresh = () => { queryClient.invalidateQueries({ queryKey: ['time'] }); queryClient.invalidateQueries({ queryKey: ['projects'] }); };
  const start = useMutation({ mutationFn: () => api.post('/time/timer/start', { projectId: f.projectId, ...(f.taskId && { taskId: f.taskId }), ...(f.note && { note: f.note }) }), onSuccess: () => { toast.success('Timer started'); refresh(); } });
  const stop = useMutation({
    mutationFn: async () => (await api.post('/time/timer/stop', {})).data.data,
    onSuccess: (r) => { toast.success(`Saved ${fmtMinutes(r.entry.minutes)}${r.capped ? ' (capped at 12 h — check it)' : ''}`); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  if (current.isLoading) return <Card><LoadingState rows={2} /></Card>;
  const t = current.data;
  return (
    <Card title="Timer">
      {t ? (
        <div className="flex flex-wrap items-center gap-4">
          <Elapsed since={t.startedAt} />
          <div className="text-sm"><p className="font-medium">{t.projectId?.name}</p><p className="text-white/50">{t.taskId?.title || 'General work'}{t.note ? ` — ${t.note}` : ''}</p></div>
          <Button className="ml-auto" variant="danger" loading={stop.isPending} onClick={() => stop.mutate()}>Stop &amp; save</Button>
        </div>
      ) : (
        <form className="grid gap-3 sm:grid-cols-4 sm:items-end" onSubmit={(e) => { e.preventDefault(); start.mutate(); }}>
          {start.isError && <div className="sm:col-span-4"><Alert>{apiErrorMessage(start.error)}</Alert></div>}
          <SelectField label="Project" name="project" value={f.projectId} onChange={(e) => setF({ ...f, projectId: e.target.value, taskId: '' })} options={[{ value: '', label: 'Choose…' }, ...(projects.data || []).map((p) => ({ value: p.id, label: p.name }))]} />
          <SelectField label="Task" name="task" value={f.taskId} onChange={(e) => setF({ ...f, taskId: e.target.value })} options={[{ value: '', label: 'General work' }, ...(tasks.data || []).filter((x) => x.status !== 'DONE').map((x) => ({ value: x.id, label: x.title }))]} />
          <Field label="Note" name="note" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <Button type="submit" loading={start.isPending} disabled={!f.projectId}>▶ Start</Button>
        </form>
      )}
      <p className="mt-3 text-xs text-white/40">One timer at a time. A timer left running is saved as at most 12 hours.</p>
    </Card>
  );
}

export default function TimePage() {
  useDocumentTitle('My time');
  const [page, setPage] = useState(1);
  const list = useQuery({ queryKey: ['time', 'mine', page], queryFn: async () => (await api.get('/time', { params: { userId: 'me', page, limit: 25 } })).data.data, placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="My time" description="Start a timer or log time inside a project (Projects → Time)." />
      <div className="space-y-6">
        <Timer />
        <Card title={`My entries${list.data ? ` · ${fmtMinutes(list.data.totalMinutes)} total` : ''}`}>
          {list.isLoading && <LoadingState rows={3} />}
          {list.data?.items.length === 0 && <EmptyState icon="clock" title="No time logged yet" />}
          <ul className="divide-y divide-white/5">
            {list.data?.items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="w-24 text-white/55">{e.day}</span>
                <span className="w-20 font-mono">{e.running ? '⏱' : fmtMinutes(e.minutes)}</span>
                <Link className="min-w-0 flex-1 truncate hover:underline" to={`/app/projects/${e.projectId?.id}`}>{e.projectId?.name} · {e.taskId?.title || 'General'}</Link>
                {e.status === 'INVOICED' && <Badge color="green">billed</Badge>}
              </li>
            ))}
          </ul>
          <Pager pagination={list.data?.pagination} onPage={setPage} />
        </Card>
      </div>
    </>
  );
}
