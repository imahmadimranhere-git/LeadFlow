// PHASE 20 — quote arithmetic (pure). Integer minor units, BigInt multiplication, exact discount sharing.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotals, effectiveDiscountBp, toMinor, toQtyMilli, LIMITS, QuoteMathError } from '../src/services/erp/quoteMath.js';

const line = (o = {}) => ({ qtyMilli: 1000, unitPriceMinor: 10000, discountBp: 0, taxBp: 0, ...o });

describe('Quote math', () => {
  it('basic line: quantity × price − discount + tax, no floating-point errors (3 × 0.10 = 0.30 exactly)', () => {
    const t = calculateTotals([line({ qtyMilli: 2000, unitPriceMinor: 6000000, discountBp: 1000, taxBp: 1700 })]);
    assert.deepEqual(
      { s: t.subtotalMinor, d: t.discountMinor, tax: t.taxMinor, total: t.totalMinor },
      { s: 12000000, d: 1200000, tax: 1836000, total: 12636000 } // 120,000 − 12,000 + 17 % of 108,000
    );
    assert.equal(calculateTotals([line({ qtyMilli: 3000, unitPriceMinor: 10 })]).totalMinor, 30);
    assert.equal(calculateTotals([line({ qtyMilli: 1500, unitPriceMinor: 333 })]).totalMinor, 500, '499.5 → 500 (half away from zero)');
  });

  it('order discount is shared across lines so that everything adds up to the last paisa', () => {
    const t = calculateTotals([line({ unitPriceMinor: 333 }), line({ unitPriceMinor: 333 }), line({ unitPriceMinor: 334 })], { type: 'AMOUNT', valueMinor: 100 });
    assert.equal(t.lines.reduce((a, l) => a + l.orderDiscountMinor, 0), 100);
    assert.equal(t.totalMinor, 900);
    assert.equal(t.lines.reduce((a, l) => a + l.totalMinor, 0), t.totalMinor, 'line totals = quote total');
  });

  it('tax is charged AFTER the order discount (per line rate); percent discount; effective discount', () => {
    const t = calculateTotals([line({ unitPriceMinor: 100000, taxBp: 1700 }), line({ unitPriceMinor: 100000, taxBp: 0 })], { type: 'PERCENT', valueBp: 1000 });
    assert.equal(t.orderDiscountMinor, 20000);
    assert.equal(t.taxMinor, 15300, '17 % of (1000 − 100)');
    assert.equal(t.totalMinor, 200000 - 20000 + 15300);
    assert.equal(effectiveDiscountBp(t), 1000);
    const both = calculateTotals([line({ unitPriceMinor: 100000, discountBp: 500 })], { type: 'PERCENT', valueBp: 1000 });
    assert.equal(effectiveDiscountBp(both), 1450, '5 % then 10 % = 14.5 % in total (not 15 %)');
  });

  it('refuses impossible input: zero/negative/fractional numbers, >100 %, discount larger than the quote, too many lines', () => {
    const bad = [
      [[line({ qtyMilli: 0 })]],
      [[line({ qtyMilli: -1000 })]],
      [[line({ unitPriceMinor: -1 })]],
      [[line({ unitPriceMinor: 10.5 })]],
      [[line({ discountBp: 10001 })]],
      [[line({ taxBp: -5 })]],
      [[line()], { type: 'AMOUNT', valueMinor: 10001 }],
      [[line()], { type: 'PERCENT', valueBp: 20000 }],
      [[line()], { type: 'MAGIC' }],
      [[]],
      [Array.from({ length: LIMITS.lines + 1 }, () => line())],
    ];
    for (const [lines, d] of bad) assert.throws(() => calculateTotals(lines, d), QuoteMathError, JSON.stringify(d || lines[0]));
  });

  it('big property prices stay exact (BigInt); totals that would lose precision are refused', () => {
    const plot = calculateTotals([line({ qtyMilli: 3000, unitPriceMinor: 50_000_000_000 /* PKR 50 crore */, taxBp: 300 })]);
    assert.equal(plot.subtotalMinor, 150_000_000_000);
    assert.equal(plot.totalMinor, 154_500_000_000);
    assert.throws(() => calculateTotals([line({ qtyMilli: LIMITS.qtyMilliMax, unitPriceMinor: LIMITS.unitPriceMax })]), /too large/);
  });

  it('input parsing: "1250.50" → 125050, "1.5" → 1500; refuses "-1", "1e5", "1.234" money, "NaN", " "', () => {
    assert.equal(toMinor('1250.50'), 125050);
    assert.equal(toMinor('0.1'), 10);
    assert.equal(toMinor(17.5), 1750);
    assert.equal(toQtyMilli('1.5'), 1500);
    assert.equal(toQtyMilli(2), 2000);
    for (const v of ['-1', '1e5', '1.234', 'NaN', ' ', '', null, '12,5', '0x10']) assert.equal(toMinor(v), null, String(v));
    for (const v of ['0', '-2', '1.2345', 'abc', '99999999']) assert.equal(toQtyMilli(v), null, String(v));
  });
});
