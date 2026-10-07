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
      { to: '/app/leads', label: 'Leads', icon: 'target', phase: 9, permissions: ['leads:read:all', 'leads:read:own'],
        description: 'All your potential clients in one place, with the reason each one was found.',
        bullets: ['Add, edit, search and filter leads', 'Duplicate detection per company', 'Tags, notes, custom fields', '"Why was this lead discovered?" panel'] },
      { to: '/app/discovery', label: 'Discovery', icon: 'search', phase: 10, permissions: ['leads:write'],
        description: 'Find new leads from Google/Web, local businesses and CSV files using your keywords.',
        bullets: ['Source-specific search queries', 'CSV import with preview and validation', 'Evidence stored for every lead'] },
      { to: '/app/signals', label: 'Signals inbox', icon: 'inbox', phase: 11, permissions: ['leads:read:all', 'leads:read:own'],
        description: 'Public posts that match your hashtags and buyer-intent phrases, waiting for review.',
        bullets: ['Post link, snippet and matched hashtag', 'Public contact only, with its source shown', 'Turn a signal into a lead in one click'] },
      { to: '/app/hashtag-watches', label: 'Hashtag watches', icon: 'hash', phase: 11, permissions: ['leads:write'],
        description: 'Watch hashtags like #needaplot or #needwebsite on a schedule using official APIs.',
        bullets: ['Schedules (e.g. every 6 hours)', 'Location and keyword filters', 'Honest notes about what each platform allows'] },
      { to: '/app/approvals', label: 'Approval queue', icon: 'checkCircle', phase: 15, permissions: ['leads:write'],
        description: 'Every AI-written message waits here for a human to approve, edit or reject.',
        bullets: ['Nothing is sent automatically', 'Edit, regenerate or save as template'] },
      { to: '/app/outreach', label: 'Outreach', icon: 'send', phase: 17, permissions: ['leads:write'],
        description: 'Track approved messages across email, WhatsApp (official API) and other channels.' },
      { to: '/app/conversations', label: 'Conversations', icon: 'chat', phase: 18, permissions: ['leads:read:all', 'leads:read:own'],
        description: 'Full message history per lead with AI reply suggestions you approve.' },
      { to: '/app/follow-ups', label: 'Follow-ups', icon: 'bell', phase: 19, permissions: ['leads:read:all', 'leads:read:own'],
        description: "Today's, overdue and upcoming follow-ups so no lead is forgotten." },
      { to: '/app/website-audits', label: 'Website audits', icon: 'globe', phase: 16, permissions: ['leads:write'],
        description: 'Safe checks of a lead\'s public website — only real, observed issues are reported.' },
      { to: '/app/templates', label: 'Templates', icon: 'template', phase: 15, permissions: ['leads:write'],
        description: 'Reusable message templates with {{firstName}}, {{companyName}} and more.' },
    ],
  },
  {
    label: 'CRM',
    items: [
      { to: '/app/pipeline', label: 'Pipeline', icon: 'kanban', phase: 9, permissions: ['leads:read:all', 'leads:read:own'],
        description: 'Drag leads through your sales stages on a Kanban board.' },
      { to: '/app/contacts', label: 'Contacts', icon: 'contact', phase: 9, permissions: ['leads:read:all', 'leads:read:own'],
        description: 'People and companies you work with.' },
    ],
  },
  {
    label: 'ERP',
    items: [
      { to: '/app/items', label: 'Items', icon: 'box', phase: 20, permissions: ['leads:read:all', 'leads:write'],
        description: 'Your products, services, plots or apartments — with custom fields per industry.' },
      { to: '/app/quotes', label: 'Quotes', icon: 'file', phase: 20, permissions: ['leads:write'],
        description: 'Create proposals and quotations; totals are always calculated on the server.' },
      { to: '/app/invoices', label: 'Invoices', icon: 'receipt', phase: 21, permissions: ['leads:write'],
        description: 'Client invoices, payments, taxes and PDF export.' },
      { to: '/app/projects', label: 'Projects', icon: 'folder', phase: 22, permissions: ['leads:read:all', 'leads:write'],
        description: 'Projects, milestones, tasks and time tracking after a deal is won.' },
      { to: '/app/accounting', label: 'Accounting', icon: 'calculator', phase: 23, permissions: ['billing:manage', 'export:run'],
        description: 'Simple income, expenses and reports.' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/app/analytics', label: 'Analytics', icon: 'chart', phase: 24, permissions: ['leads:read:all'],
        description: 'Which sources bring good leads, reply rates, conversion rates and cost per qualified lead.' },
      { to: '/app/exports', label: 'Exports', icon: 'download', phase: 25, permissions: ['export:run'],
        description: 'Secure CSV and PDF exports (lead dossier, hashtag reports) with audit logging.' },
      { to: '/app/ai-usage', label: 'AI usage', icon: 'cpu', phase: 26, permissions: ['billing:manage', 'integrations:manage'],
        description: 'AI requests, tokens and estimated cost for your company.' },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/app/settings/team', label: 'Team', icon: 'users', permissions: ['users:read'] },
      { to: '/app/settings/company', label: 'Company', icon: 'building', phase: 7, permissions: ['tenant:update'],
        description: 'Company profile, industry pack, services, ideal customer profile, brand voice and logo.' },
      { to: '/app/settings/integrations', label: 'Integrations', icon: 'plug', phase: 8, permissions: ['integrations:manage'],
        description: 'Your own API keys (OpenAI, Google, Meta...) stored encrypted. Only masked values are ever shown.' },
      { to: '/app/settings/billing', label: 'Billing', icon: 'card', permissions: ['billing:manage'] },
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
