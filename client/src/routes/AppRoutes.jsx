import { lazy, Suspense } from 'react';
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
const CompanySettingsPage = lazy(() => import('../pages/app/CompanySettingsPage.jsx'));
const IntegrationsPage = lazy(() => import('../pages/app/IntegrationsPage.jsx'));
const LeadsPage = lazy(() => import('../pages/app/leads/LeadsPage.jsx'));
const LeadDetailPage = lazy(() => import('../pages/app/leads/LeadDetailPage.jsx'));
const PipelinePage = lazy(() => import('../pages/app/leads/PipelinePage.jsx'));
const DiscoveryPage = lazy(() => import('../pages/app/discovery/DiscoveryPage.jsx'));
const SignalsPage = lazy(() => import('../pages/app/signals/SignalsPage.jsx'));
const HashtagWatchesPage = lazy(() => import('../pages/app/signals/HashtagWatchesPage.jsx'));
const AiUsagePage = lazy(() => import('../pages/app/AiUsagePage.jsx'));
const ApprovalQueuePage = lazy(() => import('../pages/app/messages/ApprovalQueuePage.jsx'));
const OutreachPage = lazy(() => import('../pages/app/messages/OutreachPage.jsx'));
const ItemsPage = lazy(() => import('../pages/app/erp/ItemsPage.jsx'));
const ClientsPage = lazy(() => import('../pages/app/erp/ClientsPage.jsx'));
const ClientDetailPage = lazy(() => import('../pages/app/erp/ClientDetailPage.jsx'));
const QuotesPage = lazy(() => import('../pages/app/erp/QuotesPage.jsx'));
const QuoteEditorPage = lazy(() => import('../pages/app/erp/QuoteEditorPage.jsx'));
const AnalyticsPage = lazy(() => import('../pages/app/AnalyticsPage.jsx'));
const AccountingPage = lazy(() => import('../pages/app/erp/AccountingPage.jsx'));
const ProjectsPage = lazy(() => import('../pages/app/erp/ProjectsPage.jsx'));
const ProjectPage = lazy(() => import('../pages/app/erp/ProjectPage.jsx'));
const TimePage = lazy(() => import('../pages/app/erp/TimePage.jsx'));
const InvoicesPage = lazy(() => import('../pages/app/erp/InvoicesPage.jsx'));
const InvoicePage = lazy(() => import('../pages/app/erp/InvoicePage.jsx'));
const InvoicePrintPage = lazy(() => import('../pages/app/erp/InvoicePrintPage.jsx'));
const QuotePrintPage = lazy(() => import('../pages/app/erp/QuotePrintPage.jsx'));
const FollowUpsPage = lazy(() => import('../pages/app/followUps/FollowUpsPage.jsx'));
const NotificationsPage = lazy(() => import('../pages/app/NotificationsPage.jsx'));
const ConversationsPage = lazy(() => import('../pages/app/messages/ConversationsPage.jsx'));
const TemplatesPage = lazy(() => import('../pages/app/messages/TemplatesPage.jsx'));
const WebsiteAuditsPage = lazy(() => import('../pages/app/WebsiteAuditsPage.jsx'));
const ExtensionPage = lazy(() => import('../pages/app/ExtensionPage.jsx'));
const DoNotContactPage = lazy(() => import('../pages/app/DoNotContactPage.jsx'));
const OnboardingPage = lazy(() => import('../pages/app/OnboardingPage.jsx'));
const IndustryPacksPage = lazy(() => import('../pages/superAdmin/IndustryPacksPage.jsx'));
const InvoicesPage = lazy(() => import('../pages/superAdmin/InvoicesPage.jsx'));
const AiModelsPage = lazy(() => import('../pages/superAdmin/AiModelsPage.jsx'));
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
          <Route path="analytics" element={<RequirePermission permissions={['leads:read:all']}><AnalyticsPage /></RequirePermission>} />
        <Route path="accounting" element={<RequirePermission permissions={['accounting:manage']}><AccountingPage /></RequirePermission>} />
        <Route path="projects" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><ProjectsPage /></RequirePermission>} />
        <Route path="projects/:id" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><ProjectPage /></RequirePermission>} />
        <Route path="time" element={<RequirePermission permissions={['leads:write']}><TimePage /></RequirePermission>} />
        <Route path="invoices" element={<InvoicesPage />} />
          <Route path="industry-packs" element={<IndustryPacksPage />} />
          <Route path="ai-models" element={<AiModelsPage />} />
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

      <Route path="/print/invoices/:id" element={<ProtectedRoute><Suspense fallback={null}><InvoicePrintPage /></Suspense></ProtectedRoute>} />
      <Route path="/print/quotes/:id" element={<ProtectedRoute><Suspense fallback={null}><QuotePrintPage /></Suspense></ProtectedRoute>} />
      <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
      <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="settings/team" element={<RequirePermission permissions={['users:read']}><TeamPage /></RequirePermission>} />
        <Route path="settings/account" element={<AccountPage />} />
        <Route path="leads" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><LeadsPage /></RequirePermission>} />
        <Route path="leads/:id" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><LeadDetailPage /></RequirePermission>} />
        <Route path="discovery" element={<RequirePermission permissions={['leads:write']}><DiscoveryPage /></RequirePermission>} />
        <Route path="signals" element={<RequirePermission permissions={['leads:write']}><SignalsPage /></RequirePermission>} />
        <Route path="hashtag-watches" element={<RequirePermission permissions={['leads:write']}><HashtagWatchesPage /></RequirePermission>} />
        <Route path="pipeline" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><PipelinePage /></RequirePermission>} />
        <Route path="settings/do-not-contact" element={<RequirePermission permissions={['leads:delete']}><DoNotContactPage /></RequirePermission>} />
        <Route path="settings/company" element={<CompanySettingsPage />} />
        <Route path="approvals" element={<RequirePermission permissions={['leads:write', 'messages:approve']}><ApprovalQueuePage /></RequirePermission>} />
        <Route path="outreach" element={<RequirePermission permissions={['leads:write']}><OutreachPage /></RequirePermission>} />
        <Route path="items" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><ItemsPage /></RequirePermission>} />
        <Route path="contacts" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><ClientsPage /></RequirePermission>} />
        <Route path="contacts/:id" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><ClientDetailPage /></RequirePermission>} />
        <Route path="quotes" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><QuotesPage /></RequirePermission>} />
        <Route path="quotes/new" element={<RequirePermission permissions={['leads:write']}><QuoteEditorPage /></RequirePermission>} />
        <Route path="quotes/:id" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><QuoteEditorPage /></RequirePermission>} />
        <Route path="invoices" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><InvoicesPage /></RequirePermission>} />
        <Route path="invoices/new" element={<RequirePermission permissions={['invoices:manage']}><InvoicePage /></RequirePermission>} />
        <Route path="invoices/:id" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><InvoicePage /></RequirePermission>} />
        <Route path="follow-ups" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><FollowUpsPage /></RequirePermission>} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="conversations" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><ConversationsPage /></RequirePermission>} />
        <Route path="templates" element={<RequirePermission permissions={['leads:write']}><TemplatesPage /></RequirePermission>} />
        <Route path="website-audits" element={<RequirePermission permissions={['leads:read:all', 'leads:read:own']}><WebsiteAuditsPage /></RequirePermission>} />
        <Route path="ai-usage" element={<RequirePermission permissions={['billing:manage', 'integrations:manage']}><AiUsagePage /></RequirePermission>} />
        <Route path="settings/extension" element={<RequirePermission permissions={['leads:write']}><ExtensionPage /></RequirePermission>} />
        <Route path="settings/integrations" element={<RequirePermission permissions={['integrations:manage']}><IntegrationsPage /></RequirePermission>} />
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
