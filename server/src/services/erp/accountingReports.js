// Accounting-lite reports — PURE (unit-tested). Everything is per currency (we never add PKR to USD).
//
//   Profit & loss is on a CASH basis: income = payments actually received (not voided), expenses = recorded
//   expenses (not voided), both by the month they happened in the company's time zone.
//   Aging: how long OPEN invoice balances have been due — "current" (not due yet), 1–30, 31–60, 61–90, 90+ days.
const DAY = 24 * 3600 * 1000;

export const monthOf = (dayKey) => String(dayKey).slice(0, 7); // "2026-10-09" → "2026-10"

/** "2026-01".."2026-03" → ["2026-01","2026-02","2026-03"]; null if invalid / reversed / too long. */
export function monthsBetween(from, to, max = 24) {
  const re = /^(\d{4})-(0[1-9]|1[0-2])$/;
  const a = re.exec(from);
  const b = re.exec(to);
  if (!a || !b) return null;
  let y = Number(a[1]);
  let m = Number(a[2]);
  const end = Number(b[1]) * 12 + Number(b[2]);
  if (y * 12 + m > end) return null;
  const out = [];
  while (y * 12 + m <= end) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (out.length > max) return null;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * @param income   [{ month, currency, amountMinor }]
 * @param expenses [{ month, currency, amountMinor }]
 * → { currencies: { PKR: { rows: [{ month, income, expenses, profit }], totals } } }
 */
export function buildPnl(months, income, expenses) {
  const cur = new Set([...income, ...expenses].map((x) => x.currency));
  const out = {};
  for (const c of cur) {
    const rows = months.map((month) => {
      const inc = income.filter((x) => x.currency === c && x.month === month).reduce((s, x) => s + x.amountMinor, 0);
      const exp = expenses.filter((x) => x.currency === c && x.month === month).reduce((s, x) => s + x.amountMinor, 0);
      return { month, income: inc, expenses: exp, profit: inc - exp };
    });
    const totals = rows.reduce((t, r) => ({ income: t.income + r.income, expenses: t.expenses + r.expenses, profit: t.profit + r.profit }), { income: 0, expenses: 0, profit: 0 });
    out[c] = { rows, totals, marginPercent: totals.income ? Math.round((totals.profit / totals.income) * 1000) / 10 : null };
  }
  return { months, currencies: out };
}

export const AGING_BUCKETS = ['current', '1-30', '31-60', '61-90', '90+'];

export function agingBucket(dueDate, now = new Date()) {
  if (!dueDate) return 'current';
  const days = Math.floor((now.getTime() - new Date(dueDate).getTime()) / DAY);
  if (days <= 0) return 'current';
  if (days <= 30) return '1-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

/**
 * @param invoices [{ clientId, clientName, currency, balanceMinor, dueDate }] (open ones)
 * → { currencies: { PKR: { buckets: {current:..}, total, clients: [{ clientId, name, buckets, total }] } } }
 */
export function buildAging(invoices, now = new Date()) {
  const empty = () => Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0]));
  const out = {};
  for (const inv of invoices) {
    if (!(inv.balanceMinor > 0)) continue;
    const c = (out[inv.currency] ||= { buckets: empty(), total: 0, clients: new Map() });
    const b = agingBucket(inv.dueDate, now);
    c.buckets[b] += inv.balanceMinor;
    c.total += inv.balanceMinor;
    const key = String(inv.clientId);
    if (!c.clients.has(key)) c.clients.set(key, { clientId: key, name: inv.clientName || '—', buckets: empty(), total: 0 });
    const cl = c.clients.get(key);
    cl.buckets[b] += inv.balanceMinor;
    cl.total += inv.balanceMinor;
  }
  for (const c of Object.values(out)) c.clients = [...c.clients.values()].sort((a, b) => b.total - a.total);
  return { buckets: AGING_BUCKETS, currencies: out };
}

/** [{ key, name, currency, amountMinor }] → per currency, biggest first, with % share. */
export function groupTotals(rows) {
  const out = {};
  for (const r of rows) {
    const c = (out[r.currency] ||= { total: 0, items: new Map() });
    c.total += r.amountMinor;
    const it = c.items.get(r.key) || { key: r.key, name: r.name, amountMinor: 0 };
    it.amountMinor += r.amountMinor;
    c.items.set(r.key, it);
  }
  for (const c of Object.values(out)) {
    c.items = [...c.items.values()].sort((a, b) => b.amountMinor - a.amountMinor).map((i) => ({ ...i, percent: c.total ? Math.round((i.amountMinor / c.total) * 1000) / 10 : 0 }));
  }
  return out;
}

/** Is this day inside a closed (locked) period? */
export const isLocked = (dayKey, lockedUntil) => Boolean(lockedUntil && dayKey && String(dayKey) <= String(lockedUntil));
