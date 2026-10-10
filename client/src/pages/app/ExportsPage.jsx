// Exports (A29): choose what, which columns and filters → a background job → a 10-minute download link.
// The server decides everything (allowed types, columns, filters, password check, do-not-contact) —
// this page only shows what the catalogue says is allowed.
import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import { useToast } from '../../components/Toast.jsx';
import { PageHeader, Card, Button, Field, SelectField, TextArea, Alert, Modal, Badge, LoadingState, ErrorState, EmptyState, Pager } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatDateTime } from '../../utils/platform.js';
import { LEAD_STATUSES, PRIORITIES, LEAD_SOURCE_OPTIONS } from '../../utils/leadOptions.js';

const STATUS_COLOR = { QUEUED: 'gray', RUNNING: 'blue', DONE: 'green', FAILED: 'red', EXPIRED: 'gray' };
const PDF_MAX_COLUMNS = 8;
const opt = (pairs) => [{ value: '', label: 'Any' }, ...pairs.map(([v, l]) => ({ value: v, label: l || v }))];
const words = (list) => list.map((v) => [v, v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ')]);

/** How each allowed filter is shown. Status lists depend on the export type. */
function filterField(type, key) {
  switch (key) {
    case 'from': return { label: 'From', input: 'date' };
    case 'to': return { label: 'To', input: 'date' };
    case 'minScore': return { label: 'Min. score (0–100)', input: 'number' };
    case 'source': return { label: 'Source', options: opt(LEAD_SOURCE_OPTIONS) };
    case 'priority': return { label: 'Priority', options: opt(PRIORITIES) };
    case 'channel': return { label: 'Channel', options: opt(words(['EMAIL', 'WHATSAPP', 'LINKEDIN', 'INSTAGRAM_DM', 'FACEBOOK_MESSAGE', 'GENERAL'])) };
    case 'status':
      if (type === 'LEADS') return { label: 'Status', options: opt(LEAD_STATUSES.map(([v, l]) => [v, l])) };
      if (type === 'QUOTES') return { label: 'Status', options: opt(words(['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'])) };
      if (type === 'INVOICES') return { label: 'Status', options: opt(words(['DRAFT', 'ISSUED', 'PAID', 'VOID'])) };
      if (type === 'EXPENSES') return { label: 'Status', options: opt(words(['RECORDED', 'VOID'])) };
      return { label: 'Status (exact value)', input: 'text' };
    case 'city': return { label: 'City', input: 'text' };
    case 'country': return { label: 'Country', input: 'text' };
    case 'matchedHashtag': return { label: 'Hashtag', input: 'text' };
    case 'tag': return { label: 'Tag', input: 'text' };
    case 'category': return { label: 'Category', input: 'text' };
    case 'action': return { label: 'Action (e.g. lead.deleted)', input: 'text' };
    default: return null; // ids (assignedTo, watchId) are set from other pages, not typed here
  }
}

function NewExport({ catalog, onDone }) {
  const toast = useToast();
  const types = Object.entries(catalog.types);
  const [type, setType] = useState(types[0]?.[0] || 'LEADS');
  const def = catalog.types[type];
  const [format, setFormat] = useState('CSV');
  const [columns, setColumns] = useState(def?.defaults || []);
  const [filters, setFilters] = useState({});
  const [dnc, setDnc] = useState({ on: false, reason: '' });
  const [askPassword, setAskPassword] = useState(false);
  const [password, setPassword] = useState('');
  useEffect(() => { setColumns(def?.defaults || []); setFilters({}); setDnc({ on: false, reason: '' }); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps
  const piiCols = useMemo(() => new Set((def?.columns || []).filter((c) => c.pii).map((c) => c.key)), [def]);
  const hasPii = columns.some((c) => piiCols.has(c));
  const tooManyForPdf = format === 'PDF' && columns.length > PDF_MAX_COLUMNS;
  const create = useMutation({
    mutationFn: async () => {
      const f = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, k === 'minScore' ? Number(v) : v]));
      return (await api.post('/exports', { type, format, filters: f, columns, ...(password && { password }), ...(dnc.on && { includeDoNotContact: true, overrideReason: dnc.reason }) })).data.data.export;
    },
    onSuccess: () => { toast.success('Export started — it appears below when ready'); setPassword(''); setAskPassword(false); onDone(); },
    onError: (e) => { if (e.response?.data?.errors?.[0]?.code === 'REAUTH_REQUIRED') setAskPassword(true); },
  });
  if (!def) return <Alert type="info">You don't have permission to export anything.</Alert>;
  const isReauth = create.isError && create.error.response?.data?.errors?.[0]?.code === 'REAUTH_REQUIRED';
  const start = () => (hasPii && !password ? setAskPassword(true) : create.mutate());
  const order = def.columns.map((c) => c.key);
  const toggle = (key, on) => setColumns(on ? order.filter((k) => k === key || columns.includes(k)) : columns.filter((x) => x !== key));
  return (
    <Card title="New export">
      <div className="space-y-4">
        <Alert type="info">Using exported data for outreach must follow platform terms and local laws (consent, anti-spam, privacy). You are responsible for lawful use.{def.contactable ? ' Do-not-contact and opted-out people are left out.' : ''}</Alert>
        {create.isError && !isReauth && <Alert>{apiErrorMessage(create.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="What" name="type" value={type} onChange={(e) => setType(e.target.value)} options={types.map(([k, t]) => ({ value: k, label: t.label }))} />
          <SelectField label="Format" name="format" value={format} onChange={(e) => setFormat(e.target.value)} options={[{ value: 'CSV', label: 'CSV (Excel, Google Sheets)' }, { value: 'PDF', label: `PDF table (max ${PDF_MAX_COLUMNS} columns)` }]} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {def.filters.map((k) => {
            const f = filterField(type, k);
            if (!f) return null;
            return f.options
              ? <SelectField key={k} label={f.label} name={`f-${k}`} value={filters[k] || ''} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })} options={f.options} />
              : <Field key={k} label={f.label} name={`f-${k}`} type={f.input} min={f.input === 'number' ? 0 : undefined} max={f.input === 'number' ? 100 : undefined} value={filters[k] || ''} onChange={(e) => setFilters({ ...filters, [k]: e.target.value })} />;
          })}
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Columns</span>
            <span className="text-xs text-white/40">🔒 = personal data → your password is asked</span>
            <button type="button" className="ml-auto text-xs text-brand-500 hover:underline" onClick={() => setColumns(def.defaults)}>Default</button>
            <button type="button" className="text-xs text-white/50 hover:underline" onClick={() => setColumns([])}>None</button>
          </div>
          <div className="grid gap-1 sm:grid-cols-3">
            {def.columns.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={columns.includes(c.key)} onChange={(e) => toggle(c.key, e.target.checked)} />
                {c.key}{c.pii ? ' 🔒' : ''}
              </label>
            ))}
          </div>
          {tooManyForPdf && <p className="mt-2 text-xs text-amber-300">A PDF table fits at most {PDF_MAX_COLUMNS} columns — choose fewer, or use CSV.</p>}
        </div>
        {catalog.canIncludeDoNotContact && def.contactable && (
          <div className="rounded-lg bg-white/[0.03] p-3 ring-1 ring-white/10">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={dnc.on} onChange={(e) => setDnc({ ...dnc, on: e.target.checked })} /> Include do-not-contact / opted-out people (owner/admin only)</label>
            {dnc.on && <TextArea label="Why? (saved in the audit log)" name="reason" rows={2} maxLength={300} value={dnc.reason} onChange={(e) => setDnc({ ...dnc, reason: e.target.value })} />}
          </div>
        )}
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-white/40">Max {catalog.rowCap.toLocaleString()} rows per file</span>
          <Button loading={create.isPending} disabled={!columns.length || tooManyForPdf || (dnc.on && dnc.reason.trim().length < 5)} onClick={start}>Start export</Button>
        </div>
      </div>
      <Modal open={askPassword} onClose={() => setAskPassword(false)} size="sm" title="Confirm with your password" footer={<><Button variant="ghost" onClick={() => setAskPassword(false)}>Cancel</Button><Button loading={create.isPending} disabled={!password} onClick={() => create.mutate()}>Confirm</Button></>}>
        <div className="space-y-3">
          {isReauth && password && <Alert>Wrong password — try again.</Alert>}
          <p className="text-sm text-white/70">This export contains personal data (emails / phone numbers). For your company's safety, please enter your password again.</p>
          <Field label="Password" name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </Modal>
    </Card>
  );
}

