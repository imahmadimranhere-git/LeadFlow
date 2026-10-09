// Printable invoice ("Print → Save as PDF"). Plain text only; the internal note is never shown.
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { money, qty, PAYMENT_METHODS } from '../../../utils/money.js';

const d = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const METHOD = Object.fromEntries(PAYMENT_METHODS);

export default function InvoicePrintPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['invoices', 'one', id], queryFn: async () => (await api.get(`/invoices/${id}`)).data.data });
  useDocumentTitle(q.data ? `Invoice ${q.data.invoice.number || 'draft'}` : 'Invoice');
  if (q.isLoading) return <p className="p-8 text-center text-gray-500">Loading…</p>;
  if (q.isError) return <p className="p-8 text-center text-red-600">{apiErrorMessage(q.error)}</p>;
  const { invoice: x, company: c, payments } = q.data;
  const to = x.clientId || {};
  const cur = x.currency;
  const paid = payments.filter((p) => !p.voided);
  const stamp = x.status === 'PAID' ? ['PAID', 'border-green-600 text-green-700'] : x.status === 'VOID' ? ['VOID', 'border-red-600 text-red-700'] : x.status === 'DRAFT' ? ['DRAFT', 'border-amber-500 text-amber-600'] : null;
  return (
    <div className="min-h-screen bg-white text-gray-900 print:min-h-0">
      <div className="relative mx-auto max-w-3xl p-8 print:p-0">
        <div className="mb-6 flex justify-end print:hidden">
          <button type="button" onClick={() => window.print()} className="rounded bg-gray-900 px-4 py-2 text-sm text-white">Print / Save as PDF</button>
        </div>
        {stamp && <p className={`absolute right-10 top-24 rotate-12 rounded border-4 px-4 py-1 text-3xl font-bold opacity-70 ${stamp[1]}`}>{stamp[0]}</p>}
        <header className="flex flex-wrap justify-between gap-6 border-b border-gray-300 pb-6">
          <div>
            <h1 className="text-2xl font-bold">{c.name}</h1>
            <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{[c.address, [c.city, c.country].filter(Boolean).join(', '), c.phone, c.email, c.website, c.taxId && `Tax ID: ${c.taxId}`].filter(Boolean).join('\n')}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold uppercase tracking-wide text-gray-500">Invoice</p>
            <p className="font-mono">{x.number || 'DRAFT'}</p>
            <p className="mt-2 text-sm">Date: {d(x.issueDate)}</p>
            <p className="text-sm">Due: {d(x.dueDate)}</p>
          </div>
        </header>
        <section className="mt-6">
          <p className="text-xs uppercase text-gray-500">Bill to</p>
          <p className="font-semibold">{to.name}</p>
          <p className="whitespace-pre-line text-sm text-gray-600">{[to.address, [to.city, to.country].filter(Boolean).join(', '), to.phone, to.email, to.taxId && `Tax ID: ${to.taxId}`].filter(Boolean).join('\n')}</p>
          {x.title && <p className="mt-4 text-lg font-medium">{x.title}</p>}
        </section>
        <table className="mt-6 w-full text-sm">
          <thead><tr className="border-b border-gray-300 text-left text-xs uppercase text-gray-500"><th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Price</th><th className="py-2 text-right">Disc.</th><th className="py-2 text-right">Tax</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>
            {x.lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-100 align-top"><td className="py-2 pr-2">{l.description}</td><td className="py-2 text-right">{qty(l.qtyMilli)}{l.unit ? ` ${l.unit}` : ''}</td><td className="py-2 text-right font-mono">{money(l.unitPriceMinor)}</td><td className="py-2 text-right">{l.discountBp ? `${l.discountBp / 100}%` : '—'}</td><td className="py-2 text-right">{l.taxBp ? `${l.taxBp / 100}%` : '—'}</td><td className="py-2 text-right font-mono">{money(l.netMinor)}</td></tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd className="font-mono">{money(x.subtotalMinor - x.lineDiscountMinor, cur)}</dd></div>
          {x.orderDiscountMinor > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="font-mono">− {money(x.orderDiscountMinor, cur)}</dd></div>}
          <div className="flex justify-between"><dt>Tax</dt><dd className="font-mono">{money(x.taxMinor, cur)}</dd></div>
          <div className="flex justify-between border-t border-gray-300 pt-2 text-base font-bold"><dt>Total</dt><dd className="font-mono">{money(x.totalMinor, cur)}</dd></div>
          {paid.length > 0 && <div className="flex justify-between"><dt>Paid</dt><dd className="font-mono">− {money(x.paidMinor, cur)}</dd></div>}
          {x.status !== 'VOID' && x.status !== 'DRAFT' && <div className="flex justify-between font-semibold"><dt>Balance due</dt><dd className="font-mono">{money(x.balanceMinor, cur)}</dd></div>}
        </dl>
        {paid.length > 0 && (
          <section className="mt-6 text-sm">
            <p className="text-xs uppercase text-gray-500">Payments received</p>
            <ul>{paid.map((p) => <li key={p.id}>{d(p.paidAt)} — {money(p.amountMinor, p.currency)} ({METHOD[p.method]}{p.reference ? `, ${p.reference}` : ''})</li>)}</ul>
          </section>
        )}
        {x.notes && <section className="mt-6"><p className="text-xs uppercase text-gray-500">Notes</p><p className="whitespace-pre-wrap text-sm">{x.notes}</p></section>}
        {x.footer && <section className="mt-4 border-t border-gray-200 pt-3"><p className="whitespace-pre-wrap text-sm text-gray-700">{x.footer}</p></section>}
      </div>
    </div>
  );
}
