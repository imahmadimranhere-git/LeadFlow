// PHASE 22 — pure project/time rules: durations, billing quantities, timer cap, invoice lines, progress.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatMinutes, minutesToQtyMilli, timerMinutes, timeToInvoiceLines, projectProgress } from '../src/services/erp/projectRules.js';

describe('Project & time rules', () => {
  it('durations: 1:30 = 90 = 1.5h = 1h 30m; nonsense, 0 and more than 24 h refused', () => {
    for (const v of ['1:30', '90', '1.5h', '1h 30m', '1h30m', '90m', '90 min', 90]) assert.equal(parseDuration(v), 90, String(v));
    assert.equal(parseDuration('0:20'), 20);
    assert.equal(parseDuration('24:00'), 1440);
    for (const v of ['0', '', 'abc', '25:00', '1441', '-30', '1:75', '1e3', '2h 90x', null]) assert.equal(parseDuration(v), null, String(v));
    assert.equal(formatMinutes(95), '1h 35m');
  });

  it('billing quantity: minutes → hours with 3 decimals (20 min = 0.333 h, 90 min = 1.5 h)', () => {
    assert.equal(minutesToQtyMilli(90), 1500);
    assert.equal(minutesToQtyMilli(20), 333);
    assert.equal(minutesToQtyMilli(1), 17);
  });

  it('timer: rounds up to whole minutes, at least 1, capped at 12 h (a forgotten timer can\'t bill 3 days)', () => {
    const now = new Date('2026-10-09T12:00:00Z');
    assert.deepEqual(timerMinutes(new Date('2026-10-09T11:58:01Z'), now), { minutes: 2, capped: false });
    assert.deepEqual(timerMinutes(new Date('2026-10-09T12:00:00Z'), now), { minutes: 1, capped: false });
    assert.deepEqual(timerMinutes(new Date('2026-10-06T12:00:00Z'), now), { minutes: 720, capped: true });
  });

  it('invoice lines: one per task and rate, hours as quantity, "General work" without task', () => {
    const lines = timeToInvoiceLines(
      [
        { taskId: 't1', minutes: 60, rateMinor: 500000 },
        { taskId: 't1', minutes: 30, rateMinor: 500000 },
        { taskId: 't1', minutes: 45, rateMinor: 600000 },
        { taskId: null, minutes: 20, rateMinor: 500000 },
      ],
      new Map([['t1', 'Homepage design']]),
      'Ali Bakery website'
    );
    assert.equal(lines.length, 3);
    assert.deepEqual(lines[0], { description: 'Ali Bakery website: Homepage design (1h 30m)', unit: 'hour', qtyMilli: 1500, unitPriceMinor: 500000, discountBp: 0 });
    assert.equal(lines[1].unitPriceMinor, 600000, 'a different rate is a separate line');
    assert.equal(lines[2].description, 'Ali Bakery website: General work (0h 20m)');
  });

  it('progress: done %, overdue tasks, budget used / over budget', () => {
    const now = new Date('2026-10-09');
    const p = projectProgress({ tasks: [{ status: 'DONE' }, { status: 'TODO', dueDate: new Date('2026-10-01') }, { status: 'IN_PROGRESS' }, { status: 'DONE' }], milestones: [{ status: 'DONE' }, { status: 'OPEN' }], minutesLogged: 660, budgetMinutes: 600, now });
    assert.equal(p.percentDone, 50);
    assert.equal(p.overdueTasks, 1);
    assert.equal(p.milestonesDone, 1);
    assert.equal(p.budgetUsedPercent, 110);
    assert.equal(p.overBudget, true);
    assert.equal(projectProgress({}).percentDone, 0);
  });
});
