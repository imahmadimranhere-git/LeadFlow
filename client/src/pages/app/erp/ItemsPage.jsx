// Items catalog: services, products, properties. Prices are set by managers/admins; everyone can read them.
import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { PageHeader, Card, Button, Field, SelectField, TextArea, Alert, Modal, Badge, LoadingState, ErrorState, EmptyState, Pager } from '../../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';
import { money, minorToInput, bpToPct, ITEM_TYPES, AVAILABILITY } from '../../../utils/money.js';

const TYPE_LABEL = Object.fromEntries(ITEM_TYPES);
const AVAIL_LABEL = Object.fromEntries(AVAILABILITY);
const AVAIL_COLOR = { AVAILABLE: 'green', RESERVED: 'amber', SOLD: 'gray' };

function ItemModal({ item, onClose }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [f, setF] = useState(() => ({
    name: item?.name || '',
    type: item?.type || 'SERVICE',
    sku: item?.sku || '',
    unit: item?.unit || '',
    price: minorToInput(item?.priceMinor),
    tax: bpToPct(item?.taxBp) || '0',
    description: item?.description || '',
    availability: item?.availability || 'NOT_TRACKED',
    fields: Object.entries(item?.customFields || {}),
  }));
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name: f.name, type: f.type, sku: f.sku.trim() || null, unit: f.unit, price: f.price, tax: f.tax || '0', description: f.description, availability: f.availability,
        customFields: Object.fromEntries(f.fields.filter(([k]) => k.trim()).map(([k, v]) => [k.trim(), v])),
      };
      return item ? (await api.patch(`/items/${item.id}`, body)).data.data.item : (await api.post('/items', body)).data.data.item;
    },
    onSuccess: () => { toast.success('Saved'); queryClient.invalidateQueries({ queryKey: ['items'] }); onClose(); },
  });
  const errs = apiFieldErrors(save.error);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} size="lg" title={item ? `Edit ${item.name}` : 'New item'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!f.name.trim() || !f.price} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" name="name" maxLength={150} value={f.name} onChange={set('name')} error={errs.name} />
          <SelectField label="Type" name="type" value={f.type} onChange={set('type')} options={ITEM_TYPES.map(([value, label]) => ({ value, label }))} />
          <Field label="Price (without tax)" name="price" inputMode="decimal" placeholder="60000" value={f.price} onChange={set('price')} error={errs.price || errs.priceMinor} hint="Normal units, e.g. 60000 or 1250.50" />
          <Field label="Tax %" name="tax" inputMode="decimal" value={f.tax} onChange={set('tax')} error={errs.tax} hint="e.g. 17 for 17 %" />
          <Field label="Unit (optional)" name="unit" maxLength={30} placeholder="project / hour / plot / marla" value={f.unit} onChange={set('unit')} />
          <Field label="SKU / code (optional)" name="sku" maxLength={60} value={f.sku} onChange={set('sku')} error={errs.sku} />
          <SelectField label="Availability" name="availability" value={f.availability} onChange={set('availability')} options={AVAILABILITY.map(([value, label]) => ({ value, label }))} />
          <p className="self-end text-xs text-white/45">Availability is for plots, apartments or stock. When a quote is accepted, its “Available” items become “Reserved”.</p>
        </div>
        <TextArea label="Description (optional)" name="description" rows={3} maxLength={2000} value={f.description} onChange={set('description')} />
        <div>
          <p className="mb-2 text-sm font-medium">Extra details (custom fields)</p>
          {f.fields.map(([k, v], i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_auto] gap-2">
              <Field aria-label="Field name" name={`fk${i}`} placeholder="Size" maxLength={40} value={k} onChange={(e) => setF({ ...f, fields: f.fields.map((x, j) => (j === i ? [e.target.value, x[1]] : x)) })} />
              <Field aria-label="Value" name={`fv${i}`} placeholder="10 marla" maxLength={500} value={v} onChange={(e) => setF({ ...f, fields: f.fields.map((x, j) => (j === i ? [x[0], e.target.value] : x)) })} />
              <Button variant="ghost" aria-label="Remove field" onClick={() => setF({ ...f, fields: f.fields.filter((_, j) => j !== i) })}>✕</Button>
            </div>
          ))}
          {f.fields.length < 20 && <Button variant="ghost" className="px-3 py-1.5" onClick={() => setF({ ...f, fields: [...f.fields, ['', '']] })}>+ Add field</Button>}
          {errs.customFields && <p className="mt-1 text-xs text-red-300">{errs.customFields}</p>}
        </div>
      </div>
    </Modal>
  );
}

export default function ItemsPage() {
  useDocumentTitle('Items');
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const manage = can('catalog:manage');
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null); // item | 'new'
  const params = { page, limit: 20, status, ...(q.trim() && { q: q.trim() }), ...(type && { type }) };
  const list = useQuery({ queryKey: ['items', params], queryFn: async () => (await api.get('/items', { params })).data.data, placeholderData: keepPreviousData });
  const archive = useMutation({
    mutationFn: (it) => api.patch(`/items/${it.id}`, { status: it.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' }),
    onSuccess: () => { toast.success('Updated'); queryClient.invalidateQueries({ queryKey: ['items'] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <>
      <PageHeader title="Items" description="Your services, products and properties with prices. Quotes copy the price — changing it later doesn't change old quotes." actions={manage && <Button onClick={() => setEditing('new')}>New item</Button>} />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Field label="Search" name="q" maxLength={80} placeholder="Name, SKU…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <SelectField label="Type" name="type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} options={[{ value: '', label: 'All types' }, ...ITEM_TYPES.map(([value, label]) => ({ value, label }))]} />
          <SelectField label="Show" name="status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'ARCHIVED', label: 'Archived' }]} />
        </div>
        {list.isLoading && <LoadingState rows={4} />}
        {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
        {list.data?.items.length === 0 && <EmptyState icon="box" title="No items yet" description={manage ? 'Add what you sell — then build quotes from it.' : 'A manager adds items and prices.'} />}
        {list.data?.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-white/45"><tr><th className="py-2 pr-3">Name</th><th className="pr-3">Type</th><th className="pr-3 text-right">Price</th><th className="pr-3 text-right">Tax</th><th className="pr-3">Availability</th><th /></tr></thead>
              <tbody className="divide-y divide-white/5">
                {list.data.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2.5 pr-3">
                      <p className="font-medium">{it.name}</p>
                      <p className="text-xs text-white/40">{[it.sku, it.unit && `per ${it.unit}`, ...Object.entries(it.customFields || {}).slice(0, 3).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="pr-3 text-white/60">{TYPE_LABEL[it.type]}</td>
                    <td className="whitespace-nowrap pr-3 text-right font-mono">{money(it.priceMinor, it.currency)}</td>
                    <td className="pr-3 text-right text-white/60">{it.taxBp / 100}%</td>
                    <td className="pr-3">{it.availability !== 'NOT_TRACKED' ? <Badge color={AVAIL_COLOR[it.availability]}>{AVAIL_LABEL[it.availability]}</Badge> : <span className="text-white/30">—</span>}</td>
                    <td className="whitespace-nowrap text-right">
                      {manage && (
                        <>
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing(it)}>Edit</Button>
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => archive.mutate(it)}>{it.status === 'ACTIVE' ? 'Archive' : 'Restore'}</Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager pagination={list.data?.pagination} onPage={setPage} />
      </Card>
      {editing && <ItemModal item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
