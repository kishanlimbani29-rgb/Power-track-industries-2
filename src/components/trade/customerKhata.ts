import { CustomerAdvance, PartyInfo, PaymentEntry, Sale, SalesReturn } from '../../types/inventory';
import { moneyPosition, round2 } from '../../utils/tradeMath';

export interface KhataEntry {
  id: string;
  kind: 'bill' | 'payment' | 'refund' | 'return' | 'advance' | 'advance_use';
  timestamp: string;
  date: string;
  detail: string;
  subDetail?: string;
  billAmount: number | null;
  paidAmount: number | null;
  infoAmount?: number;
  balanceAfter: number;
  sale?: Sale;
  paymentEntry?: PaymentEntry;
  advance?: CustomerAdvance;
  salesReturn?: SalesReturn;
}

export interface CustomerAccount {
  key: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  gstin: string;
  party: PartyInfo;
  sales: Sale[];
  unpaidBills: Sale[];
  unpaidBillsCount: number;
  oldestUnpaidDays: number;
  anyPartPaid: boolean;
  advances: CustomerAdvance[];
  advanceRemaining: number;
  invoicesDue: number;
  totalBought: number;
  totalPaid: number;
  totalReturns: number;
  balanceDue: number;
  billsCount: number;
  lastSaleAt: string;
  khataRows: KhataEntry[]; // newest first
}

const normalizePhoneKey = (phone?: string): string => {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.length < 6) return '';
  return `phone:${digits.length >= 10 ? digits.slice(-10) : digits}`;
};

const normalizeNameKey = (name?: string): string => {
  const clean = (name || '').trim().toLowerCase();
  return clean ? `name:${clean}` : '';
};

export const getCustomerKey = (party?: Partial<PartyInfo>): string => {
  const pKey = normalizePhoneKey(party?.phone);
  if (pKey) return pKey;
  const nKey = normalizeNameKey(party?.name);
  return nKey || 'unknown';
};

export const extractCity = (address?: string): string => {
  const raw = (address || '').trim();
  if (!raw) return '';
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  // If formatted like "Street, City" or "Area, City - Pincode", prefer last meaningful segment
  return parts[parts.length - 1];
};

const itemsSummary = (lines: { itemName: string; quantity: number }[]): string => {
  if (!lines || lines.length === 0) return '';
  const shown = lines.slice(0, 2).map((l) => `${l.itemName} × ${l.quantity}`);
  const extra = lines.length > 2 ? ` +${lines.length - 2}` : '';
  return shown.join(', ') + extra;
};

