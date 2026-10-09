// Invoice rules — PURE (unit-tested).
//   - "overdue" and "partly paid" are CALCULATED from the stored numbers + today, never stored separately,
//     so they can never disagree with the payments.
//   - stock is counted in whole units: 1.5 units of a stocked item can't be sold.
const DAY = 24 * 3600 * 1000;

/** What the UI shows for an invoice right now. */
export function invoiceView(inv, now = new Date()) {
  const open = inv.status === 'ISSUED';
  const paid = inv.status === 'PAID';
  const balance = inv.balanceMinor ?? 0;
  const paymentState = paid || (open && balance === 0) ? 'PAID' : open && (inv.paidMinor ?? 0) > 0 ? 'PARTIAL' : open ? 'UNPAID' : null;
  const due = inv.dueDate ? new Date(inv.dueDate) : null;
  const overdue = Boolean(open && balance > 0 && due && due.getTime() < now.getTime());
  return { paymentState, overdue, daysOverdue: overdue ? Math.floor((now.getTime() - due.getTime()) / DAY) : 0 };
}

/** Can this amount be recorded as a payment? → null (ok) or a message. */
export function paymentProblem(inv, amountMinor) {
  if (inv.status === 'DRAFT' || inv.status === 'ISSUING') return 'Issue the invoice before recording payments.';
  if (inv.status === 'VOID') return 'This invoice is void.';
  if (inv.status === 'PAID' || inv.balanceMinor === 0) return 'This invoice is already fully paid.';
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return 'The amount must be more than 0.';
  if (amountMinor > inv.balanceMinor) return 'The amount is more than the open balance (no overpayments).';
  return null;
}

/** Due date = issue date + payment terms (days). */
export const dueDateFor = (issueDate, termsDays) => new Date(new Date(issueDate).getTime() + termsDays * DAY);

/** 2500 (=2.5 units) → null ; 3000 → 3 */
export const wholeUnits = (qtyMilli) => (Number.isInteger(qtyMilli) && qtyMilli % 1000 === 0 ? qtyMilli / 1000 : null);

/** Stock to take for an invoice: { itemId: units } for lines whose item counts stock. */
export function stockNeeds(lines, stockedItemIds) {
  const need = new Map();
  for (const l of lines) {
    if (!l.itemId || !stockedItemIds.has(String(l.itemId))) continue;
    const units = wholeUnits(l.qtyMilli);
    if (units === null) return { error: `"${l.description}": stocked items can only be sold in whole units.` };
    need.set(String(l.itemId), (need.get(String(l.itemId)) || 0) + units);
  }
  return { need };
}
