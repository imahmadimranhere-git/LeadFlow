// In-app notifications (spec A15/A17). Pure data.
export const NOTIFICATION_TYPES = ['FOLLOW_UP_DUE', 'NEW_REPLY', 'MESSAGE_APPROVED', 'MESSAGE_REJECTED', 'LEAD_ASSIGNED', 'QUOTE_ACCEPTED', 'INVOICE_OVERDUE', 'INVOICE_PAID', 'TASK_ASSIGNED'];
export const NOTIFICATION_LABEL = Object.freeze({
  FOLLOW_UP_DUE: 'Follow-up is due',
  NEW_REPLY: 'New reply from a lead',
  MESSAGE_APPROVED: 'My draft was approved',
  MESSAGE_REJECTED: 'My draft was rejected',
  LEAD_ASSIGNED: 'A lead was assigned to me',
  QUOTE_ACCEPTED: 'My quote was accepted',
  INVOICE_OVERDUE: 'An invoice of my client is overdue',
  INVOICE_PAID: 'An invoice of my client was paid',
  TASK_ASSIGNED: 'A task was assigned to me',
});
export const NOTIFICATION_RETENTION_DAYS = 90;
export const DEFAULT_TIMEZONE = 'UTC';
export const DEFAULT_DIGEST_HOUR = 8;
