// Quote / invoice arithmetic — PURE and the ONLY place totals are calculated (spec 23: "never trust
// client totals"). The browser may show a preview, but the server recalculates everything on save.
//
// Money is stored as INTEGER minor units (paisa / cents) — never floating point (0.1 + 0.2 ≠ 0.3).
// Quantities are stored as integer thousandths (1.5 hours = 1500), rates as basis points (17% = 1700).
// Multiplication uses BigInt so huge property prices × quantities can't silently lose precision.
//
// Order of calculation (documented so accountants can check it):
//   line subtotal  = quantity × unit price
//   line discount  = line subtotal × line discount %
//   line net       = subtotal − line discount
//   order discount = (Σ line net) × % — or a fixed amount (never more than Σ line net),
//                    shared across lines in proportion to their net (largest-remainder, so it adds up exactly)
//   line tax       = (line net − its share of the order discount) × tax %
//   total          = Σ line net − order discount + Σ line tax
// Rounding: half away from zero, per line.

export const LIMITS = Object.freeze({
  lines: 100,
  qtyMilliMax: 1_000_000_000, // 1,000,000.000 units
  unitPriceMax: 100_000_000_000_000, // 1 trillion in major units (e.g. PKR) — far above any real price
  rateBpMax: 10_000, // 100 %
  totalMax: Number.MAX_SAFE_INTEGER,
});

export class QuoteMathError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
  }
}

const B = (n) => BigInt(n);
/** a × b / d, rounded half away from zero (all BigInt, a,b ≥ 0). */
function mulDivRound(a, b, d) {
  const num = a * b;
  const q = num / d;
  const r = num % d;
  return r * 2n >= d ? q + 1n : q;
}
const toSafe = (big, field) => {
  if (big > B(LIMITS.totalMax)) throw new QuoteMathError('The amount is too large.', field);
  return Number(big);
};
const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** "1.5" / 1.5 → 1500 (thousandths). Rejects negatives, NaN and more than 3 decimals. */
export function toQtyMilli(q) {
  const s = typeof q === 'number' ? String(q) : String(q ?? '').trim();
  if (!/^\d{1,7}(\.\d{1,3})?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  const milli = Number(int) * 1000 + Number(frac.padEnd(3, '0'));
  return milli > 0 && milli <= LIMITS.qtyMilliMax ? milli : null;
}
export const fromQtyMilli = (m) => m / 1000;

/** Major units (e.g. "1250.50") → minor (125050). Rejects negatives and > 2 decimals. */
export function toMinor(v) {
  const s = typeof v === 'number' ? String(v) : String(v ?? '').trim();
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(s)) return null;
  const [int, frac = ''] = s.split('.');
  const minor = B(int) * 100n + B(frac.padEnd(2, '0'));
  return minor <= B(LIMITS.unitPriceMax) ? Number(minor) : null;
}

/**
 * @param lines [{ qtyMilli, unitPriceMinor, discountBp, taxBp }]
 * @param orderDiscount { type: 'PERCENT'|'AMOUNT'|'NONE', valueBp?, valueMinor? }
 * → { lines: [{ subtotalMinor, discountMinor, netMinor, orderDiscountMinor, taxMinor, totalMinor }], subtotalMinor,
 *     lineDiscountMinor, orderDiscountMinor, discountMinor, taxMinor, totalMinor }
 */
