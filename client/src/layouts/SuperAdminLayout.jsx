import { Suspense } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import AppShell from './AppShell.jsx';
import { useAdminAuth } from '../context/AdminAuthContext.jsx';
import { DropdownMenu, Icon, LoadingState } from '../components/ui.jsx';

const NAV = [
  {
    label: null,
    items: [
      { to: '/super-admin', label: 'Dashboard', icon: 'home', end: true },
      { to: '/super-admin/tenants', label: 'Tenants', icon: 'building' },
      { to: '/super-admin/plans', label: 'Plans', icon: 'card' },
      { to: '/super-admin/invoices', label: 'Invoices', icon: 'receipt' },
      { to: '/super-admin/industry-packs', label: 'Industry packs', icon: 'template' },
      { to: '/super-admin/ai-models', label: 'AI models', icon: 'cpu' },
      { to: '/super-admin/audit-logs', label: 'Audit logs', icon: 'shield' },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/super-admin/settings', label: 'Platform settings', icon: 'settings' },
      { to: '/super-admin/account', label: 'My account', icon: 'user' },
    ],
  },
];

export default function SuperAdminLayout() {
  const { admin, isAuthenticated, signOut } = useAdminAuth();
  const navigate = useNavigate();
  if (!isAuthenticated) return <Navigate to="/super-admin/login" replace />;

  const banner = (
    <div className="sticky top-0 z-40 flex h-8 items-center justify-center bg-amber-500/15 px-4 text-xs font-medium text-amber-300">
      SUPER ADMIN MODE — every action here is recorded in the audit log
    </div>
  );

  const topBar = (
    <DropdownMenu
      label="Admin menu"
      trigger={
        <span className="flex items-center gap-2 text-sm">
          <Icon name="shield" className="h-4 w-4 text-amber-300" />
          <span className="max-w-[200px] truncate">{admin.email}</span>
          <Icon name="chevronDown" className="h-4 w-4" />
        </span>
      }
      items={[
        { label: 'My account', onSelect: () => navigate('/super-admin/account') },
        { label: 'Log out', danger: true, onSelect: signOut },
      ]}
    />
  );

  return (
    <AppShell groups={NAV} subtitle="Platform control" topBar={topBar} banner={banner}>
      <Suspense fallback={<LoadingState rows={6} />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}
