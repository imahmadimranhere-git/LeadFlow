// Settings → Company → Sales: currency, tax, the Sales role's discount limit, quote numbering and terms.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useSetSettings } from '../../hooks/useTenantSettings.js';
import { useToast } from '../Toast.jsx';
import { Button, Alert, Field, SelectField, TextArea } from '../ui.jsx';
import { apiErrorMessage, apiFieldErrors } from '../../utils/apiErrors.js';
import { CURRENCIES, bpToPct } from '../../utils/money.js';

export default function SalesSettingsForm({ settings, readOnly }) {
  const s = settings.sales || {};
  const [f, setF] = useState({
    currency: s.currency || 'USD',
    defaultTax: bpToPct(s.defaultTaxBp ?? 0),
    salesMaxDiscount: bpToPct(s.salesMaxDiscountBp ?? 1000),
    quoteValidityDays: String(s.quoteValidityDays ?? 15),
    quotePrefix: s.quotePrefix || 'Q',
    taxId: s.taxId || '',
    quoteTerms: s.quoteTerms || '',
    invoicePrefix: s.invoicePrefix || 'INV',
    paymentTermsDays: String(s.paymentTermsDays ?? 15),
    invoiceFooter: s.invoiceFooter || '',
  });
  const setSettings = useSetSettings();
  const toast = useToast();
  const save = useMutation({
    mutationFn: async () => (await api.patch('/settings/sales', { ...f, quoteValidityDays: Number(f.quoteValidityDays), quotePrefix: f.quotePrefix.toUpperCase(), invoicePrefix: f.invoicePrefix.toUpperCase(), paymentTermsDays: Number(f.paymentTermsDays) })).data.data.settings,
    onSuccess: (x) => { setSettings(x); toast.success('Saved'); },
  });
  const errs = apiFieldErrors(save.error);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <fieldset disabled={readOnly || save.isPending} className="space-y-4">
      {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField label="Currency" name="currency" value={f.currency} onChange={set('currency')} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <Field label="Default tax %" name="defaultTax" inputMode="decimal" value={f.defaultTax} onChange={set('defaultTax')} error={errs.defaultTax} hint="Used when an item has no tax of its own" />
        <Field label="Max discount for Sales role %" name="salesMaxDiscount" inputMode="decimal" value={f.salesMaxDiscount} onChange={set('salesMaxDiscount')} error={errs.salesMaxDiscount} hint="Above this, a manager must make the quote" />
        <Field label="Quotes valid for (days)" name="validity" type="number" min={1} max={365} value={f.quoteValidityDays} onChange={set('quoteValidityDays')} error={errs.quoteValidityDays} />
        <Field label="Quote number prefix" name="prefix" maxLength={6} value={f.quotePrefix} onChange={set('quotePrefix')} error={errs.quotePrefix} hint={`e.g. ${f.quotePrefix.toUpperCase() || 'Q'}-2026-0001`} />
        <Field label="Your tax ID (NTN / VAT) — printed on quotes" name="taxId" maxLength={60} value={f.taxId} onChange={set('taxId')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice number prefix" name="invPrefix" maxLength={6} value={f.invoicePrefix} onChange={set('invoicePrefix')} error={errs.invoicePrefix} hint={`e.g. ${f.invoicePrefix.toUpperCase() || 'INV'}-2026-0001 (given when issued)`} />
        <Field label="Payment terms (days)" name="paymentTerms" type="number" min={0} max={365} value={f.paymentTermsDays} onChange={set('paymentTermsDays')} error={errs.paymentTermsDays} hint="Due date = issue date + these days" />
      </div>
      <TextArea label="Invoice footer (e.g. bank account details)" name="invFooter" rows={3} maxLength={2000} value={f.invoiceFooter} onChange={set('invoiceFooter')} placeholder="Bank: … · Account title: … · IBAN: …" />
      <TextArea label="Default terms for new quotes" name="terms" rows={4} maxLength={3000} value={f.quoteTerms} onChange={set('quoteTerms')} placeholder="e.g. 50% advance, balance on delivery." />
      <p className="text-xs text-white/45">Changing the currency affects NEW quotes and new item prices only — existing quotes keep their currency. Items priced in the old currency must be re-priced before they can be quoted.</p>
      {!readOnly && <div className="flex justify-end"><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>}
    </fieldset>
  );
}
