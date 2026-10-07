import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import { Card, Badge, Spinner, Alert, EmptyState, Pager, SelectField, TENANT_STATUS_COLOR } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { TENANT_STATUSES, formatDate } from '../../utils/platform.js';

export default function TenantsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const params = { page, limit: 20, ...(search.trim() && { search: search.trim() }), ...(status && { status }) };
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'tenants', params],
    queryFn: async () => (await adminApi.get('/tenants', { params })).data.data,
    placeholderData: keepPreviousData,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Tenants</h1>
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px]">
          <input
            type="search"
            placeholder="Search by company name…"
            value={search}
            maxLength={60}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-lg bg-ink-900 px-3 py-2.5 text-white placeholder-white/30 ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-brand-500"
          />
          <SelectField
            name="status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            options={[{ value: '', label: 'All statuses' }, ...TENANT_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        </div>

        {isLoading && <Spinner />}
        {isError && <Alert>{apiErrorMessage(error)}</Alert>}
        {data && data.items.length === 0 && <EmptyState>No tenants found.</EmptyState>}
        {data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-white/50">
                <tr>
                  <th className="py-2 pr-4 font-medium">Company</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Plan</th>
                  <th className="py-2 pr-4 font-medium">Users</th>
                  <th className="py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.items.map((t) => (
                  <tr key={t.id} className="hover:bg-white/5">
                    <td className="py-2.5 pr-4">
                      <Link to={`/super-admin/tenants/${t.id}`} className="font-medium text-brand-500 hover:underline">{t.name}</Link>
                      <p className="text-xs text-white/40">{t.slug}</p>
                    </td>
                    <td className="py-2.5 pr-4"><Badge color={TENANT_STATUS_COLOR[t.status]}>{t.status}</Badge></td>
                    <td className="py-2.5 pr-4">{t.planId?.name || '—'}</td>
                    <td className="py-2.5 pr-4">{t.userCount}</td>
                    <td className="py-2.5 text-white/60">{formatDate(t.createdAt)}</td>
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
