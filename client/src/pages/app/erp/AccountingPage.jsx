// Accounting-lite: Overview (P&L) · Expenses · Reports (aging, income by client, expense breakdown) · Settings.
// Cash basis: income = payments actually received. All amounts per currency.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { useToast } from '../../../components/Toast.jsx';
import { PageHeader, Card, Button, Field, SelectField, TextArea, Alert, Modal, Badge, StatCard, LoadingState, ErrorState, EmptyState, Pager } from '../../../components/ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../../utils/apiErrors.js';
import { money, minorToInput, PAYMENT_METHODS } from '../../../utils/money.js';
import { todayKey } from '../../../utils/projects.js';

const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthsAgo = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n); return monthKey(d); };
const monthLabel = (m) => new Date(`${m}-01T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
const BUCKET_LABEL = { current: 'Not due', '1-30': '1–30 days', '31-60': '31–60', '61-90': '61–90', '90+': '90+ days' };

function RangePicker({ range, setRange }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="From" name="from" type="month" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
      <Field label="To" name="to" type="month" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
    </div>
  );
}

// ---------------------------------------------------------------- overview

function Overview() {
  const [range, setRange] = useState({ from: monthsAgo(5), to: monthsAgo(0) });
  const summary = useQuery({ queryKey: ['accounting', 'summary'], queryFn: async () => (await api.get('/accounting/summary')).data.data });
  const pnl = useQuery({ queryKey: ['accounting', 'pnl', range], queryFn: async () => (await api.get('/accounting/reports/pnl', { params: range })).data.data, placeholderData: keepPreviousData, enabled: Boolean(range.from && range.to) });
  const s = summary.data;
  return (
    <div className="space-y-6">
      {s && Object.entries(s.thisMonth).map(([cur, t]) => (
        <div key={cur} className="grid gap-4 sm:grid-cols-4">
          <StatCard label={`Received this month (${cur})`} value={money(t.income)} />
          <StatCard label="Expenses this month" value={money(t.expenses)} />
          <StatCard label="Profit this month" value={<span className={t.profit < 0 ? 'text-red-300' : ''}>{money(t.profit)}</span>} />
          <StatCard label="Receivables (overdue)" value={money(s.receivables[cur]?.total || 0)} hint={s.receivables[cur]?.overdue ? `${money(s.receivables[cur].overdue)} overdue` : 'nothing overdue'} />
        </div>
      ))}
      {s?.lockedUntil && <Alert type="info">Books are closed until <b>{s.lockedUntil}</b>.</Alert>}
      <Card title="Profit & loss (cash basis)">
        <RangePicker range={range} setRange={setRange} />
        {pnl.isError && <div className="mt-3"><Alert>{apiErrorMessage(pnl.error)}</Alert></div>}
        {pnl.data && Object.keys(pnl.data.currencies).length === 0 && <p className="mt-4 text-sm text-white/45">No payments or expenses in this period.</p>}
        {pnl.data && Object.entries(pnl.data.currencies).map(([cur, d]) => {
          const max = Math.max(1, ...d.rows.map((r) => Math.max(r.income, r.expenses)));
          return (
            <div key={cur} className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-white/45"><tr><th className="py-2">{cur}</th><th className="text-right">Income</th><th className="text-right">Expenses</th><th className="text-right">Profit</th><th className="w-40" /></tr></thead>
                <tbody className="divide-y divide-white/5">
                  {d.rows.map((r) => (
                    <tr key={r.month}>
                      <td className="py-2">{monthLabel(r.month)}</td>
                      <td className="text-right font-mono">{money(r.income)}</td>
                      <td className="text-right font-mono">{money(r.expenses)}</td>
                      <td className={`text-right font-mono ${r.profit < 0 ? 'text-red-300' : ''}`}>{money(r.profit)}</td>
                      <td className="pl-3">
                        <div className="h-1.5 rounded bg-brand-500" style={{ width: `${(r.income / max) * 100}%` }} title="income" />
                        <div className="mt-0.5 h-1.5 rounded bg-red-400/70" style={{ width: `${(r.expenses / max) * 100}%` }} title="expenses" />
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold"><td className="py-2">Total</td><td className="text-right font-mono">{money(d.totals.income)}</td><td className="text-right font-mono">{money(d.totals.expenses)}</td><td className={`text-right font-mono ${d.totals.profit < 0 ? 'text-red-300' : ''}`}>{money(d.totals.profit)}</td><td className="pl-3 text-xs text-white/45">{d.marginPercent !== null ? `margin ${d.marginPercent}%` : ''}</td></tr>
                </tbody>
              </table>
            </div>
          );
        })}
        <p className="mt-3 text-xs text-white/40">Cash basis: income is counted when the payment arrives, not when the invoice is issued. Months follow your company time zone ({pnl.data?.timezone || '…'}).</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- expenses

function ExpenseModal({ expense, categories, onClose }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const projects = useQuery({ queryKey: ['projects', 'picker-all'], queryFn: async () => (await api.get('/projects', { params: { limit: 100 } })).data.data.items, retry: false });
  const [f, setF] = useState({
    day: expense?.day || todayKey(), amount: minorToInput(expense?.amountMinor) || '', category: expense?.category || categories[0] || '', vendor: expense?.vendor || '',
    description: expense?.description || '', method: expense?.method || 'BANK_TRANSFER', reference: expense?.reference || '', projectId: expense?.projectId?.id || '',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, projectId: f.projectId || null };
      return expense ? api.patch(`/accounting/expenses/${expense.id}`, body) : api.post('/accounting/expenses', body);
    },
    onSuccess: () => { toast.success('Saved'); queryClient.invalidateQueries({ queryKey: ['accounting'] }); onClose(); },
  });
  const errs = apiFieldErrors(save.error);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={expense ? 'Edit expense' : 'New expense'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!f.amount || !f.category} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date paid" name="day" type="date" max={todayKey()} value={f.day} onChange={set('day')} error={errs.day} />
          <Field label="Amount" name="amount" inputMode="decimal" value={f.amount} onChange={set('amount')} error={errs.amount} />
          <SelectField label="Category" name="category" value={f.category} onChange={set('category')} options={categories.map((c) => ({ value: c, label: c }))} />
          <SelectField label="Paid by" name="method" value={f.method} onChange={set('method')} options={PAYMENT_METHODS.map(([value, label]) => ({ value, label }))} />
          <Field label="Vendor" name="vendor" maxLength={120} value={f.vendor} onChange={set('vendor')} />
          <Field label="Receipt / bill no." name="reference" maxLength={120} value={f.reference} onChange={set('reference')} />
        </div>
        <SelectField label="Project (optional)" name="project" value={f.projectId} onChange={set('projectId')} options={[{ value: '', label: '—' }, ...(projects.data || []).map((p) => ({ value: p.id, label: p.name }))]} />
        <TextArea label="Description" name="desc" rows={2} maxLength={500} value={f.description} onChange={set('description')} />
      </div>
    </Modal>
  );
}

function Expenses({ settings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [filters, setFilters] = useState({ from: '', to: '', category: '', status: 'RECORDED', q: '' });
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null); // 'new' | expense | {void: expense}
  const [reason, setReason] = useState('');
  const params = { page, limit: 25, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) };
  const list = useQuery({ queryKey: ['accounting', 'expenses', params], queryFn: async () => (await api.get('/accounting/expenses', { params })).data.data, placeholderData: keepPreviousData });
  const voidIt = useMutation({
    mutationFn: (id) => api.post(`/accounting/expenses/${id}/void`, { reason }),
    onSuccess: () => { toast.success('Expense voided'); setModal(null); setReason(''); queryClient.invalidateQueries({ queryKey: ['accounting'] }); },
  });
  const locked = (day) => settings.lockedUntil && day <= settings.lockedUntil;
  const set = (k) => (e) => { setFilters({ ...filters, [k]: e.target.value }); setPage(1); };
  return (
    <Card title="Expenses" action={<Button className="px-3 py-1.5" onClick={() => setModal('new')}>New expense</Button>}>
      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        <Field label="From" name="from" type="date" value={filters.from} onChange={set('from')} />
        <Field label="To" name="to" type="date" value={filters.to} onChange={set('to')} />
        <SelectField label="Category" name="cat" value={filters.category} onChange={set('category')} options={[{ value: '', label: 'All' }, ...settings.expenseCategories.map((c) => ({ value: c, label: c }))]} />
        <SelectField label="Show" name="st" value={filters.status} onChange={set('status')} options={[{ value: 'RECORDED', label: 'Recorded' }, { value: 'VOID', label: 'Void' }]} />
        <Field label="Search" name="q" maxLength={80} value={filters.q} onChange={set('q')} />
      </div>
      {list.isLoading && <LoadingState rows={4} />}
      {list.isError && <ErrorState message={apiErrorMessage(list.error)} onRetry={list.refetch} />}
      {list.data?.items.length === 0 && <EmptyState icon="receipt" title="No expenses" />}
      {list.data && Object.keys(list.data.totals).length > 0 && <p className="mb-2 text-sm">Total: {Object.entries(list.data.totals).map(([c, v]) => <b key={c} className="mr-3 font-mono">{money(v, c)}</b>)}</p>}
      <ul className="divide-y divide-white/5">
        {list.data?.items.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
            <span className="w-24 text-white/55">{e.day}</span>
            <Badge color="gray">{e.category}</Badge>
            <span className="min-w-0 flex-1 truncate">{e.vendor || '—'}{e.description ? <span className="text-white/45"> · {e.description}</span> : null}{e.projectId?.name ? <span className="text-white/45"> · {e.projectId.name}</span> : null}</span>
            <span className="font-mono">{money(e.amountMinor, e.currency)}</span>
            {e.status === 'VOID' ? <span className="text-xs text-red-300">void: {e.voidReason}</span> : locked(e.day) ? <span className="text-xs text-white/35">🔒 closed</span> : (
              <>
                <button type="button" className="text-xs text-white/50 underline" onClick={() => setModal(e)}>Edit</button>
                <button type="button" className="text-xs text-white/50 underline" onClick={() => { voidIt.reset(); setModal({ void: e }); }}>Void</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <Pager pagination={list.data?.pagination} onPage={setPage} />
      {(modal === 'new' || (modal && modal.id)) && <ExpenseModal expense={modal === 'new' ? null : modal} categories={settings.expenseCategories} onClose={() => setModal(null)} />}
      {modal?.void && (
        <Modal open onClose={() => setModal(null)} size="sm" title="Void expense" footer={<><Button variant="ghost" onClick={() => setModal(null)}>Back</Button><Button variant="danger" loading={voidIt.isPending} disabled={reason.trim().length < 3} onClick={() => voidIt.mutate(modal.void.id)}>Void</Button></>}>
          {voidIt.isError && <Alert>{apiErrorMessage(voidIt.error)}</Alert>}
          <TextArea label="Reason (kept in the record)" name="reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Modal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- reports

function Breakdown({ title, data }) {
  return (
    <Card title={title}>
      {!data && <LoadingState rows={2} />}
      {data && Object.keys(data.currencies).length === 0 && <p className="text-sm text-white/45">Nothing in this period.</p>}
      {data && Object.entries(data.currencies).map(([cur, d]) => (
        <div key={cur} className="mb-4">
          <p className="mb-2 text-xs text-white/45">{cur} · total {money(d.total)}</p>
          <ul className="space-y-1.5">
            {d.items.slice(0, 15).map((i) => (
              <li key={i.key} className="text-sm">
                <div className="flex justify-between"><span className="truncate">{i.name}</span><span className="font-mono">{money(i.amountMinor)} <span className="text-xs text-white/40">{i.percent}%</span></span></div>
                <div className="mt-0.5 h-1.5 rounded bg-brand-500/70" style={{ width: `${i.percent}%` }} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

function Reports() {
  const [range, setRange] = useState({ from: monthsAgo(11), to: monthsAgo(0) });
  const [by, setBy] = useState('category');
  const aging = useQuery({ queryKey: ['accounting', 'aging'], queryFn: async () => (await api.get('/accounting/reports/aging')).data.data });
  const income = useQuery({ queryKey: ['accounting', 'income', range], queryFn: async () => (await api.get('/accounting/reports/income-by-client', { params: range })).data.data, enabled: Boolean(range.from && range.to), placeholderData: keepPreviousData });
  const exp = useQuery({ queryKey: ['accounting', 'exp', range, by], queryFn: async () => (await api.get('/accounting/reports/expenses', { params: { ...range, by } })).data.data, enabled: Boolean(range.from && range.to), placeholderData: keepPreviousData });
  return (
    <div className="space-y-6">
      <Card title="Receivables aging (who owes you, and since when)">
        {aging.isLoading && <LoadingState rows={3} />}
        {aging.data && Object.keys(aging.data.currencies).length === 0 && <p className="text-sm text-white/45">Nothing open — every issued invoice is paid. 🎉</p>}
        {aging.data && Object.entries(aging.data.currencies).map(([cur, d]) => (
          <div key={cur} className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-white/45"><tr><th className="py-2">{cur} client</th>{aging.data.buckets.map((b) => <th key={b} className="text-right">{BUCKET_LABEL[b]}</th>)}<th className="text-right">Total</th></tr></thead>
              <tbody className="divide-y divide-white/5">
                {d.clients.map((c) => (
                  <tr key={c.clientId}><td className="py-2"><Link className="hover:underline" to={`/app/contacts/${c.clientId}`}>{c.name}</Link></td>{aging.data.buckets.map((b) => <td key={b} className={`text-right font-mono ${c.buckets[b] && b !== 'current' ? 'text-amber-300' : ''}`}>{c.buckets[b] ? money(c.buckets[b]) : '—'}</td>)}<td className="text-right font-mono">{money(c.total)}</td></tr>
                ))}
                <tr className="font-semibold"><td className="py-2">Total</td>{aging.data.buckets.map((b) => <td key={b} className="text-right font-mono">{money(d.buckets[b])}</td>)}<td className="text-right font-mono">{money(d.total)}</td></tr>
              </tbody>
            </table>
          </div>
        ))}
      </Card>
      <Card><RangePicker range={range} setRange={setRange} /></Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="Income by client (received)" data={income.data} />
        <div>
          <div className="mb-2 max-w-xs"><SelectField label="Expenses by" name="by" value={by} onChange={(e) => setBy(e.target.value)} options={[{ value: 'category', label: 'Category' }, { value: 'project', label: 'Project' }]} /></div>
          <Breakdown title={`Expenses by ${by}`} data={exp.data} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- settings

function AccountingSettings({ settings }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [cats, setCats] = useState(settings.expenseCategories.join('\n'));
  const [lock, setLock] = useState(settings.lockedUntil || '');
  const save = useMutation({
    mutationFn: (body) => api.patch('/accounting/settings', body),
    onSuccess: () => { toast.success('Saved'); queryClient.invalidateQueries({ queryKey: ['accounting'] }); },
  });
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Expense categories">
        {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
        <TextArea label="One per line (max 50)" name="cats" rows={10} value={cats} onChange={(e) => setCats(e.target.value)} />
        <p className="mt-1 text-xs text-white/40">Renaming a category doesn't change old expenses.</p>
        <div className="mt-3 flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate({ expenseCategories: cats.split('\n').map((c) => c.trim()).filter(Boolean) })}>Save</Button></div>
      </Card>
      <Card title="Close the books">
        <p className="text-sm text-white/70">After you've reported a month (e.g. to your accountant), close it: expenses and client payments on or before this day can no longer be added, changed or voided.</p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Closed until (inclusive)" name="lock" type="date" max={yesterday} value={lock} onChange={(e) => setLock(e.target.value)} />
          <Button loading={save.isPending} disabled={!lock || lock === settings.lockedUntil} onClick={() => save.mutate({ lockedUntil: lock })}>Close</Button>
          {settings.lockedUntil && <Button variant="ghost" loading={save.isPending} onClick={() => { setLock(''); save.mutate({ lockedUntil: null }); }}>Re-open all</Button>}
        </div>
        <p className="mt-2 text-xs text-white/40">Every close / re-open is written to the audit log.</p>
      </Card>
    </div>
  );
}

export default function AccountingPage() {
  useDocumentTitle('Accounting');
  const [tab, setTab] = useState('overview');
  const settings = useQuery({ queryKey: ['accounting', 'settings'], queryFn: async () => (await api.get('/accounting/settings')).data.data });
  const tabs = [['overview', 'Overview'], ['expenses', 'Expenses'], ['reports', 'Reports'], ['settings', 'Settings']];
  return (
    <>
      <PageHeader title="Accounting" description="Simple income vs. expenses, who owes you money, and closed periods. Not a replacement for your accountant." />
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-2 text-sm ${tab === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>{l}</button>)}
      </div>
      {settings.isError && <ErrorState message={apiErrorMessage(settings.error)} onRetry={settings.refetch} />}
      {settings.isLoading && <LoadingState rows={4} />}
      {settings.data && (
        <>
          {tab === 'overview' && <Overview />}
          {tab === 'expenses' && <Expenses settings={settings.data} />}
          {tab === 'reports' && <Reports />}
          {tab === 'settings' && <AccountingSettings key={`${settings.data.lockedUntil}-${settings.data.expenseCategories.length}`} settings={settings.data} />}
        </>
      )}
    </>
  );
}
