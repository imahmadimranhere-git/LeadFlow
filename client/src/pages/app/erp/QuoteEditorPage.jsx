// Quote editor. The preview is calculated in the browser while you type, but on Save the SERVER
// recalculates everything and its numbers are what's stored and printed.
import PdfDownloadButton from '../../../components/PdfDownloadButton.jsx';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import useTenantSettings from '../../../hooks/useTenantSettings.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../components/Toast.jsx';
import { Card, Button, Field, SelectField, TextArea, Alert, Badge, Modal, LoadingState, ErrorState } from '../../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';
import { QUOTE_STATUS_COLOR, QUOTE_STATUS_LABEL } from '../../../utils/money.js';
import { newLine, dateInput, linesFormFromDoc, linesPayload, previewTotals, LinesCard, TotalsCard } from '../../../components/erp/LinesEditor.jsx';

function fromQuote(q) {
  return {
    title: q.title || '',
    issueDate: dateInput(q.issueDate),
    validUntil: dateInput(q.validUntil),
    notes: q.notes || '',
    terms: q.terms || '',
    internalNote: q.internalNote || '',
    ...linesFormFromDoc(q),
  };
}

function StatusActions({ quote, onChanged }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [ask, setAsk] = useState(null);
  const [note, setNote] = useState('');
  const change = useMutation({
    mutationFn: async ({ status, note: n }) => (await api.post(`/quotes/${quote.id}/status`, { status, ...(n && { note: n }) })).data.data.quote,
    onSuccess: (q) => { toast.success(`Quote ${QUOTE_STATUS_LABEL[q.status].toLowerCase()}`); setAsk(null); onChanged(q); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const { can } = useAuth();
  const invoice = useMutation({ mutationFn: async () => (await api.post(`/invoices/from-quote/${quote.id}`)).data.data.invoice, onSuccess: (inv) => { toast.success('Draft invoice created'); navigate(`/app/invoices/${inv.id}`); }, onError: (e) => toast.error(apiErrorMessage(e)) });
  const project = useMutation({ mutationFn: async () => (await api.post(`/projects/from-quote/${quote.id}`)).data.data.project, onSuccess: (p) => { toast.success('Project created'); navigate(`/app/projects/${p.id}`); }, onError: (e) => toast.error(apiErrorMessage(e)) });
  const dup = useMutation({ mutationFn: async () => (await api.post(`/quotes/${quote.id}/duplicate`)).data.data.quote, onSuccess: (q) => { toast.success(`Copy ${q.number} created`); navigate(`/app/quotes/${q.id}`); }, onError: (e) => toast.error(apiErrorMessage(e)) });
  const s = quote.status;
  const b = (status, label, variant = 'ghost') => <Button key={status} variant={variant} loading={change.isPending && change.variables?.status === status} onClick={() => (['DECLINED', 'CANCELLED'].includes(status) ? setAsk(status) : change.mutate({ status }))}>{label}</Button>;
  return (
    <div className="flex flex-wrap gap-2">
      <a href={`/print/quotes/${quote.id}`} target="_blank" rel="noopener noreferrer" className="rounded-lg px-3 py-2 text-sm ring-1 ring-white/15 hover:bg-white/5">Print</a>
      <PdfDownloadButton path={`/quotes/${quote.id}/pdf`} fileName="quote.pdf">PDF file</PdfDownloadButton>
      {s === 'DRAFT' && b('SENT', 'Mark as sent', 'primary')}
      {s === 'SENT' && b('ACCEPTED', 'Accepted ✓', 'primary')}
      {s === 'ACCEPTED' && can('projects:manage') && <Button variant="ghost" loading={project.isPending} onClick={() => project.mutate()}>Start project</Button>}
      {s === 'ACCEPTED' && can('invoices:manage') && <Button loading={invoice.isPending} onClick={() => invoice.mutate()}>Create invoice</Button>}
      {s === 'SENT' && b('DECLINED', 'Declined')}
      {['SENT', 'DECLINED', 'EXPIRED'].includes(s) && b('DRAFT', 'Revise')}
      {['DRAFT', 'SENT'].includes(s) && b('CANCELLED', 'Cancel')}
      <Button variant="ghost" loading={dup.isPending} onClick={() => dup.mutate()}>Duplicate</Button>
      <Modal open={Boolean(ask)} onClose={() => setAsk(null)} size="sm" title={ask === 'DECLINED' ? 'Quote declined' : 'Cancel quote'} footer={<><Button variant="ghost" onClick={() => setAsk(null)}>Back</Button><Button loading={change.isPending} onClick={() => change.mutate({ status: ask, note: note.trim() })}>Confirm</Button></>}>
        <TextArea label="Reason (optional)" name="reason" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={ask === 'DECLINED' ? 'e.g. price too high, chose a competitor' : ''} />
      </Modal>
    </div>
  );
}

export default function QuoteEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const settings = useTenantSettings();
  const sales = settings.data?.sales || {};

  const existing = useQuery({ queryKey: ['quotes', 'one', id], queryFn: async () => (await api.get(`/quotes/${id}`)).data.data, enabled: !isNew });
  const items = useQuery({ queryKey: ['items', 'picker'], queryFn: async () => (await api.get('/items', { params: { limit: 100 } })).data.data.items });
  const clients = useQuery({ queryKey: ['clients', 'picker'], queryFn: async () => (await api.get('/clients', { params: { limit: 100 } })).data.data.items, enabled: isNew && !params.get('leadId') && !params.get('clientId') });
  const leadId = params.get('leadId');
  const leadQ = useQuery({ queryKey: ['leads', 'detail', leadId], queryFn: async () => (await api.get(`/leads/${leadId}`)).data.data.lead, enabled: isNew && Boolean(leadId) });

  const quote = existing.data?.quote;
  const [form, setForm] = useState(null);
  const [clientPick, setClientPick] = useState(params.get('clientId') || '');
  const f = form || (quote ? fromQuote(quote) : isNew ? { title: '', issueDate: dateInput(new Date()), validUntil: '', notes: '', terms: sales.quoteTerms || '', internalNote: '', discountType: 'NONE', discountValue: '', lines: [newLine()] } : null);
  const set = (patch) => setForm({ ...f, ...patch });
  useDocumentTitle(quote ? `Quote ${quote.number}` : 'New quote');

  const itemsById = useMemo(() => new Map((items.data || []).map((i) => [i.id, i])), [items.data]);
  const editable = isNew || quote?.status === 'DRAFT';
  const canManagePrices = existing.data?.canManagePrices ?? can('catalog:manage');
  const maxBp = existing.data?.salesMaxDiscountBp ?? sales.salesMaxDiscountBp ?? 1000;
  const currency = quote?.currency || sales.currency || 'USD';
  const p = f ? previewTotals(f, itemsById, sales.defaultTaxBp) : null;

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: f.title,
        notes: f.notes,
        terms: f.terms,
        internalNote: f.internalNote,
        ...(f.issueDate && { issueDate: new Date(f.issueDate).toISOString() }),
        ...(f.validUntil && { validUntil: new Date(f.validUntil).toISOString() }),
        ...linesPayload(f),
      };
      if (isNew) {
        if (leadId) body.leadId = leadId;
        else if (clientPick) body.clientId = clientPick;
        return (await api.post('/quotes', body)).data.data.quote;
      }
      return (await api.patch(`/quotes/${id}`, body)).data.data.quote;
    },
    onSuccess: (q) => {
      toast.success('Saved — totals calculated by the server');
      queryClient.invalidateQueries({ queryKey: ['quotes'] });
      setForm(null);
      if (isNew) navigate(`/app/quotes/${q.id}`, { replace: true });
    },
  });
  const errs = apiFieldErrors(save.error);

  if (!isNew && existing.isLoading) return <LoadingState rows={8} />;
  if (existing.isError) return <ErrorState message={apiErrorMessage(existing.error)} onRetry={existing.refetch} />;
  if (!f) return <LoadingState rows={4} />;

  const party = quote ? quote.clientId?.name || quote.leadId?.name : leadId ? leadQ.data?.name : null;
  const overLimit = !canManagePrices && p && !p.error && p.effectiveDiscountBp > maxBp;

  return (
    <>
      <Link to="/app/quotes" className="text-sm text-white/50 hover:text-white">← All quotes</Link>
      <div className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {quote ? quote.number : 'New quote'}
            {quote && <Badge color={QUOTE_STATUS_COLOR[quote.status]}>{QUOTE_STATUS_LABEL[quote.status]}</Badge>}
            {quote?.revision > 1 && <span className="text-sm text-white/40">rev. {quote.revision}</span>}
          </h1>
          <p className="mt-1 text-sm text-white/50">
            For: {party ? (quote?.clientId ? <Link className="underline" to={`/app/contacts/${quote.clientId.id}`}>{party}</Link> : party) : '—'} · {currency}
          </p>
        </div>
        {quote && <StatusActions quote={quote} onChanged={() => { setForm(null); queryClient.invalidateQueries({ queryKey: ['quotes'] }); }} />}
      </div>

      {!editable && <div className="mb-4"><Alert type="info">This quote is {QUOTE_STATUS_LABEL[quote.status].toLowerCase()} — it can't be edited. Use “Revise” (sent / declined / expired) or “Duplicate”.</Alert></div>}
      {save.isError && <div className="mb-4"><Alert>{apiErrorMessage(save.error)}{Object.entries(errs).map(([k, m]) => <span key={k} className="block text-xs">{k}: {m}</span>)}</Alert></div>}

      <fieldset disabled={!editable || save.isPending} className="space-y-6">
        {isNew && !leadId && (
          <Card title="Client">
            {clients.isLoading ? <LoadingState rows={1} /> : (
              <SelectField label="Quote for" name="client" value={clientPick} onChange={(e) => setClientPick(e.target.value)} options={[{ value: '', label: 'Choose a client…' }, ...(clients.data || []).map((c) => ({ value: c.id, label: c.name }))]} />
            )}
            <p className="mt-2 text-xs text-white/45">For a lead who isn't a client yet: open the lead and click “Create quote”.</p>
          </Card>
        )}

        <LinesCard f={f} set={set} items={items.data} itemsById={itemsById} p={p} errs={errs} editable={editable} canManagePrices={canManagePrices} defaultTaxBp={sales.defaultTaxBp} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Details">
            <div className="space-y-3">
              <Field label="Title" name="title" maxLength={150} placeholder="e.g. Website for Ali Bakery" value={f.title} onChange={(e) => set({ title: e.target.value })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Issue date" name="issueDate" type="date" value={f.issueDate} onChange={(e) => set({ issueDate: e.target.value })} />
                <Field label="Valid until" name="validUntil" type="date" value={f.validUntil} onChange={(e) => set({ validUntil: e.target.value })} hint={!f.validUntil ? `Empty = ${sales.quoteValidityDays || 15} days` : undefined} error={errs.validUntil} />
              </div>
              <TextArea label="Notes for the client" name="notes" rows={3} maxLength={3000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
              <TextArea label="Terms" name="terms" rows={3} maxLength={3000} value={f.terms} onChange={(e) => set({ terms: e.target.value })} />
              <TextArea label="Internal note (never printed)" name="internalNote" rows={2} maxLength={1000} value={f.internalNote} onChange={(e) => set({ internalNote: e.target.value })} />
            </div>
          </Card>
          <TotalsCard f={f} set={set} p={p} currency={currency} errs={errs} overLimitBp={overLimit ? maxBp : null} footerNote={form ? 'Preview — the server recalculates on save.' : quote ? `These are the server's numbers (saved ${new Date(quote.updatedAt).toLocaleString()}).` : null} />
        </div>

        {editable && (
          <div className="flex justify-end gap-2">
            {form && !isNew && <Button variant="ghost" onClick={() => setForm(null)}>Discard changes</Button>}
            <Button loading={save.isPending} disabled={Boolean(p?.error) || overLimit || (isNew && !leadId && !clientPick)} onClick={() => save.mutate()}>{isNew ? 'Create quote' : 'Save'}</Button>
          </div>
        )}
      </fieldset>
    </>
  );
}