export function calculateTotals(lines, orderDiscount = { type: 'NONE' }) {
  if (!Array.isArray(lines) || lines.length === 0) throw new QuoteMathError('Add at least one line.', 'lines');
  if (lines.length > LIMITS.lines) throw new QuoteMathError(`At most ${LIMITS.lines} lines.`, 'lines');

  const calc = lines.map((l, i) => {
    if (!intIn(l.qtyMilli, 1, LIMITS.qtyMilliMax)) throw new QuoteMathError('Quantity must be more than 0.', `lines.${i}.quantity`);
    if (!intIn(l.unitPriceMinor, 0, LIMITS.unitPriceMax)) throw new QuoteMathError('Price must be 0 or more.', `lines.${i}.unitPrice`);
    if (!intIn(l.discountBp ?? 0, 0, LIMITS.rateBpMax)) throw new QuoteMathError('Discount must be between 0 and 100 %.', `lines.${i}.discount`);
    if (!intIn(l.taxBp ?? 0, 0, LIMITS.rateBpMax)) throw new QuoteMathError('Tax must be between 0 and 100 %.', `lines.${i}.tax`);
    const subtotal = mulDivRound(B(l.qtyMilli), B(l.unitPriceMinor), 1000n);
    const discount = mulDivRound(subtotal, B(l.discountBp ?? 0), 10_000n);
    return { subtotal, discount, net: subtotal - discount, taxBp: B(l.taxBp ?? 0) };
  });

  const sumNet = calc.reduce((a, l) => a + l.net, 0n);
  let orderDisc = 0n;
  const od = orderDiscount || { type: 'NONE' };
  if (od.type === 'PERCENT') {
    if (!intIn(od.valueBp, 0, LIMITS.rateBpMax)) throw new QuoteMathError('Discount must be between 0 and 100 %.', 'discount');
    orderDisc = mulDivRound(sumNet, B(od.valueBp), 10_000n);
  } else if (od.type === 'AMOUNT') {
    if (!intIn(od.valueMinor, 0, LIMITS.unitPriceMax)) throw new QuoteMathError('Discount must be 0 or more.', 'discount');
    if (B(od.valueMinor) > sumNet) throw new QuoteMathError('The discount is larger than the quote.', 'discount');
    orderDisc = B(od.valueMinor);
  } else if (od.type !== 'NONE') {
    throw new QuoteMathError('Unknown discount type.', 'discount');
  }

  // share the order discount across lines (largest remainder → shares add up exactly)
  const shares = calc.map(() => 0n);
  if (orderDisc > 0n && sumNet > 0n) {
    const rema = calc.map((l, i) => {
      const exact = l.net * orderDisc;
      shares[i] = exact / sumNet;
      return { i, rem: exact % sumNet };
    });
    let left = orderDisc - shares.reduce((a, s) => a + s, 0n);
    rema.sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
    for (const { i } of rema) {
      if (left <= 0n) break;
      shares[i] += 1n;
      left -= 1n;
    }
  }

  const out = calc.map((l, i) => {
    const taxable = l.net - shares[i];
    const tax = mulDivRound(taxable, l.taxBp, 10_000n);
    return { subtotal: l.subtotal, discount: l.discount, net: l.net, share: shares[i], tax, total: taxable + tax };
  });
  const sum = (k) => out.reduce((a, l) => a + l[k], 0n);
  const lineDiscount = sum('discount');
  const tax = sum('tax');
  return {
    lines: out.map((l, i) => ({
      subtotalMinor: toSafe(l.subtotal, `lines.${i}`),
      discountMinor: toSafe(l.discount, `lines.${i}`),
      netMinor: toSafe(l.net, `lines.${i}`),
      orderDiscountMinor: toSafe(l.share, `lines.${i}`),
      taxMinor: toSafe(l.tax, `lines.${i}`),
      totalMinor: toSafe(l.total, `lines.${i}`),
    })),
    subtotalMinor: toSafe(sum('subtotal'), 'total'),
    lineDiscountMinor: toSafe(lineDiscount, 'total'),
    orderDiscountMinor: toSafe(orderDisc, 'total'),
    discountMinor: toSafe(lineDiscount + orderDisc, 'total'),
    taxMinor: toSafe(tax, 'total'),
    totalMinor: toSafe(sumNet - orderDisc + tax, 'total'),
  };
}

/** Effective discount of the whole quote in basis points (for the "max discount for sales" rule). */
export function effectiveDiscountBp(totals) {
  if (!totals.subtotalMinor) return 0;
  return Number((B(totals.discountMinor) * 10_000n) / B(totals.subtotalMinor));
}
