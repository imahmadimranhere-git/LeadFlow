// Super admin → System (Phase 30): health of THIS server (requests, errors, latency, background jobs,
// database, memory, queues, alerts) + permanent data erasure of deleted companies.
// Numbers are per server process and reset on restart — an outside monitor (UptimeRobot) watches too.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { PageHeader, Card, StatCard, Badge, Alert, Button, Field, Modal, LoadingState, ErrorState, ProgressBar } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

const LEVEL_COLOR = { critical: 'red', warning: 'amber', resolved: 'green' };

function EraseModal({ tenant, onClose }) {
  const queryClient = useQueryClient();
  const [slug, setSlug] = useState('');
  const [typed, setTyped] = useState('');
  const dry = useQuery({ queryKey: ['admin', 'purge-dry', tenant.id], queryFn: async () => (await adminApi.post(`/tenants/${tenant.id}/purge`, { confirmSlug: tenant.slug })).data.data });
  const erase = useMutation({
    mutationFn: async () => (await adminApi.post(`/tenants/${tenant.id}/purge`, { confirmSlug: slug, dryRun: false, confirm: 'ERASE' })).data.data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'deleted-tenants'] }),
  });
  const counts = Object.entries(dry.data?.counts || {}).filter(([, n]) => n > 0);
  return (
    <Modal open onClose={onClose} title={`Erase "${tenant.name}" permanently`} footer={erase.isSuccess ? <Button onClick={onClose}>Close</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" loading={erase.isPending} disabled={slug !== tenant.slug || typed !== 'ERASE'} onClick={() => erase.mutate()}>Erase forever</Button></>}>
      <div className="space-y-3 text-sm">
        {erase.isSuccess ? <Alert type="success">Erased {erase.data.total} records. Billing records and the security audit log were kept.</Alert> : (
          <>
            <Alert>This can't be undone. Make a database backup first (npm run db:backup). Billing records and the audit log are kept; everything else of this company is deleted.</Alert>
            {dry.isLoading && <LoadingState rows={2} />}
            {dry.isError && <Alert>{apiErrorMessage(dry.error)}</Alert>}
            {dry.data && (counts.length ? <ul className="grid grid-cols-2 gap-1 rounded-lg bg-ink-900 p-3 font-mono text-xs">{counts.map(([m, n]) => <li key={m}>{m}: {n}</li>)}</ul> : <p className="text-white/50">Nothing left to erase.</p>)}
            <Field label={`Type the slug: ${tenant.slug}`} name="slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
            <Field label="Type ERASE" name="erase" value={typed} onChange={(e) => setTyped(e.target.value)} />
            {erase.isError && <Alert>{apiErrorMessage(erase.error)}</Alert>}
          </>
        )}
      </div>
    </Modal>
  );
}

