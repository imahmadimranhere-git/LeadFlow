// Contacts = clients (customers). Usually created by converting a lead or when a quote is accepted.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { PageHeader, Card, Button, Field, SelectField, Alert, Modal, LoadingState, ErrorState, EmptyState, Pager } from '../../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';

function NewClientModal({ onClose }) {
  const navigate = useNavigate();
  const [f, setF] = useState({ type: 'COMPANY', name: '', email: '', phone: '', city: '' });
  const create = useMutation({
    mutationFn: async () => (await api.post('/clients', { type: f.type, name: f.name, ...(f.email && { email: f.email }), ...(f.phone && { phone: f.phone }), ...(f.city && { city: f.city }) })).data.data.client,
    onSuccess: (c) => navigate(`/app/contacts/${c.id}`),
  });
  const errs = apiFieldErrors(create.error);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="New client" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={create.isPending} disabled={!f.name.trim()} onClick={() => create.mutate()}>Create</Button></>}>
      <div className="space-y-3">
        {create.isError && <Alert>{apiErrorMessage(create.error)}</Alert>}
        <SelectField label="Type" name="type" value={f.type} onChange={set('type')} options={[{ value: 'COMPANY', label: 'Company' }, { value: 'PERSON', label: 'Person' }]} />
        <Field label="Name" name="name" maxLength={150} value={f.name} onChange={set('name')} error={errs.name} />
        <Field label="Email" name="email" type="email" maxLength={254} value={f.email} onChange={set('email')} error={errs.email} />
        <Field label="Phone" name="phone" maxLength={30} value={f.phone} onChange={set('phone')} error={errs.phone} />
        <Field label="City" name="city" maxLength={60} value={f.city} onChange={set('city')} />
        <p className="text-xs text-white/45">Tip: on a lead's page, “Convert to client” copies everything for you.</p>
      </div>
    </Modal>
  );
}

export default function ClientsPage() {
  useDocumentTitle('Contacts');
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const params = { page, limit: 20, status, ...(q.trim() && { q: q.trim() }) };
  const list = useQuery({ queryKey: ['clients', params], queryFn: async () => (await api.get('/clients', { params })).data.data, placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader title="Contacts" description="Your clients (customers) and their contact people." actions={can('leads:write') && <Button onClick={() => setCreating(true)}>New client</Button>} />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <Field label="Search" name="q" maxLength={80} placeholder="Name, email, phone, city…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <SelectField label="Show" name="status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]} />
        </div>
        {list.isLoading && <LoadingState rows={4} />}
        {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
        {list.data?.items.length === 0 && <EmptyState icon="contact" title="No clients yet" description="Convert a lead into a client, or accept a quote — the client is created automatically." />}
        <ul className="divide-y divide-white/5">
          {list.data?.items.map((c) => (
            <li key={c.id}>
              <Link to={`/app/contacts/${c.id}`} className="flex flex-col gap-0.5 rounded-lg px-2 py-3 hover:bg-white/5 sm:flex-row sm:items-center sm:gap-4">
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="truncate text-sm text-white/55">{[c.email, c.phone, c.city].filter(Boolean).join(' · ')}</span>
                {c.ownerId?.name && <span className="text-xs text-white/35">{c.ownerId.name}</span>}
              </Link>
            </li>
          ))}
        </ul>
        <Pager pagination={list.data?.pagination} onPage={setPage} />
      </Card>
      {creating && <NewClientModal onClose={() => setCreating(false)} />}
    </>
  );
}
