// Printable quote (browser "Print → Save as PDF"). Plain text only — client/lead data can't inject HTML.
// The internal note is never shown here.
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../../lib/api.js';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { apiErrorMessage } from '../../../utils/apiErrors.js';
import { money, qty } from '../../../utils/money.js';

const d = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export default function QuotePrintPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ['quotes', 'one', id], queryFn: async () => (await api.get(`/quotes/${id}`)).data.data });
  useDocumentTitle(q.data ? `Quote ${q.data.quote.number}` : 'Quote');
  if (q.isLoading) return <p className="p-8 text-center text-gray-500">Loading…</p>;
  if (q.isError) return <p className="p-8 text-center text-red-600">{apiErrorMessage(q.error)}</p>;
  const { quote: x, company: c } = q.data;
  const to = x.clientId || x.leadId || {};
  const cur = x.currency;
  return (
    <div className="min-h-screen bg-white text-gray-900 print:min-h-0">
      <div className="mx-auto max-w-3xl p-8 print:p-0">
        <div className="mb-6 flex justify-end gap-2 print:hidden">
          <button type="button" onClick={() => window.print()} className="rounded bg-gray-900 px-4 py-2 text-sm text-white">Print / Save as PDF</button>
        </div>
        {x.status === 'DRAFT' && <p className="mb-4 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800">DRAFT — not sent yet</p>}
        <header className="flex flex-wrap justify-between gap-6 border-b border-gray-300 pb-6">
          <div>
            <h1 className="text-2xl font-bold">{c.name}</h1>
            <p className="mt-1 whitespace-pre-line text-sm text-gray-600">{[c.address, [c.city, c.country].filter(Boolean).join(', '), c.phone, c.email, c.website, c.taxId && `Tax ID: ${c.taxId}`].filter(Boolean).join('\n')}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-semibold uppercase tracking-wide text-gray-500">Quotation</p>
            <p className="font-mono">{x.number}{x.revision > 1 ? ` (rev. ${x.revision})` : ''}</p>
            <p className="mt-2 text-sm">Date: {d(x.issueDate)}</p>
            <p className="text-sm">Valid until: {d(x.validUntil)}</p>
          </div>
        </header>
        <section className="mt-6">
          <p className="text-xs uppercase text-gray-500">For</p>
          <p className="font-semibold">{to.name || to.companyName || '—'}</p>
          <p className="whitespace-pre-line text-sm text-gray-600">{[to.personName, to.address, [to.city, to.country].filter(Boolean).join(', '), to.phone, to.email, to.taxId && `Tax ID: ${to.taxId}`].filter(Boolean).join('\n')}</p>
          {x.title && <p className="mt-4 text-lg font-medium">{x.title}</p>}
        </section>
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-gray-300 text-left text-xs uppercase text-gray-500">
              <th className="py-2">Description</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Price</th><th className="py-2 text-right">Disc.</th><th className="py-2 text-right">Tax</th><th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {x.lines.map((l) => (
              <tr key={l.id} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-2">{l.description}</td>
                <td className="py-2 text-right">{qty(l.qtyMilli)}{l.unit ? ` ${l.unit}` : ''}</td>
                <td className="py-2 text-right font-mono">{money(l.unitPriceMinor)}</td>
                <td className="py-2 text-right">{l.discountBp ? `${l.discountBp / 100}%` : '—'}</td>
                <td className="py-2 text-right">{l.taxBp ? `${l.taxBp / 100}%` : '—'}</td>
                <td className="py-2 text-right font-mono">{money(l.netMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto mt-4 w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt>Subtotal</dt><dd className="font-mono">{money(x.subtotalMinor - x.lineDiscountMinor, cur)}</dd></div>
          {x.orderDiscountMinor > 0 && <div className="flex justify-between"><dt>Discount</dt><dd className="font-mono">− {money(x.orderDiscountMinor, cur)}</dd></div>}
          <div className="flex justify-between"><dt>Tax</dt><dd className="font-mono">{money(x.taxMinor, cur)}</dd></div>
          <div className="flex justify-between border-t border-gray-300 pt-2 text-base font-bold"><dt>Total</dt><dd className="font-mono">{money(x.totalMinor, cur)}</dd></div>
        </dl>
        {x.notes && <section className="mt-8"><p className="text-xs uppercase text-gray-500">Notes</p><p className="whitespace-pre-wrap text-sm">{x.notes}</p></section>}
        {x.terms && <section className="mt-4"><p className="text-xs uppercase text-gray-500">Terms</p><p className="whitespace-pre-wrap text-sm">{x.terms}</p></section>}
      </div>
    </div>
  );
}
