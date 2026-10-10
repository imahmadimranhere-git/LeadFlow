// Tenant (company) app layout.
import { Suspense, useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import AppShell from './AppShell.jsx';
import { visibleNav, BILLING_ONLY_PATHS } from './navigation.js';
import { useAuth } from '../context/AuthContext.jsx';
import { DropdownMenu, Icon, LoadingState, Badge } from '../components/ui.jsx';
import { ROLE_LABELS } from '../utils/roles.js';
import useTenantSettings from '../hooks/useTenantSettings.js';
import useTenantLogo from '../hooks/useTenantLogo.js';
import { applyAccent } from '../utils/color.js';
import NotificationBell from '../components/notifications/NotificationBell.jsx';

function daysLeft(date) {
  if (!date) return null;
  return Math.max(0, Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000));
}

function TrialBadge({ tenant }) {
  if (tenant.status === 'PAST_DUE') return <Badge color="amber">Payment due</Badge>;
  if (tenant.status !== 'TRIAL') return null;
  const days = daysLeft(tenant.trialEndsAt);
  return <Badge color={days !== null && days <= 3 ? 'amber' : 'blue'}>Trial · {days ?? '–'} days left</Badge>;
}

export default function AppLayout() {
  const { user, tenant, can, access, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const billingOnly = access === 'BILLING_ONLY';
  const settings = useTenantSettings();
  const branding = settings.data?.branding;
  const logoUrl = useTenantLogo(branding?.hasLogo, branding?.logoVersion);

  // White-label: the company's brand colour replaces the default green (reset when leaving the app)
  useEffect(() => {
    applyAccent(branding?.accentColor || null);
  }, [branding?.accentColor]);
  useEffect(() => () => applyAccent(null), []);

  if (billingOnly && !BILLING_ONLY_PATHS.includes(location.pathname)) {
    return <Navigate to="/app/settings/billing" replace />;
  }
  // New company → owner/admin goes through the setup wizard first
  if (!billingOnly && settings.data?.onboardingRequired && can('tenant:update')) {
    return <Navigate to="/onboarding" replace />;
  }

  const topBar = (
    <>
      <div className="mr-auto hidden min-w-0 sm:block">
        <p className="truncate text-sm font-medium">{tenant.name}</p>
      </div>
      <TrialBadge tenant={tenant} />
      {!billingOnly && <NotificationBell />}
      <DropdownMenu
        label="Account menu"
        trigger={
          <span className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-500/20 text-sm font-semibold text-brand-500">
              {user.name.trim().charAt(0).toUpperCase()}
            </span>
            <span className="hidden text-left text-sm leading-tight md:block">
              <span className="block max-w-[160px] truncate text-white">{user.name}</span>
              <span className="block text-xs text-white/40">{ROLE_LABELS[user.role]}</span>
            </span>
            <Icon name="chevronDown" className="h-4 w-4" />
          </span>
        }
        items={[
          { label: 'My account', onSelect: () => navigate('/app/settings/account') },
          { label: 'Team', onSelect: () => navigate('/app/settings/team'), hidden: !can('users:read') },
          { label: 'Log out', danger: true, onSelect: () => logout() },
        ]}
      />
    </>
  );

  return (
    <AppShell
      groups={visibleNav(can, access)}
      subtitle={tenant.name}
      brandLogoUrl={logoUrl}
      topBar={topBar}
      banner={
        billingOnly ? (
          <div className="sticky top-0 z-40 flex h-8 items-center justify-center bg-red-500/20 px-4 text-xs font-medium text-red-200">
            Subscription suspended — renew below to unlock your workspace
          </div>
        ) : user.emailVerified === false && location.pathname !== '/app/settings/account' ? (
          <div className="sticky top-0 z-40 flex min-h-8 flex-wrap items-center justify-center gap-2 bg-amber-500/15 px-4 py-1 text-xs text-amber-100">
            Please confirm your email address — we sent you a link.
            <button type="button" className="underline" onClick={() => navigate('/app/settings/account')}>Resend / details</button>
          </div>
        ) : null
      }
    >
      <Suspense fallback={<LoadingState rows={6} />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}
