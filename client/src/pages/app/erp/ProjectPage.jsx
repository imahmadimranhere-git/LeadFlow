// One project: Board (tasks) · Milestones · Time · Settings. The server decides who may do what;
// the UI only hides buttons people can't use.
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import useTeamOptions from '../../../hooks/useTeamOptions.js';
import { useToast } from '../../../components/Toast.jsx';
import { Card, Button, Field, SelectField, TextArea, Alert, Modal, Badge, ProgressBar, StatCard, LoadingState, ErrorState, Pager } from '../../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';
import { formatDate } from '../../../utils/platform.js';
import { money, minorToInput } from '../../../utils/money.js';
import { PROJECT_STATUS, TASK_COLUMNS, TASK_PRIORITY, fmtMinutes, todayKey } from '../../../utils/projects.js';
import { DoneBar } from './ProjectsPage.jsx';

const dateIn = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const noon = (d) => (d ? new Date(`${d}T12:00:00`).toISOString() : null);

// ---------------------------------------------------------------- board

function TaskModal({ project, task, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({
    title: task?.title || '', description: task?.description || '', status: task?.status || 'TODO', priority: task?.priority || 'MEDIUM',
    assigneeId: task?.assigneeId?.id || '', milestoneId: task?.milestoneId || '', dueDate: dateIn(task?.dueDate), estimate: task?.estimateMinutes ? fmtMinutes(task.estimateMinutes).replace(' ', '') : '',
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['projects'] });
  const save = useMutation({
    mutationFn: async () => {
      const body = { title: f.title, description: f.description, status: f.status, priority: f.priority, assigneeId: f.assigneeId || null, milestoneId: f.milestoneId || null, dueDate: noon(f.dueDate), ...(f.estimate ? { estimate: f.estimate } : { estimate: null }) };
      return task ? api.patch(`/tasks/${task.id}`, body) : api.post(`/projects/${project.id}/tasks`, body);
    },
    onSuccess: () => { toast.success('Saved'); refresh(); onClose(); },
  });
  const remove = useMutation({ mutationFn: () => api.delete(`/tasks/${task.id}`), onSuccess: () => { toast.success('Task deleted'); refresh(); onClose(); } });
  const errs = apiFieldErrors(save.error);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} size="lg" title={task ? 'Task' : 'New task'} footer={<>{task && <Button variant="ghost" className="mr-auto" loading={remove.isPending} onClick={() => remove.mutate()}>Delete</Button>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!f.title.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        {(save.isError || remove.isError) && <Alert>{apiErrorMessage(save.error || remove.error)}</Alert>}
        <Field label="Title" name="title" maxLength={200} value={f.title} onChange={set('title')} error={errs.title} />
        <TextArea label="Description" name="description" rows={4} maxLength={5000} value={f.description} onChange={set('description')} />
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Status" name="status" value={f.status} onChange={set('status')} options={TASK_COLUMNS.map(([value, label]) => ({ value, label }))} />
          <SelectField label="Priority" name="priority" value={f.priority} onChange={set('priority')} options={Object.entries(TASK_PRIORITY).map(([value, [, label]]) => ({ value, label }))} />
          <SelectField label="Assigned to" name="assignee" value={f.assigneeId} onChange={set('assigneeId')} options={[{ value: '', label: 'Nobody' }, ...project.members.map((m) => ({ value: m.id, label: m.name }))]} />
          <SelectField label="Milestone" name="milestone" value={f.milestoneId} onChange={set('milestoneId')} options={[{ value: '', label: '—' }, ...project.milestones.map((m) => ({ value: m.id, label: m.name }))]} />
          <Field label="Due date" name="due" type="date" value={f.dueDate} onChange={set('dueDate')} />
          <Field label="Estimate" name="estimate" placeholder="e.g. 4h or 1:30" value={f.estimate} onChange={set('estimate')} error={errs.estimate} />
        </div>
      </div>
    </Modal>
  );
}

function Board({ project, canWork }) {
  const [params] = useSearchParams();
  const [mine, setMine] = useState(false);
  const [open, setOpen] = useState(params.get('task') || null); // task id | 'new'
  const queryClient = useQueryClient();
  const toast = useToast();
  const tasks = useQuery({ queryKey: ['projects', 'tasks', project.id, mine], queryFn: async () => (await api.get(`/projects/${project.id}/tasks`, { params: mine ? { assigneeId: 'me' } : {} })).data.data.items });
  const move = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/tasks/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  if (tasks.isLoading) return <LoadingState rows={4} />;
  if (tasks.isError) return <ErrorState message={apiErrorMessage(tasks.error)} onRetry={tasks.refetch} />;
  const now = Date.now();
  const openTask = open && open !== 'new' ? tasks.data.find((t) => t.id === open) : null;
  return (
    <>
      <div className="mb-3 flex items-center gap-3">
        {canWork && <Button onClick={() => setOpen('new')}>New task</Button>}
        <label className="flex items-center gap-2 text-sm text-white/60"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only my tasks</label>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TASK_COLUMNS.map(([col, label], ci) => {
          const list = tasks.data.filter((t) => t.status === col);
          return (
            <section key={col} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
              <h3 className="mb-2 flex items-center justify-between text-sm font-medium">{label}<span className="text-xs text-white/40">{list.length}</span></h3>
              <ul className="space-y-2">
                {list.map((t) => (
                  <li key={t.id} className="rounded-lg bg-ink-900 p-2.5 ring-1 ring-white/10">
                    <button type="button" className="block w-full text-left text-sm hover:underline" onClick={() => setOpen(t.id)}>{t.title}</button>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-white/45">
                      {t.priority !== 'MEDIUM' && <Badge color={TASK_PRIORITY[t.priority][0]}>{TASK_PRIORITY[t.priority][1]}</Badge>}
                      {t.assigneeId?.name && <span>{t.assigneeId.name}</span>}
                      {t.dueDate && <span className={t.status !== 'DONE' && new Date(t.dueDate).getTime() < now ? 'text-red-300' : ''}>· {formatDate(t.dueDate)}</span>}
                    </div>
                    {canWork && (
                      <div className="mt-1.5 flex justify-between">
                        <button type="button" disabled={ci === 0 || move.isPending} className="text-xs text-white/40 hover:text-white disabled:opacity-20" aria-label="Move left" onClick={() => move.mutate({ id: t.id, status: TASK_COLUMNS[ci - 1][0] })}>◀</button>
                        <button type="button" disabled={ci === TASK_COLUMNS.length - 1 || move.isPending} className="text-xs text-white/40 hover:text-white disabled:opacity-20" aria-label="Move right" onClick={() => move.mutate({ id: t.id, status: TASK_COLUMNS[ci + 1][0] })}>▶</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {open === 'new' && <TaskModal project={project} onClose={() => setOpen(null)} />}
      {openTask && <TaskModal key={openTask.id} project={project} task={openTask} onClose={() => setOpen(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- milestones

function Milestones({ project, canManage }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ name: '', dueDate: '' });
  const act = useMutation({
    mutationFn: ({ method, url, body }) => api[method](url, body),
    onSuccess: () => { setF({ name: '', dueDate: '' }); queryClient.invalidateQueries({ queryKey: ['projects'] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const base = `/projects/${project.id}/milestones`;
  return (
    <Card title="Milestones">
      {project.milestones.length === 0 && <p className="text-sm text-white/45">No milestones yet.</p>}
      <ul className="divide-y divide-white/5">
        {project.milestones.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
            <input type="checkbox" aria-label="Done" disabled={!canManage} checked={m.status === 'DONE'} onChange={(e) => act.mutate({ method: 'patch', url: `${base}/${m.id}`, body: { status: e.target.checked ? 'DONE' : 'OPEN' } })} />
            <span className={m.status === 'DONE' ? 'text-white/45 line-through' : ''}>{m.name}</span>
            {m.dueDate && <span className="text-xs text-white/45">due {formatDate(m.dueDate)}</span>}
            {canManage && <button type="button" className="ml-auto text-xs text-white/40 underline" onClick={() => act.mutate({ method: 'delete', url: `${base}/${m.id}` })}>Remove</button>}
          </li>
        ))}
      </ul>
      {canManage && (
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (f.name.trim()) act.mutate({ method: 'post', url: base, body: { name: f.name.trim(), ...(f.dueDate && { dueDate: noon(f.dueDate) }) } }); }}>
          <Field label="New milestone" name="ms" maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Field label="Due" name="msDue" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} />
          <Button type="submit" variant="ghost" loading={act.isPending}>Add</Button>
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- time

function TimeTab({ data }) {
  const { project, unbilled, can } = data;
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ taskId: '', time: '', day: todayKey(), note: '', billable: project.billable });
  const tasks = useQuery({ queryKey: ['projects', 'tasks', project.id, false], queryFn: async () => (await api.get(`/projects/${project.id}/tasks`)).data.data.items });
  const list = useQuery({ queryKey: ['projects', 'time', project.id, page], queryFn: async () => (await api.get('/time', { params: { projectId: project.id, page, limit: 20 } })).data.data, placeholderData: keepPreviousData });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['projects'] });
  const log = useMutation({
    mutationFn: () => api.post(`/projects/${project.id}/time`, { time: f.time, day: f.day, billable: f.billable, ...(f.taskId && { taskId: f.taskId }), ...(f.note && { note: f.note }) }),
    onSuccess: () => { toast.success('Time logged'); setF({ ...f, time: '', note: '' }); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id) => api.delete(`/time/${id}`), onSuccess: () => { toast.success('Deleted'); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e)) });
  const bill = useMutation({
    mutationFn: async () => (await api.post(`/projects/${project.id}/invoice-time`, {})).data.data,
    onSuccess: (r) => { toast.success(`${r.entries} time entries put on a draft invoice`); navigate(`/app/invoices/${r.invoiceId}`); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const errs = apiFieldErrors(log.error);
  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <div className="space-y-6 xl:col-span-2">
        <Card title={`Time (${fmtMinutes(list.data?.totalMinutes || 0)} total)`}>
          {list.isLoading && <LoadingState rows={3} />}
          <ul className="divide-y divide-white/5">
            {list.data?.items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="w-24 text-white/55">{e.day}</span>
                <span className="w-20 font-mono">{e.running ? '⏱ running' : fmtMinutes(e.minutes)}</span>
                <span className="min-w-0 flex-1 truncate">{e.taskId?.title || 'General'}{e.note ? <span className="text-white/45"> — {e.note}</span> : null}</span>
                <span className="text-xs text-white/40">{e.userId?.name}</span>
                {e.status === 'INVOICED' ? <Badge color="green">billed</Badge> : !e.billable ? <Badge color="gray">non-billable</Badge> : null}
                {e.status === 'OPEN' && !e.running && <button type="button" className="text-xs text-white/40 underline" onClick={() => remove.mutate(e.id)}>Delete</button>}
              </li>
            ))}
          </ul>
          <Pager pagination={list.data?.pagination} onPage={setPage} />
        </Card>
      </div>
      <div className="space-y-6">
        {can.work && (
          <Card title="Log time">
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); log.mutate(); }}>
              {log.isError && <Alert>{apiErrorMessage(log.error)}</Alert>}
              <SelectField label="Task" name="task" value={f.taskId} onChange={(e) => setF({ ...f, taskId: e.target.value })} options={[{ value: '', label: 'General work' }, ...(tasks.data || []).filter((t) => t.status !== 'DONE' || t.id === f.taskId).map((t) => ({ value: t.id, label: t.title }))]} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Time" name="time" placeholder="1:30 or 90 or 1.5h" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} error={errs.time || errs.minutes} />
                <Field label="Day" name="day" type="date" max={todayKey()} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} error={errs.day} />
              </div>
              <Field label="Note" name="note" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Billable</label>
              <Button type="submit" loading={log.isPending} disabled={!f.time.trim()}>Log time</Button>
            </form>
          </Card>
        )}
        <Card title="Unbilled time">
          <p className="text-sm">{fmtMinutes(unbilled.minutes)} in {unbilled.entries} entries{project.hourlyRateMinor ? ` · at ${money(project.hourlyRateMinor, project.currency)}/h` : ''}</p>
          {!project.clientId && <p className="mt-2 text-xs text-amber-300">Link a client in Settings to bill time.</p>}
          {can.invoice && <Button className="mt-3" disabled={!unbilled.entries || !project.clientId} loading={bill.isPending} onClick={() => bill.mutate()}>Put on a draft invoice</Button>}
          <p className="mt-2 text-xs text-white/40">Billed time is locked. Deleting or voiding that invoice makes the time billable again.</p>
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- settings

function SettingsTab({ project, canManage }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const team = useTeamOptions();
  const clients = useQuery({ queryKey: ['clients', 'picker'], queryFn: async () => (await api.get('/clients', { params: { limit: 100 } })).data.data.items });
  const [f, setF] = useState({
    name: project.name, description: project.description, status: project.status, clientId: project.clientId?.id || '', startDate: dateIn(project.startDate), dueDate: dateIn(project.dueDate),
    hourlyRate: minorToInput(project.hourlyRateMinor), budgetHours: project.budgetMinutes ? String(project.budgetMinutes / 60) : '', billable: project.billable, members: project.members.map((m) => m.id),
  });
  const save = useMutation({
    mutationFn: () => api.patch(`/projects/${project.id}`, {
      name: f.name, description: f.description, status: f.status, clientId: f.clientId || null, startDate: noon(f.startDate), dueDate: noon(f.dueDate),
      hourlyRate: f.hourlyRate || '0', budgetHours: f.budgetHours === '' ? null : Number(f.budgetHours), billable: f.billable, members: f.members,
    }),
    onSuccess: () => { toast.success('Saved'); queryClient.invalidateQueries({ queryKey: ['projects'] }); },
  });
  const remove = useMutation({ mutationFn: () => api.delete(`/projects/${project.id}`), onSuccess: () => navigate('/app/projects'), onError: (e) => toast.error(apiErrorMessage(e)) });
  const errs = apiFieldErrors(save.error);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const people = team.data || project.members;
  return (
    <Card title="Project settings">
      <fieldset disabled={!canManage || save.isPending} className="space-y-4">
        {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" name="name" maxLength={150} value={f.name} onChange={set('name')} error={errs.name} />
          <SelectField label="Status" name="status" value={f.status} onChange={set('status')} options={Object.entries(PROJECT_STATUS).map(([value, [, label]]) => ({ value, label }))} />
          <SelectField label="Client" name="client" value={f.clientId} onChange={set('clientId')} options={[{ value: '', label: '— none —' }, ...(clients.data || []).map((c) => ({ value: c.id, label: c.name }))]} />
          <Field label="Hourly rate" name="rate" inputMode="decimal" value={f.hourlyRate} onChange={set('hourlyRate')} error={errs.hourlyRate} hint="Changing it doesn't change time already logged" />
          <Field label="Start" name="start" type="date" value={f.startDate} onChange={set('startDate')} />
          <Field label="Due" name="due" type="date" value={f.dueDate} onChange={set('dueDate')} />
          <Field label="Budget (hours)" name="budgetHours" type="number" min={0} value={f.budgetHours} onChange={set('budgetHours')} />
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={f.billable} onChange={(e) => setF({ ...f, billable: e.target.checked })} /> Time is billable by default</label>
        </div>
        <TextArea label="Description" name="desc" rows={3} maxLength={3000} value={f.description} onChange={set('description')} />
        <div>
          <p className="mb-2 text-sm font-medium">Members (can see the project, add tasks, log time)</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {people.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.members.includes(u.id)} onChange={(e) => setF({ ...f, members: e.target.checked ? [...f.members, u.id] : f.members.filter((x) => x !== u.id) })} />
                {u.name}
              </label>
            ))}
          </div>
          {errs.members && <p className="mt-1 text-xs text-red-300">{errs.members}</p>}
        </div>
      </fieldset>
      {canManage && (
        <div className="mt-4 flex justify-between">
          <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>Delete project</Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- page

export default function ProjectPage() {
  const { id } = useParams();
  const [tab, setTab] = useState('board');
  const q = useQuery({ queryKey: ['projects', 'one', id], queryFn: async () => (await api.get(`/projects/${id}`)).data.data });
  useDocumentTitle(q.data?.project?.name || 'Project');
  if (q.isLoading) return <LoadingState rows={8} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;
  const { project, progress, can } = q.data;
  const tabs = [['board', 'Board'], ['milestones', `Milestones (${progress.milestonesDone}/${progress.milestonesTotal})`], ['time', 'Time'], ['settings', 'Settings']];
  return (
    <>
      <Link to="/app/projects" className="text-sm text-white/50 hover:text-white">← All projects</Link>
      <div className="mb-4 mt-2">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">{project.name}<Badge color={PROJECT_STATUS[project.status][0]}>{PROJECT_STATUS[project.status][1]}</Badge></h1>
        <p className="mt-1 text-sm text-white/50">
          {project.clientId ? <Link className="underline" to={`/app/contacts/${project.clientId.id}`}>{project.clientId.name}</Link> : 'No client'}
          {project.quoteId && <> · quote <Link className="underline" to={`/app/quotes/${project.quoteId.id}`}>{project.quoteId.number}</Link></>}
          {' '}· manager {project.managerId?.name}{project.dueDate ? ` · due ${formatDate(project.dueDate)}` : ''}
        </p>
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-ink-800 p-5 ring-1 ring-white/10"><p className="text-sm text-white/50">Tasks done</p><p className="mt-2 text-2xl font-semibold">{progress.tasksDone}/{progress.tasksTotal}</p><div className="mt-2"><DoneBar value={progress.tasksDone} max={progress.tasksTotal} /></div>{progress.overdueTasks > 0 && <p className="mt-1 text-xs text-red-300">{progress.overdueTasks} overdue</p>}</div>
        <div className="rounded-2xl bg-ink-800 p-5 ring-1 ring-white/10"><p className="text-sm text-white/50">Time logged</p><p className="mt-2 text-2xl font-semibold">{fmtMinutes(progress.minutesLogged)}</p>{progress.budgetMinutes ? <><div className="mt-2"><ProgressBar value={progress.minutesLogged} max={progress.budgetMinutes} /></div><p className={`mt-1 text-xs ${progress.overBudget ? 'text-red-300' : 'text-white/40'}`}>{progress.budgetUsedPercent}% of {fmtMinutes(progress.budgetMinutes)} budget</p></> : null}</div>
        <StatCard label="Budget" value={project.budgetMinor !== null && project.budgetMinor !== undefined ? money(project.budgetMinor, project.currency) : '—'} hint={project.hourlyRateMinor ? `${money(project.hourlyRateMinor, project.currency)} / hour` : undefined} />
      </div>
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-2 text-sm ${tab === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>{l}</button>)}
      </div>
      {tab === 'board' && <Board project={project} canWork={can.work && !['COMPLETED', 'CANCELLED'].includes(project.status)} />}
      {tab === 'milestones' && <Milestones project={project} canManage={can.manage} />}
      {tab === 'time' && <TimeTab data={q.data} />}
      {tab === 'settings' && <SettingsTab key={project.updatedAt} project={project} canManage={can.manage} />}
    </>
  );
}
