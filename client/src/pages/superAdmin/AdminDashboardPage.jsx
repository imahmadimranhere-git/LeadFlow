import { useQuery } from '@tanstack/react-query';
import adminApi from '../../lib/adminApi.js';
import { StatCard, Spinner, Alert } from '../../components/ui.jsx';
import { apiErrorMessage } from '../../utils/apiErrors.js';
import { formatMoneyMap } from '../../utils/platform.js';

export default function AdminDashboardPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => (await adminApi.get('/dashboard')).data.data,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Platform overview</h1>
      {isLoading && <Spinner />}
      {isError && <Alert>{apiErrorMessage(error)}</Alert>}
      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total tenants" value={data.totalTenants} />
            <StatCard label="New signups (30 days)" value={data.newSignups30d} />
            <StatCard label="Total users" value={data.totalUsers} />
            <StatCard label="Active plans" value={data.activePlans} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Trial" value={data.tenantsByStatus.TRIAL} />
            <StatCard label="Active" value={data.tenantsByStatus.ACTIVE} />
            <StatCard label="Payment due" value={data.tenantsByStatus.PAST_DUE} />
            <StatCard label="Suspended" value={data.tenantsByStatus.SUSPENDED} />
            <StatCard label="Cancelled" value={data.tenantsByStatus.CANCELLED} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="MRR" value={formatMoneyMap(data.mrr)} hint="Monthly recurring revenue (yearly ÷ 12)" />
            <StatCard label="Revenue (30 days)" value={formatMoneyMap(data.revenue30d)} hint="Confirmed payments" />
            <StatCard label="Paying subscriptions" value={data.payingSubscriptions} />
            <StatCard label="Cancellations (30 days)" value={data.churn30d} />
          </div>
        </>
      )}
    </div>
  );
}
