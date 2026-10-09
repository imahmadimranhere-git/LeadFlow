// PHASE 24 — pure analytics maths: confidence intervals and the "no best-source claim without enough data" rule.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wilson, funnelRow, compareSources, costPer, weekStart, weeksBetween, rangeDays, MIN_LEADS } from '../src/services/analytics/analyticsMath.js';

const row = (key, leads, contacted, replied, converted) => funnelRow(key, { leads, qualified: 0, contacted, replied, converted });

describe('Analytics maths', () => {
  it('Wilson 95% interval matches the textbook values; 0 of n is not "0% for sure"', () => {
    assert.deepEqual(wilson(10, 100), { rate: 10, low: 5.5, high: 17.4, k: 10, n: 100 });
    const zero = wilson(0, 5);
    assert.equal(zero.rate, 0);
    assert.equal(zero.high, 43.4, 'with 5 leads, the true rate could still be up to ~43%');
    assert.equal(wilson(0, 0), null);
  });

  it('a clear winner only when the ranges do not overlap', () => {
    const r = compareSources([row('CSV', 40, 20, 10, 8), row('GOOGLE_WEB', 40, 20, 2, 0)], 'conversionRate');
    assert.equal(r.status, 'CLEAR');
    assert.equal(r.best, 'CSV');
  });

  it('50% vs 10% reply rate on only 20 contacted each is NOT called a win (could be chance)', () => {
    const r = compareSources([row('CSV', 40, 20, 10, 8), row('GOOGLE_WEB', 40, 20, 2, 0)], 'replyRate');
    assert.equal(r.status, 'NO_CLEAR_WINNER');
    assert.equal(r.best, null);
    assert.match(r.message, /could still be chance/);
  });

  it(`sources with fewer than ${MIN_LEADS} leads are not compared at all`, () => {
    const r = compareSources([row('CSV', 29, 29, 29, 29), row('INSTAGRAM', 500, 100, 5, 1)], 'conversionRate');
    assert.equal(r.status, 'NOT_ENOUGH_DATA');
    assert.equal(r.best, null);
    assert.equal(compareSources([], 'replyRate').status, 'NOT_ENOUGH_DATA');
  });

  it('funnel rates use the right denominators (reply rate = of the people contacted)', () => {
    const f = row('X', 50, 10, 5, 2);
    assert.equal(f.contactRate.rate, 20);
    assert.equal(f.replyRate.rate, 50);
    assert.equal(f.conversionRate.rate, 4);
    assert.equal(f.enoughData, true);
    assert.equal(f.enoughReplyData, true);
    assert.equal(row('Y', 10, 0, 0, 0).replyRate, null, 'nobody contacted → no reply rate');
  });

  it('cost per qualified lead, week buckets (Monday), and safe date ranges', () => {
    assert.equal(costPer(12.5, 5), 2.5);
    assert.equal(costPer(3, 0), null);
    assert.equal(weekStart('2026-10-09'), '2026-10-05');
    assert.equal(weekStart('2026-10-05'), '2026-10-05');
    assert.deepEqual(weeksBetween('2026-09-30', '2026-10-09'), ['2026-09-28', '2026-10-05']);
    assert.equal(rangeDays('2026-01-01', '2026-01-31'), 31);
    for (const [a, b] of [['2026-02-01', '2026-02-31'], ['2026-03-01', '2026-01-01'], ['2024-01-01', '2026-01-01'], ['2026-1-1', '2026-01-02']]) assert.equal(rangeDays(a, b), null, `${a}..${b}`);
  });
});
