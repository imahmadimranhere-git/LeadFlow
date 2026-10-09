// PHASE 21 — pure invoice rules: overdue / partly paid are calculated (never stored), payment limits, stock units.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { invoiceView, paymentProblem, dueDateFor, wholeUnits, stockNeeds } from '../src/services/erp/invoiceRules.js';

const now = new Date('2026-10-20T12:00:00Z');
const inv = (o = {}) => ({ status: 'ISSUED', totalMinor: 10000, paidMinor: 0, balanceMinor: 10000, dueDate: new Date('2026-10-25T00:00:00Z'), ...o });

describe('Invoice rules', () => {
  it('payment state + overdue are derived from the numbers and the date', () => {
    assert.deepEqual(invoiceView(inv(), now), { paymentState: 'UNPAID', overdue: false, daysOverdue: 0 });
    assert.equal(invoiceView(inv({ paidMinor: 4000, balanceMinor: 6000 }), now).paymentState, 'PARTIAL');
    const late = invoiceView(inv({ dueDate: new Date('2026-10-10T12:00:00Z') }), now);
    assert.deepEqual(late, { paymentState: 'UNPAID', overdue: true, daysOverdue: 10 });
    assert.equal(invoiceView(inv({ status: 'PAID', paidMinor: 10000, balanceMinor: 0, dueDate: new Date('2026-01-01') }), now).overdue, false, 'paid is never overdue');
    assert.equal(invoiceView(inv({ status: 'VOID', dueDate: new Date('2026-01-01') }), now).overdue, false, 'void is never overdue');
    assert.equal(invoiceView(inv({ status: 'DRAFT', dueDate: new Date('2026-01-01') }), now).paymentState, null);
  });

  it('payments: only on issued invoices, more than 0, never more than the open balance', () => {
    assert.equal(paymentProblem(inv(), 10000), null);
    assert.equal(paymentProblem(inv(), 1), null);
    assert.match(paymentProblem(inv(), 10001), /more than the open balance/);
    assert.match(paymentProblem(inv(), 0), /more than 0/);
    assert.match(paymentProblem(inv(), -5), /more than 0/);
    assert.match(paymentProblem(inv(), 10.5), /more than 0/);
    assert.match(paymentProblem(inv({ status: 'DRAFT' }), 100), /Issue the invoice/);
    assert.match(paymentProblem(inv({ status: 'VOID' }), 100), /void/);
    assert.match(paymentProblem(inv({ status: 'PAID', balanceMinor: 0 }), 100), /fully paid/);
  });

  it('due date = issue date + payment terms; stock only in whole units', () => {
    assert.equal(dueDateFor(new Date('2026-10-01T09:00:00Z'), 15).toISOString(), '2026-10-16T09:00:00.000Z');
    assert.equal(wholeUnits(3000), 3);
    assert.equal(wholeUnits(2500), null);
    const lines = [{ itemId: 'a', qtyMilli: 2000, description: 'Laptop' }, { itemId: 'a', qtyMilli: 1000, description: 'Laptop' }, { itemId: 'b', qtyMilli: 1500, description: 'Consulting' }, { itemId: null, qtyMilli: 1000, description: 'Custom' }];
    assert.deepEqual([...stockNeeds(lines, new Set(['a'])).need], [['a', 3]], 'same item on two lines is added up; un-stocked items ignored');
    assert.match(stockNeeds(lines, new Set(['a', 'b'])).error, /whole units/);
  });
});
