// UI copies of platform option lists (the server validates the real values).
export const TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'];
export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'];
export const INVOICE_STATUSES = ['OPEN', 'PAID', 'VOID'];
export const PAYMENT_METHODS = [
  ['BANK_TRANSFER', 'Bank transfer'],
  ['JAZZCASH', 'JazzCash'],
  ['EASYPAISA', 'Easypaisa'],
  ['CARD', 'Card'],
  ['CASH', 'Cash'],
  ['OTHER', 'Other'],
];
export const CURRENCIES = ['USD', 'PKR', 'EUR', 'GBP', 'AED', 'SAR'];
export const CONNECTORS = ['CSV', 'GOOGLE_WEB', 'LOCAL_BUSINESS', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'CHROME_EXTENSION', 'DATA_PROVIDER', 'WEBHOOK'];
export const ERP_MODULES = ['SALES', 'INVOICING', 'PROJECTS', 'ITEMS', 'ACCOUNTING', 'HR', 'SUPPORT', 'CUSTOM_FIELDS'];
export const LIMITS = [
  ['users', 'Users'],
  ['leadsPerMonth', 'Leads / month'],
  ['discoverySearchesPerMonth', 'Discovery searches / month'],
  ['aiRequestsPerMonth', 'AI requests / month'],
  ['aiTokensPerMonth', 'AI tokens / month'],
  ['hashtagWatches', 'Hashtag watches'],
  ['storageMb', 'Storage (MB)'],
  ['exportsPerMonth', 'Exports / month'],
];

export const formatMoney = (minor, currency) =>
  `${currency} ${(Number(minor || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const formatLimit = (v) => (v === -1 ? 'Unlimited' : Number(v).toLocaleString());
export const formatDateTime = (v) => (v ? new Date(v).toLocaleString() : '—');
export const formatDate = (v) => (v ? new Date(v).toLocaleDateString() : '—');

/** { USD: 2900, PKR: 500000 } → "USD 29 · PKR 5,000" */
export function formatMoneyMap(map) {
  const entries = Object.entries(map || {});
  if (entries.length === 0) return '0';
  return entries.map(([cur, minor]) => formatMoney(minor, cur)).join(' · ');
}
