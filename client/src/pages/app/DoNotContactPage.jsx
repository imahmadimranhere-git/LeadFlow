import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useToast } from '../../components/Toast.jsx';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { Card, PageHeader, Button, Field, SelectField, Alert, DataTable, Pager, EmptyState, ErrorState, Badge } from '../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';
import { formatDate } from '../../utils/platform.js';

const TYPES = [['EMAIL', 'Email'], ['PHONE', 'Phone'], ['DOMAIN', 'Domain / website'], ['SOCIAL', 'Social profile']];

export default function DoNotContactPage() {
  useDocumentTitle('Do-not-contact');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ type: 'EMAIL', value: '', reason: '' });
  const q = useQuery({ queryKey: ['dnc', page], queryFn: async () => (await api.get('/leads/do-not-contact', { params: { page, limit: 25 } })).data.data, placeholderData: keepPreviousData });

  const add = useMutation({
    mutationFn: async () => (await api.post('/leads/do-not-contact', { type: f.type, value: f.value, ...(f.reason.trim() && { reason: f.reason }) })).data.data,
    onSuccess: (r) => {
      toast.success(`Added. ${r.leadsFlagged} existing lead(s) flagged.`);
      setF((x) => ({ ...x, value: '', reason: '' }));
      queryClient.invalidateQueries({ queryKey: ['dnc'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
  });
  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/leads/do-not-contact/${id}`)).data.data,
    onSuccess: (r) => {
      toast.success(`Removed. ${r.leadsCleared} lead(s) unflagged.`);
      queryClient.invalidateQueries({ queryKey: ['dnc'] });
      queryClient.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const errs = apiFieldErrors(add.error);
  const columns = [
    { key: 'type', header: 'Type', render: (d) => <Badge>{d.type}</Badge> },
    { key: 'value', header: 'Value', render: (d) => <span className="break-all font-mono text-xs">{d.value}</span> },
    { key: 'reason', header: 'Reason', render: (d) => <span className="text-white/60">{d.reason || '—'}</span> },
    { key: 'added', header: 'Added', render: (d) => <span className="text-white/50">{formatDate(d.createdAt)} · {d.addedBy?.name || '—'}</span> },
    { key: 'x', header: <span className="sr-only">Actions</span>, className: 'text-right', render: (d) => <Button variant="ghost" className="px-3 py-1.5" loading={remove.isPending && remove.variables === d.id} onClick={() => remove.mutate(d.id)}>Remove</Button> },
  ];

  return (
    <>
      <PageHeader title="Do-not-contact list" description="People and companies who asked not to be contacted. Matching leads are flagged and outreach to them is blocked." />
      <div className="space-y-6">
        <Card title="Add">
          <form className="grid gap-3 md:grid-cols-[180px_1fr_1fr_auto] md:items-end" onSubmit={(e) => { e.preventDefault(); add.mutate(); }} noValidate>
            <SelectField label="Type" name="dncType" value={f.type} onChange={(e) => setF((x) => ({ ...x, type: e.target.value }))} options={TYPES.map(([v, l]) => ({ value: v, label: l }))} />
            <Field label="Value" name="dncValue" placeholder={f.type === 'DOMAIN' ? 'company.com' : f.type === 'PHONE' ? '+92 300 1234567' : f.type === 'SOCIAL' ? 'https://instagram.com/name' : 'name@company.com'} value={f.value} onChange={(e) => setF((x) => ({ ...x, value: e.target.value }))} error={errs.value} />
            <Field label="Reason (optional)" name="dncReason" maxLength={300} value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} />
            <Button type="submit" loading={add.isPending} disabled={!f.value.trim()}>Add</Button>
          </form>
          {add.isError && !errs.value && <div className="mt-3"><Alert>{apiErrorMessage(add.error)}</Alert></div>}
        </Card>
        <Card>
          {q.isError ? <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} /> : <DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} empty={<EmptyState icon="shield" title="The list is empty" />} />}
          <Pager pagination={q.data?.pagination} onPage={setPage} />
        </Card>
      </div>
    </>
  );
}
