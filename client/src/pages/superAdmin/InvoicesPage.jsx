import { useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import { Card, PageHeader, DataTable, Badge, Pager, SelectField, ErrorState, EmptyState, INVOICE_STATUS_COLOR } from '../../components/ui.jsx';
import InvoiceActions from '../../components/billing/InvoiceActions.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { INVOICE_STATUSES, formatMoney, formatDate } from '../../utils/platform.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';

export default function InvoicesPage() {
  useDocumentTitle('Invoices');
  const [status, setStatus] = useState('OPEN');
  const [page, setPage] = useState(1);
  const params = { page, limit: 20, ...(status && { status }) };

  const q = useQuery({
    queryKey: ['admin', 'invoices', params],
    queryFn: async () => (await adminApi.get('/invoices', { params })).data.data,
    placeholderData: keepPreviousData,
  });

  const columns = [
    { key: 'number', header: 'Invoice', render: (i) => <span className="font-mono text-xs">{i.number}</span> },
    {
      key: 'tenant',
      header: 'Company',
      render: (i) => (i.tenantId ? <Link className="text-brand-500 hover:underline" to={`/super-admin/tenants/${i.tenantId.id}`}>{i.tenantId.name}</Link> : '—'),
    },
    { key: 'plan', header: 'Plan', render: (i) => `${i.planId?.name || '—'} · ${i.billingCycle === 'YEARLY' ? 'yearly' : 'monthly'}` },
    { key: 'amount', header: 'Amount', render: (i) => formatMoney(i.amountMinor, i.currency) },
    { key: 'status', header: 'Status', render: (i) => <Badge color={INVOICE_STATUS_COLOR[i.status]}>{i.status}</Badge> },
    { key: 'due', header: 'Due / paid', render: (i) => <span className="text-white/60">{formatDate(i.paidAt || i.dueDate)}</span> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, className: 'text-right', render: (i) => <InvoiceActions invoice={i} /> },
  ];

  return (
    <>
      <PageHeader title="Invoices" description="Confirm manual payments (bank transfer, JazzCash, Easypaisa) here." />
      <Card>
        <div className="mb-4 max-w-xs">
          <SelectField
            name="status"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            options={[{ value: '', label: 'All invoices' }, ...INVOICE_STATUSES.map((s) => ({ value: s, label: s }))]}
          />
        </div>
        {q.isError ? (
          <ErrorState message={apiErrorMessage(q.error)} onRetry={q.refetch} />
        ) : (
          <DataTable columns={columns} rows={q.data?.items} loading={q.isLoading} empty={<EmptyState icon="receipt" title="No invoices" />} />
        )}
        <Pager pagination={q.data?.pagination} onPage={setPage} />
      </Card>
    </>
  );
}
