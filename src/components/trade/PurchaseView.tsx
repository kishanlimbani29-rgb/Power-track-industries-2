import React, { useMemo, useState } from 'react';
import {
  ShoppingBag,
  Plus,
  Search,
  Wallet,
  Undo2,
  Truck,
  XCircle,
  Trash2,
  FileSpreadsheet,
  Eye,
  AlertTriangle,
  PackageCheck,
  Pencil,
  ChevronRight,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';
import { useTrade, PurchaseLineInput } from '../../context/TradeContext';
import { PartyInfo, Purchase, PurchaseReturn } from '../../types/inventory';
import { getItemQuantity } from '../../utils/itemResolver';
import { calcLine, formatINR, formatINRShort, GST_RATES, moneyPosition, round2, sumLines, todayISODate, weightedAverageCost } from '../../utils/tradeMath';
import { purchaseOrderPdf, purchaseReturnPdf } from '../../utils/tradeDocuments';
import { downloadExcelFile } from '../../utils/fileDownload';
import { formatShortDate } from '../../utils/numberFormat';
import {
  Chip,
  ConfirmDialog,
  ErrorBox,
  Field,
  InfoBox,
  inputCls,
  qtyInputCls,
  LoadMore,
  PartyFields,
  PaymentSheet,
  PdfButtons,
  PrimaryButton,
  Sheet,
  SmallButton,
  Totals,
  Tone,
  useToast,
  fmtDate,
  fmtDateTime,
} from './TradeUI';

const STATUS: Record<Purchase['status'], { label: string; tone: Tone }> = {
  ordered: { label: 'Ordered', tone: 'indigo' },
  partly_received: { label: 'Partly received', tone: 'sky' },
  received: { label: 'Received', tone: 'emerald' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};
const PAY: Record<string, { label: string; tone: Tone }> = {
  unpaid: { label: 'Unpaid', tone: 'rose' },
  partly_paid: { label: 'Partly paid', tone: 'amber' },
  paid: { label: 'Paid', tone: 'emerald' },
  refund_due: { label: 'Refund due', tone: 'amber' },
};
type PurchaseTab = 'orders' | 'suppliers';
type Filter = 'all' | 'open' | 'late' | 'unpaid' | 'received' | 'cancelled' | 'returns';

type PurchaseFeedEntry =
  | { type: 'po'; data: Purchase; timestamp: string; dayKey: string }
  | { type: 'return'; data: PurchaseReturn; timestamp: string; dayKey: string };

interface SupplierSummary {
  key: string;
  name: string;
  phone: string;
  poCount: number;
  totalBought: number;
  balanceToPay: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toLocalDayKey = (iso?: string): string => {
  if (!iso) return todayISODate();
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return todayISODate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const shiftDayKey = (daysOffset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDayHeading = (dayKey: string, todayKey: string, yesterdayKey: string): string => {
  if (dayKey === todayKey) return 'Today';
  if (dayKey === yesterdayKey) return 'Yesterday';
  const d = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return `${WEEKDAYS[d.getDay()]}, ${formatShortDate(d, true)}`;
};

const isPoLate = (p: Purchase, todayKey: string): boolean =>
  (p.status === 'ordered' || p.status === 'partly_received') &&
  Boolean(p.expectedDate) &&
  toLocalDayKey(p.expectedDate) < todayKey;

const normPhoneDigits = (phone?: string): string => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 7) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
};

export const PurchaseView: React.FC = () => {
  const { permissions } = useAuth();
  const { showActionToast } = useInventory();
  const trade = useTrade();
  const { purchases, purchaseReturns } = trade;
  const toast = useToast();
  const showPrices = permissions.canViewCostPerUnit;

  const [activeTab, setActiveTab] = useState<PurchaseTab>('orders');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [newOpen, setNewOpen] = useState<null | 'blank' | 'lowstock'>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [returnDetail, setReturnDetail] = useState<PurchaseReturn | null>(null);
  const [receiveFor, setReceiveFor] = useState<Purchase | null>(null);
  const [payFor, setPayFor] = useState<{ po: Purchase; kind: 'payment' | 'refund' } | null>(null);
  const [returnFor, setReturnFor] = useState<Purchase | null>(null);
  const [cancelFor, setCancelFor] = useState<Purchase | null>(null);
  const [editFor, setEditFor] = useState<Purchase | null>(null);
  const [deleteFor, setDeleteFor] = useState<Purchase | null>(null);
  const [editReturnFor, setEditReturnFor] = useState<{ r: PurchaseReturn; po: Purchase } | null>(null);
  const [deleteReturnFor, setDeleteReturnFor] = useState<PurchaseReturn | null>(null);

  const detail = purchases.find((p) => p.id === detailId) || null;
  const todayKey = todayISODate();
  const yesterdayKey = shiftDayKey(-1);
  const thirtyDaysAgoKey = shiftDayKey(-29);

  const stats = useMemo(() => {
    const live = purchases.filter((p) => p.status !== 'cancelled');
    const open = live.filter((p) => p.status === 'ordered' || p.status === 'partly_received');
    const pendingLines = open.reduce(
      (a, p) => a + p.lines.filter((l) => ((p.receivedQty || {})[l.itemId] || 0) < l.quantity).length,
      0
    );
    const total30d = round2(
      live
        .filter((p) => toLocalDayKey(p.createdAt) >= thirtyDaysAgoKey)
        .reduce((a, p) => a + (p.grandTotal || 0), 0)
    );
    return {
      open: open.length,
      total30d,
      pendingLines,
      payable: round2(live.reduce((a, p) => a + Math.max(0, moneyPosition(p).balance), 0)),
    };
  }, [purchases, thirtyDaysAgoKey]);

  const q = search.trim().toLowerCase();

  const lateCount = useMemo(
    () => purchases.filter((p) => isPoLate(p, todayKey)).length,
    [purchases, todayKey]
  );

  const filtered = useMemo(
    () =>
      purchases.filter((p) => {
        if (filter === 'open' && !(p.status === 'ordered' || p.status === 'partly_received')) return false;
        if (filter === 'late' && !isPoLate(p, todayKey)) return false;
        if (filter === 'unpaid' && (p.status === 'cancelled' || moneyPosition(p).balance <= 0.009)) return false;
        if (filter === 'received' && p.status !== 'received') return false;
        if (filter === 'cancelled' && p.status !== 'cancelled') return false;
        if (!q) return true;
        return (
          p.poNumber.toLowerCase().includes(q) ||
          p.supplier.name.toLowerCase().includes(q) ||
          (p.supplier.phone || '').toLowerCase().includes(q) ||
          p.lines.some((l) => l.itemName.toLowerCase().includes(q))
        );
      }),
    [purchases, filter, q, todayKey]
  );

  const filteredReturns = useMemo(
    () =>
      purchaseReturns.filter(
        (r) =>
          !q ||
          r.returnNumber.toLowerCase().includes(q) ||
          r.poNumber.toLowerCase().includes(q) ||
          r.supplierName.toLowerCase().includes(q) ||
          r.lines.some((l) => l.itemName.toLowerCase().includes(q))
      ),
    [purchaseReturns, q]
  );

  const feedItems = useMemo<PurchaseFeedEntry[]>(() => {
    if (filter === 'returns') {
      return [...filteredReturns]
        .map((r) => {
          const ts = r.createdAt || r.date || '';
          return {
            type: 'return' as const,
            data: r,
            timestamp: ts,
            dayKey: toLocalDayKey(r.createdAt || r.date),
          };
        })
        .sort((a, b) => (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0));
    }
    if (filter === 'all') {
      const poEntries: PurchaseFeedEntry[] = filtered.map((p) => ({
        type: 'po',
        data: p,
        timestamp: p.createdAt,
        dayKey: toLocalDayKey(p.createdAt),
      }));
      const returnEntries: PurchaseFeedEntry[] = filteredReturns.map((r) => {
        const ts = r.createdAt || r.date || '';
        return {
          type: 'return',
          data: r,
          timestamp: ts,
          dayKey: toLocalDayKey(r.createdAt || r.date),
        };
      });
      return [...poEntries, ...returnEntries].sort(
        (a, b) => (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0)
      );
    }
    return [...filtered]
      .map((p) => ({
        type: 'po' as const,
        data: p,
        timestamp: p.createdAt,
        dayKey: toLocalDayKey(p.createdAt),
      }))
      .sort((a, b) => (new Date(b.timestamp).getTime() || 0) - (new Date(a.timestamp).getTime() || 0));
  }, [filter, filtered, filteredReturns]);

  // Day-grouped feed for the Daily Purchase Register
  const dayGroups = useMemo(() => {
    const groups: {
      dayKey: string;
      label: string;
      entries: PurchaseFeedEntry[];
      poCount: number;
      returnCount: number;
      dayTotal: number;
    }[] = [];
    const byKey = new Map<string, (typeof groups)[number]>();

    for (const entry of feedItems) {
      let grp = byKey.get(entry.dayKey);
      if (!grp) {
        grp = {
          dayKey: entry.dayKey,
          label: formatDayHeading(entry.dayKey, todayKey, yesterdayKey),
          entries: [],
          poCount: 0,
          returnCount: 0,
          dayTotal: 0,
        };
        byKey.set(entry.dayKey, grp);
        groups.push(grp);
      }
      grp.entries.push(entry);
      if (entry.type === 'po') {
        if (entry.data.status !== 'cancelled') {
          grp.poCount += 1;
          grp.dayTotal = round2(grp.dayTotal + (entry.data.grandTotal || 0));
        }
      } else {
        grp.returnCount += 1;
      }
    }
    return groups;
  }, [feedItems, todayKey, yesterdayKey]);

  // Suppliers derived from non-cancelled purchases grouped by supplier phone (or name if no phone)
  const supplierList = useMemo<SupplierSummary[]>(() => {
    const map = new Map<string, SupplierSummary>();
    const nameToKey = new Map<string, string>();

    // First pass for purchases with phone so name-only matches can link when clean
    for (const p of purchases) {
      if (p.status === 'cancelled') continue;
      const phoneDigits = normPhoneDigits(p.supplier.phone);
      const normName = p.supplier.name.trim().toLowerCase();
      if (phoneDigits && normName && !nameToKey.has(normName)) {
        nameToKey.set(normName, `phone:${phoneDigits}`);
      }
    }

    for (const p of purchases) {
      if (p.status === 'cancelled') continue;
      const phoneDigits = normPhoneDigits(p.supplier.phone);
      const normName = p.supplier.name.trim().toLowerCase();
      const key = phoneDigits
        ? `phone:${phoneDigits}`
        : nameToKey.get(normName) || `name:${normName || 'unknown'}`;

      const pos = moneyPosition(p);
      let entry = map.get(key);
      if (!entry) {
        entry = {
          key,
          name: p.supplier.name.trim() || 'Supplier',
          phone: p.supplier.phone?.trim() || '',
          poCount: 0,
          totalBought: 0,
          balanceToPay: 0,
        };
        map.set(key, entry);
      } else {
        if (!entry.phone && p.supplier.phone?.trim()) {
          entry.phone = p.supplier.phone.trim();
        }
      }
      entry.poCount += 1;
      entry.totalBought = round2(entry.totalBought + (p.grandTotal || 0));
      entry.balanceToPay = round2(entry.balanceToPay + Math.max(0, pos.balance));
    }

    return Array.from(map.values()).sort(
      (a, b) =>
        b.balanceToPay - a.balanceToPay ||
        b.totalBought - a.totalBought ||
        a.name.localeCompare(b.name)
    );
  }, [purchases]);

  const exportExcel = () => {
    downloadExcelFile(
      filtered.map((p) => {
        const pos = moneyPosition(p);
        const row: Record<string, any> = {
          'PO No.': p.poNumber,
          Date: fmtDate(p.createdAt),
          Supplier: p.supplier.name,
          Phone: p.supplier.phone || '',
          Items: p.lines.map((l) => `${l.itemName} ${(p.receivedQty || {})[l.itemId] || 0}/${l.quantity}`).join(', '),
          Status: STATUS[p.status].label,
        };
        if (showPrices) {
          row['Total (₹)'] = p.grandTotal;
          row['Returns (₹)'] = p.returnsTotal || 0;
          row['Paid (₹)'] = pos.netPaid;
          row['Payable (₹)'] = pos.balance;
          row.Payment = PAY[pos.status].label;
        }
        return row;
      }),
      `powertrack_purchases_${todayISODate()}`,
      'Purchases'
    );
  };

  const actions = (p: Purchase, inDetail = false) => {
    const pos = moneyPosition(p);
    const open = p.status === 'ordered' || p.status === 'partly_received';
    return (
      <div className="flex flex-wrap gap-2">
        {!inDetail && (
          <SmallButton icon={Eye} onClick={() => setDetailId(p.id)}>
            Details
          </SmallButton>
        )}
        {permissions.canReceivePurchase && open && (
          <SmallButton tone="sky" icon={Truck} onClick={() => setReceiveFor(p)}>
            Receive
          </SmallButton>
        )}
        <PdfButtons build={() => purchaseOrderPdf(p, showPrices)} fileName={`${p.poNumber}.pdf`} title={`Purchase order ${p.poNumber}`} onError={(m) => toast.show('PDF failed', m, true)} />
        {showPrices && permissions.canRecordPurchasePayments && p.status !== 'cancelled' && pos.balance > 0.009 && (
          <SmallButton tone="emerald" icon={Wallet} onClick={() => setPayFor({ po: p, kind: 'payment' })}>
            Payment
          </SmallButton>
        )}
        {showPrices && permissions.canRecordPurchasePayments && p.status !== 'cancelled' && pos.balance < -0.009 && (
          <SmallButton tone="amber" icon={Wallet} onClick={() => setPayFor({ po: p, kind: 'refund' })}>
            Refund Received
          </SmallButton>
        )}
        {permissions.canEditPurchase && p.status === 'ordered' && (p.receipts || []).length === 0 && (
          <SmallButton tone="indigo" icon={Pencil} onClick={() => setEditFor(p)}>
            Edit
          </SmallButton>
        )}
        {permissions.canCreatePurchaseReturn && (p.status === 'partly_received' || p.status === 'received') && p.returnStatus !== 'fully_returned' && (
          <SmallButton tone="amber" icon={Undo2} onClick={() => setReturnFor(p)}>
            Return
          </SmallButton>
        )}
        {permissions.canCreatePurchase && p.status === 'ordered' && (p.receipts || []).length === 0 && !(p.amountPaid > 0) && (
          <SmallButton tone="rose" icon={XCircle} onClick={() => setCancelFor(p)}>
            Cancel
          </SmallButton>
        )}
        {permissions.canDeletePurchase && (
          <SmallButton tone="rose" icon={Trash2} onClick={() => setDeleteFor(p)}>
            Delete
          </SmallButton>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3.5 max-w-[900px] mx-auto pb-36 overflow-x-clip">
      {/* 1. HEADER: One compact row */}
      <div className="flex items-center justify-end sm:justify-between gap-2">
        <div className="hidden sm:flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-sky-50 border border-sky-200 text-sky-600 flex items-center justify-center">
            <ShoppingBag className="w-4 h-4" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight truncate">
            Purchase
          </h1>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {permissions.canExportExcel && (
            <button
              type="button"
              onClick={exportExcel}
              title="Export Excel"
              aria-label="Export Excel"
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer shadow-2xs"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Excel</span>
            </button>
          )}
          {permissions.canCreatePurchase && (
            <button
              type="button"
              onClick={() => setNewOpen('lowstock')}
              title="From Low Stock"
              aria-label="From Low Stock"
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold transition cursor-pointer shadow-2xs"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span className="hidden sm:inline">From Low Stock</span>
              <span className="sm:hidden">Low Stock</span>
            </button>
          )}
        </div>
      </div>

      {trade.tradeError && <ErrorBox message={trade.tradeError} />}

      {/* 2. TABS under header: Orders (N) | Suppliers (N) */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 rounded-xl">
        <button
          type="button"
          onClick={() => setActiveTab('orders')}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-bold transition cursor-pointer ${
            activeTab === 'orders'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Orders ({feedItems.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('suppliers')}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-bold transition cursor-pointer ${
            activeTab === 'suppliers'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Suppliers ({supplierList.length})
        </button>
      </div>

      {/* ====================================================================
          3. ORDERS TAB (DAILY PURCHASE REGISTER)
      ==================================================================== */}
      {activeTab === 'orders' && (
        <div className="space-y-3">
          {/* Search + Filter Chips */}
          <div className="bg-white rounded-2xl border border-slate-200 p-2.5 space-y-2 shadow-2xs">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search PO, supplier or item…"
                className="flex-1 min-w-0 bg-transparent text-sm outline-none text-slate-900 placeholder:text-slate-400"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {(
                [
                  ['all', purchaseReturns.length > 0 ? `All (${purchases.length + purchaseReturns.length})` : 'All'],
                  ['open', 'To receive'],
                  ['late', lateCount > 0 ? `Late (${lateCount})` : 'Late'],
                  ...(showPrices ? [['unpaid', 'Unpaid']] : []),
                  ['received', 'Received'],
                  ['cancelled', 'Cancelled'],
                  ...(permissions.canViewPurchaseOption
                    ? [['returns', purchaseReturns.length > 0 ? `Returns (${purchaseReturns.length})` : 'Returns']]
                    : []),
                ] as [Filter, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer shrink-0 transition ${
                    filter === id
                      ? id === 'late'
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-900 text-white'
                      : id === 'late' && lateCount > 0
                      ? 'bg-rose-50 text-rose-700 border border-rose-200'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Day-Grouped Compact PO & Return Rows */}
          {dayGroups.length === 0 ? (
            <Empty
              text={
                filter === 'returns'
                  ? 'No purchase returns yet.'
                  : purchases.length === 0 && purchaseReturns.length === 0
                  ? 'No purchase orders yet.'
                  : 'No orders or returns match this filter.'
              }
            />
          ) : (
            <div className="space-y-3">
              {dayGroups.map((grp) => {
                const rightParts: string[] = [];
                if (showPrices && grp.poCount > 0) {
                  rightParts.push(formatINR(grp.dayTotal, grp.dayTotal % 1 !== 0));
                }
                if (grp.poCount > 0) {
                  rightParts.push(`${grp.poCount} ${grp.poCount === 1 ? 'PO' : 'POs'}`);
                } else if (grp.returnCount > 0) {
                  rightParts.push(`${grp.returnCount} ${grp.returnCount === 1 ? 'return' : 'returns'}`);
                } else {
                  rightParts.push('Cancelled');
                }

                return (
                  <div
                    key={grp.dayKey}
                    className="bg-white rounded-2xl border border-slate-200 overflow-x-clip shadow-2xs"
                  >
                    {/* Sticky Day Header */}
                    <div
                      style={{ top: 'calc(4rem + env(safe-area-inset-top))' }}
                      className="sticky z-10 px-3.5 py-2 rounded-t-2xl bg-slate-100/95 backdrop-blur-xs border-b border-slate-200 flex items-center justify-between gap-2 text-[11px] font-bold text-slate-700"
                    >
                      <span className="truncate">{grp.label}</span>
                      <span className="shrink-0 font-mono tabular-nums text-slate-800">
                        {rightParts.join(' · ')}
                      </span>
                    </div>

                    <div className="divide-y divide-slate-100 rounded-b-2xl overflow-hidden">
                      {grp.entries.map((entry) => {
                        if (entry.type === 'return') {
                          const r = entry.data;
                          return (
                            <button
                              key={`ret-${r.id}`}
                              type="button"
                              onClick={() => setReturnDetail(r)}
                              className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
                            >
                              {/* Left */}
                              <div className="min-w-0 flex-1">
                                <div className="text-xs sm:text-sm font-mono font-bold text-slate-900 truncate">
                                  {r.returnNumber}
                                </div>
                                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                  {r.supplierName}
                                </div>
                              </div>

                              {/* Middle */}
                              <div className="w-[74px] sm:w-[110px] shrink-0 text-left">
                                <div className="text-[11px] font-medium text-slate-600 truncate">
                                  {r.lines.length} {r.lines.length === 1 ? 'item' : 'items'}
                                </div>
                                <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">
                                  {r.poNumber}
                                </div>
                              </div>

                              {/* Right */}
                              <div className="shrink-0 text-right flex flex-col items-end gap-0.5">
                                <div className="flex items-center justify-end gap-1.5">
                                  {showPrices && (
                                    <span className="text-xs sm:text-sm font-bold font-mono tabular-nums text-slate-900">
                                      – {formatINR(r.total, r.total % 1 !== 0)}
                                    </span>
                                  )}
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                    Return
                                  </span>
                                </div>
                              </div>
                            </button>
                          );
                        }

                        const p = entry.data;
                        const pos = moneyPosition(p);
                        const late = isPoLate(p, todayKey);

                        // Received bar calculations for partly_received
                        const totalLines = p.lines.length;
                        const completedLines = p.lines.filter(
                          (l) => ((p.receivedQty || {})[l.itemId] || 0) >= l.quantity - 1e-9
                        ).length;
                        const totalOrderedQty = p.lines.reduce((s, l) => s + (l.quantity || 0), 0);
                        const totalGotQty = p.lines.reduce(
                          (s, l) => s + Math.min(l.quantity || 0, (p.receivedQty || {})[l.itemId] || 0),
                          0
                        );
                        const pctBar =
                          totalLines > 0
                            ? completedLines > 0
                              ? Math.round((completedLines / totalLines) * 100)
                              : totalOrderedQty > 0
                              ? Math.round((totalGotQty / totalOrderedQty) * 100)
                              : 0
                            : 0;

                        let chipLabel = 'Ordered';
                        let chipClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
                        if (p.status === 'cancelled') {
                          chipLabel = 'Cancelled';
                          chipClass = 'bg-slate-100 text-slate-600 border-slate-200';
                        } else if (p.status === 'received') {
                          chipLabel = 'Received';
                          chipClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        } else if (late) {
                          chipLabel = 'Late';
                          chipClass = 'bg-rose-50 text-rose-700 border-rose-200';
                        } else if (p.status === 'partly_received') {
                          chipLabel = 'Part received';
                          chipClass = 'bg-sky-50 text-sky-700 border-sky-200';
                        }

                        const showPaySub =
                          showPrices && p.status !== 'cancelled' && pos.balance > 0.009;
                        const paySubText =
                          pos.status === 'partly_paid' ? 'Part paid' : 'Unpaid';

                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setDetailId(p.id)}
                            className="w-full text-left px-3 py-2.5 flex items-center gap-2 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
                          >
                            {/* Left: PO number bold + supplier name small grey */}
                            <div className="min-w-0 flex-1">
                              <div className="text-xs sm:text-sm font-mono font-bold text-slate-900 truncate">
                                {p.poNumber}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                {p.supplier.name}
                              </div>
                            </div>

                            {/* Middle: item count + received progress bar when partly received */}
                            <div className="w-[70px] sm:w-[96px] shrink-0 text-left">
                              <div className="text-[11px] font-medium text-slate-600 truncate">
                                {totalLines} {totalLines === 1 ? 'item' : 'items'}
                              </div>
                              {p.status === 'partly_received' && (
                                <div className="mt-1">
                                  <div className="text-[10px] font-mono font-semibold text-sky-700 leading-none">
                                    {completedLines}/{totalLines} recd
                                  </div>
                                  <div className="h-1 rounded-full bg-slate-100 mt-1 overflow-hidden">
                                    <div
                                      className="h-1 rounded-full bg-sky-500"
                                      style={{ width: `${Math.min(100, Math.max(8, pctBar))}%` }}
                                    />
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Right: Amount (if showPrices) + single status chip + Unpaid/Part paid under amount */}
                            <div className="shrink-0 text-right flex flex-col items-end gap-0.5">
                              <div className="flex items-center justify-end gap-1.5">
                                {showPrices && (
                                  <span className="text-xs sm:text-sm font-bold font-mono tabular-nums text-slate-900">
                                    {formatINR(p.grandTotal, p.grandTotal % 1 !== 0)}
                                  </span>
                                )}
                                <span
                                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${chipClass}`}
                                >
                                  {chipLabel}
                                </span>
                              </div>
                              {showPaySub && (
                                <span
                                  className={`text-[10px] font-bold leading-none ${
                                    pos.status === 'partly_paid' ? 'text-amber-600' : 'text-rose-600'
                                  }`}
                                >
                                  {paySubText}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {filter !== 'returns' && (
            <LoadMore show={trade.hasMorePurchases} onClick={trade.loadMorePurchases} />
          )}
        </div>
      )}

      {/* ====================================================================
          6. SUPPLIERS TAB
      ==================================================================== */}
      {activeTab === 'suppliers' && (
        <div className="space-y-2">
          {supplierList.length === 0 ? (
            <Empty text="No suppliers yet. Create a purchase order to see suppliers here." />
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-2xs">
              {supplierList.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => {
                    setFilter('all');
                    setSearch(s.name);
                    setActiveTab('orders');
                  }}
                  className="w-full text-left px-3.5 py-3 flex items-center justify-between gap-2.5 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-900 truncate">{s.name}</div>
                    <div className="text-[11px] text-slate-500 truncate mt-0.5">
                      {[s.phone, `${s.poCount} ${s.poCount === 1 ? 'PO' : 'POs'}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 text-right">
                    {showPrices && (
                      <div>
                        <div className="text-xs sm:text-sm font-bold font-mono tabular-nums text-slate-900">
                          {formatINR(s.totalBought, s.totalBought % 1 !== 0)}
                        </div>
                        {s.balanceToPay > 0.009 && (
                          <div className="text-[10px] font-bold font-mono tabular-nums text-rose-600 mt-0.5">
                            To pay {formatINR(s.balanceToPay, s.balanceToPay % 1 !== 0)}
                          </div>
                        )}
                      </div>
                    )}
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 5. FLOATING "+ New PO" BUTTON (bottom-right, above summary bar) */}
      {permissions.canCreatePurchase && (
        <button
          type="button"
          onClick={() => setNewOpen('blank')}
          style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
          className="fixed right-4 z-30 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg cursor-pointer active:scale-95 transition"
        >
          <Plus className="w-4 h-4" />
          <span>New PO</span>
        </button>
      )}

      {/* 4. SLIM SUMMARY BAR FIXED AT BOTTOM */}
      <div
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
        className="fixed bottom-0 left-0 right-0 lg:left-64 z-20 bg-slate-900 text-white border-t border-slate-800 px-3 py-2"
      >
        <div className="max-w-[900px] mx-auto text-center text-xs font-semibold tabular-nums truncate">
          {showPrices ? (
            <>
              <span className="text-slate-300">30 days </span>
              <span className="font-bold text-white">{formatINRShort(stats.total30d)}</span>
              <span className="text-slate-500"> · </span>
              <span className="text-slate-300">POs </span>
              <span className="font-bold text-white">{stats.open}</span>
              <span className="text-slate-500"> · </span>
              <span className="text-slate-300">To receive </span>
              <span className="font-bold text-sky-300">{stats.pendingLines}</span>
              <span className="text-slate-500"> · </span>
              <span className="text-slate-300">To pay </span>
              <span className="font-bold text-rose-400">{formatINRShort(stats.payable)}</span>
            </>
          ) : (
            <>
              <span className="text-slate-300">30 days</span>
              <span className="text-slate-500"> · </span>
              <span className="text-slate-300">POs </span>
              <span className="font-bold text-white">{stats.open}</span>
              <span className="text-slate-500"> · </span>
              <span className="text-slate-300">To receive </span>
              <span className="font-bold text-sky-300">{stats.pendingLines}</span>
            </>
          )}
        </div>
      </div>

      {/* Existing Modals / Sheets */}
      {newOpen && <NewPurchaseSheet lowStock={newOpen === 'lowstock'} onClose={() => setNewOpen(null)} onSaved={() => {}} />}
      {receiveFor && <ReceiveSheet po={receiveFor} showPrices={showPrices} onClose={() => setReceiveFor(null)} onSaved={() => {}} />}
      {returnFor && <PurchaseReturnSheet po={returnFor} showPrices={showPrices} onClose={() => setReturnFor(null)} onSaved={() => {}} />}
      {detail && <PurchaseDetailSheet po={detail} showPrices={showPrices} returns={purchaseReturns.filter((r) => r.purchaseId === detail.id)} actions={actions(detail, true)} onClose={() => setDetailId(null)} />}
      {returnDetail && (
        <ReturnDetailSheet
          r={returnDetail}
          po={purchases.find((p) => p.id === returnDetail.purchaseId)}
          showPrices={showPrices}
          canEdit={permissions.canEditPurchaseReturn}
          canDelete={permissions.canDeletePurchaseReturn}
          onClose={() => setReturnDetail(null)}
          onOpenParentPo={(poId) => {
            setReturnDetail(null);
            setDetailId(poId);
          }}
          onEdit={(ret) => {
            const parentPo = purchases.find((p) => p.id === ret.purchaseId);
            if (parentPo) {
              setReturnDetail(null);
              setEditReturnFor({ r: ret, po: parentPo });
            }
          }}
          onDelete={(ret) => {
            setReturnDetail(null);
            setDeleteReturnFor(ret);
          }}
          onError={(m) => toast.show('PDF failed', m, true)}
        />
      )}

      <PaymentSheet
        open={!!payFor}
        onClose={() => setPayFor(null)}
        title={payFor?.kind === 'refund' ? `Refund · ${payFor?.po.poNumber}` : `Payment · ${payFor?.po.poNumber || ''}`}
        subtitle={payFor?.po.supplier.name || ''}
        maxAmount={payFor ? Math.abs(moneyPosition(payFor.po).balance) : 0}
        maxLabel={payFor?.kind === 'refund' ? 'Refund due from supplier' : 'Payable'}
        submitLabel={payFor?.kind === 'refund' ? 'Save Refund Received' : 'Save Payment'}
        onSubmit={async (p) => {
          if (!payFor) return;
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            throw new Error('No internet connection — nothing was saved. Please try again.');
          }
          const target = payFor;
          setPayFor(null);
          showActionToast('Saving…', `${formatINR(p.amount)} on ${target.po.poNumber}`, 'saving');
          const promise =
            target.kind === 'refund'
              ? trade.recordPurchaseRefund(target.po.id, p)
              : trade.recordPurchasePayment(target.po.id, p);
          promise
            .then(() => {
              showActionToast(
                target.kind === 'refund' ? 'Refund saved' : 'Payment saved',
                `${formatINR(p.amount)} on ${target.po.poNumber}`,
                'success'
              );
            })
            .catch((e: any) => {
              showActionToast('Could not save', e?.message || 'Payment could not be saved.', 'error');
            });
        }}
      />

      {editFor && (
        <EditPurchaseSheet
          po={editFor}
          onClose={() => setEditFor(null)}
          onSaved={(p) => {
            setEditFor(null);
            if (detailId === p.id) setDetailId(p.id);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteFor}
        title={`Delete Purchase Order ${deleteFor?.poNumber || ''}?`}
        message="Permanently delete this purchase order. Any goods received under this order will be automatically deducted out of inventory."
        confirmLabel="Delete PO & Reverse Stock"
        withReason
        onCancel={() => setDeleteFor(null)}
        onConfirm={async (reason) => {
          if (!deleteFor) return;
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            throw new Error('No internet connection — nothing was saved. Please try again.');
          }
          const target = deleteFor;
          setDeleteFor(null);
          if (detailId === target.id) setDetailId(null);
          showActionToast('Saving…', `Deleting ${target.poNumber}`, 'saving');
          trade
            .deletePurchase(target.id, reason)
            .then(() => {
              showActionToast(`${target.poNumber} deleted`, 'Received stock reversed if applicable.', 'success');
            })
            .catch((e: any) => {
              showActionToast('Could not delete', e?.message || 'The purchase order could not be deleted.', 'error');
            });
        }}
      />

      <ConfirmDialog
        open={!!cancelFor}
        title={`Cancel ${cancelFor?.poNumber || ''}?`}
        message="Nothing has been received on this order. It will be marked Cancelled and stay in history."
        confirmLabel="Cancel Order"
        withReason
        onCancel={() => setCancelFor(null)}
        onConfirm={async (reason) => {
          if (!cancelFor) return;
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            throw new Error('No internet connection — nothing was saved. Please try again.');
          }
          const target = cancelFor;
          setCancelFor(null);
          showActionToast('Saving…', `Cancelling ${target.poNumber}`, 'saving');
          trade
            .cancelPurchase(target.id, reason)
            .then(() => {
              showActionToast(`${target.poNumber} cancelled`, undefined, 'success');
            })
            .catch((e: any) => {
              showActionToast('Could not cancel', e?.message || 'The order could not be cancelled.', 'error');
            });
        }}
      />
      {editReturnFor && (
        <EditPurchaseReturnSheet
          r={editReturnFor.r}
          po={editReturnFor.po}
          showPrices={showPrices}
          onClose={() => setEditReturnFor(null)}
          onSaved={() => {
            setEditReturnFor(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteReturnFor}
        title={`Delete Purchase Return ${deleteReturnFor?.returnNumber || ''}?`}
        message={`Permanently delete this purchase return (${formatINR(deleteReturnFor?.total || 0)}). Any stock that was deducted for return to supplier will be restored to inventory.`}
        confirmLabel="Delete Return & Restore Stock"
        withReason
        onCancel={() => setDeleteReturnFor(null)}
        onConfirm={async (reason) => {
          if (!deleteReturnFor) return;
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            throw new Error('No internet connection — nothing was saved. Please try again.');
          }
          const target = deleteReturnFor;
          setDeleteReturnFor(null);
          showActionToast('Saving…', `Deleting ${target.returnNumber}`, 'saving');
          trade
            .deletePurchaseReturn(target.id, reason)
            .then(() => {
              showActionToast(`${target.returnNumber} deleted`, 'Debit note cancelled and stock restored to inventory.', 'success');
            })
            .catch((e: any) => {
              showActionToast('Could not delete return', e?.message || 'The purchase return could not be deleted.', 'error');
            });
        }}
      />
      {toast.view}
    </div>
  );
};

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{text}</div>
);

const ReturnDetailSheet: React.FC<{
  r: PurchaseReturn;
  po?: Purchase;
  showPrices: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  onClose: () => void;
  onOpenParentPo: (poId: string) => void;
  onEdit?: (r: PurchaseReturn) => void;
  onDelete?: (r: PurchaseReturn) => void;
  onError: (m: string) => void;
}> = ({ r, po, showPrices, canEdit, canDelete, onClose, onOpenParentPo, onEdit, onDelete, onError }) => (
  <Sheet
    open
    onClose={onClose}
    tone="amber"
    icon={Undo2}
    title={`${r.returnNumber} · Purchase Return`}
    subtitle={`${r.supplierName} · Against ${r.poNumber}`}
  >
    <div className="flex gap-1.5 flex-wrap">
      <Chip tone="amber">Purchase Return</Chip>
      <Chip tone="slate">Against {r.poNumber}</Chip>
    </div>

    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
      {r.lines.map((l) => (
        <div key={l.itemId} className="p-3 text-xs flex justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-slate-800 truncate">{l.itemName}</div>
            <div className="text-slate-500">
              {l.quantity} {l.unit}
              {showPrices ? ` × ${formatINR(l.rate)}` : ''}
            </div>
          </div>
          {showPrices && <div className="font-bold text-slate-900 shrink-0">{formatINR(l.amount)}</div>}
        </div>
      ))}
    </div>

    {showPrices && <Totals rows={[{ label: 'Debit note total', value: formatINR(r.total), bold: true }]} />}

    <div className="text-xs text-slate-500">
      Reason: <b className="text-slate-800">{r.reason}</b> · {fmtDate(r.date || r.createdAt)} · by {r.createdByName || '—'}
    </div>

    <div className="flex flex-wrap gap-2 pt-1">
      {showPrices && (
        <PdfButtons build={() => purchaseReturnPdf(r, po)} fileName={`${r.returnNumber}.pdf`} title={`Debit note ${r.returnNumber}`} onError={onError} />
      )}
      {po && (
        <SmallButton icon={Eye} onClick={() => onOpenParentPo(po.id)}>
          View {po.poNumber}
        </SmallButton>
      )}
      {canEdit && onEdit && po && (
        <SmallButton tone="indigo" icon={Pencil} onClick={() => onEdit(r)}>
          Edit
        </SmallButton>
      )}
      {canDelete && onDelete && (
        <SmallButton tone="rose" icon={Trash2} onClick={() => onDelete(r)}>
          Delete
        </SmallButton>
      )}
    </div>
  </Sheet>
);

// ---------------------------------------------------------------------------
// New purchase order
// ---------------------------------------------------------------------------
interface Row {
  key: string;
  itemId: string;
  quantity: string;
  rate: string;
}
const rowKey = () => Math.random().toString(36).slice(2);

const NewPurchaseSheet: React.FC<{ lowStock: boolean; onClose: () => void; onSaved: (p: Purchase) => void }> = ({ lowStock, onClose }) => {
  const { items, showActionToast } = useInventory();
  const { suppliers, createPurchase } = useTrade();
  const [supplier, setSupplier] = useState<PartyInfo>({ name: '', phone: '', gstin: '', address: '' });
  const [rows, setRows] = useState<Row[]>(() => {
    if (lowStock) {
      const low = items.filter((i) => getItemQuantity(i) <= (i.minStock || 0) && i.type !== 'finished_good');
      if (low.length)
        return low.map((i) => ({
          key: rowKey(),
          itemId: i.id,
          quantity: String(Math.max(1, round2((i.minStock || 0) * 2 - getItemQuantity(i)))),
          rate: String(i.unitCost || ''),
        }));
    }
    return [{ key: rowKey(), itemId: '', quantity: '', rate: '' }];
  });
  const [expected, setExpected] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(lowStock && rows.every((r) => !r.itemId) ? 'No raw materials are at or below their minimum stock right now.' : null);

  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.type === 'raw_material' ? 0 : 1) - (b.type === 'raw_material' ? 0 : 1) || a.name.localeCompare(b.name)),
    [items]
  );
  const computed = rows.map((r) => ({ r, item: items.find((i) => i.id === r.itemId), ...calcLine({ quantity: Number(r.quantity) || 0, rate: Number(r.rate) || 0 }) }));
  const totals = sumLines(computed.filter((c) => c.item));
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async () => {
    setError(null);
    if (!supplier.name.trim()) return setError('Enter the supplier name.');
    const filled = rows.filter((r) => r.itemId);
    if (!filled.length) return setError('Add at least one item.');
    if (filled.some((r) => !(Number(r.quantity) > 0))) return setError('Enter a quantity on every item row.');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return setError('No internet connection — nothing was saved. Please try again.');
    }
    const lines: PurchaseLineInput[] = filled.map((r) => ({ itemId: r.itemId, quantity: Number(r.quantity), rate: Number(r.rate) || 0, gstPct: 0 }));
    setBusy(false);
    showActionToast('Saving…', `PO for ${supplier.name.trim()}`, 'saving');
    onClose();
    createPurchase({ supplier, lines, expectedDate: expected, notes })
      .then((po) => {
        showActionToast(`${po.poNumber} created`, `${po.lines.length} item(s) ordered from ${po.supplier.name}`, 'success');
      })
      .catch((e: any) => {
        showActionToast('Could not save PO', e?.message || 'The order could not be saved.', 'error');
      });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      tone="sky"
      icon={ShoppingBag}
      title={lowStock ? 'New PO from Low Stock' : 'New Purchase Order'}
      subtitle="Stock goes up only when goods are received"
      wide
      footer={
        <PrimaryButton tone="indigo" busy={busy} onClick={submit}>
          Create Purchase Order
        </PrimaryButton>
      }
    >
      <PartyFields label="Supplier" value={supplier} onChange={setSupplier} suggestions={suppliers} listId="po-suppliers" />
      <div className="flex justify-between items-center pt-1">
        <div className="text-xs font-bold text-slate-700">Items</div>
        <SmallButton tone="indigo" icon={Plus} onClick={() => setRows((rs) => [...rs, { key: rowKey(), itemId: '', quantity: '', rate: '' }])}>
          Add Item
        </SmallButton>
      </div>
      {computed.map(({ r, item, amount }) => {
        const usedElsewhere = new Set(rows.filter((x) => x.key !== r.key).map((x) => x.itemId));
        return (
          <div key={r.key} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex gap-2 items-start">
              <select
                className={inputCls}
                value={r.itemId}
                onChange={(e) => {
                  const it = items.find((i) => i.id === e.target.value);
                  update(r.key, { itemId: e.target.value, rate: it ? String(it.unitCost || '') : '' });
                }}
              >
                <option value="">— Choose item —</option>
                {sorted
                  .filter((it) => !usedElsewhere.has(it.id))
                  .map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} (stock {getItemQuantity(it)} {it.unit})
                    </option>
                  ))}
              </select>
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="p-2 text-slate-400 hover:text-rose-600 cursor-pointer" aria-label="Remove row">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            {item && (
              <div className="text-[11px] font-mono text-slate-500">
                In stock: <b>{getItemQuantity(item)} {item.unit}</b> · Min {item.minStock} {item.unit}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field label="Qty">
                <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
              </Field>
              <Field label="Rate ₹">
                <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={r.rate} onChange={(e) => update(r.key, { rate: e.target.value })} />
              </Field>
            </div>
            <div className="text-right text-[11px] font-bold text-slate-900">{formatINR(amount)}</div>
          </div>
        );
      })}
      <Totals
        rows={[
          { label: 'Subtotal', value: formatINR(totals.subtotal) },
          { label: 'Order total', value: formatINR(totals.grandTotal), bold: true },
        ]}
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Expected delivery">
          <input className={inputCls} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>
        <Field label="Notes">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <ErrorBox message={error} />
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Receive goods
// ---------------------------------------------------------------------------
const ReceiveSheet: React.FC<{ po: Purchase; showPrices: boolean; onClose: () => void; onSaved: () => void }> = ({ po, showPrices, onClose }) => {
  const { items, showActionToast } = useInventory();
  const { receivePurchase } = useTrade();
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const l of po.lines) {
      const left = round2(l.quantity - ((po.receivedQty || {})[l.itemId] || 0));
      if (left > 0) init[l.itemId] = String(left);
    }
    return init;
  });
  const [billNumber, setBillNumber] = useState('');
  const [billDate, setBillDate] = useState(todayISODate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = po.lines.map((l) => {
    const got = (po.receivedQty || {})[l.itemId] || 0;
    const left = round2(l.quantity - got);
    const n = Number(qty[l.itemId]) || 0;
    const item = items.find((i) => i.id === l.itemId);
    const stock = item ? getItemQuantity(item) : 0;
    return { l, got, left, n, item, stock, over: n > left + 1e-9 };
  });
  const anyOver = lines.some((x) => x.over);
  const allAfter = lines.every((x) => x.got + x.n >= x.l.quantity - 1e-9);

  const submit = async () => {
    setError(null);
    if (anyOver) return setError('You can’t receive more than what is still pending on the order.');
    const input = lines.filter((x) => x.n > 0).map((x) => ({ itemId: x.l.itemId, quantity: x.n }));
    if (!input.length) return setError('Enter a received quantity for at least one item.');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return setError('No internet connection — nothing was saved. Please try again.');
    }
    setBusy(false);
    showActionToast('Saving…', `Receiving ${po.poNumber}`, 'saving');
    onClose();
    receivePurchase(po.id, { lines: input, billNumber, billDate })
      .then(() => {
        showActionToast('Goods received', 'Stock updated.', 'success');
      })
      .catch((e: any) => {
        showActionToast('Could not receive goods', e?.message || 'Could not receive the goods.', 'error');
      });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      tone="sky"
      icon={Truck}
      title={`Receive Goods · ${po.poNumber}`}
      subtitle={po.supplier.name}
      footer={
        <PrimaryButton tone="sky" busy={busy} disabled={anyOver} onClick={submit}>
          Receive into Stock
        </PrimaryButton>
      }
    >
      {lines.map(({ l, got, left, n, item, stock, over }) => (
        <div key={l.itemId} className={`rounded-xl border p-3 ${over ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'}`}>
          <div className="text-sm font-bold text-slate-800 mb-2">{l.itemName}</div>
          <div className="grid grid-cols-3 gap-2 text-[11px] items-end">
            <div>
              <div className="text-slate-400 font-semibold">Ordered</div>
              <div className="font-bold mt-1">
                {l.quantity} {l.unit}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-semibold">Received before</div>
              <div className="font-bold mt-1">
                {got} {l.unit}
              </div>
            </div>
            <Field label="Receive now">
              <input
                className={`${qtyInputCls} ${over ? 'border-rose-400' : 'border-sky-300 bg-sky-50'} font-bold`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                disabled={left <= 0}
                placeholder={left <= 0 ? '—' : '0'}
                value={qty[l.itemId] || ''}
                onChange={(e) => setQty((q) => ({ ...q, [l.itemId]: e.target.value }))}
              />
            </Field>
          </div>
          <div className="text-[11px] mt-2">
            {left <= 0 ? (
              <span className="text-emerald-600 font-bold">Fully received</span>
            ) : over ? (
              <span className="text-rose-600 font-semibold">Only {left} {l.unit} is still pending</span>
            ) : n > 0 ? (
              <span className="text-slate-500">
                Stock {stock} → <b>{round2(stock + n)}</b> {l.unit}
                {showPrices && item && (
                  <>
                    {' '}
                    · Avg cost {formatINR(item.unitCost || 0)} → <b>{formatINR(weightedAverageCost(stock, item.unitCost || 0, n, l.rate))}</b> (bought at {formatINR(l.rate)})
                  </>
                )}
              </span>
            ) : (
              <span className="text-slate-400">{left} {l.unit} pending</span>
            )}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Supplier bill no.">
          <input className={inputCls} value={billNumber} onChange={(e) => setBillNumber(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Bill date">
          <input className={inputCls} type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
        </Field>
      </div>
      {!anyOver && lines.some((x) => x.n > 0) && (
        <InfoBox>
          After this, the order becomes <b>{allAfter ? 'Received' : 'Partly received'}</b>.
        </InfoBox>
      )}
      <ErrorBox message={error} />
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Purchase return
// ---------------------------------------------------------------------------
const P_REASONS = ['Damaged', 'Wrong item', 'Poor quality', 'Excess quantity', 'Other'];

const PurchaseReturnSheet: React.FC<{ po: Purchase; showPrices: boolean; onClose: () => void; onSaved: (r: PurchaseReturn) => void }> = ({ po, showPrices, onClose }) => {
  const { items, showActionToast } = useInventory();
  const { createPurchaseReturn } = useTrade();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(P_REASONS[0]);
  const [vehicle, setVehicle] = useState('');
  const [date, setDate] = useState(todayISODate());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = po.lines
    .filter((l) => ((po.receivedQty || {})[l.itemId] || 0) > 0)
    .map((l) => {
      const got = (po.receivedQty || {})[l.itemId] || 0;
      const already = (po.returnedQty || {})[l.itemId] || 0;
      const item = items.find((i) => i.id === l.itemId);
      const stock = item ? getItemQuantity(item) : 0;
      const left = round2(Math.min(got - already, stock));
      const n = Number(qty[l.itemId]) || 0;
      return { l, got, already, stock, left, n, over: n > left + 1e-9, ...calcLine({ quantity: n, rate: l.rate, gstPct: l.gstPct }) };
    });
  const totals = sumLines(lines);
  const anyOver = lines.some((x) => x.over);
  const pos = moneyPosition(po);
  const newBalance = round2(pos.balance - totals.grandTotal);

  const submit = async () => {
    setError(null);
    if (anyOver) return setError('A return quantity is more than allowed.');
    const input = lines.filter((x) => x.n > 0).map((x) => ({ itemId: x.l.itemId, quantity: x.n }));
    if (!input.length) return setError('Enter a return quantity for at least one item.');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return setError('No internet connection — nothing was saved. Please try again.');
    }
    setBusy(false);
    showActionToast('Saving…', `Return for ${po.poNumber}`, 'saving');
    onClose();
    createPurchaseReturn(po.id, { lines: input, reason, vehicleNumber: vehicle, date, notes })
      .then((r) => {
        showActionToast(`Return ${r.returnNumber} saved`, showPrices ? `Debit note ${formatINR(r.total)}` : 'Stock updated.', 'success');
      })
      .catch((e: any) => {
        showActionToast('Could not save return', e?.message || 'The return could not be saved.', 'error');
      });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      tone="amber"
      icon={Undo2}
      title={`Return to Supplier · ${po.poNumber}`}
      subtitle={po.supplier.name}
      footer={
        <PrimaryButton tone="amber" busy={busy} disabled={anyOver} onClick={submit}>
          {showPrices ? 'Save Return & Debit Note' : 'Save Return'}
        </PrimaryButton>
      }
    >
      {lines.map(({ l, got, already, stock, left, n, over }) => (
        <div key={l.itemId} className={`rounded-xl border p-3 ${over ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'}`}>
          <div className="text-sm font-bold text-slate-800 mb-2">{l.itemName}</div>
          <div className="grid grid-cols-3 gap-2 text-[11px] items-end">
            <div>
              <div className="text-slate-400 font-semibold">Received</div>
              <div className="font-bold mt-1">
                {got} {l.unit}
                {already ? <span className="text-amber-600"> (−{already})</span> : null}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-semibold">In stock now</div>
              <div className="font-bold mt-1">
                {stock} {l.unit}
              </div>
            </div>
            <Field label="Return now">
              <input
                className={`${qtyInputCls} ${over ? 'border-rose-400' : 'border-amber-300 bg-amber-50'} font-bold`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                disabled={left <= 0}
                placeholder={left <= 0 ? '—' : '0'}
                value={qty[l.itemId] || ''}
                onChange={(e) => setQty((q) => ({ ...q, [l.itemId]: e.target.value }))}
              />
            </Field>
          </div>
          {over && <div className="text-[11px] text-rose-600 font-semibold mt-1.5">Only {Math.max(0, left)} {l.unit} can be returned</div>}
          {!over && n > 0 && (
            <div className="text-[11px] text-slate-500 mt-1.5">
              Stock goes {stock} → <b>{round2(stock - n)}</b> {l.unit}
            </div>
          )}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Reason">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            {P_REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Vehicle / LR">
          <input className={inputCls} value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder="Optional" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date">
          <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Notes">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      {showPrices && (
        <>
          <Totals
            rows={[
              { label: 'Subtotal', value: formatINR(totals.subtotal) },
              { label: 'Debit note', value: formatINR(totals.grandTotal), bold: true },
            ]}
          />
          {totals.grandTotal > 0 && (
            <InfoBox>
              {newBalance >= 0 ? (
                <>
                  Payable goes <b>{formatINR(Math.max(0, pos.balance))}</b> → <b>{formatINR(newBalance)}</b>.
                </>
              ) : (
                <>
                  This order is already paid, so <b>{formatINR(-newBalance)} refund is due from the supplier</b>.
                </>
              )}
            </InfoBox>
          )}
        </>
      )}
      <ErrorBox message={error} />
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Edit Purchase Return
// ---------------------------------------------------------------------------
const EditPurchaseReturnSheet: React.FC<{
  r: PurchaseReturn;
  po: Purchase;
  showPrices: boolean;
  onClose: () => void;
  onSaved: (r: PurchaseReturn) => void;
}> = ({ r, po, showPrices, onClose }) => {
  const { items, showActionToast } = useInventory();
  const { editPurchaseReturn } = useTrade();
  const [qty, setQty] = useState<Record<string, string>>(() =>
    r.lines.reduce((acc, l) => ({ ...acc, [l.itemId]: String(l.quantity) }), {})
  );
  const [reason, setReason] = useState(r.reason || P_REASONS[0]);
  const [vehicle, setVehicle] = useState(r.vehicleNumber || '');
  const [date, setDate] = useState(r.date || todayISODate());
  const [notes, setNotes] = useState(r.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = po.lines
    .filter((l) => ((po.receivedQty || {})[l.itemId] || 0) > 0)
    .map((l) => {
      const got = (po.receivedQty || {})[l.itemId] || 0;
      const prevInThisReturn = r.lines.find((x) => x.itemId === l.itemId)?.quantity || 0;
      const otherReturns = Math.max(0, round2((po.returnedQty || {})[l.itemId] || 0) - prevInThisReturn);
      const item = items.find((i) => i.id === l.itemId);
      const stock = item ? getItemQuantity(item) : 0;
      const maxAllowed = round2(got - otherReturns);
      const stockCapacity = round2(stock + prevInThisReturn);
      const limit = Math.min(maxAllowed, stockCapacity);
      const n = Number(qty[l.itemId]) || 0;
      return {
        l,
        got,
        otherReturns,
        prevInThisReturn,
        stock,
        limit,
        n,
        over: n > limit + 1e-9,
        ...calcLine({ quantity: n, rate: l.rate, gstPct: l.gstPct }),
      };
    });

  const totals = sumLines(lines);
  const anyOver = lines.some((x) => x.over);
  const pos = moneyPosition(po);
  const newBalance = round2(pos.balance + (r.total || 0) - totals.grandTotal);

  const submit = async () => {
    setError(null);
    if (anyOver) return setError('A return quantity is more than allowed.');
    const input = lines.filter((x) => x.n > 0).map((x) => ({ itemId: x.l.itemId, quantity: x.n }));
    if (!input.length) return setError('Enter a return quantity for at least one item.');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return setError('No internet connection — nothing was saved. Please try again.');
    }
    setBusy(false);
    showActionToast('Saving…', `Updating ${r.returnNumber}`, 'saving');
    onClose();
    editPurchaseReturn(r.id, { lines: input, reason, vehicleNumber: vehicle, date, notes })
      .then((updated) => {
        showActionToast(`Return ${updated.returnNumber} updated`, showPrices ? `Debit note ${formatINR(updated.total)}.` : 'Stock updated.', 'success');
      })
      .catch((e: any) => {
        showActionToast('Could not update return', e?.message || 'The return could not be updated.', 'error');
      });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      tone="amber"
      icon={Undo2}
      title={`Edit Return · ${r.returnNumber}`}
      subtitle={`${po.poNumber} · ${po.supplier.name}`}
      footer={
        <PrimaryButton tone="amber" busy={busy} disabled={anyOver} onClick={submit}>
          {showPrices ? 'Update Return & Debit Note' : 'Update Return'}
        </PrimaryButton>
      }
    >
      {lines.map(({ l, got, otherReturns, prevInThisReturn, stock, limit, n, over }) => (
        <div key={l.itemId} className={`rounded-xl border p-3 ${over ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'}`}>
          <div className="text-sm font-bold text-slate-800 mb-2">{l.itemName}</div>
          <div className="grid grid-cols-3 gap-2 text-[11px] items-end">
            <div>
              <div className="text-slate-400 font-semibold">Received</div>
              <div className="font-bold mt-1">
                {got} {l.unit}
                {otherReturns ? <span className="text-amber-600"> (other −{otherReturns})</span> : null}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-semibold">Current stock</div>
              <div className="font-bold mt-1">
                {stock} {l.unit}
              </div>
            </div>
            <Field label="Return qty">
              <input
                className={`${qtyInputCls} ${over ? 'border-rose-400' : 'border-amber-300 bg-amber-50'} font-bold`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                disabled={limit <= 0}
                placeholder={limit <= 0 ? '—' : '0'}
                value={qty[l.itemId] ?? ''}
                onChange={(e) => setQty((q) => ({ ...q, [l.itemId]: e.target.value }))}
              />
            </Field>
          </div>
          {over && <div className="text-[11px] text-rose-600 font-semibold mt-1.5">Max returnable is {Math.max(0, limit)} {l.unit}</div>}
          {!over && (
            <div className="text-[11px] text-slate-500 mt-1.5">
              Was: {prevInThisReturn} {l.unit} → Now: <b>{n} {l.unit}</b> (stock change: {round2(prevInThisReturn - n)} {l.unit})
            </div>
          )}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Reason">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            {P_REASONS.map((res) => (
              <option key={res}>{res}</option>
            ))}
          </select>
        </Field>
        <Field label="Vehicle / LR">
          <input className={inputCls} value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder="Optional" />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Date">
          <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Notes">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      {showPrices && (
        <>
          <Totals
            rows={[
              { label: 'Subtotal', value: formatINR(totals.subtotal) },
              { label: 'Debit note', value: formatINR(totals.grandTotal), bold: true },
            ]}
          />
          {totals.grandTotal > 0 && (
            <InfoBox>
              {newBalance >= 0 ? (
                <>
                  Adjusted payable: <b>{formatINR(newBalance)}</b>.
                </>
              ) : (
                <>
                  Adjusted balance: <b>{formatINR(-newBalance)} refund due from supplier</b>.
                </>
              )}
            </InfoBox>
          )}
        </>
      )}
      <ErrorBox message={error} />
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Order details
// ---------------------------------------------------------------------------
const PurchaseDetailSheet: React.FC<{ po: Purchase; showPrices: boolean; returns: PurchaseReturn[]; actions: React.ReactNode; onClose: () => void }> = ({ po, showPrices, returns, actions, onClose }) => {
  const pos = moneyPosition(po);
  return (
    <Sheet open onClose={onClose} tone="sky" icon={PackageCheck} title={`${po.poNumber} · ${STATUS[po.status].label}`} subtitle={`${po.supplier.name}${po.supplier.phone ? ` · ${po.supplier.phone}` : ''}`} wide>
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
        {po.lines.map((l) => (
          <div key={l.itemId} className="p-3 text-xs flex justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-slate-800 truncate">{l.itemName}</div>
              <div className="text-slate-500">
                Received {(po.receivedQty || {})[l.itemId] || 0} of {l.quantity} {l.unit}
                {(po.returnedQty || {})[l.itemId] ? <span className="text-amber-600"> · returned {(po.returnedQty || {})[l.itemId]}</span> : null}
                {showPrices ? ` · ${formatINR(l.rate)}` : ''}
              </div>
            </div>
            {showPrices && <div className="font-bold text-slate-900 shrink-0">{formatINR(l.amount)}</div>}
          </div>
        ))}
      </div>
      {showPrices && (
        <Totals
          rows={[
            { label: 'Order total', value: formatINR(po.grandTotal), bold: true },
            ...(po.returnsTotal ? [{ label: 'Returns (debit notes)', value: `− ${formatINR(po.returnsTotal)}` }] : []),
            { label: 'Paid', value: formatINR(pos.netPaid) },
            { label: pos.balance < 0 ? 'Refund due from supplier' : 'Payable', value: formatINR(Math.abs(pos.balance)), bold: true },
          ]}
        />
      )}
      {(po.receipts || []).length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Deliveries</div>
          {po.receipts.map((r) => (
            <div key={r.id} className="text-xs bg-sky-50 border border-sky-100 rounded-lg px-3 py-2">
              <b>{fmtDateTime(r.receivedAt)}</b> · {r.lines.map((l) => `${l.itemName} ${l.quantity}`).join(', ')}
              {r.billNumber ? ` · Bill ${r.billNumber}` : ''} · by {r.receivedByName || '—'}
            </div>
          ))}
        </div>
      )}
      {showPrices && (po.payments || []).length + (po.refunds || []).length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Payments</div>
          {[...(po.payments || []).map((p) => ({ ...p, refund: false })), ...(po.refunds || []).map((p) => ({ ...p, refund: true }))].map((p) => (
            <div key={p.id} className="flex justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
              <span className="text-slate-600">
                {fmtDate(p.date)} · {p.mode.toUpperCase()}
                {p.note ? ` · ${p.note}` : ''}
                {p.refund ? ' · refund received' : ''}
              </span>
              <b className={p.refund ? 'text-amber-600' : 'text-emerald-700'}>
                {p.refund ? '−' : ''}
                {formatINR(p.amount)}
              </b>
            </div>
          ))}
        </div>
      )}
      {returns.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Returns</div>
          {returns.map((r) => (
            <div key={r.id} className="flex justify-between gap-2 text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <span className="truncate">
                <b>{r.returnNumber}</b> · {r.lines.map((l) => `${l.itemName} × ${l.quantity}`).join(', ')}
              </span>
              {showPrices && <b className="text-amber-700 shrink-0">{formatINR(r.total)}</b>}
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] text-slate-400">
        Created by {po.createdByName || '—'} · {fmtDateTime(po.createdAt)}
        {po.cancelReason ? ` · Cancelled: ${po.cancelReason}` : ''}
      </div>
      {actions}
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Edit Purchase Order
// ---------------------------------------------------------------------------
const EditPurchaseSheet: React.FC<{ po: Purchase; onClose: () => void; onSaved: (p: Purchase) => void }> = ({ po, onClose }) => {
  const { items, showActionToast } = useInventory();
  const { suppliers, editPurchase } = useTrade();

  const [supplier, setSupplier] = useState<PartyInfo>(() => ({
    name: po.supplier.name,
    phone: po.supplier.phone || '',
    gstin: po.supplier.gstin || '',
    address: po.supplier.address || '',
  }));

  const [rows, setRows] = useState<Row[]>(() =>
    po.lines.map((l) => ({
      key: Math.random().toString(36).slice(2),
      itemId: l.itemId,
      quantity: String(l.quantity),
      rate: String(l.rate || ''),
    }))
  );

  const [expected, setExpected] = useState(po.expectedDate || '');
  const [notes, setNotes] = useState(po.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...items].sort((a, b) => (a.type === 'raw_material' ? 0 : 1) - (b.type === 'raw_material' ? 0 : 1) || a.name.localeCompare(b.name)),
    [items]
  );

  const computed = rows.map((r) => ({
    r,
    item: items.find((i) => i.id === r.itemId),
    ...calcLine({ quantity: Number(r.quantity) || 0, rate: Number(r.rate) || 0 }),
  }));
  const totals = sumLines(computed.filter((c) => c.item));
  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async () => {
    setError(null);
    if (!supplier.name.trim()) return setError('Enter the supplier name.');
    const filled = rows.filter((r) => r.itemId);
    if (!filled.length) return setError('Add at least one item.');
    if (filled.some((r) => !(Number(r.quantity) > 0))) return setError('Enter a quantity on every item row.');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return setError('No internet connection — nothing was saved. Please try again.');
    }
    const lines: PurchaseLineInput[] = filled.map((r) => ({
      itemId: r.itemId,
      quantity: Number(r.quantity),
      rate: Number(r.rate) || 0,
      gstPct: 0,
    }));
    setBusy(false);
    showActionToast('Saving…', `Updating ${po.poNumber}`, 'saving');
    onClose();
    editPurchase(po.id, { supplier, lines, expectedDate: expected, notes })
      .then((updated) => {
        showActionToast(`PO ${updated.poNumber} updated`, 'Changes saved.', 'success');
      })
      .catch((e: any) => {
        showActionToast('Could not update PO', e?.message || 'The purchase order could not be updated.', 'error');
      });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      tone="indigo"
      icon={Pencil}
      title={`Edit PO · ${po.poNumber}`}
      subtitle="Modify order details before receiving items"
      wide
      footer={
        <PrimaryButton tone="indigo" busy={busy} onClick={submit}>
          Save Purchase Order
        </PrimaryButton>
      }
    >
      <PartyFields label="Supplier" value={supplier} onChange={setSupplier} suggestions={suppliers} listId="edit-po-suppliers" />
      <div className="flex justify-between items-center pt-1">
        <div className="text-xs font-bold text-slate-700">Items</div>
        <SmallButton tone="indigo" icon={Plus} onClick={() => setRows((rs) => [...rs, { key: Math.random().toString(36).slice(2), itemId: '', quantity: '', rate: '' }])}>
          Add Item
        </SmallButton>
      </div>
      {computed.map(({ r, item, amount }) => {
        const usedElsewhere = new Set(rows.filter((x) => x.key !== r.key).map((x) => x.itemId));
        return (
          <div key={r.key} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex gap-2 items-start">
              <select
                className={inputCls}
                value={r.itemId}
                onChange={(e) => {
                  const it = items.find((i) => i.id === e.target.value);
                  update(r.key, { itemId: e.target.value, rate: it ? String(it.unitCost || '') : '' });
                }}
              >
                <option value="">— Choose item —</option>
                {sorted
                  .filter((it) => !usedElsewhere.has(it.id))
                  .map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.type.replace('_', ' ')})
                    </option>
                  ))}
              </select>
              {rows.length > 1 && (
                <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="p-2 text-slate-400 hover:text-rose-600 cursor-pointer" aria-label="Remove row">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={`Qty${item ? ` (${item.unit})` : ''}`}>
                <input className={qtyInputCls} type="number" inputMode="decimal" min="0" step="any" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
              </Field>
              <Field label="Rate (₹)">
                <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={r.rate} onChange={(e) => update(r.key, { rate: e.target.value })} />
              </Field>
            </div>
            <div className="text-right text-xs font-mono text-slate-600">
              Line total: <b className="text-slate-900">{formatINR(amount)}</b>
            </div>
          </div>
        );
      })}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Expected by">
          <input className={inputCls} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>
        <Field label="Notes">
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </Field>
      </div>

      <Totals
        rows={[
          { label: 'Subtotal', value: formatINR(totals.subtotal) },
          { label: 'Grand total', value: formatINR(totals.grandTotal), bold: true },
        ]}
      />
      <ErrorBox message={error} />
    </Sheet>
  );
};

