// UI labels for lead options (the server validates the real values).
export const LEAD_STATUSES = [
  ['NEW', 'New', 'blue'],
  ['QUALIFIED', 'Qualified', 'green'],
  ['CONTACTED', 'Contacted', 'blue'],
  ['REPLIED', 'Replied', 'green'],
  ['FOLLOW_UP', 'Follow-up', 'amber'],
  ['NEGOTIATION', 'Negotiation', 'amber'],
  ['CONVERTED', 'Converted', 'green'],
  ['NOT_INTERESTED', 'Not interested', 'gray'],
  ['LOST', 'Lost', 'red'],
];
export const STATUS_LABEL = Object.fromEntries(LEAD_STATUSES.map(([k, l]) => [k, l]));
export const STATUS_COLOR = Object.fromEntries(LEAD_STATUSES.map(([k, , c]) => [k, c]));
export const PRIORITIES = [
  ['LOW', 'Low'],
  ['MEDIUM', 'Medium'],
  ['HIGH', 'High'],
  ['URGENT', 'Urgent'],
];
export const PRIORITY_COLOR = { LOW: 'gray', MEDIUM: 'blue', HIGH: 'amber', URGENT: 'red' };
export const LEAD_SOURCE_OPTIONS = [
  ['MANUAL', 'Manual'],
  ['CSV', 'CSV import'],
  ['GOOGLE_WEB', 'Google / Web'],
  ['LOCAL_BUSINESS', 'Local business'],
  ['INSTAGRAM', 'Instagram'],
  ['FACEBOOK', 'Facebook'],
  ['LINKEDIN', 'LinkedIn'],
  ['CHROME_EXTENSION', 'Chrome extension'],
  ['DATA_PROVIDER', 'Data provider'],
  ['WEBHOOK', 'Webhook / form'],
];
export const SOURCE_LABEL = Object.fromEntries(LEAD_SOURCE_OPTIONS);

/** Only ever turn http(s) URLs into links (defence in depth — the server also validates). */
export const safeHref = (url) => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null);
