// PHASE 23 — pure accounting reports: month ranges, cash-basis P&L, receivables aging, breakdowns, closed periods.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { monthsBetween, buildPnl, agingBucket, buildAging, groupTotals, isLocked, monthOf } from '../src/services/erp/accountingReports.js';

describe('Accounting reports', () => {
  it('month ranges: across a year end; reversed / invalid / longer than 24 months refused', () => {
    assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
    assert.deepEqual(monthsBetween('2026-05', '2026-05'), ['2026-05']);
    for (const [a, b] of [['2026-03', '2026-01'], ['2026-13', '2026-14'], ['2024-01', '2026-02'], ['26-01', '2026-01'], ['2026-1', '2026-02']]) assert.equal(monthsBetween(a, b), null, `${a}..${b}`);
    assert.equal(monthOf('2026-10-09'), '2026-10');
  });

  it('P&L: per currency (PKR and USD never added together), loss months negative, margin', () => {
    const r = buildPnl(['2026-01', '2026-02'],
      [{ month: '2026-01', currency: 'PKR', amountMinor: 10000000 }, { month: '2026-02', currency: 'PKR', amountMinor: 2000000 }, { month: '2026-02', currency: 'USD', amountMinor: 50000 }],
      [{ month: '2026-01', currency: 'PKR', amountMinor: 3000000 }, { month: '2026-02', currency: 'PKR', amountMinor: 4000000 }]);
    assert.deepEqual(Object.keys(r.currencies).sort(), ['PKR', 'USD']);
    assert.deepEqual(r.currencies.PKR.rows[1], { month: '2026-02', income: 2000000, expenses: 4000000, profit: -2000000 });
    assert.deepEqual(r.currencies.PKR.totals, { income: 12000000, expenses: 7000000, profit: 5000000 });
    assert.equal(r.currencies.PKR.marginPercent, 41.7);
    assert.equal(r.currencies.USD.totals.profit, 50000);
    assert.equal(buildPnl(['2026-01'], [], [{ month: '2026-01', currency: 'PKR', amountMinor: 5 }]).currencies.PKR.marginPercent, null, 'no income → no margin');
  });

  it('aging buckets: not due yet = current; exact day boundaries 30 / 60 / 90', () => {
    const now = new Date('2026-10-31T12:00:00Z');
    const ago = (d) => new Date(now.getTime() - d * 86400000);
    assert.equal(agingBucket(new Date('2026-11-05'), now), 'current');
    assert.equal(agingBucket(ago(0), now), 'current');
    assert.equal(agingBucket(ago(1), now), '1-30');
    assert.equal(agingBucket(ago(30), now), '1-30');
    assert.equal(agingBucket(ago(31), now), '31-60');
    assert.equal(agingBucket(ago(61), now), '61-90');
    assert.equal(agingBucket(ago(91), now), '90+');
    assert.equal(agingBucket(null, now), 'current');
  });

  it('aging per client and currency; fully paid invoices ignored; biggest debtor first', () => {
    const now = new Date('2026-10-31T12:00:00Z');
    const r = buildAging([
      { clientId: 'a', clientName: 'Ali', currency: 'PKR', balanceMinor: 1000, dueDate: new Date('2026-10-01') },
      { clientId: 'a', clientName: 'Ali', currency: 'PKR', balanceMinor: 500, dueDate: new Date('2026-12-01') },
      { clientId: 'b', clientName: 'Sara', currency: 'PKR', balanceMinor: 5000, dueDate: new Date('2026-06-01') },
      { clientId: 'b', clientName: 'Sara', currency: 'PKR', balanceMinor: 0, dueDate: new Date('2026-01-01') },
    ], now);
    assert.equal(r.currencies.PKR.total, 6500);
    assert.deepEqual(r.currencies.PKR.buckets, { current: 500, '1-30': 1000, '31-60': 0, '61-90': 0, '90+': 5000 });
    assert.equal(r.currencies.PKR.clients[0].name, 'Sara');
  });

  it('breakdowns with % share; closed periods include the lock day itself', () => {
    const g = groupTotals([{ key: 'Rent', name: 'Rent', currency: 'PKR', amountMinor: 300 }, { key: 'Ads', name: 'Ads', currency: 'PKR', amountMinor: 100 }, { key: 'Rent', name: 'Rent', currency: 'PKR', amountMinor: 200 }]);
    assert.deepEqual(g.PKR.items.map((i) => [i.name, i.amountMinor, i.percent]), [['Rent', 500, 83.3], ['Ads', 100, 16.7]]);
    assert.equal(isLocked('2026-09-30', '2026-09-30'), true);
    assert.equal(isLocked('2026-10-01', '2026-09-30'), false);
    assert.equal(isLocked('2026-01-01', null), false);
  });
});
