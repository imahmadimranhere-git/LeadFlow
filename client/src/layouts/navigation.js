// Tenant app menu. `permissions`: show the item if the user has ANY of them (UI only — server checks too).
// `phase`: modules not built yet show an honest "coming in Phase X" page.
export const NAV_GROUPS = [
  {
    label: null,
    items: [{ to: '/app', label: 'Dashboard', icon: 'home', end: true }],
  },
  {
    label: 'Growth',
    items: [
      { to: '/app/leads', label: 'Leads', icon: 'target', permissions: ['leads:read:all', 'leads:read:own'] },
      { to: '/app/discovery', label: 'Discovery', icon: 'search', permissions: ['leads:write'] },
      { to: '/app/signals', label: 'Signals inbox', icon: 'inbox', permissions: ['leads:write'] },
      { to: '/app/hashtag-watches', label: 'Hashtag watches', icon: 'hash', permissions: ['leads:write'] },
      { to: '/app/approvals', label: 'Approval queue', icon: 'checkCircle', permissions: ['leads:write', 'messages:approve'] },
      { to: '/app/outreach', label: 'Outreach', icon: 'send', permissions: ['leads:write'] },
      { to: '/app/conversations', label: 'Conversations', icon: 'chat', permissions: ['leads:read:all', 'leads:read:own'] },
      { to: '/app/follow-ups', label: 'Follow-ups', icon: 'bell', permissions: ['leads:read:all', 'leads:read:own'] },
      { to: '/app/website-audits', label: 'Website audits', icon: 'globe', permissions: ['leads:read:all', 'leads:read:own'] },
      { to: '/app/templates', label: 'Templates', icon: 'template', permissions: ['leads:write'] },
    ],
  },
  {
    label: 'CRM',
    items: [
      { to: '/app/pipeline', label: 'Pipeline', icon: 'kanban', permissions: ['leads:read:all', 'leads:read:own'] },
      { to: '/app/contacts', label: 'Contacts', icon: 'contact', permissions: ['leads:read:all', 'leads:read:own'] },
    ],
  },
  {
    label: 'ERP',
    items: [
      { to: '/app/items', label: 'Items', icon: 'box', permissions: ['leads:read:all', 'leads:read:own'] },
      { to: '/app/quotes', label: 'Quotes', icon: 'file', permissions: ['leads:read:all', 'leads:read:own'] },
      { to: '/app/invoices', label: 'Invoices', icon: 'receipt', permissions: ['leads:read:all', 'leads:read:own'] },
      { to: '/app/projects', label: 'Projects', icon: 'folder', permissions: ['leads:read:all', 'leads:read:own'] },
      { to: '/app/time', label: 'My time', icon: 'clock', permissions: ['leads:write'] },
      { to: '/app/accounting', label: 'Accounting', icon: 'calculator', permissions: ['accounting:manage'] },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/app/analytics', label: 'Analytics', icon: 'chart', permissions: ['leads:read:all'] },
      { to: '/app/exports', label: 'Exports', icon: 'download', phase: 25, permissions: ['export:run'],
        description: 'Secure CSV and PDF exports (lead dossier, hashtag reports) with audit logging.' },
      { to: '/app/ai-usage', label: 'AI usage', icon: 'cpu', permissions: ['billing:manage', 'integrations:manage'] },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/app/settings/team', label: 'Team', icon: 'users', permissions: ['users:read'] },
      { to: '/app/settings/company', label: 'Company', icon: 'building', permissions: ['tenant:read'] },
      { to: '/app/settings/integrations', label: 'Integrations', icon: 'plug', permissions: ['integrations:manage'] },
      { to: '/app/settings/extension', label: 'Chrome extension', icon: 'globe', permissions: ['leads:write'] },
      { to: '/app/settings/billing', label: 'Billing', icon: 'card', permissions: ['billing:manage'] },
      { to: '/app/settings/do-not-contact', label: 'Do-not-contact', icon: 'shield', permissions: ['leads:delete'] },
      { to: '/app/settings/account', label: 'My account', icon: 'user' },
    ],
  },
];

/** Company suspended for non-payment → only these pages are usable. */
export const BILLING_ONLY_PATHS = ['/app/settings/billing', '/app/settings/account'];

/** Items the current user may see. */
export function visibleNav(can, access = 'FULL') {
  if (access === 'BILLING_ONLY') {
    return [{ label: null, items: NAV_GROUPS.flatMap((g) => g.items).filter((i) => BILLING_ONLY_PATHS.includes(i.to)) }];
  }
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.permissions || can(...i.permissions)) })).filter(
    (g) => g.items.length > 0
  );
}

/** All "coming soon" modules → used to create their routes. */
export const COMING_SOON_ITEMS = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.phase);
