// Super admin: "Mark as paid" and "Void" for one invoice (used on Invoices page and Tenant page).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import { useToast } from '../Toast.jsx';
import { Button, Modal, Alert, Field, SelectField, TextArea } from '../ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { PAYMENT_METHODS, formatMoney } from '../../utils/platform.js';

export default function InvoiceActions({ invoice }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState(null); // 'pay' | 'void'
  const [form, setForm] = useState({ method: 'BANK_TRANSFER', reference: '', note: '', reason: '' });

  const done = (msg) => {
    toast.success(msg);
    setMode(null);
    queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  const pay = useMutation({
    mutationFn: () =>
      adminApi.post(`/invoices/${invoice.id}/mark-paid`, {
        method: form.method,
        ...(form.reference.trim() && { reference: form.reference.trim() }),
        ...(form.note.trim() && { note: form.note.trim() }),
      }),
    onSuccess: () => done(`${invoice.number} marked as paid`),
  });
  const voidIt = useMutation({
    mutationFn: () => adminApi.post(`/invoices/${invoice.id}/void`, { reason: form.reason.trim() }),
    onSuccess: () => done(`${invoice.number} voided`),
  });

  if (invoice.status !== 'OPEN') return null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <div className="flex justify-end gap-2">
        <Button className="px-3 py-1.5" onClick={() => setMode('pay')}>Mark paid</Button>
        <Button variant="ghost" className="px-3 py-1.5" onClick={() => setMode('void')}>Void</Button>
      </div>

      <Modal
        open={mode === 'pay'}
        onClose={() => setMode(null)}
        title={`Mark ${invoice.number} as paid`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            <Button loading={pay.isPending} onClick={() => pay.mutate()}>Confirm payment received</Button>
          </>
        }
      >
        <div className="space-y-4">
          {pay.isError && <Alert>{apiErrorMessage(pay.error)}</Alert>}
          <p className="text-sm text-white/70">
            Only confirm after the money is <b>in your account</b>: {formatMoney(invoice.amountMinor, invoice.currency)}.
            The customer's plan activates immediately.
          </p>
          <SelectField label="Payment method" name="method" value={form.method} onChange={set('method')} options={PAYMENT_METHODS.map(([v, l]) => ({ value: v, label: l }))} />
          <Field label="Transaction / reference number" name="reference" maxLength={200} value={form.reference} onChange={set('reference')} />
          <TextArea label="Note (optional)" name="note" rows={2} maxLength={300} value={form.note} onChange={set('note')} />
        </div>
      </Modal>

      <Modal
        open={mode === 'void'}
        onClose={() => setMode(null)}
        title={`Void ${invoice.number}?`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant="danger" loading={voidIt.isPending} disabled={!form.reason.trim()} onClick={() => voidIt.mutate()}>Void invoice</Button>
          </>
        }
      >
        <div className="space-y-3">
          {voidIt.isError && <Alert>{apiErrorMessage(voidIt.error)}</Alert>}
          <Field label="Reason (saved in audit log)" name="voidReason" maxLength={300} value={form.reason} onChange={set('reason')} />
        </div>
      </Modal>
    </>
  );
}
