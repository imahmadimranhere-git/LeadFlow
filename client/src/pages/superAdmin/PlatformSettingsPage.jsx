import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import { useToast } from '../../components/Toast.jsx';
import { Card, PageHeader, Field, TextArea, Button, Alert, LoadingState, ErrorState } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

export default function PlatformSettingsPage() {
  useDocumentTitle('Platform settings');
  const toast = useToast();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'settings', 'billing'], queryFn: async () => (await adminApi.get('/settings/billing')).data.data.settings });
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (q.data && !form) setForm({ ...q.data, graceDays: String(q.data.graceDays), invoiceDueDays: String(q.data.invoiceDueDays) });
  }, [q.data, form]);

  const save = useMutation({
    mutationFn: () =>
      adminApi.put('/settings/billing', {
        manualPaymentInstructions: form.manualPaymentInstructions,
        graceDays: Number(form.graceDays),
        invoiceDueDays: Number(form.invoiceDueDays),
      }),
    onSuccess: () => {
      toast.success('Billing settings saved');
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
    },
  });

  const run = useMutation({ mutationFn: async () => (await adminApi.post('/billing/run-cycle')).data.data.summary });

  if (q.isLoading || (!form && !q.isError)) return <LoadingState rows={5} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHeader title="Platform settings" />
      <div className="space-y-6">
        <Card title="Manual payments">
          <form className="max-w-2xl space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            {save.isError && <Alert>{apiErrorMessage(save.error)}</Alert>}
            <TextArea
              label="Payment instructions shown to customers"
              name="manualPaymentInstructions"
              rows={7}
              maxLength={2000}
              value={form.manualPaymentInstructions}
              onChange={set('manualPaymentInstructions')}
              hint="e.g. Bank name, account title, IBAN, JazzCash / Easypaisa number. Shown as plain text."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Grace days after due date" name="graceDays" type="number" min="0" max="30" value={form.graceDays} onChange={set('graceDays')} hint="Workspace stays usable this long before suspension." />
              <Field label="Invoice due in (days)" name="invoiceDueDays" type="number" min="1" max="60" value={form.invoiceDueDays} onChange={set('invoiceDueDays')} />
            </div>
            <Button type="submit" loading={save.isPending}>Save</Button>
          </form>
        </Card>

        <Card title="Billing job">
          <p className="mb-4 text-sm text-white/60">
            Runs automatically every hour: ends trials, creates renewal invoices and suspends companies after the grace period. You can run it now.
          </p>
          <Button variant="ghost" loading={run.isPending} onClick={() => run.mutate()}>Run billing cycle now</Button>
          {run.isError && <div className="mt-3"><Alert>{apiErrorMessage(run.error)}</Alert></div>}
          {run.data && (
            <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-5">
              {Object.entries(run.data).map(([k, v]) => (
                <li key={k} className="rounded-lg bg-ink-900 p-3 ring-1 ring-white/10">
                  <p className="text-xs text-white/40">{k}</p>
                  <p className="text-lg font-semibold">{v}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
