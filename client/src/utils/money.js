// Money in the API is integer minor units (paisa / cents). These helpers only format / convert for display.
export const CURRENCIES = ['USD', 'PKR', 'EUR', 'GBP', 'AED', 'SAR'];

/** 6000050 → "60,000.50" */
export function majorString(minor) {
  if (minor === null || minor === undefined) return '';
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const int = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${int}${frac === '00' ? '' : `.${frac}`}`;
}
export const money = (minor, currency) => `${currency ? `${currency} ` : ''}${majorString(minor)}`;
/** for <input>: 6000050 → "60000.5" (no thousands separators) */
export const minorToInput = (minor) => (minor === null || minor === undefined ? '' : String(minor / 100));
/** 1700 → "17" */
export const bpToPct = (bp) => (bp === null || bp === undefined ? '' : String(bp / 100));
export const pct = (bp) => `${(bp || 0) / 100}%`;
export const qty = (milli) => String(milli / 1000);

export const QUOTE_STATUS_COLOR = { DRAFT: 'gray', SENT: 'blue', ACCEPTED: 'green', DECLINED: 'red', EXPIRED: 'amber', CANCELLED: 'gray' };
export const QUOTE_STATUS_LABEL = { DRAFT: 'Draft', SENT: 'Sent', ACCEPTED: 'Accepted', DECLINED: 'Declined', EXPIRED: 'Expired', CANCELLED: 'Cancelled' };
export const ITEM_TYPES = [['SERVICE', 'Service'], ['PRODUCT', 'Product'], ['PROPERTY', 'Property'], ['OTHER', 'Other']];
export const AVAILABILITY = [['NOT_TRACKED', 'Not tracked'], ['AVAILABLE', 'Available'], ['RESERVED', 'Reserved'], ['SOLD', 'Sold']];

export const INVOICE_STATUS_LABEL = { DRAFT: 'Draft', ISSUING: 'Issuing…', ISSUED: 'Issued', PAID: 'Paid', VOID: 'Void' };
export const PAYMENT_STATE = { UNPAID: ['amber', 'Unpaid'], PARTIAL: ['blue', 'Partly paid'], PAID: ['green', 'Paid'] };
export const PAYMENT_METHODS = [['BANK_TRANSFER', 'Bank transfer'], ['CASH', 'Cash'], ['CHEQUE', 'Cheque'], ['CARD', 'Card'], ['ONLINE', 'Online'], ['OTHER', 'Other']];
/** { PKR: 100000, USD: 500 } → "PKR 1,000 · USD 5" */
export const moneyMap = (m) => (Object.keys(m || {}).length ? Object.entries(m).map(([c, v]) => money(v, c)).join(' · ') : '0');
/** One badge for an invoice: Draft / Void / Overdue / Paid / Partly paid / Unpaid */
export function invoiceBadge(inv) {
  if (inv.status === 'DRAFT') return ['gray', 'Draft'];
  if (inv.status === 'VOID') return ['gray', 'Void'];
  if (inv.overdue) return ['red', `Overdue ${inv.daysOverdue}d`];
  return PAYMENT_STATE[inv.paymentState] || ['gray', INVOICE_STATUS_LABEL[inv.status]];
}
