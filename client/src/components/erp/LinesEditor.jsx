// Shared by the quote and invoice editors: line items + extra discount + live totals preview.
// The preview uses the same math as the server, but the SERVER recalculates on save — its numbers count.
import { Card, Button, Field, SelectField, Alert } from '../ui.jsx';
import { money, minorToInput, bpToPct, qty } from '../../utils/money.js';
import { calculateTotals, effectiveDiscountBp, toMinor, toQtyMilli } from '../../utils/quoteMath.js';

let keySeq = 0;
export const newLine = (o = {}) => ({ key: ++keySeq, itemId: '', description: '', unit: '', quantity: '1', unitPrice: '', discount: '', tax: '', ...o });
export const dateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const pctBp = (v) => {
  const bp = toMinor(v);
  return bp !== null && bp <= 10000 ? bp : null;
};

/** Stored document (quote / invoice) → editable form fields for lines + discount. */
export function linesFormFromDoc(doc) {
  return {
    discountType: doc.discount?.type || 'NONE',
    discountValue: doc.discount?.type === 'PERCENT' ? bpToPct(doc.discount.valueBp) : doc.discount?.type === 'AMOUNT' ? minorToInput(doc.discount.valueMinor) : '',
    lines: doc.lines.map((l) => newLine({ itemId: l.itemId ? String(l.itemId) : '', description: l.description, unit: l.unit, quantity: qty(l.qtyMilli), unitPrice: minorToInput(l.unitPriceMinor), discount: bpToPct(l.discountBp), tax: bpToPct(l.taxBp) })),
  };
}

/** Form → API body parts (only what the server accepts; never totals). */
export function linesPayload(f) {
  return {
    discount: f.discountType === 'NONE' ? { type: 'NONE' } : { type: f.discountType, value: f.discountValue || '0' },
    lines: f.lines.map((l) => ({
      ...(l.itemId && { itemId: l.itemId }),
      ...(l.description.trim() && { description: l.description.trim() }),
      ...(l.unit && { unit: l.unit }),
      quantity: l.quantity,
      ...(l.unitPrice !== '' && { unitPrice: l.unitPrice }),
      ...(l.discount !== '' && { discount: l.discount }),
      ...(l.tax !== '' && { tax: l.tax }),
    })),
  };
}

/** Same rules as the server, for the live preview only. */
export function previewTotals(f, itemsById, defaultTaxBp) {
  try {
    const lines = f.lines.map((l) => {
      const item = l.itemId ? itemsById.get(l.itemId) : null;
      const qtyMilli = toQtyMilli(l.quantity);
      const unitPriceMinor = l.unitPrice === '' ? item?.priceMinor ?? null : toMinor(l.unitPrice);
      const discountBp = l.discount === '' ? 0 : pctBp(l.discount);
      const taxBp = l.tax === '' ? item?.taxBp ?? defaultTaxBp ?? 0 : pctBp(l.tax);
      if ([qtyMilli, unitPriceMinor, discountBp, taxBp].some((x) => x === null)) throw new Error('incomplete');
      return { qtyMilli, unitPriceMinor, discountBp, taxBp };
    });
    const d = f.discountType === 'PERCENT' ? { type: 'PERCENT', valueBp: pctBp(f.discountValue || '0') } : f.discountType === 'AMOUNT' ? { type: 'AMOUNT', valueMinor: toMinor(f.discountValue || '0') } : { type: 'NONE' };
    const t = calculateTotals(lines, d);
    return { ...t, effectiveDiscountBp: effectiveDiscountBp(t) };
  } catch (err) {
    return { error: err.message === 'incomplete' ? 'Fill in quantity and price on every line.' : err.message };
  }
}

