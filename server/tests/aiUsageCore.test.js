// PHASE 26 — pure maths of the AI usage & cost dashboard (no database).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { usd6, dayKeysBetween, fillDays, withShares, failureRate, budgetStatus, projectMonthEnd, daysInMonth, quotaRow, budgetAlertToSend, avg } from '../src/services/ai/usageMath.js';

describe('Daily series', () => {
  it('every day is present (zero days filled), month/year edges and leap day handled', () => {
    assert.deepEqual(dayKeysBetween('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    assert.deepEqual(dayKeysBetween('2028-02-28', '2028-03-01'), ['2028-02-28', '2028-02-29', '2028-03-01']);
    assert.deepEqual(dayKeysBetween('2026-05-02', '2026-05-01'), [], 'from after to → nothing');
    assert.equal(dayKeysBetween('2020-01-01', '2030-01-01').length, 400, 'safety cap');
    const s = fillDays([{ day: '2026-10-02', requests: 3, failed: 1, tokens: 900, costUsd: 0.0123456789 }], '2026-10-01', '2026-10-03');
    assert.deepEqual(s.map((d) => d.requests), [0, 3, 0]);
    assert.equal(s[1].costUsd, 0.012346, 'rounded to 6 decimals');
    assert.deepEqual(s[0], { day: '2026-10-01', requests: 0, failed: 0, tokens: 0, costUsd: 0 });
  });
});

describe('Breakdowns', () => {
  it('shares add up; zero totals give 0% (not NaN); failure rate null with no requests', () => {
    const r = withShares([{ key: 'A', requests: 3, costUsd: 0.75 }, { key: 'B', requests: 1, costUsd: 0.25 }]);
    assert.deepEqual(r.map((x) => [x.costShare, x.requestShare]), [[75, 75], [25, 25]]);
    assert.deepEqual(withShares([{ key: 'A', requests: 0, costUsd: 0 }]).map((x) => x.costShare), [0]);
    assert.equal(failureRate(1, 3), 33.3);
    assert.equal(failureRate(0, 0), null);
    assert.equal(avg(10, 4), 2.5);
    assert.equal(avg(5, 0), null);
    assert.equal(usd6(0.1 + 0.2), 0.3, 'float noise removed');
  });
});

describe('Monthly budget', () => {
  it('levels: NONE without a budget, OK, WARN at the alert line, EXCEEDED at 100%', () => {
    assert.equal(budgetStatus({ spentUsd: 5, budgetUsd: null }).level, 'NONE');
    assert.equal(budgetStatus({ spentUsd: 5, budgetUsd: 0 }).level, 'NONE', '0 = no budget');
    assert.deepEqual(budgetStatus({ spentUsd: 7.9, budgetUsd: 10, alertPercent: 80 }), { level: 'OK', percent: 79, remainingUsd: 2.1 });
    assert.equal(budgetStatus({ spentUsd: 8, budgetUsd: 10, alertPercent: 80 }).level, 'WARN');
    assert.equal(budgetStatus({ spentUsd: 10, budgetUsd: 10 }).level, 'EXCEEDED');
    assert.equal(budgetStatus({ spentUsd: 12, budgetUsd: 10 }).remainingUsd, 0, 'never negative');
  });

  it('alerts only when a line is crossed UPWARDS (once for WARN, once for EXCEEDED)', () => {
    assert.equal(budgetAlertToSend('OK', 'WARN'), 'WARN');
    assert.equal(budgetAlertToSend('OK', 'EXCEEDED'), 'EXCEEDED', 'a big request can jump both lines → the bigger alert');
    assert.equal(budgetAlertToSend('WARN', 'EXCEEDED'), 'EXCEEDED');
    assert.equal(budgetAlertToSend('WARN', 'WARN'), null, 'still above the line → no repeat alert');
    assert.equal(budgetAlertToSend('EXCEEDED', 'EXCEEDED'), null);
    assert.equal(budgetAlertToSend('NONE', 'NONE'), null);
    assert.equal(budgetAlertToSend('OK', 'OK'), null);
  });

  it('month-end projection: straight line, but only after 3 days of data (honest)', () => {
    assert.equal(projectMonthEnd({ spentUsd: 3, dayOfMonth: 10, daysInMonth: 30 }), 9);
    assert.equal(projectMonthEnd({ spentUsd: 3, dayOfMonth: 2, daysInMonth: 30 }), null);
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(daysInMonth(2028, 2), 29);
    assert.equal(daysInMonth(2026, 12), 31);
  });
});

describe('Plan quota', () => {
  it('used / limit / remaining / percent; unlimited (-1) has no percent; never above 100%', () => {
    assert.deepEqual(quotaRow(250, 1000), { used: 250, limit: 1000, remaining: 750, percent: 25, unlimited: false });
    assert.deepEqual(quotaRow(5, -1), { used: 5, limit: null, remaining: null, percent: null, unlimited: true });
    assert.equal(quotaRow(1200, 1000).percent, 100);
    assert.equal(quotaRow(1200, 1000).remaining, 0);
    assert.equal(quotaRow(0, 0).percent, 100, 'a 0 limit means nothing is allowed');
  });
});
