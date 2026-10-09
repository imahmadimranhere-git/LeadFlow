// Projects list. Sales people see the projects they are members of; managers see all.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { PageHeader, Card, Button, Field, SelectField, Alert, Modal, Badge, ProgressBar, LoadingState, ErrorState, EmptyState, Pager } from '../../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';
import { formatDate } from '../../../utils/platform.js';
import { PROJECT_STATUS, fmtMinutes } from '../../../utils/projects.js';

/** Green progress bar (tasks done) — 100 % is good news here, not a limit. */
export function DoneBar({ value, max }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="h-2 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={value} aria-valuemax={max}><div className="h-full bg-brand-500" style={{ width: `${pct}%` }} /></div>;
}

function NewProjectModal({ onClose }) {
  const navigate = useNavigate();
  const clients = useQuery({ queryKey: ['clients', 'picker'], queryFn: async () => (await api.get('/clients', { params: { limit: 100 } })).data.data.items });
  const [f, setF] = useState({ name: '', clientId: '', hourlyRate: '', budgetHours: '', dueDate: '' });
  const create = useMutation({
    mutationFn: async () => (await api.post('/projects', { name: f.name, ...(f.clientId && { clientId: f.clientId }), ...(f.hourlyRate && { hourlyRate: f.hourlyRate }), ...(f.budgetHours && { budgetHours: Number(f.budgetHours) }), ...(f.dueDate && { dueDate: new Date(`${f.dueDate}T12:00:00`).toISOString() }) })).data.data.project,
    onSuccess: (p) => navigate(`/app/projects/${p.id}`),
  });
  const errs = apiFieldErrors(create.error);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="New project" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!f.name.trim()} onClick={() => create.mutate()}>Create</Button></>}>
      <div className="space-y-3">
        {create.isError && <Alert>{apiErrorMessage(create.error)}</Alert>}
        <Field label="Name" name="name" maxLength={150} value={f.name} onChange={set('name')} error={errs.name} />
        <SelectField label="Client (optional)" name="clientId" value={f.clientId} onChange={set('clientId')} options={[{ value: '', label: '— none —' }, ...(clients.data || []).map((c) => ({ value: c.id, label: c.name }))]} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hourly rate (for billing time)" name="rate" inputMode="decimal" value={f.hourlyRate} onChange={set('hourlyRate')} error={errs.hourlyRate} />
          <Field label="Budget (hours)" name="budget" type="number" min={0} value={f.budgetHours} onChange={set('budgetHours')} />
        </div>
        <Field label="Due date" name="due" type="date" value={f.dueDate} onChange={set('dueDate')} />
        <p className="text-xs text-white/45">Tip: on an accepted quote, “Start project” fills this in for you. Add members in the project's Settings.</p>
      </div>
    </Modal>
  );
}

export default function ProjectsPage() {
  useDocumentTitle('Projects');
  const { can } = useAuth();
  const [status, setStatus] = useState('ACTIVE');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const params = { page, limit: 20, ...(status && { status }), ...(q.trim() && { q: q.trim() }) };
  const list = useQuery({ queryKey: ['projects', 'list', params], queryFn: async () => (await api.get('/projects', { params })).data.data, placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Projects" description="Delivery after a deal is won: tasks, milestones and time." actions={can('projects:manage') && <Button onClick={() => setCreating(true)}>New project</Button>} />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <SelectField label="Status" name="status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: '', label: 'All' }, ...Object.entries(PROJECT_STATUS).map(([value, [, label]]) => ({ value, label }))]} />
          <Field label="Search" name="q" maxLength={80} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        {list.isLoading && <LoadingState rows={4} />}
        {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
        {list.data?.items.length === 0 && <EmptyState icon="folder" title="No projects" description={can('projects:manage') ? 'Create one, or start it from an accepted quote.' : 'You will see projects you are added to.'} />}
        <ul className="divide-y divide-white/5">
          {list.data?.items.map((p) => (
            <li key={p.id}>
              <Link to={`/app/projects/${p.id}`} className="block rounded-lg px-2 py-3 hover:bg-white/5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  <Badge color={PROJECT_STATUS[p.status][0]}>{PROJECT_STATUS[p.status][1]}</Badge>
                  <span className="text-sm text-white/45">{p.clientId?.name}</span>
                  <span className="ml-auto text-xs text-white/40">{p.managerId?.name}{p.dueDate ? ` · due ${formatDate(p.dueDate)}` : ''}</span>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-white/50 sm:grid-cols-2">
                  <div><DoneBar value={p.tasksDone} max={p.tasksTotal} /><span>{p.tasksDone}/{p.tasksTotal} tasks done</span></div>
                  <div>{p.budgetMinutes ? <><ProgressBar value={p.minutesLogged} max={p.budgetMinutes} /><span>{fmtMinutes(p.minutesLogged)} of {fmtMinutes(p.budgetMinutes)}</span></> : <span>{fmtMinutes(p.minutesLogged)} logged</span>}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <Pager pagination={list.data?.pagination} onPage={setPage} />
      </Card>
      {creating && <NewProjectModal onClose={() => setCreating(false)} />}
    </>
  );
}