export function LinesCard({ f, set, items, itemsById, p, errs, editable, canManagePrices, defaultTaxBp }) {
  const setLine = (key, patch) => set({ lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
  const itemOptions = [{ value: '', label: 'Custom line (type it)' }, ...(items || []).map((i) => ({ value: i.id, label: `${i.name} — ${money(i.priceMinor, i.currency)}` }))];
  return (
    <Card title="Lines">
      <div className="space-y-4">
        {f.lines.map((l, i) => {
          const item = l.itemId ? itemsById.get(l.itemId) : null;
          return (
            <div key={l.key} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
              <div className="grid gap-3 md:grid-cols-2">
                <SelectField label={`Line ${i + 1}`} name={`item${l.key}`} value={l.itemId} onChange={(e) => setLine(l.key, { itemId: e.target.value, unitPrice: '', tax: '', description: '' })} options={itemOptions} />
                <Field label="Description" name={`desc${l.key}`} maxLength={500} placeholder={item?.name || 'What is it?'} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} error={errs[`lines.${i}.description`]} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
                <Field label={`Quantity${item?.unit ? ` (${item.unit})` : ''}`} name={`qty${l.key}`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} error={errs[`lines.${i}.quantity`]} />
                <Field label="Unit price" name={`price${l.key}`} inputMode="decimal" placeholder={item ? minorToInput(item.priceMinor) : ''} value={l.unitPrice} onChange={(e) => setLine(l.key, { unitPrice: e.target.value })} error={errs[`lines.${i}.unitPrice`]} hint={item && !canManagePrices ? 'Not below catalog' : undefined} />
                <Field label="Discount %" name={`disc${l.key}`} inputMode="decimal" placeholder="0" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} />
                <Field label="Tax %" name={`tax${l.key}`} inputMode="decimal" placeholder={bpToPct(item?.taxBp ?? defaultTaxBp ?? 0)} value={l.tax} onChange={(e) => setLine(l.key, { tax: e.target.value })} />
                <div className="flex items-end justify-between gap-2">
                  <span className="pb-2 font-mono text-sm">{p?.lines?.[i] ? money(p.lines[i].totalMinor) : '—'}</span>
                  {editable && f.lines.length > 1 && <Button variant="ghost" aria-label="Remove line" onClick={() => set({ lines: f.lines.filter((x) => x.key !== l.key) })}>✕</Button>}
                </div>
              </div>
            </div>
          );
        })}
        {editable && f.lines.length < 100 && <Button variant="ghost" onClick={() => set({ lines: [...f.lines, newLine()] })}>+ Add line</Button>}
      </div>
    </Card>
  );
}

export function TotalsCard({ f, set, p, currency, errs, overLimitBp, footerNote, children }) {
  return (
    <Card title="Totals">
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Extra discount" name="discountType" value={f.discountType} onChange={(e) => set({ discountType: e.target.value, discountValue: '' })} options={[{ value: 'NONE', label: 'None' }, { value: 'PERCENT', label: 'Percent %' }, { value: 'AMOUNT', label: `Amount (${currency})` }]} />
          {f.discountType !== 'NONE' && <Field label={f.discountType === 'PERCENT' ? 'Percent' : 'Amount'} name="discountValue" inputMode="decimal" value={f.discountValue} onChange={(e) => set({ discountValue: e.target.value })} error={errs.discount || errs['discount.value']} />}
        </div>
        {p?.error ? <p className="text-amber-300">{p.error}</p> : p && (
          <dl className="space-y-1.5">
            <div className="flex justify-between"><dt className="text-white/55">Subtotal</dt><dd className="font-mono">{money(p.subtotalMinor, currency)}</dd></div>
            {p.discountMinor > 0 && <div className="flex justify-between"><dt className="text-white/55">Discount ({(p.effectiveDiscountBp / 100).toFixed(2)}%)</dt><dd className="font-mono">− {money(p.discountMinor, currency)}</dd></div>}
            <div className="flex justify-between"><dt className="text-white/55">Tax</dt><dd className="font-mono">{money(p.taxMinor, currency)}</dd></div>
            <div className="flex justify-between border-t border-white/10 pt-2 text-base font-semibold"><dt>Total</dt><dd className="font-mono">{money(p.totalMinor, currency)}</dd></div>
          </dl>
        )}
        {overLimitBp !== null && overLimitBp !== undefined && <Alert>Total discount is above your limit of {overLimitBp / 100}% — a manager has to do this.</Alert>}
        {footerNote && <p className="text-xs text-white/40">{footerNote}</p>}
        {children}
      </div>
    </Card>
  );
}