const toMs = (iso?: string): number => {
  if (!iso) return 0;
  const t = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

const fmtCompactRupee = (n: number): string => {
  const v = round2(n);
  return (
    '₹' +
    v.toLocaleString('en-IN', {
      minimumFractionDigits: v % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })
  );
};

export function buildCustomerAccounts(
  sales: Sale[],
  salesReturns: SalesReturn[],
  customerAdvances: CustomerAdvance[] = []
): CustomerAccount[] {
  // Sales arrive newest-first from Firestore. Group active + cancelled sales cleanly.
  const returnsBySaleId = new Map<string, SalesReturn[]>();
  salesReturns.forEach((r) => {
    const arr = returnsBySaleId.get(r.saleId) || [];
    arr.push(r);
    returnsBySaleId.set(r.saleId, arr);
  });

  const groups = new Map<
    string,
    {
      key: string;
      name: string;
      phone: string;
      address: string;
      gstin: string;
      sales: Sale[];
      advances: CustomerAdvance[];
    }
  >();

  // First pass: register customer keys from sales (newest first keeps latest contact details)
  for (const s of sales) {
    const key = getCustomerKey(s.customer);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        name: (s.customer?.name || 'Customer').trim(),
        phone: (s.customer?.phone || '').trim(),
        address: (s.customer?.address || '').trim(),
        gstin: (s.customer?.gstin || '').trim(),
        sales: [s],
        advances: [],
      });
    } else {
      existing.sales.push(s);
      if (!existing.name && s.customer?.name) existing.name = s.customer.name.trim();
      if (!existing.phone && s.customer?.phone) existing.phone = s.customer.phone.trim();
      if (!existing.address && s.customer?.address) existing.address = s.customer.address.trim();
      if (!existing.gstin && s.customer?.gstin) existing.gstin = s.customer.gstin.trim();
    }
  }

  // Second pass: attach customer advances (create group if party has only advances)
  for (const adv of customerAdvances) {
    const key = adv.partyKey || getCustomerKey({ name: adv.partyName, phone: adv.partyPhone });
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        name: (adv.partyName || 'Customer').trim(),
        phone: (adv.partyPhone || '').trim(),
        address: '',
        gstin: '',
        sales: [],
        advances: [adv],
      });
    } else {
      existing.advances.push(adv);
      if (!existing.phone && adv.partyPhone) existing.phone = adv.partyPhone.trim();
    }
  }

  const nowMs = Date.now();
  const result: CustomerAccount[] = [];

  for (const g of groups.values()) {
    const liveSales = g.sales.filter((s) => s.status !== 'cancelled');
    let totalBought = 0;
    let totalPaid = 0;
    let totalReturns = 0;
    let rawInvoicesDue = 0;

    const unpaidBills: Sale[] = [];
    let anyPartPaid = false;
    let oldestUnpaidMs = Infinity;

    const rawEvents: Omit<KhataEntry, 'balanceAfter'>[] = [];

    for (const s of liveSales) {
      const pos = moneyPosition(s);
      const advancePaidOnSale = round2(
        (s.payments || [])
          .filter((p) => p.mode === 'advance')
          .reduce((a, p) => a + (p.amount || 0), 0)
      );
      totalBought = round2(totalBought + (s.grandTotal || 0));
      totalPaid = round2(totalPaid + (pos.netPaid - advancePaidOnSale));
      totalReturns = round2(totalReturns + (s.returnsTotal || 0));
      rawInvoicesDue = round2(rawInvoicesDue + pos.balance);

      if (pos.balance > 0.009) {
        unpaidBills.push(s);
        if (pos.status === 'partly_paid') anyPartPaid = true;
        const createdMs = toMs(s.createdAt);
        if (createdMs > 0 && createdMs < oldestUnpaidMs) {
          oldestUnpaidMs = createdMs;
        }
      }

      const prodText = itemsSummary(s.lines);
      rawEvents.push({
        id: `bill-${s.id}`,
        kind: 'bill',
        timestamp: s.createdAt,
        date: s.createdAt,
        detail: prodText ? `${s.invoiceNumber} · ${prodText}` : s.invoiceNumber,
        billAmount: round2(s.grandTotal || 0),
        paidAmount: null,
        sale: s,
      });

      for (const p of s.payments || []) {
        if (p.mode === 'advance') {
          rawEvents.push({
            id: `pay-${s.id}-${p.id}`,
            kind: 'advance_use',
            timestamp: p.recordedAt || (p.date && p.date.length === 10 ? `${p.date}T12:00:00` : s.createdAt),
            date: p.date || s.createdAt,
            detail: `Advance used on ${s.invoiceNumber}`,
            subDetail: p.note && p.note !== 'Advance adjusted' ? p.note : undefined,
            billAmount: null,
            paidAmount: null,
            infoAmount: round2(p.amount || 0),
            sale: s,
            paymentEntry: p,
          });
        } else {
          rawEvents.push({
            id: `pay-${s.id}-${p.id}`,
            kind: 'payment',
            timestamp: p.date && p.date.length === 10 ? `${p.date}T12:00:00` : p.date || s.createdAt,
            date: p.date || s.createdAt,
            detail: `Payment · ${(p.mode || 'cash').toUpperCase()}`,
            subDetail: `${s.invoiceNumber}${p.note ? ` · ${p.note}` : ''}`,
            billAmount: null,
            paidAmount: round2(p.amount || 0),
            sale: s,
            paymentEntry: p,
          });
        }
      }

      for (const rf of s.refunds || []) {
        rawEvents.push({
          id: `ref-${s.id}-${rf.id}`,
          kind: 'refund',
          timestamp: rf.date && rf.date.length === 10 ? `${rf.date}T12:00:00` : rf.date || s.createdAt,
          date: rf.date || s.createdAt,
          detail: `Refund · ${(rf.mode || 'cash').toUpperCase()}`,
          subDetail: `${s.invoiceNumber}${rf.note ? ` · ${rf.note}` : ''}`,
          billAmount: round2(rf.amount || 0),
          paidAmount: null,
          sale: s,
        });
      }

      const linkedReturns = returnsBySaleId.get(s.id) || [];
      for (const ret of linkedReturns) {
        rawEvents.push({
          id: `ret-${ret.id}`,
          kind: 'return',
          timestamp: ret.createdAt || (ret.date ? `${ret.date}T12:00:00` : s.createdAt),
          date: ret.date || ret.createdAt,
          detail: `Return ${ret.returnNumber}`,
          subDetail: `${ret.invoiceNumber} · ${ret.reason || 'Credit note'}`,
          billAmount: null,
          paidAmount: round2(ret.total || 0),
          sale: s,
          salesReturn: ret,
        });
      }
    }

    let advanceRemaining = 0;
    for (const adv of g.advances) {
      totalPaid = round2(totalPaid + (adv.amount || 0));
      advanceRemaining = round2(advanceRemaining + Math.max(0, adv.remaining || 0));
      const remPart =
        (adv.remaining || 0) > 0.009
          ? `${fmtCompactRupee(adv.remaining)} left`
          : 'Fully used';
      rawEvents.push({
        id: `adv-${adv.id}`,
        kind: 'advance',
        timestamp: adv.date && adv.date.length === 10 ? `${adv.date}T12:00:00` : adv.createdAt,
        date: adv.date || adv.createdAt,
        detail: `Advance received ${(adv.mode || 'cash').toUpperCase()}`,
        subDetail: [remPart, adv.note].filter(Boolean).join(' · '),
        billAmount: null,
        paidAmount: round2(adv.amount || 0),
        advance: adv,
      });
    }

    // Compute running balance chronologically oldest -> newest, then reverse to newest-first
    const kindOrder: Record<KhataEntry['kind'], number> = {
      bill: 0,
      return: 1,
      advance: 2,
      advance_use: 3,
      payment: 4,
      refund: 5,
    };
    const chronological = [...rawEvents].sort((a, b) => {
      const diff = toMs(a.timestamp) - toMs(b.timestamp);
      if (diff !== 0) return diff;
      return kindOrder[a.kind] - kindOrder[b.kind];
    });

    let running = 0;
    const withBalance: KhataEntry[] = chronological.map((ev) => {
      if (ev.billAmount) running = round2(running + ev.billAmount);
      if (ev.paidAmount) running = round2(running - ev.paidAmount);
      return { ...ev, balanceAfter: running };
    });

    const khataRows = withBalance.reverse();
    const rawNetDue = round2(rawInvoicesDue - advanceRemaining);
    const invoicesDue = Math.abs(rawInvoicesDue) <= 0.009 ? 0 : rawInvoicesDue;
    const balanceDue = Math.abs(rawNetDue) <= 0.009 ? 0 : rawNetDue;
    const oldestUnpaidDays =
      oldestUnpaidMs < Infinity
        ? Math.max(0, Math.floor((nowMs - oldestUnpaidMs) / 86400000))
        : 0;

    const latestFromSales = g.sales.reduce(
      (best, s) => (toMs(s.createdAt) > toMs(best) ? s.createdAt : best),
      g.sales[0]?.createdAt || ''
    );
    const latestFromAdv = g.advances.reduce(
      (best, a) => (toMs(a.createdAt) > toMs(best) ? a.createdAt : best),
      g.advances[0]?.createdAt || ''
    );
    const lastSaleAt = toMs(latestFromAdv) > toMs(latestFromSales) ? latestFromAdv : latestFromSales;

    result.push({
      key: g.key,
      name: g.name || 'Customer',
      phone: g.phone,
      address: g.address,
      city: extractCity(g.address),
      gstin: g.gstin,
      party: {
        name: g.name || 'Customer',
        phone: g.phone || undefined,
        address: g.address || undefined,
        gstin: g.gstin || undefined,
      },
      sales: g.sales,
      unpaidBills: [...unpaidBills].sort((a, b) => toMs(a.createdAt) - toMs(b.createdAt)),
      unpaidBillsCount: unpaidBills.length,
      oldestUnpaidDays,
      anyPartPaid,
      advances: g.advances,
      advanceRemaining,
      invoicesDue,
      totalBought,
      totalPaid,
      totalReturns,
      balanceDue,
      billsCount: liveSales.length,
      lastSaleAt,
      khataRows,
    });
  }

  return result;
}
