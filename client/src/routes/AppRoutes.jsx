import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute, GuestRoute, RequirePermission } from './guards.jsx';
import AppLayout from '../layouts/AppLayout.jsx';
import { COMING_SOON_ITEMS } from '../layouts/navigation.js';
import ComingSoon from '../components/ComingSoon.jsx';
import { AdminAuthProvider } from '../context/AdminAuthContext.jsx';
import SuperAdminLayout from '../layouts/SuperAdminLayout.jsx';
import LoginPage from '../pages/LoginPage.jsx';
import RegisterPage from '../pages/RegisterPage.jsx';
import AcceptInvitePage from '../pages/AcceptInvitePage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';

// Pages load on demand → smaller first download, faster app start
const DashboardPage = lazy(() => import('../pages/app/DashboardPage.jsx'));
const TeamPage = lazy(() => import('../pages/app/TeamPage.jsx'));
const AccountPage = lazy(() => import('../pages/app/AccountPage.jsx'));
const BillingPage = lazy(() => import('../pages/app/BillingPage.jsx'));
const InvoicesPage = lazy(() => import('../pages/superAdmin/InvoicesPage.jsx'));
const PlatformSettingsPage = lazy(() => import('../pages/superAdmin/PlatformSettingsPage.jsx'));
const StatusPage = lazy(() => import('../pages/StatusPage.jsx'));
const AdminLoginPage = lazy(() => import('../pages/superAdmin/AdminLoginPage.jsx'));
const AdminDashboardPage = lazy(() => import('../pages/superAdmin/AdminDashboardPage.jsx'));
const TenantsPage = lazy(() => import('../pages/superAdmin/TenantsPage.jsx'));
const TenantDetailPage = lazy(() => import('../pages/superAdmin/TenantDetailPage.jsx'));
const PlansPage = lazy(() => import('../pages/superAdmin/PlansPage.jsx'));
const AuditLogsPage = lazy(() => import('../pages/superAdmin/AuditLogsPage.jsx'));
const AdminAccountPage = lazy(() => import('../pages/superAdmin/AdminAccountPage.jsx'));

function SuperAdminArea() {
  return (
    <AdminAuthProvider>
      <Routes>
        <Route path="login" element={<AdminLoginPage />} />
        <Route element={<SuperAdminLayout />}>
          <Route index element={<AdminDashboardPage />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="tenants/:id" element={<TenantDetailPage />} />
          <Route path="plans" element={<PlansPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="settings" element={<PlatformSettingsPage />} />
          <Route path="audit-logs" element={<AuditLogsPage />} />
          <Route path="account" element={<AdminAccountPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/super-admin" replace />} />
      </Routes>
    </AdminAuthProvider>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/dashboard" element={<Navigate to="/app" replace />} />
      <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
      <Route path="/register" element={<GuestRoute><RegisterPage /></GuestRoute>} />
      <Route path="/accept-invite" element={<GuestRoute><AcceptInvitePage /></GuestRoute>} />

      <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="settings/team" element={<RequirePermission permissions={['users:read']}><TeamPage /></RequirePermission>} />
        <Route path="settings/account" element={<AccountPage />} />
        <Route path="settings/billing" element={<RequirePermission permissions={['billing:manage']}><BillingPage /></RequirePermission>} />
        {COMING_SOON_ITEMS.map((item) => (
          <Route
            key={item.to}
            path={item.to.replace('/app/', '')}
            element={
              <RequirePermission permissions={item.permissions}>
                <ComingSoon title={item.label} icon={item.icon} phase={item.phase} description={item.description} bullets={item.bullets} />
              </RequirePermission>
            }
          />
        ))}
        <Route path="*" element={<NotFoundPage inApp />} />
      </Route>

      <Route path="/super-admin/*" element={<SuperAdminArea />} />
      <Route path="/status" element={<StatusPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
