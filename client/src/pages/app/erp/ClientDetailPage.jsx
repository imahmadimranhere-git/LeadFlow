// One client: details, contact people, quotes.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { Card, Button, Field, SelectField, TextArea, Alert, Badge, LoadingState, ErrorState } from '../../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';
import { formatDate } from '../../../utils/platform.js';
import { money, moneyMap, invoiceBadge, QUOTE_STATUS_COLOR, QUOTE_STATUS_LABEL } from '../../../utils/money.js';

const FIELDS = [['name', 'Name', 150], ['email', 'Email', 254], ['phone', 'Phone', 30], ['website', 'Website', 2048], ['address', 'Address', 300], ['city', 'City', 60], ['country', 'Country', 60], ['taxId', 'Tax ID (NTN / VAT)', 60]];

function ClientForm({ client, canWrite }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState(() => ({
    ...Object.fromEntries(FIELDS.map(([k]) => [k, client[k] || ''])),
    type: client.type,
    status: client.status,
    notes: client.notes || '',
    contacts: (client.contacts || []).map((c) => ({ name: c.name || '', role: c.role || '', email: c.email || '', phone: c.phone || '' })),
  }));
  const save = useMutation({
    mutationFn: async () => {
      const body = { type: f.type, status: f.status, notes: f.notes };
      for (const [k] of FIELDS) body[k] = k === 'name' ? f.name : f[k].trim() || null;
      body.contacts = f.contacts.filter((c) => c.name.trim()).map((c) => ({ name: c.name, role: c.role || undefined, email: c.email.trim() || null, phone: c.phone.trim() || null }));
      return (await api.patch(`/clients/${client.id}`, body)).data.data.client;
    },
    onSuccess: () => { toast.success('Saved'); queryClient.invalidateQueries({ queryKey: ['clients'] }); },
  });
  const errs = apiFieldErrors(save.error);
  const setC = (i, k) => (e) => setF({ ...f, contacts: f.contacts.map((c, j) => (j === i ? { ...c, [k]: e.target.value } : c)) });
  return (
    <Card title="Details">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate>
        {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
        <fieldset disabled={!canWrite} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Type" name="type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={[{ value: 'COMPANY', label: 'Company' }, { value: 'PERSON', label: 'Person' }]} />
            <SelectField label="Status" name="status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]} />
            {FIELDS.map(([k, label, max]) => <Field key={k} label={label} name={`c-${k}`} maxLength={max} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} error={errs[k]} />)}
          </div>
          <TextArea label="Notes" name="notes" rows={3} maxLength={2000} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <div>
            <p className="mb-2 text-sm font-medium">Contact people</p>
            {f.contacts.map((c, i) => (
              <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <Field aria-label="Name" name={`cn${i}`} placeholder="Name" maxLength={120} value={c.name} onChange={setC(i, 'name')} />
                <Field aria-label="Role" name={`cr${i}`} placeholder="Role" maxLength={80} value={c.role} onChange={setC(i, 'role')} />
                <Field aria-label="Email" name={`ce${i}`} placeholder="Email" maxLength={254} value={c.email} onChange={setC(i, 'email')} />
                <Field aria-label="Phone" name={`cp${i}`} placeholder="Phone" maxLength={30} value={c.phone} onChange={setC(i, 'phone')} />
                <Button variant="ghost" aria-label="Remove contact" onClick={() => setF({ ...f, contacts: f.contacts.filter((_, j) => j !== i) })}>✕</Button>
              </div>
            ))}
            {f.contacts.length < 10 && <Button variant="ghost" className="px-3 py-1.5" onClick={() => setF({ ...f, contacts: [...f.contacts, { name: '', role: '', email: '', phone: '' }] })}>+ Add contact person</Button>}
          </div>
        </fieldset>
        {canWrite && <div className="flex justify-end"><Button type="submit" loading={save.isPending}>Save</Button></div>}
      </form>
    </Card>
  );
}

export default function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ['clients', 'detail', id], queryFn: async () => (await api.get(`/clients/${id}`)).data.data });
  useDocumentTitle(q.data?.client?.name || 'Client');
  if (q.isLoading) return <LoadingState rows={8} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;
  const { client, quotes, invoices = [], outstanding = {} } = q.data;
  const canWrite = can('leads:write');
  return (
    <>
      <Link to="/app/contacts" className="text-sm text-white/50 hover:text-white">← All contacts</Link>
      <div className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{client.name}</h1>
          <p className="mt-1 text-sm text-white/50">
            {client.ownerId?.name && <>Owner: {client.ownerId.name} · </>}
            {client.leadId && <Link className="underline" to={`/app/leads/${client.leadId.id}`}>From lead “{client.leadId.name}”</Link>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('invoices:manage') && <Button variant="ghost" onClick={() => navigate(`/app/invoices/new?clientId=${client.id}`)}>New invoice</Button>}
          {canWrite && <Button onClick={() => navigate(`/app/quotes/new?clientId=${client.id}`)}>New quote</Button>}
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2"><ClientForm key={client.updatedAt} client={client} canWrite={canWrite} /></div>
        <div className="space-y-6">
        <Card title="Invoices">
          {Object.keys(outstanding).length > 0 && <p className="mb-2 text-sm">Outstanding: <b className="font-mono">{moneyMap(outstanding)}</b></p>}
          {invoices.length === 0 && <p className="text-sm text-white/45">No invoices yet.</p>}
          <ul className="space-y-1">
            {invoices.map((x) => {
              const [color, label] = invoiceBadge(x);
              return (
                <li key={x.id}>
                  <Link to={`/app/invoices/${x.id}`} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-white/5">
                    <span className="font-mono text-xs">{x.number || 'draft'}</span>
                    <Badge color={color}>{label}</Badge>
                    <span className="ml-auto font-mono">{money(x.totalMinor, x.currency)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card title="Quotes">
          {quotes.length === 0 && <p className="text-sm text-white/45">No quotes yet.</p>}
          <ul className="space-y-2">
            {quotes.map((x) => (
              <li key={x.id}>
                <Link to={`/app/quotes/${x.id}`} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-white/5">
                  <span className="font-mono text-xs">{x.number}</span>
                  <Badge color={QUOTE_STATUS_COLOR[x.status]}>{QUOTE_STATUS_LABEL[x.status]}</Badge>
                  <span className="ml-auto font-mono">{money(x.totalMinor, x.currency)}</span>
                </Link>
                <p className="px-2 text-xs text-white/35">{x.title || '—'} · {formatDate(x.issueDate)}</p>
              </li>
            ))}
          </ul>
        </Card>
        </div>
      </div>
    </>
  );
}
