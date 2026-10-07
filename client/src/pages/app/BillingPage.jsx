import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import {
  Card, PageHeader, Badge, Button, Alert, Modal, DataTable, Pager, LoadingState, ErrorState, EmptyState, TextArea,
  ProgressBar, SUBSCRIPTION_STATUS_COLOR, INVOICE_STATUS_COLOR,
} from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatMoney, formatLimit, formatDate, LIMITS } from '../../utils/platform.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

const STATUS_TEXT = {
  TRIALING: 'Free trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment due',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
};

function PaymentInstructions({ invoice, instructions }) {
  return (
    <div className="space-y-3 rounded-xl bg-ink-900 p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Invoice {invoice.number}</p>
        <p className="text-lg font-semibold">{formatMoney(invoice.amountMinor, invoice.currency)}</p>
      </div>
      <p className="text-xs text-white/50">{invoice.description} · due {formatDate(invoice.dueDate)}</p>
      {/* Plain text from the platform admin, shown as text (never HTML) */}
      <p className="whitespace-pre-wrap text-sm text-white/80">{instructions}</p>
      <p className="text-xs text-amber-300">Please write <b>{invoice.number}</b> as the payment reference. Your plan activates as soon as the payment is confirmed.</p>
    </div>
  );
}

function CurrentPlan({ data, onChanged }) {
  const toast = useToast();
  const { subscription: sub, plan } = data;
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const cancel = useMutation({
    mutationFn: () => api.post('/billing/cancel', reason.trim() ? { reason: reason.trim() } : {}),
    onSuccess: () => {
      toast.success('Your plan will end at the end of the current period.');
      setCancelOpen(false);
      onChanged();
    },
  });
  const resume = useMutation({
    mutationFn: () => api.post('/billing/resume'),
    onSuccess: () => {
      toast.success('Cancellation withdrawn.');
      onChanged();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  let dateLine = null;
  if (sub.status === 'TRIALING') dateLine = `Trial ends ${formatDate(sub.trialEndsAt)}`;
  else if (sub.status === 'PAST_DUE') dateLine = `Please pay by ${formatDate(sub.graceEndsAt)} to avoid suspension`;
  else if (sub.status === 'ACTIVE') dateLine = `${sub.cancelAtPeriodEnd ? 'Ends' : 'Renews'} ${formatDate(sub.currentPeriodEnd)}`;

  return (
    <Card title="Current plan">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xl font-semibold">{plan?.name || '—'}</p>
            <Badge color={SUBSCRIPTION_STATUS_COLOR[sub.status]}>{STATUS_TEXT[sub.status]}</Badge>
            {sub.status !== 'TRIALING' && <Badge>{sub.billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly'}</Badge>}
          </div>
          {dateLine && <p className="mt-1 text-sm text-white/60">{dateLine}</p>}
          {sub.cancelAtPeriodEnd && <p className="mt-1 text-sm text-amber-300">Cancellation requested — your plan will not renew.</p>}
        </div>
        {['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(sub.status) &&
          (sub.cancelAtPeriodEnd ? (
            <Button variant="ghost" loading={resume.isPending} onClick={() => resume.mutate()}>Keep my plan</Button>
          ) : (
            <Button variant="ghost" onClick={() => setCancelOpen(true)}>Cancel plan</Button>
          ))}
      </div>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel your plan?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep plan</Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>Cancel at period end</Button>
          </>
        }
      >
        <div className="space-y-3">
          {cancel.isError && <Alert>{apiErrorMessage(cancel.error)}</Alert>}
          <p className="text-sm text-white/70">You keep access until the end of the current period. After that your workspace is locked.</p>
          <TextArea label="Why are you leaving? (optional)" name="cancelReason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
    </Card>
  );
}

function UsageCard({ usage }) {
  return (
    <Card title={`Usage this month (${usage.period})`}>
      <ul className="grid gap-4 sm:grid-cols-2">
        {usage.rows.map((r) => (
          <li key={r.metric} className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-white/70">{r.label}</span>
              <span className="text-white/50">
                {r.used.toLocaleString()} / {formatLimit(r.limit)}
              </span>
            </div>
            <ProgressBar value={r.used} max={r.limit} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PlanPicker({ currentPlanId, currentCycle, subStatus, onCheckout }) {
  const [cycle, setCycle] = useState(currentCycle || 'MONTHLY');
  const plans = useQuery({ queryKey: ['billing', 'plans'], queryFn: async () => (await api.get('/billing/plans')).data.data.items });
  const checkout = useMutation({
    mutationFn: async (planId) => (await api.post('/billing/checkout', { planId, billingCycle: cycle })).data.data,
    onSuccess: onCheckout,
  });

  if (plans.isLoading) return <LoadingState rows={3} />;
  if (plans.isError) return <ErrorState message={apiErrorMessage(plans.error)} onRetry={plans.refetch} />;

  const keyLimits = LIMITS.filter(([k]) => ['users', 'leadsPerMonth', 'aiRequestsPerMonth', 'hashtagWatches'].includes(k));

  return (
    <Card
      title="Plans"
      action={
        <div className="flex rounded-lg bg-ink-900 p-1 text-sm ring-1 ring-white/10" role="group" aria-label="Billing cycle">
          {['MONTHLY', 'YEARLY'].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              aria-pressed={cycle === c}
              className={`rounded-md px-3 py-1 ${cycle === c ? 'bg-brand-500 text-white' : 'text-white/60'}`}
            >
              {c === 'MONTHLY' ? 'Monthly' : 'Yearly'}
            </button>
          ))}
        </div>
      }
    >
      {checkout.isError && <div className="mb-4"><Alert>{apiErrorMessage(checkout.error)}</Alert></div>}
      {plans.data.length === 0 && <EmptyState icon="card" title="No plans available yet" />}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.data.map((p) => {
          const price = cycle === 'YEARLY' ? p.priceYearlyMinor : p.priceMonthlyMinor;
          const isCurrent = p.id === currentPlanId && cycle === currentCycle && subStatus === 'ACTIVE';
          return (
            <div key={p.id} className={`flex flex-col rounded-xl p-5 ring-1 ${p.id === currentPlanId ? 'bg-brand-500/5 ring-brand-500/40' : 'bg-ink-900 ring-white/10'}`}>
              <p className="font-semibold">{p.name}</p>
              <p className="mt-1 text-xs text-white/50">{p.description}</p>
              <p className="mt-4 text-2xl font-semibold">
                {formatMoney(price, p.currency)} <span className="text-sm font-normal text-white/50">/ {cycle === 'YEARLY' ? 'year' : 'month'}</span>
              </p>
              <ul className="mt-4 flex-1 space-y-1 text-sm text-white/60">
                {keyLimits.map(([k, label]) => (
                  <li key={k} className="flex justify-between gap-2"><span>{label}</span><span className="text-white/80">{formatLimit(p.limits[k])}</span></li>
                ))}
              </ul>
              <Button
                className="mt-5 w-full"
                variant={isCurrent ? 'ghost' : 'primary'}
                disabled={isCurrent || price <= 0}
                loading={checkout.isPending && checkout.variables === p.id}
                onClick={() => checkout.mutate(p.id)}
              >
                {isCurrent ? 'Current plan' : price <= 0 ? 'Contact us' : 'Choose plan'}
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function InvoiceHistory() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['billing', 'invoices', page],
    queryFn: async () => (await api.get('/billing/invoices', { params: { page, limit: 10 } })).data.data,
    placeholderData: keepPreviousData,
  });
  const columns = [
    { key: 'number', header: 'Invoice', render: (i) => <span className="font-mono text-xs">{i.number}</span> },
    { key: 'desc', header: 'Description', render: (i) => <span className="text-white/70">{i.description}</span> },
    { key: 'amount', header: 'Amount', render: (i) => formatMoney(i.amountMinor, i.currency) },
    { key: 'status', header: 'Status', render: (i) => <Badge color={INVOICE_STATUS_COLOR[i.status]}>{i.status}</Badge> },
    { key: 'date', header: 'Date', render: (i) => <span className="text-white/60">{formatDate(i.paidAt || i.createdAt)}</span> },
  ];
  return (
    <Card title="Invoice history">
      {q.isError ? (
        <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />
      ) : (
        <DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} empty={<EmptyState icon="receipt" title="No invoices yet" />} />
      )}
      <Pager pagination={q.data?.pagination} onPage={setPage} />
    </Card>
  );
}

export default function BillingPage() {
  useDocumentTitle('Billing');
  const queryClient = useQueryClient();
  const { access } = useAuth();
  const [justCreated, setJustCreated] = useState(null);

  const q = useQuery({ queryKey: ['billing', 'overview'], queryFn: async () => (await api.get('/billing')).data.data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing'] });

  if (q.isLoading) return <LoadingState rows={6} />;
  if (q.isError) return <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />;
  if (!q.data.configured) {
    return (
      <>
        <PageHeader title="Billing" />
        <Card><EmptyState icon="card" title="Billing isn't set up yet" description="The platform has no plans configured. Please contact support." /></Card>
      </>
    );
  }

  const { subscription, plan, openInvoices, paymentInstructions, usage } = q.data;

  return (
    <>
      <PageHeader title="Billing" description="Your plan, usage and invoices." />
      <div className="space-y-6">
        {access === 'BILLING_ONLY' && (
          <Alert>Your workspace is suspended because a payment is overdue. Pay the open invoice below to unlock it — your data is safe.</Alert>
        )}

        <CurrentPlan data={q.data} onChanged={refresh} />

        {openInvoices.length > 0 && (
          <Card title="Payment due">
            <div className="space-y-4">
              {openInvoices.map((inv) => (
                <PaymentInstructions key={inv.id} invoice={inv} instructions={paymentInstructions} />
              ))}
            </div>
          </Card>
        )}

        <UsageCard usage={usage} />

        <PlanPicker
          currentPlanId={plan?.id}
          currentCycle={subscription.billingCycle}
          subStatus={subscription.status}
          onCheckout={(data) => {
            setJustCreated(data);
            refresh();
          }}
        />

        <InvoiceHistory />
      </div>

      <Modal
        open={Boolean(justCreated)}
        onClose={() => setJustCreated(null)}
        title="Complete your payment"
        footer={<Button onClick={() => setJustCreated(null)}>Done</Button>}
      >
        {justCreated && <PaymentInstructions invoice={justCreated.invoice} instructions={justCreated.checkout.instructions} />}
      </Modal>
    </>
  );
}
