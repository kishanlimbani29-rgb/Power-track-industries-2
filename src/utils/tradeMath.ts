// Shared money / tax helpers for Sales & Purchase.

export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export const GST_RATES = [0, 5, 12, 18, 28];

/** ₹1,23,456.50 (Indian grouping). */
export function formatINR(n: number, withDecimals = true): string {
  const v = Number(n) || 0;
  return (
    '₹' +
    v.toLocaleString('en-IN', {
      minimumFractionDigits: withDecimals ? 2 : 0,
      maximumFractionDigits: withDecimals ? 2 : 0,
    })
  );
}

/** Short form for summary cards: ₹6.92 L, ₹1.2 Cr, ₹48,600 */
export function formatINRShort(n: number): string {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${round2(v / 1e7)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${round2(v / 1e5)} L`;
  return formatINR(v, false);
}

export interface LineCalcInput {
  quantity: number;
  rate: number;
  discountPct?: number;
  gstPct?: number;
}

export function calcLine({ quantity, rate, discountPct = 0 }: LineCalcInput) {
  const gross = (Number(quantity) || 0) * (Number(rate) || 0);
  const taxable = round2(gross * (1 - (Number(discountPct) || 0) / 100));
  const gstAmount = 0; // GST removed from app
  return { taxable, gstAmount, amount: taxable };
}

export function sumLines<T extends { taxable: number; gstAmount?: number; amount: number }>(lines: T[]) {
  const subtotal = round2(lines.reduce((a, l) => a + (l.taxable ?? l.amount), 0));
  const gstTotal = 0;
  return { subtotal, gstTotal, grandTotal: subtotal };
}

/**
 * Money position of an invoice / order after returns, payments and refunds.
 * balance > 0 → still to be paid; balance < 0 → refund due to the other party.
 */
export function moneyPosition(doc: {
  grandTotal: number;
  returnsTotal?: number;
  amountPaid?: number;
  refundedTotal?: number;
}) {
  const netTotal = round2((doc.grandTotal || 0) - (doc.returnsTotal || 0));
  const netPaid = round2((doc.amountPaid || 0) - (doc.refundedTotal || 0));
  const balance = round2(netTotal - netPaid);
  let status: 'unpaid' | 'partly_paid' | 'paid' | 'refund_due';
  if (balance < -0.009) status = 'refund_due';
  else if (balance <= 0.009) status = 'paid';
  else if (netPaid > 0.009) status = 'partly_paid';
  else status = 'unpaid';
  return { netTotal, netPaid, balance, status };
}

/** Weighted average cost after receiving stock. */
export function weightedAverageCost(oldQty: number, oldCost: number, addQty: number, addRate: number) {
  const oq = Math.max(0, Number(oldQty) || 0);
  const total = oq + (Number(addQty) || 0);
  if (total <= 0) return round2(addRate);
  if (oq <= 0) return round2(addRate);
  return round2((oq * (Number(oldCost) || 0) + addQty * addRate) / total);
}

export const todayISODate = () => {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
};

export const newId = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const docNumber = (prefix: string, seq: number, at = new Date()) =>
  `${prefix}-${at.getFullYear()}-${String(seq).padStart(4, '0')}`;
