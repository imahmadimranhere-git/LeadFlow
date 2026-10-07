import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import { Card, Badge, Spinner, Alert, EmptyState, Pager, SelectField } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';

const ACTOR_COLORS = { PLATFORM_ADMIN: 'amber', USER: 'blue', SYSTEM: 'gray', ANONYMOUS: 'red' };

export default function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [actorType, setActorType] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [page, setPage] = useState(1);

  const params = {
    page,
    limit: 25,
    ...(/^[a-z_.]+$/.test(action.trim()) && { action: action.trim() }),
    ...(actorType && { actorType }),
    ...(/^[a-f0-9]{24}$/i.test(tenantId.trim()) && { tenantId: tenantId.trim() }),
  };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: async () => (await adminApi.get('/audit-logs', { params })).data.data,
    placeholderData: keepPreviousData,
  });

  const inputClass = 'w-full rounded-lg bg-ink-900 px-3 py-2.5 text-white placeholder-white/30 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-brand-500';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Audit logs</h1>
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <input className={inputClass} placeholder="Action, e.g. tenant.status_changed" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} />
          <SelectField
            name="actorType"
            value={actorType}
            onChange={(e) => { setActorType(e.target.value); setPage(1); }}
            options={[{ value: '', label: 'All actors' }, ...Object.keys(ACTOR_COLORS).map((a) => ({ value: a, label: a }))]}
          />
          <input className={inputClass} placeholder="Tenant id" value={tenantId} onChange={(e) => { setTenantId(e.target.value); setPage(1); }} />
        </div>

        {isLoading && <Spinner />}
        {isError && <Alert>{apiErrorMessage(error)}</Alert>}
        {data && data.items.length === 0 && <EmptyState>No audit entries match.</EmptyState>}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-white/50">
                <tr>
                  <th className="py-2 pr-4 font-medium">Time</th>
                  <th className="py-2 pr-4 font-medium">Action</th>
                  <th className="py-2 pr-4 font-medium">Actor</th>
                  <th className="py-2 pr-4 font-medium">Tenant</th>
                  <th className="py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 align-top">
                {data.items.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap py-2.5 pr-4 text-white/60">{formatDateTime(log.createdAt)}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs">{log.action}</td>
                    <td className="py-2.5 pr-4"><Badge color={ACTOR_COLORS[log.actorType]}>{log.actorType}</Badge></td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-white/50">{log.tenantId || '—'}</td>
                    <td className="py-2.5">
                      {/* Rendered as plain text by React → safe even if metadata contains HTML */}
                      <pre className="max-w-md whitespace-pre-wrap break-all text-xs text-white/60">{JSON.stringify(log.metadata, null, 1)}</pre>
                      {log.ip && <p className="text-xs text-white/30">IP {log.ip}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager pagination={data?.pagination} onPage={setPage} />
      </Card>
    </div>
  );
}