export default function ExportsPage() {
  useDocumentTitle('Exports');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const cat = useQuery({ queryKey: ['exports', 'catalog'], queryFn: async () => (await api.get('/exports/catalog')).data.data });
  const list = useQuery({
    queryKey: ['exports', 'list', page],
    queryFn: async () => (await api.get('/exports', { params: { page, limit: 20 } })).data.data,
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items?.some((j) => ['QUEUED', 'RUNNING'].includes(j.status)) ? 3000 : false),
  });
  const download = useMutation({
    mutationFn: async (id) => (await api.post(`/exports/${id}/link`)).data.data.url,
    onSuccess: (url) => {
      window.location.assign(url);
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['exports', 'list'] }), 1500);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <>
      <PageHeader title="Exports" description="Files are kept for 24 hours, then deleted. Each download link works for 10 minutes, and every download is logged." />
      <div className="space-y-6">
        {cat.isLoading && <LoadingState rows={3} />}
        {cat.isError && <ErrorState message={apiErrorMessage(cat.error)} onRetry={cat.refetch} />}
        {cat.data && <NewExport catalog={cat.data} onDone={() => queryClient.invalidateQueries({ queryKey: ['exports', 'list'] })} />}
        <Card title="History">
          {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
          {list.data?.items.length === 0 && <EmptyState icon="download" title="No exports yet" />}
          <ul className="divide-y divide-white/5">
            {list.data?.items.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="w-36 text-white/55">{formatDateTime(j.createdAt)}</span>
                <span className="font-medium">{cat.data?.types[j.type]?.label || j.type}</span>
                <Badge color="gray">{j.format}</Badge>
                {j.includesPii && <Badge color="amber">personal data</Badge>}
                {j.includeDoNotContact && <Badge color="red">incl. do-not-contact</Badge>}
                <Badge color={STATUS_COLOR[j.status]}>{j.status.toLowerCase()}</Badge>
                {j.status === 'DONE' && <span className="text-white/45">{j.rowCount} rows{j.truncated ? ' (cut — narrow the filters)' : ''}{j.downloads ? ` · downloaded ${j.downloads}×` : ''}</span>}
                {j.replacedChars > 0 && <span className="text-xs text-amber-300" title="The PDF font only has Latin letters">{j.replacedChars} non-Latin characters shown as “?” — use CSV for Urdu/Arabic text</span>}
                <span className="text-xs text-white/35">{j.requestedBy?.name}</span>
                {j.status === 'FAILED' && <span className="text-xs text-red-300">{j.error}</span>}
                {j.status === 'DONE' && <Button className="ml-auto px-3 py-1.5" loading={download.isPending && download.variables === j.id} onClick={() => download.mutate(j.id)}>Download</Button>}
              </li>
            ))}
          </ul>
          <Pager pagination={list.data?.pagination} onPage={setPage} />
        </Card>
      </div>
    </>
  );
}
