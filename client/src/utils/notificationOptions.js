export const NOTIFICATION_LABEL = {
  FOLLOW_UP_DUE: 'Follow-up is due',
  NEW_REPLY: 'New reply from a lead',
  MESSAGE_APPROVED: 'My draft was approved',
  MESSAGE_REJECTED: 'My draft was rejected',
  LEAD_ASSIGNED: 'A lead was assigned to me',
  QUOTE_ACCEPTED: 'My quote was accepted',
  INVOICE_OVERDUE: 'An invoice of my client is overdue',
  INVOICE_PAID: 'An invoice of my client was paid',
  TASK_ASSIGNED: 'A task was assigned to me',
  LARGE_EXPORT: 'Someone exported a lot of data',
  AI_BUDGET: 'AI spend reached the monthly budget',
};
export const NOTIFICATION_ICON = { FOLLOW_UP_DUE: 'clock', NEW_REPLY: 'chat', MESSAGE_APPROVED: 'checkCircle', MESSAGE_REJECTED: 'x', LEAD_ASSIGNED: 'target', QUOTE_ACCEPTED: 'file', INVOICE_OVERDUE: 'alert', INVOICE_PAID: 'receipt', TASK_ASSIGNED: 'checkCircle', LARGE_EXPORT: 'download', AI_BUDGET: 'cpu' };

/** Only in-app paths are followed — a notification can never send you to another website. */
export const safeAppLink = (link) => (typeof link === 'string' && /^\/app\/[A-Za-z0-9/_?=&.-]*$/.test(link) ? link : null);

export function timeAgo(date) {
  const s = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
