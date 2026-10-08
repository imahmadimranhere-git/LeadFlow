import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import { Card, Badge, Spinner, Alert, Button, Field, SelectField, TENANT_STATUS_COLOR, SUBSCRIPTION_STATUS_COLOR, INVOICE_STATUS_COLOR, DataTable, EmptyState } from '../../components/ui.jsx';
import InvoiceActions from '../../components/billing/InvoiceActions.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { TENANT_STATUSES, SUBSCRIPTION_STATUSES, formatDate, formatDateTime, formatMoney } from '../../utils/platform.js';

function StatusForm({ tenant, onDone }) {
  const [status, setStatus] = useState(tenant.status);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: (body) => adminApi.patch(`/tenants/${tenant.id}/status`, body),
    onSuccess: () => {
      setReason('');
      onDone();
    },
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate({ status, reason }); }}>
      <SelectField label="New status" name="status" value={status} onChange={(e) => setStatus(e.target.value)} options={TENANT_STATUSES.map((s) => ({ value: s, label: s }))} />
      <Field label="Reason (required, saved in audit log)" name="reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      {m.isError && <Alert>{apiErrorMessage(m.error)}</Alert>}
      {m.isSuccess && <Alert type="success">Status updated.</Alert>}
      <Button type="submit" loading={m.isPending} disabled={!reason.trim() || status === tenant.status}>Update status</Button>
    </form>
  );
}

function PlanForm({ tenant, onDone }) {
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: async () => (await adminApi.get('/plans')).data.data.items });
  const [planId, setPlanId] = useState(tenant.planId?.id || '');
  const [reason, setReason] = useState('');
  const m = useMutation({ mutationFn: (body) => adminApi.patch(`/tenants/${tenant.id}/plan`, body), onSuccess: onDone });
  const options = [{ value: '', label: 'Select a plan…' }, ...(plans.data || []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name }))];
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate({ planId, ...(reason.trim() && { reason }) }); }}>
      <SelectField label="Plan" name="planId" value={planId} onChange={(e) => setPlanId(e.target.value)} options={options} />
      <Field label="Reason (optional)" name="planReason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      {m.isError && <Alert>{apiErrorMessage(m.error)}</Alert>}
      {m.isSuccess && <Alert type="success">Plan updated.</Alert>}
      <Button type="submit" loading={m.isPending} disabled={!planId}>Assign plan</Button>
    </form>
  );
}

function DeleteForm({ tenant }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmSlug, setConfirmSlug] = useState('');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: (body) => adminApi.delete(`/tenants/${tenant.id}`, { data: body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
      navigate('/super-admin/tenants', { replace: true });
    },
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate({ confirmSlug, reason }); }}>
      <p className="text-sm text-white/60">
        This cancels the company and logs out all its users. Type <span className="font-mono text-red-300">{tenant.slug}</span> to confirm.
      </p>
      <Field label="Type the slug" name="confirmSlug" value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} />
      <Field label="Reason" name="deleteReason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      {m.isError && <Alert>{apiErrorMessage(m.error)}</Alert>}
      <Button type="submit" variant="danger" loading={m.isPending} disabled={confirmSlug !== tenant.slug || !reason.trim()}>Delete company</Button>
    </form>
  );
}


function OverrideForm({ tenantId, subscription, onDone }) {
  const plans = useQuery({ queryKey: ['admin', 'plans'], queryFn: async () => (await adminApi.get('/plans')).data.data.items });
  const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [f, setF] = useState({
    planId: subscription?.planId?.id || '',
    status: 'ACTIVE',
    billingCycle: subscription?.billingCycle || 'MONTHLY',
    currentPeriodEnd: nextMonth,
    reason: '',
  });
  const m = useMutation({
    mutationFn: () => adminApi.post(`/tenants/${tenantId}/subscription`, { ...f, currentPeriodEnd: new Date(f.currentPeriodEnd).toISOString() }),
    onSuccess: () => { setF((x) => ({ ...x, reason: '' })); onDone(); },
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <p className="text-xs text-white/50">Use for special deals (e.g. Enterprise contract, free months). Everything is audit-logged.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Plan" name="ovPlan" value={f.planId} onChange={set('planId')} options={[{ value: '', label: 'Select…' }, ...(plans.data || []).map((p) => ({ value: p.id, label: p.name }))]} />
        <SelectField label="Status" name="ovStatus" value={f.status} onChange={set('status')} options={SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: s }))} />
        <SelectField label="Cycle" name="ovCycle" value={f.billingCycle} onChange={set('billingCycle')} options={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'YEARLY', label: 'Yearly' }]} />
        <Field label="Period ends" name="ovEnd" type="date" value={f.currentPeriodEnd} onChange={set('currentPeriodEnd')} />
      </div>
      <Field label="Reason (required)" name="ovReason" maxLength={500} value={f.reason} onChange={set('reason')} />
      {m.isError && <Alert>{apiErrorMessage(m.error)}</Alert>}
      {m.isSuccess && <Alert type="success">Subscription updated.</Alert>}
      <Button type="submit" loading={m.isPending} disabled={!f.planId || !f.reason.trim()}>Apply override</Button>
    </form>
  );
}

