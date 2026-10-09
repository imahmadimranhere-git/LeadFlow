// One invoice: edit while DRAFT → Issue (gets its number, then locked) → record payments → Paid.
// Mistakes: void a payment (reason) / void the invoice (reason). Nothing is ever deleted after issuing.
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
import { formatDate } from '../../../utils/platform.js';
import { money, minorToInput, qty, invoiceBadge, PAYMENT_METHODS } from '../../../utils/money.js';
import { newLine, dateInput, linesFormFromDoc, linesPayload, previewTotals, LinesCard, TotalsCard } from '../../../components/erp/LinesEditor.jsx';

const METHOD_LABEL = Object.fromEntries(PAYMENT_METHODS);

function ReasonModal({ title, onConfirm, onClose, pending, error }) {
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} size="sm" title={title} footer={<><Button variant="ghost" onClick={onClose}>Back</Button><Button variant="danger" loading={pending} disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>Confirm</Button></>}>
      <div className="space-y-3">
        {error && <Alert>{apiErrorMessage(error)}</Alert>}
        <TextArea label="Reason (kept in the record)" name="reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

function PaymentModal({ inv, onClose, onDone }) {
  const [f, setF] = useState({ amount: minorToInput(inv.balanceMinor), method: 'BANK_TRANSFER', reference: '', paidAt: dateInput(new Date()), note: '' });
  const save = useMutation({
    mutationFn: async () => (await api.post(`/invoices/${inv.id}/payments`, { amount: f.amount, method: f.method, ...(f.reference && { reference: f.reference }), ...(f.note && { note: f.note }), ...(f.paidAt && { paidAt: new Date(`${f.paidAt}T12:00:00`).toISOString() }) })).data.data,
    onSuccess: onDone,
  });
  const errs = apiFieldErrors(save.error);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title="Record a payment" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!f.amount} onClick={() => save.mutate()}>Save payment</Button></>}>
      <div className="space-y-3">
        {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
        <p className="text-sm text-white/60">Open balance: <b className="font-mono">{money(inv.balanceMinor, inv.currency)}</b></p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Amount (${inv.currency})`} name="amount" inputMode="decimal" value={f.amount} onChange={set('amount')} error={errs.amount} />
          <SelectField label="Method" name="method" value={f.method} onChange={set('method')} options={PAYMENT_METHODS.map(([value, label]) => ({ value, label }))} />
          <Field label="Date received" name="paidAt" type="date" max={dateInput(new Date())} value={f.paidAt} onChange={set('paidAt')} error={errs.paidAt} />
          <Field label="Reference (optional)" name="reference" maxLength={120} placeholder="Cheque no. / bank ref" value={f.reference} onChange={set('reference')} />
        </div>
        <Field label="Note (optional)" name="note" maxLength={300} value={f.note} onChange={set('note')} />
      </div>
    </Modal>
  );
}

export default function InvoicePage() {
  const { id } = useParams();
  const isNew = !id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const manage = can('invoices:manage');
  const settings = useTenantSettings();
  const sales = settings.data?.sales || {};
  const q = useQuery({ queryKey: ['invoices', 'one', id], queryFn: async () => (await api.get(`/invoices/${id}`)).data.data, enabled: !isNew });
  const items = useQuery({ queryKey: ['items', 'picker'], queryFn: async () => (await api.get('/items', { params: { limit: 100 } })).data.data.items, enabled: manage });
  const clients = useQuery({ queryKey: ['clients', 'picker'], queryFn: async () => (await api.get('/clients', { params: { limit: 100 } })).data.data.items, enabled: isNew });
  const inv = q.data?.invoice;
  const [form, setForm] = useState(null);
  const [clientPick, setClientPick] = useState(params.get('clientId') || '');
  const [modal, setModal] = useState(null); // pay | void | voidPay:<id>
  const f = form || (inv ? { title: inv.title, notes: inv.notes, footer: inv.footer, internalNote: inv.internalNote, dueDate: dateInput(inv.dueDate), ...linesFormFromDoc(inv) } : isNew ? { title: '', notes: '', footer: sales.invoiceFooter || '', internalNote: '', dueDate: '', discountType: 'NONE', discountValue: '', lines: [newLine()] } : null);
  const set = (patch) => setForm({ ...f, ...patch });
  useDocumentTitle(inv ? `Invoice ${inv.number || '(draft)'}` : 'New invoice');
  const itemsById = useMemo(() => new Map((items.data || []).map((i) => [i.id, i])), [items.data]);
  const refresh = () => { setForm(null); queryClient.invalidateQueries({ queryKey: ['invoices'] }); queryClient.invalidateQueries({ queryKey: ['items'] }); };

  const save = useMutation({
    mutationFn: async () => {
      const body = { title: f.title, notes: f.notes, footer: f.footer, internalNote: f.internalNote, ...(f.dueDate && { dueDate: new Date(`${f.dueDate}T12:00:00`).toISOString() }), ...linesPayload(f) };
      if (isNew) return (await api.post('/invoices', { ...body, clientId: clientPick })).data.data.invoice;
      return (await api.patch(`/invoices/${id}`, body)).data.data.invoice;
    },
    onSuccess: (x) => { toast.success('Saved — totals calculated by the server'); refresh(); if (isNew) navigate(`/app/invoices/${x.id}`, { replace: true }); },
  });
  const act = useMutation({
    mutationFn: async ({ path, body = {}, method = 'post' }) => (await api[method](path, body)).data.data,
    onSuccess: (_d, v) => { toast.success(v.done); setModal(null); if (v.goList) navigate('/app/invoices'); else refresh(); },
    onError: (e, v) => { if (!v.inModal) toast.error(apiErrorMessage(e)); },
  });
  const errs = apiFieldErrors(save.error);

  if (!isNew && q.isLoading) return <LoadingState rows={8} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;
  if (!f) return <LoadingState rows={4} />;

  const draft = isNew || inv?.status === 'DRAFT';
  const currency = inv?.currency || sales.currency || 'USD';
  const p = draft ? previewTotals(f, itemsById, sales.defaultTaxBp) : null;
  const badge = inv ? invoiceBadge(inv) : null;
  const payments = q.data?.payments || [];

  return (
    <>
      <Link to="/app/invoices" className="text-sm text-white/50 hover:text-white">← All invoices</Link>
      <div className="mb-6 mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">{inv ? inv.number || 'Draft invoice' : 'New invoice'}{badge && <Badge color={badge[0]}>{badge[1]}</Badge>}</h1>
          {inv && <p className="mt-1 text-sm text-white/50"><Link className="underline" to={`/app/contacts/${inv.clientId.id}`}>{inv.clientId.name}</Link>{inv.quoteId && <> · from quote <Link className="underline" to={`/app/quotes/${inv.quoteId.id}`}>{inv.quoteId.number}</Link></>} · {currency}</p>}
        </div>
        {inv && (
          <div className="flex flex-wrap gap-2">
            <a href={`/print/invoices/${inv.id}`} target="_blank" rel="noopener noreferrer" className="rounded-lg px-3 py-2 text-sm ring-1 ring-white/15 hover:bg-white/5">Print / PDF</a>
            {manage && inv.status === 'DRAFT' && <Button loading={act.isPending} disabled={Boolean(form)} title={form ? 'Save your changes first' : ''} onClick={() => act.mutate({ path: `/invoices/${inv.id}/issue`, done: 'Invoice issued — it now has its number' })}>Issue invoice</Button>}
            {manage && inv.status === 'ISSUED' && <Button onClick={() => setModal('pay')}>Record payment</Button>}
            {manage && ['ISSUED', 'PAID'].includes(inv.status) && <Button variant="ghost" onClick={() => setModal('void')}>Void</Button>}
            {manage && inv.status === 'DRAFT' && <Button variant="ghost" loading={act.isPending} onClick={() => act.mutate({ path: `/invoices/${inv.id}`, method: 'delete', done: 'Draft deleted', goList: true })}>Delete draft</Button>}
          </div>
        )}
      </div>

      {inv?.status === 'VOID' && <div className="mb-4"><Alert>Void{inv.voidReason ? `: ${inv.voidReason}` : ''} ({formatDate(inv.voidedAt)}). Kept for the record.</Alert></div>}
      {save.isError && <div className="mb-4"><Alert>{apiErrorMessage(save.error)}{Object.entries(errs).map(([k, m]) => <span key={k} className="block text-xs">{k}: {m}</span>)}</Alert></div>}

      {draft ? (
        <fieldset disabled={!manage || save.isPending} className="space-y-6">
          {isNew && (
            <Card title="Client">
              <SelectField label="Invoice to" name="client" value={clientPick} onChange={(e) => setClientPick(e.target.value)} options={[{ value: '', label: 'Choose a client…' }, ...(clients.data || []).map((c) => ({ value: c.id, label: c.name }))]} />
            </Card>
          )}
          <LinesCard f={f} set={set} items={items.data} itemsById={itemsById} p={p} errs={errs} editable={manage} canManagePrices={can('catalog:manage')} defaultTaxBp={sales.defaultTaxBp} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Details">
              <div className="space-y-3">
                <Field label="Title" name="title" maxLength={150} value={f.title} onChange={(e) => set({ title: e.target.value })} />
                <Field label="Due date (optional)" name="dueDate" type="date" value={f.dueDate} onChange={(e) => set({ dueDate: e.target.value })} hint={`Empty = ${sales.paymentTermsDays ?? 15} days after issuing`} />
                <TextArea label="Notes for the client" name="notes" rows={2} maxLength={3000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
                <TextArea label="Footer (e.g. bank details)" name="footer" rows={3} maxLength={2000} value={f.footer} onChange={(e) => set({ footer: e.target.value })} />
                <TextArea label="Internal note (never printed)" name="internalNote" rows={2} maxLength={1000} value={f.internalNote} onChange={(e) => set({ internalNote: e.target.value })} />
              </div>
            </Card>
            <TotalsCard f={f} set={set} p={p} currency={currency} errs={errs} footerNote={form || isNew ? 'Preview — the server recalculates on save.' : 'Server numbers.'} />
          </div>
          {manage && (
            <div className="flex justify-end gap-2">
              {form && !isNew && <Button variant="ghost" onClick={() => setForm(null)}>Discard changes</Button>}
              <Button loading={save.isPending} disabled={Boolean(p?.error) || (isNew && !clientPick) || (!isNew && !form)} onClick={() => save.mutate()}>{isNew ? 'Create draft' : 'Save draft'}</Button>
            </div>
          )}
        </fieldset>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Card title="Lines">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-white/45"><tr><th className="py-2">Description</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Disc.</th><th className="text-right">Tax</th><th className="text-right">Amount</th></tr></thead>
                  <tbody className="divide-y divide-white/5">
                    {inv.lines.map((l) => (
                      <tr key={l.id}><td className="py-2 pr-2">{l.description}</td><td className="text-right">{qty(l.qtyMilli)} {l.unit}</td><td className="text-right font-mono">{money(l.unitPriceMinor)}</td><td className="text-right">{l.discountBp ? `${l.discountBp / 100}%` : '—'}</td><td className="text-right">{l.taxBp ? `${l.taxBp / 100}%` : '—'}</td><td className="text-right font-mono">{money(l.netMinor)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Payments">
              {payments.length === 0 && <p className="text-sm text-white/45">No payments yet.</p>}
              <ul className="divide-y divide-white/5">
                {payments.map((x) => (
                  <li key={x.id} className={`flex flex-wrap items-center gap-3 py-2.5 text-sm ${x.voided ? 'opacity-50' : ''}`}>
                    <span className="w-24 text-white/55">{formatDate(x.paidAt)}</span>
                    <span className={`font-mono ${x.voided ? 'line-through' : ''}`}>{money(x.amountMinor, x.currency)}</span>
                    <span className="text-white/60">{METHOD_LABEL[x.method]}{x.reference ? ` · ${x.reference}` : ''}</span>
                    <span className="text-xs text-white/35">by {x.recordedBy?.name}</span>
                    {x.voided ? <span className="ml-auto text-xs text-red-300">void: {x.voidReason}</span> : manage && <Button variant="ghost" className="ml-auto px-2 py-1 text-xs" onClick={() => setModal(`voidPay:${x.id}`)}>Void</Button>}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <Card title="Summary">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-white/55">Issued</dt><dd>{formatDate(inv.issueDate)}</dd></div>
              <div className="flex justify-between"><dt className="text-white/55">Due</dt><dd className={inv.overdue ? 'text-red-300' : ''}>{formatDate(inv.dueDate)}</dd></div>
              <div className="flex justify-between pt-2"><dt className="text-white/55">Total</dt><dd className="font-mono">{money(inv.totalMinor, currency)}</dd></div>
              <div className="flex justify-between"><dt className="text-white/55">Paid</dt><dd className="font-mono">{money(inv.paidMinor, currency)}</dd></div>
              <div className="flex justify-between border-t border-white/10 pt-2 text-base font-semibold"><dt>Balance</dt><dd className="font-mono">{money(inv.balanceMinor, currency)}</dd></div>
            </dl>
            {inv.internalNote && <p className="mt-4 text-xs text-white/45">Internal: {inv.internalNote}</p>}
          </Card>
        </div>
      )}

      {modal === 'pay' && <PaymentModal inv={inv} onClose={() => setModal(null)} onDone={() => { toast.success('Payment recorded'); setModal(null); refresh(); }} />}
      {modal === 'void' && <ReasonModal title={`Void invoice ${inv.number}`} pending={act.isPending} error={act.error} onClose={() => { act.reset(); setModal(null); }} onConfirm={(reason) => act.mutate({ path: `/invoices/${inv.id}/void`, body: { reason }, done: 'Invoice voided', inModal: true })} />}
      {modal?.startsWith('voidPay:') && <ReasonModal title="Void this payment" pending={act.isPending} error={act.error} onClose={() => { act.reset(); setModal(null); }} onConfirm={(reason) => act.mutate({ path: `/invoices/payments/${modal.slice(8)}/void`, body: { reason }, done: 'Payment voided — balance updated', inModal: true })} />}
    </>
  );
}