function DeletedCompanies() {
  const [erasing, setErasing] = useState(null);
  const q = useQuery({ queryKey: ['admin', 'deleted-tenants'], queryFn: async () => (await adminApi.get('/deleted-tenants')).data.data.items });
  return (
    <Card title="Data erasure (deleted companies)">
      {q.isLoading && <LoadingState rows={2} />}
      {q.isError && <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />}
      {q.data?.length === 0 && <p className="text-sm text-white/45">No deleted companies.</p>}
      <ul className="divide-y divide-white/5 text-sm">
        {q.data?.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="font-medium">{t.name}</span>
            <span className="font-mono text-xs text-white/40">{t.slug}</span>
            <span className="text-xs text-white/45">deleted {formatDateTime(t.deletedAt)}{t.reason ? ` · ${t.reason}` : ''}</span>
            {t.purgedAt ? <Badge color="gray">erased {formatDateTime(t.purgedAt)}</Badge> : <Button variant="danger" className="ml-auto px-3 py-1.5" onClick={() => setErasing(t)}>Erase data…</Button>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-white/40">Automatic erasure after N days: set PURGE_DELETED_TENANTS_AFTER_DAYS on the server (off by default).</p>
      {erasing && <EraseModal tenant={erasing} onClose={() => setErasing(null)} />}
    </Card>
  );
}

export default function SystemPage() {
  useDocumentTitle('System');
  const q = useQuery({ queryKey: ['admin', 'system'], queryFn: async () => (await adminApi.get('/system')).data.data, refetchInterval: 30_000 });
  if (q.isLoading) return <LoadingState rows={6} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;
  const d = q.data;
  const h = d.http;
  return (
    <>
      <PageHeader title="System" description={`This server · up ${d.server.uptimeMinutes} min · ${d.server.node} · refreshed ${formatDateTime(d.at)}. Numbers reset when the server restarts.`} />
      <div className="space-y-6">
        {d.alerts.active.length > 0 && <Alert>Active alerts: {d.alerts.active.join(', ')}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Requests (15 min)" value={h.requests} hint={`${h.perMinute}/min`} />
          <StatCard label="Server errors" value={`${h.errorRate}%`} hint={`${h.serverErrors} × 5xx · ${h.clientErrors} × 4xx`} />
          <StatCard label="Response time p95" value={h.p95 === null ? '—' : `${h.p95} ms`} hint={h.p50 === null ? undefined : `p50 ${h.p50} ms · p99 ${h.p99} ms`} />
          <StatCard label="Database" value={d.db.status} hint={d.db.pingMs === null ? undefined : `ping ${d.db.pingMs} ms · ${h.slowQueries} slow queries`} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Memory & load">
            <div className="space-y-3 text-sm">
              <div><div className="mb-1 flex justify-between"><span>Memory (RSS)</span><span className="font-mono">{d.memory.rssMb} / {d.memory.limitMb} MB</span></div><ProgressBar value={d.memory.rssMb} max={d.memory.limitMb} /></div>
              <p className="text-white/60">Event-loop delay p99: <b>{d.eventLoop.p99Ms} ms</b> {d.eventLoop.p99Ms >= 200 && <Badge color="amber">busy</Badge>} · load {d.server.loadAvg1m} on {d.server.cpus} CPU</p>
              <p className="text-white/60">Queued: {d.backlog.exports ?? '—'} exports · {d.backlog.discovery ?? '—'} discovery runs · {d.backlog.scoring ?? '—'} scoring batches</p>
              <p className="text-white/60">Indexes: {d.indexes.ok} models ok{d.indexes.failed.length ? <> · <span className="text-red-300">{d.indexes.failed.length} failed</span></> : ''}</p>
            </div>
          </Card>
          <Card title="Background jobs">
            <ul className="divide-y divide-white/5 text-sm">
              {d.jobs.length === 0 && <li className="py-2 text-white/45">No jobs on this server (ENABLE_JOBS=false?).</li>}
              {d.jobs.map((j) => (
                <li key={j.name} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">{j.name}</span>
                  <Badge color={j.stale ? 'red' : j.running ? 'blue' : 'green'}>{j.stale ? 'not running' : j.running ? 'running' : 'ok'}</Badge>
                  <span className="text-xs text-white/45">every {j.intervalSeconds}s · last ok {j.lastOk ? formatDateTime(j.lastOk) : '—'} · {j.failures}/{j.runs} failed</span>
                  {j.lastError && <span className="w-full text-xs text-red-300">{j.lastError}</span>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card title="Slowest routes (15 min)">
          {h.slowestRoutes.length === 0 ? <p className="text-sm text-white/45">No requests yet.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-white/45"><tr><th className="py-2">Route</th><th className="text-right">Requests</th><th className="text-right">Avg</th><th className="text-right">Max</th><th className="text-right">5xx</th></tr></thead>
              <tbody className="divide-y divide-white/5">{h.slowestRoutes.map((r) => <tr key={r.route}><td className="py-1.5 font-mono text-xs">{r.route}</td><td className="text-right">{r.requests}</td><td className="text-right">{r.avgMs} ms</td><td className="text-right">{r.maxMs} ms</td><td className="text-right">{r.serverErrors}</td></tr>)}</tbody>
            </table>
          )}
        </Card>
        <Card title="Recent alerts">
          {d.alerts.recent.length === 0 ? <p className="text-sm text-white/45">No alerts since the server started.</p> : (
            <ul className="space-y-1 text-sm">{d.alerts.recent.map((a, i) => <li key={`${a.key}-${i}`} className="flex flex-wrap gap-2"><Badge color={LEVEL_COLOR[a.level] || 'gray'}>{a.level}</Badge><span>{a.title}</span><span className="text-xs text-white/40">{formatDateTime(a.at)} · {a.detail}</span></li>)}</ul>
          )}
          <p className="mt-3 text-xs text-white/40">Alerts are emailed to ALERT_EMAIL (or SUPER_ADMIN_EMAIL) when platform email is set up — at most once per 30 minutes per alert.</p>
        </Card>
        <DeletedCompanies />
      </div>
    </>
  );
}