function BillingSection({ tenantId }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'tenant-billing', tenantId], queryFn: async () => (await adminApi.get(`/tenants/${tenantId}/billing`)).data.data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin'] });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <Alert>{apiErrorMessage(q.error)}</Alert>;
  const { subscription: sub, invoices } = q.data;

  const columns = [
    { key: 'n', header: 'Invoice', render: (i) => <span className="font-mono text-xs">{i.number}</span> },
    { key: 'p', header: 'Plan', render: (i) => i.planId?.name || '—' },
    { key: 'a', header: 'Amount', render: (i) => formatMoney(i.amountMinor, i.currency) },
    { key: 's', header: 'Status', render: (i) => <Badge color={INVOICE_STATUS_COLOR[i.status]}>{i.status}</Badge> },
    { key: 'd', header: 'Due / paid', render: (i) => formatDate(i.paidAt || i.dueDate) },
    { key: 'x', header: <span className="sr-only">Actions</span>, className: 'text-right', render: (i) => <InvoiceActions invoice={i} /> },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Subscription">
        {sub ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-white/50">Status</dt><dd className="mt-1"><Badge color={SUBSCRIPTION_STATUS_COLOR[sub.status]}>{sub.status}</Badge></dd></div>
            <div><dt className="text-white/50">Plan</dt><dd className="mt-1">{sub.planId?.name} · {sub.billingCycle.toLowerCase()}</dd></div>
            <div><dt className="text-white/50">Period ends</dt><dd className="mt-1">{formatDate(sub.currentPeriodEnd)}</dd></div>
            <div><dt className="text-white/50">Trial ends</dt><dd className="mt-1">{formatDate(sub.trialEndsAt)}</dd></div>
            <div><dt className="text-white/50">Grace ends</dt><dd className="mt-1">{formatDate(sub.graceEndsAt)}</dd></div>
            <div><dt className="text-white/50">Cancels at period end</dt><dd className="mt-1">{sub.cancelAtPeriodEnd ? `Yes${sub.cancelReason ? ` — ${sub.cancelReason}` : ''}` : 'No'}</dd></div>
          </dl>
        ) : (
          <EmptyState icon="card" title="No subscription" description="Run the seed to create plans." />
        )}
      </Card>
      <Card title="Override subscription">
        <OverrideForm tenantId={tenantId} subscription={sub} onDone={refresh} />
      </Card>
      <div className="lg:col-span-2">
        <Card title="Invoices">
          <DataTable columns={columns} rows={invoices} empty={<EmptyState icon="receipt" title="No invoices" />} />
        </Card>
      </div>
    </div>
  );
}


const INTEGRATION_STATUS_COLOR = { CONNECTED: 'green', NOT_TESTED: 'blue', ERROR: 'red', DISABLED: 'gray' };

function IntegrationsStatus({ tenantId }) {
  const q = useQuery({ queryKey: ['admin', 'tenant-integrations', tenantId], queryFn: async () => (await adminApi.get(`/tenants/${tenantId}/integrations`)).data.data.items });
  if (q.isLoading) return <Spinner />;
  if (q.isError) return <Alert>{apiErrorMessage(q.error)}</Alert>;
  if (q.data.length === 0) return <p className="text-sm text-white/40">No integrations connected.</p>;
  return (
    <ul className="divide-y divide-white/5 text-sm">
      {q.data.map((i) => (
        <li key={i.provider} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
          <span>{i.name}</span>
          <span className="flex items-center gap-3 text-xs text-white/50">
            last used {formatDateTime(i.lastUsedAt)}
            <Badge color={INTEGRATION_STATUS_COLOR[i.status]}>{i.status}</Badge>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function TenantDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'tenant', id],
    queryFn: async () => (await adminApi.get(`/tenants/${id}`)).data.data,
  });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'tenant', id] });
    queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
  };

  if (isLoading) return <Spinner />;
  if (isError) return <Alert>{apiErrorMessage(error)}</Alert>;
  const { tenant, owner, userCount } = data;

  return (
    <div className="space-y-6">
      <Link to="/super-admin/tenants" className="text-sm text-white/50 hover:text-white">← All tenants</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <Badge color={TENANT_STATUS_COLOR[tenant.status]}>{tenant.status}</Badge>
      </div>

      <Card title="Details">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div><dt className="text-white/50">Slug</dt><dd className="mt-1 font-mono">{tenant.slug}</dd></div>
          <div><dt className="text-white/50">Plan</dt><dd className="mt-1">{tenant.planId?.name || '—'}</dd></div>
          <div><dt className="text-white/50">Users</dt><dd className="mt-1">{userCount}</dd></div>
          <div><dt className="text-white/50">Owner</dt><dd className="mt-1 break-all">{owner ? `${owner.name} (${owner.email})` : '—'}</dd></div>
          <div><dt className="text-white/50">Owner last login</dt><dd className="mt-1">{formatDateTime(owner?.lastLoginAt)}</dd></div>
          <div><dt className="text-white/50">Created</dt><dd className="mt-1">{formatDate(tenant.createdAt)}</dd></div>
          <div><dt className="text-white/50">Trial ends</dt><dd className="mt-1">{formatDate(tenant.trialEndsAt)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-white/50">Last status reason</dt><dd className="mt-1">{tenant.statusReason || '—'}</dd></div>
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Change status"><StatusForm tenant={tenant} onDone={refresh} /></Card>
        <Card title="Change plan"><PlanForm tenant={tenant} onDone={refresh} /></Card>
      </div>
      <BillingSection tenantId={tenant.id} />
      <Card title="Integrations (status only — secrets are never visible)"><IntegrationsStatus tenantId={tenant.id} /></Card>
      <Card title="Danger zone"><DeleteForm tenant={tenant} /></Card>
    </div>
  );
}
