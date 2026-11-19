import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShoppingCart,
  Plus,
  Search,
  Wallet,
  Undo2,
  XCircle,
  Trash2,
  FileSpreadsheet,
  Eye,
  AlertTriangle,
  Camera,
  Pencil,
  MoreVertical,
  ChevronRight,
  BatteryCharging,
  Receipt,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';
import { useTrade } from '../../context/TradeContext';
import { PartyInfo, Sale, SalesReturn, SalesReturnCondition } from '../../types/inventory';
import { getItemQuantity } from '../../utils/itemResolver';
import {
  calcLine,
  formatINR,
  moneyPosition,
  round2,
  sumLines,
  todayISODate,
} from '../../utils/tradeMath';
import { saleInvoicePdf, salesReturnPdf } from '../../utils/tradeDocuments';
import { downloadExcelFile } from '../../utils/fileDownload';
import { formatShortDate, formatTime12h } from '../../utils/numberFormat';
import { canChangeEntry, formatLockReason } from '../../utils/changeWindow';
import { NewSalePage } from './NewSalePage';
import { buildCustomerAccounts, CustomerAccount } from './customerKhata';
import { CustomerAccountPage, getInitials } from './CustomerAccountPage';
import { ReceivePaymentSheet } from './ReceivePaymentSheet';
import { BatteryCheckView } from './BatteryCheckView';
import {
  Chip,
  ConfirmDialog,
  ErrorBox,
  Field,
  InfoBox,
  inputCls,
  qtyInputCls,
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

const PAY: Record<string, { label: string; tone: Tone }> = {
  unpaid: { label: 'Unpaid', tone: 'rose' },
  partly_paid: { label: 'Part paid', tone: 'amber' },
  paid: { label: 'Paid', tone: 'emerald' },
  refund_due: { label: 'Refund due', tone: 'amber' },
};

type SalesTab = 'invoices' | 'customers';
type StatusFilter = 'all' | 'unpaid' | 'part_paid' | 'paid' | 'cancelled' | 'returns';
type PeriodFilter = 'today' | '7d' | '30d' | 'this_month' | 'last_month' | 'all' | 'custom';
type CustomerSort = 'balance_due' | 'name' | 'total_bought' | 'last_sale';

type SaleFeedEntry =
  | { type: 'sale'; data: Sale; timestamp: string; dayKey: string }
  | { type: 'return'; data: SalesReturn; timestamp: string; dayKey: string };

const toLocalDayKey = (iso?: string): string => {
  if (!iso) return todayISODate();
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return todayISODate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const shiftDayKey = (daysOffset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const monthBounds = (offsetMonths: number): { from: string; to: string } => {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 0);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: fmt(first), to: fmt(last) };
};

const formatDayHeading = (dayKey: string, todayKey: string, yesterdayKey: string): string => {
  if (dayKey === todayKey) return 'TODAY';
  if (dayKey === yesterdayKey) return 'YESTERDAY';
  const d = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey;
  return formatShortDate(d, true).toUpperCase();
};

const formatTimeShort = (iso?: string): string => {
  if (!iso || iso.length === 10) return '';
  return formatTime12h(iso);
};

const formatItemPreview = (lines: { itemName: string; quantity: number }[]): string => {
  if (!lines || lines.length === 0) return '';
  const head = lines.slice(0, 2).map((l) => `${l.itemName} × ${l.quantity}`).join(', ');
  const more = lines.length > 2 ? ` +${lines.length - 2}` : '';
  return head + more;
};

const fmtMoney = (n: number): string => {
  const v = round2(n);
  return formatINR(v, v % 1 !== 0);
};

export const SalesView: React.FC = () => {
  const { permissions, role, realUserUid } = useAuth();
  const { showActionToast } = useInventory();
  const trade = useTrade();
  const { sales, salesReturns, customerAdvances } = trade;
  const toast = useToast();

  // Top-level state
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<SalesTab>('invoices');
  const [menuOpen, setMenuOpen] = useState(false);

  // Invoices tab filters & pagination (50 at a time)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('30d');
  const [customFrom, setCustomFrom] = useState(() => shiftDayKey(-29));
  const [customTo, setCustomTo] = useState(() => todayISODate());
  const [visibleCount, setVisibleCount] = useState(50);

  // Customers tab sort & active Customer Account view
  const [customerSort, setCustomerSort] = useState<CustomerSort>('balance_due');
  const [selectedCustomerKey, setSelectedCustomerKey] = useState<string | null>(null);

  // Full-page New/Edit Sale, Battery Check & Modals / Sheets
  const [newSalePage, setNewSalePage] = useState<{
    initialCustomer?: PartyInfo | null;
    startWithPhoto?: boolean;
    editingSale?: Sale | null;
  } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [returnDetail, setReturnDetail] = useState<SalesReturn | null>(null);
  const [receivePayOpen, setReceivePayOpen] = useState<{ customerKey?: string | null } | null>(null);
  const [batteryCheckOpen, setBatteryCheckOpen] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const [returnFor, setReturnFor] = useState<Sale | null>(null);
  const [cancelFor, setCancelFor] = useState<Sale | null>(null);
  const [deleteFor, setDeleteFor] = useState<Sale | null>(null);
  const [editReturnFor, setEditReturnFor] = useState<{ r: SalesReturn; sale: Sale } | null>(null);
  const [deleteReturnFor, setDeleteReturnFor] = useState<SalesReturn | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const ignoreNextPopRef = useRef(false);
  const newSaleBackRef = useRef<(() => void) | null>(null);
  const batteryCheckBackRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  // Customer Account, New/Edit Sale & Battery Check full-page history support
  const handleOpenCustomer = useCallback((customerKey: string) => {
    setSelectedCustomerKey(customerKey);
    window.history.pushState({ view: 'customer_account', customerKey }, '');
  }, []);

  const handleCloseCustomer = useCallback(() => {
    setSelectedCustomerKey(null);
    if (window.history.state?.view === 'customer_account') {
      ignoreNextPopRef.current = true;
      window.history.back();
    }
  }, []);

  const handleOpenNewSale = useCallback(
    (opts?: {
      initialCustomer?: PartyInfo | null;
      startWithPhoto?: boolean;
      editingSale?: Sale | null;
    }) => {
      setNewSalePage({
        initialCustomer: opts?.initialCustomer ?? null,
        startWithPhoto: Boolean(opts?.startWithPhoto),
        editingSale: opts?.editingSale ?? null,
      });
      window.history.pushState({ view: 'new_sale' }, '');
    },
    []
  );

  const handleCloseNewSale = useCallback(() => {
    setNewSalePage(null);
    if (window.history.state?.view === 'new_sale') {
      ignoreNextPopRef.current = true;
      window.history.back();
    }
  }, []);

  const handleOpenBatteryCheck = useCallback(() => {
    setBatteryCheckOpen(true);
    window.history.pushState({ view: 'battery_check' }, '');
  }, []);

  const handleCloseBatteryCheck = useCallback(() => {
    setBatteryCheckOpen(false);
    if (window.history.state?.view === 'battery_check') {
      ignoreNextPopRef.current = true;
      window.history.back();
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false;
        return;
      }
      if (newSalePage && window.history.state?.view !== 'new_sale') {
        window.history.pushState({ view: 'new_sale' }, '');
        if (newSaleBackRef.current) {
          newSaleBackRef.current();
        } else {
          setNewSalePage(null);
        }
        return;
      }
      if (batteryCheckOpen && window.history.state?.view !== 'battery_check') {
        if (batteryCheckBackRef.current) {
          window.history.pushState({ view: 'battery_check' }, '');
          batteryCheckBackRef.current();
        } else {
          setBatteryCheckOpen(false);
        }
        return;
      }
      if (selectedCustomerKey && window.history.state?.view !== 'customer_account') {
        setSelectedCustomerKey(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [newSalePage, batteryCheckOpen, selectedCustomerKey]);

  // Reset pagination slice when filter/period/search changes
  useEffect(() => {
    setVisibleCount(50);
  }, [statusFilter, periodFilter, customFrom, customTo, search]);

  const detail = sales.find((s) => s.id === detailId) || null;
  const q = search.trim().toLowerCase();

  // Period bounds check
  const periodRange = useMemo(() => {
    const today = todayISODate();
    if (periodFilter === 'today') return { from: today, to: today };
    if (periodFilter === '7d') return { from: shiftDayKey(-6), to: today };
    if (periodFilter === '30d') return { from: shiftDayKey(-29), to: today };
    if (periodFilter === 'this_month') return monthBounds(0);
    if (periodFilter === 'last_month') return monthBounds(-1);
    if (periodFilter === 'custom') {
      const a = customFrom || '';
      const b = customTo || '';
      if (a && b && a > b) return { from: b, to: a };
      return { from: a, to: b };
    }
    return { from: '', to: '' };
  }, [periodFilter, customFrom, customTo]);

  const inPeriod = useCallback(
    (dayKey: string): boolean => {
      if (periodFilter === 'all') return true;
      if (periodRange.from && dayKey < periodRange.from) return false;
      if (periodRange.to && dayKey > periodRange.to) return false;
      return true;
    },
    [periodFilter, periodRange]
  );

  // Period-filtered & search-filtered sales and returns (used for tab badge, list, and dark summary bar)
  const matchingSales = useMemo(() => {
    return sales.filter((s) => {
      const dayKey = toLocalDayKey(s.createdAt);
      if (!inPeriod(dayKey)) return false;
      if (q) {
        const hit =
          s.invoiceNumber.toLowerCase().includes(q) ||
          s.customer.name.toLowerCase().includes(q) ||
          (s.customer.phone || '').toLowerCase().includes(q) ||
          s.lines.some((l) => l.itemName.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (statusFilter === 'returns') return false;
      if (statusFilter === 'cancelled') return s.status === 'cancelled';
      if (statusFilter === 'unpaid') return s.status !== 'cancelled' && moneyPosition(s).status === 'unpaid';
      if (statusFilter === 'part_paid') return s.status !== 'cancelled' && moneyPosition(s).status === 'partly_paid';
      if (statusFilter === 'paid') return s.status !== 'cancelled' && moneyPosition(s).status === 'paid';
      return true;
    });
  }, [sales, inPeriod, q, statusFilter]);

  const matchingReturns = useMemo(() => {
    if (statusFilter !== 'all' && statusFilter !== 'returns') return [];
    return salesReturns.filter((r) => {
      const dayKey = toLocalDayKey(r.date || r.createdAt);
      if (!inPeriod(dayKey)) return false;
      if (!q) return true;
      return (
        r.returnNumber.toLowerCase().includes(q) ||
        r.invoiceNumber.toLowerCase().includes(q) ||
        r.customerName.toLowerCase().includes(q) ||
        r.lines.some((l) => l.itemName.toLowerCase().includes(q))
      );
    });
  }, [salesReturns, statusFilter, inPeriod, q]);

  const feedEntries = useMemo<SaleFeedEntry[]>(() => {
    const saleEntries: SaleFeedEntry[] = matchingSales.map((s) => ({
      type: 'sale',
      data: s,
      timestamp: s.createdAt,
      dayKey: toLocalDayKey(s.createdAt),
    }));
    const retEntries: SaleFeedEntry[] = matchingReturns.map((r) => ({
      type: 'return',
      data: r,
      timestamp: r.createdAt || (r.date ? `${r.date}T12:00:00` : ''),
      dayKey: toLocalDayKey(r.date || r.createdAt),
    }));
    return [...saleEntries, ...retEntries].sort((a, b) => {
      const ta = new Date(a.timestamp).getTime() || 0;
      const tb = new Date(b.timestamp).getTime() || 0;
      return tb - ta;
    });
  }, [matchingSales, matchingReturns]);

  // Visible slice (50 at a time)
  const visibleFeed = useMemo(() => feedEntries.slice(0, visibleCount), [feedEntries, visibleCount]);

  // Day-grouped visible feed
  const dayGroups = useMemo(() => {
    const todayKey = todayISODate();
    const yesterdayKey = shiftDayKey(-1);
    const map = new Map<
      string,
      {
        dayKey: string;
        label: string;
        entries: SaleFeedEntry[];
        invoiceCount: number;
        returnCount: number;
        total: number;
        due: number;
      }
    >();

    for (const entry of visibleFeed) {
      let grp = map.get(entry.dayKey);
      if (!grp) {
        grp = {
          dayKey: entry.dayKey,
          label: formatDayHeading(entry.dayKey, todayKey, yesterdayKey),
          entries: [],
          invoiceCount: 0,
          returnCount: 0,
          total: 0,
          due: 0,
        };
        map.set(entry.dayKey, grp);
      }
      grp.entries.push(entry);
      if (entry.type === 'sale') {
        const s = entry.data;
        grp.invoiceCount += 1;
        if (s.status !== 'cancelled') {
          grp.total = round2(grp.total + (s.grandTotal || 0));
          grp.due = round2(grp.due + Math.max(0, moneyPosition(s).balance));
        }
      } else {
        grp.returnCount += 1;
      }
    }

    return Array.from(map.values());
  }, [visibleFeed]);

  // Summary bar totals for the selected period (always reflects matching sales + returns in period)
  const periodSummary = useMemo(() => {
    const liveSales = matchingSales.filter((s) => s.status !== 'cancelled');
    const total = round2(liveSales.reduce((acc, s) => acc + (s.grandTotal || 0), 0));
    const unpaid = round2(
      liveSales.reduce((acc, s) => acc + Math.max(0, moneyPosition(s).balance), 0)
    );
    // Also count returns in the selected period & search regardless of status chip unless status is returns-only
    const returnsSum = round2(
      salesReturns
        .filter((r) => {
          const dk = toLocalDayKey(r.date || r.createdAt);
          if (!inPeriod(dk)) return false;
          if (!q) return true;
          return (
            r.returnNumber.toLowerCase().includes(q) ||
            r.invoiceNumber.toLowerCase().includes(q) ||
            r.customerName.toLowerCase().includes(q) ||
            r.lines.some((l) => l.itemName.toLowerCase().includes(q))
          );
        })
        .reduce((acc, r) => acc + (r.total || 0), 0)
    );
    return {
      total,
      invoices: liveSales.length,
      unpaid,
      returns: returnsSum,
    };
  }, [matchingSales, salesReturns, inPeriod, q]);

  // Customer Accounts (Khata) derived from all sales, payments, refunds, returns & advances
  const allCustomers = useMemo(
    () => buildCustomerAccounts(sales, salesReturns, customerAdvances),
    [sales, salesReturns, customerAdvances]
  );

  const filteredSortedCustomers = useMemo(() => {
    const list = allCustomers.filter((c) => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.sales.some((s) => s.invoiceNumber.toLowerCase().includes(q))
      );
    });
    return [...list].sort((a, b) => {
      if (customerSort === 'name') return a.name.localeCompare(b.name);
      if (customerSort === 'total_bought') return b.totalBought - a.totalBought || a.name.localeCompare(b.name);
      if (customerSort === 'last_sale') {
        const ta = new Date(a.lastSaleAt).getTime() || 0;
        const tb = new Date(b.lastSaleAt).getTime() || 0;
        return tb - ta || a.name.localeCompare(b.name);
      }
      // Default: Balance due descending
      return b.balanceDue - a.balanceDue || b.totalBought - a.totalBought || a.name.localeCompare(b.name);
    });
  }, [allCustomers, q, customerSort]);

  const totalToCollect = useMemo(
    () => round2(allCustomers.reduce((acc, c) => acc + Math.max(0, c.balanceDue), 0)),
    [allCustomers]
  );

  const selectedCustomerAccount: CustomerAccount | null = useMemo(() => {
    if (!selectedCustomerKey) return null;
    return allCustomers.find((c) => c.key === selectedCustomerKey) || null;
  }, [allCustomers, selectedCustomerKey]);

  // Excel Export (keeps existing logic & columns)
  const exportExcel = () => {
    if (statusFilter === 'returns') {
      downloadExcelFile(
        matchingReturns.map((r) => ({
          'Document Type': 'Sales Return',
          'Return No.': r.returnNumber,
          Date: fmtDate(r.date || r.createdAt),
          'Against Invoice': r.invoiceNumber,
          Customer: r.customerName,
          Items: r.lines.map((l) => `${l.itemName} x ${l.quantity}`).join(', '),
          Reason: r.reason,
          Condition: r.condition === 'good' ? 'Back to stock' : 'Damaged',
          'Credit Note (₹)': r.total,
          'Created by': r.createdByName || '',
        })),
        `powertrack_sales_returns_${todayISODate()}`,
        'Sales Returns'
      );
      return;
    }

    if (statusFilter === 'all' && matchingReturns.length > 0) {
      downloadExcelFile(
        feedEntries.map((item) => {
          if (item.type === 'sale') {
            const s = item.data;
            const pos = moneyPosition(s);
            return {
              'Document Type': 'Sale Invoice',
              'Doc No.': s.invoiceNumber,
              Date: fmtDate(s.createdAt),
              Customer: s.customer.name,
              Phone: s.customer.phone || '',
              Items: s.lines.map((l) => `${l.itemName} x ${l.quantity}`).join(', '),
              'Total (₹)': s.grandTotal,
              'Returns (₹)': s.returnsTotal || 0,
              'Paid (₹)': round2((s.amountPaid || 0) - (s.refundedTotal || 0)),
              'Balance (₹)': pos.balance,
              Status: s.status === 'cancelled' ? 'Cancelled' : 'Active',
              Payment: PAY[pos.status].label,
              'Created by': s.createdByName || '',
            };
          }
          const r = item.data;
          return {
            'Document Type': 'Sales Return',
            'Doc No.': r.returnNumber,
            Date: fmtDate(r.date || r.createdAt),
            Customer: r.customerName,
            Phone: '',
            Items: r.lines.map((l) => `${l.itemName} x ${l.quantity}`).join(', '),
            'Total (₹)': -r.total,
            'Returns (₹)': r.total,
            'Paid (₹)': '',
            'Balance (₹)': '',
            Status: `Against ${r.invoiceNumber}`,
            Payment: 'Credit Note',
            'Created by': r.createdByName || '',
          };
        }),
        `powertrack_sales_and_returns_${todayISODate()}`,
        'Sales & Returns'
      );
      return;
    }

    downloadExcelFile(
      matchingSales.map((s) => {
        const pos = moneyPosition(s);
        return {
          'Invoice No.': s.invoiceNumber,
          Date: fmtDate(s.createdAt),
          Customer: s.customer.name,
          Phone: s.customer.phone || '',
          Items: s.lines.map((l) => `${l.itemName} x ${l.quantity}`).join(', '),
          'Total (₹)': s.grandTotal,
          'Returns (₹)': s.returnsTotal || 0,
          'Paid (₹)': round2((s.amountPaid || 0) - (s.refundedTotal || 0)),
          'Balance (₹)': pos.balance,
          Status: s.status === 'cancelled' ? 'Cancelled' : 'Active',
          Payment: PAY[pos.status].label,
          'Created by': s.createdByName || '',
        };
      }),
      `powertrack_sales_${todayISODate()}`,
      'Sales'
    );
  };

  const actions = (s: Sale, inDetail = false) => {
    const canEditThis = permissions.canEditSales && s.status !== 'cancelled';
    const canCancelThis =
      permissions.canCreateSales &&
      s.status !== 'cancelled' &&
      !(s.amountPaid > 0) &&
      !(s.returnsTotal > 0);
    const canDeleteThis = permissions.canDeleteSales;
    const hasBillChangePerm = canEditThis || canCancelThis || canDeleteThis;
    const changeCheck = hasBillChangePerm
      ? canChangeEntry(
          {
            createdByUid: s.createdBy,
            createdByName: s.createdByName,
            createdAt: s.createdAt,
          },
          realUserUid,
          permissions,
          role
        )
      : null;
    const billAllowed = changeCheck ? changeCheck.allowed : true;

    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-2">
          {!inDetail && (
            <SmallButton icon={Eye} onClick={() => setDetailId(s.id)}>
              Details
            </SmallButton>
          )}
          <PdfButtons
            build={() => saleInvoicePdf(s)}
            fileName={`${s.invoiceNumber}.pdf`}
            title={`Invoice ${s.invoiceNumber}`}
            onError={(m) => toast.show('PDF failed', m, true)}
          />
          {canEditThis && billAllowed && (
            <SmallButton
              tone="indigo"
              onClick={() => {
                setDetailId(null);
                handleOpenNewSale({ editingSale: s });
              }}
            >
              ✎ Edit bill
            </SmallButton>
          )}
          {permissions.canCreateSalesReturn &&
            s.status !== 'cancelled' &&
            s.returnStatus !== 'fully_returned' && (
              <SmallButton tone="amber" icon={Undo2} onClick={() => setReturnFor(s)}>
                Return
              </SmallButton>
            )}
          {canCancelThis && billAllowed && (
            <SmallButton tone="rose" icon={XCircle} onClick={() => setCancelFor(s)}>
              Cancel
            </SmallButton>
          )}
          {canDeleteThis && billAllowed && (
            <SmallButton tone="rose" icon={Trash2} onClick={() => setDeleteFor(s)}>
              Delete
            </SmallButton>
          )}
        </div>
        {changeCheck && !changeCheck.allowed && (
          <div className="text-[11px] text-slate-400">
            {formatLockReason(changeCheck.reason)}
          </div>
        )}
        {changeCheck &&
          changeCheck.allowed &&
          role !== 'admin' &&
          changeCheck.timeLeftLabel && (
            <div className="text-[11px] text-slate-400">
              Can change for {changeCheck.timeLeftLabel} more
            </div>
          )}
      </div>
    );
  };

  const hasMoreToShow =
    visibleCount < feedEntries.length || (statusFilter !== 'returns' && trade.hasMoreSales);

  const handleLoadMore = () => {
    const nextVisible = visibleCount + 50;
    setVisibleCount(nextVisible);
    if (nextVisible >= feedEntries.length && trade.hasMoreSales && statusFilter !== 'returns') {
      trade.loadMoreSales();
    }
  };

  const showMenuButton = permissions.canExportExcel;

  // Shared Modals & Sheets rendered across List Tabs, Customer Account page, and New Sale page
  const sharedModals = (
    <>

      {detail && (
        <SaleDetailSheet
          sale={detail}
          onClose={() => setDetailId(null)}
          returns={salesReturns.filter((r) => r.saleId === detail.id)}
          actions={actions(detail, true)}
          showProfit={permissions.canViewFinances}
          onError={(m) => toast.show('PDF failed', m, true)}
        />
      )}

      {returnDetail && (
        <ReturnDetailSheet
          r={returnDetail}
          sale={sales.find((s) => s.id === returnDetail.saleId)}
          canEdit={permissions.canEditSalesReturn}
          canDelete={permissions.canDeleteSalesReturn}
          onClose={() => setReturnDetail(null)}
          onOpenParentSale={(saleId) => {
            setReturnDetail(null);
            setDetailId(saleId);
          }}
          onEdit={(ret) => {
            const parent = sales.find((s) => s.id === ret.saleId);
            if (parent) {
              setReturnDetail(null);
              setEditReturnFor({ r: ret, sale: parent });
            }
          }}
          onDelete={(ret) => {
            setReturnDetail(null);
            setDeleteReturnFor(ret);
          }}
          onError={(m) => toast.show('PDF failed', m, true)}
        />
      )}

      <ReceivePaymentSheet
        open={Boolean(receivePayOpen)}
        initialCustomerKey={receivePayOpen?.customerKey || null}
        customerAccounts={allCustomers}
        onClose={() => setReceivePayOpen(null)}
      />

      {returnFor && (
        <SalesReturnSheet
          sale={returnFor}
          onClose={() => setReturnFor(null)}
          onSaved={() => {}}
        />
      )}

      <ConfirmDialog
        open={!!deleteFor}
        title={`Delete Sale ${deleteFor?.invoiceNumber || ''}?`}
        message="Permanently delete this invoice. Any remaining unreturned stock will be restored to inventory."
        confirmLabel="Delete Sale & Restore Stock"
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
          showActionToast('Saving…', `Deleting ${target.invoiceNumber}`, 'saving');
          trade
            .deleteSale(target.id, reason)
            .then(() => {
              showActionToast(`${target.invoiceNumber} deleted`, 'Allocated stock restored to inventory.', 'success');
            })
            .catch((e: any) => {
              showActionToast('Could not delete', e?.message || 'The sale could not be deleted.', 'error');
            });
        }}
      />

      <ConfirmDialog
        open={!!cancelFor}
        title={`Cancel ${cancelFor?.invoiceNumber || ''}?`}
        message="All items on this sale go back into stock and the sale is marked Cancelled. It stays in history and can't be undone."
        confirmLabel="Cancel Sale & Return Stock"
        withReason
        onCancel={() => setCancelFor(null)}
        onConfirm={async (reason) => {
          if (!cancelFor) return;
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            throw new Error('No internet connection — nothing was saved. Please try again.');
          }
          const target = cancelFor;
          setCancelFor(null);
          showActionToast('Saving…', `Cancelling ${target.invoiceNumber}`, 'saving');
          trade
            .cancelSale(target.id, reason)
            .then(() => {
              showActionToast(`${target.invoiceNumber} cancelled`, 'Stock returned.', 'success');
            })
            .catch((e: any) => {
              showActionToast('Could not cancel', e?.message || 'The sale could not be cancelled.', 'error');
            });
        }}
      />

      {editReturnFor && (
        <EditSalesReturnSheet
          r={editReturnFor.r}
          sale={editReturnFor.sale}
          onClose={() => setEditReturnFor(null)}
          onSaved={() => {
            setEditReturnFor(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteReturnFor}
        title={`Delete Sales Return ${deleteReturnFor?.returnNumber || ''}?`}
        message={`Permanently delete this credit note (${formatINR(deleteReturnFor?.total || 0)}). Any stock that was added back into inventory will be reversed out.`}
        confirmLabel="Delete Return & Adjust Stock"
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
            .deleteSalesReturn(target.id, reason)
            .then(() => {
              showActionToast(`${target.returnNumber} deleted`, 'Credit note cancelled and stock reversed.', 'success');
            })
            .catch((e: any) => {
              showActionToast('Could not delete return', e?.message || 'The sales return could not be deleted.', 'error');
            });
        }}
      />

      {toast.view}
    </>
  );

  // ============================================================================
  // FULL-PAGE NEW / EDIT SALE (Merged New Sale + Bill Photo + Edit Bill)
  // ============================================================================
  if (newSalePage) {
    return (
      <>
        <NewSalePage
          initialCustomer={newSalePage.initialCustomer}
          customerAccounts={allCustomers}
          startWithPhoto={newSalePage.startWithPhoto}
          editingSale={newSalePage.editingSale}
          backHandlerRef={newSaleBackRef}
          onCancel={handleCloseNewSale}
          onSaved={(savedSale) => {
            if (window.history.state?.view === 'new_sale') {
              window.history.replaceState(
                selectedCustomerKey ? { view: 'customer_account', customerKey: selectedCustomerKey } : null,
                ''
              );
            }
            setNewSalePage(null);
            setDetailId(savedSale.id);
          }}
        />
        {sharedModals}
      </>
    );
  }

  // ============================================================================
  // FULL-PAGE BATTERY CHECK
  // ============================================================================
  if (batteryCheckOpen) {
    return (
      <>
        <BatteryCheckView
          customerAccounts={allCustomers}
          onBack={handleCloseBatteryCheck}
          backHandlerRef={batteryCheckBackRef}
        />
        {sharedModals}
      </>
    );
  }

  // ============================================================================
  // CUSTOMER ACCOUNT PAGE
  // ============================================================================
  if (selectedCustomerAccount) {
    return (
      <>
        <CustomerAccountPage
          account={selectedCustomerAccount}
          canRecordPayments={permissions.canRecordPayments}
          canCreateSales={permissions.canCreateSales}
          canEditPayments={permissions.canEditPayments}
          canDeletePayments={permissions.canDeletePayments}
          onBack={handleCloseCustomer}
          onOpenInvoice={(saleId) => setDetailId(saleId)}
          onReceivePayment={() => setReceivePayOpen({ customerKey: selectedCustomerAccount.key })}
          onNewSaleForCustomer={(party) => handleOpenNewSale({ initialCustomer: party })}
          onError={(m) => toast.show('Statement PDF failed', m, true)}
        />
        {sharedModals}
      </>
    );
  }

  // ============================================================================
  // MAIN SALES VIEW (INVOICES TAB + CUSTOMERS TAB)
  // ============================================================================
  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-24">
      {trade.tradeError && <ErrorBox message={trade.tradeError} />}

      {/* Top Row: Search + ⋮ Menu */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Invoice, customer, phone…"
            className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900 placeholder:text-slate-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>

        {showMenuButton && (
          <div className="relative shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label="Sales menu"
              className="p-2.5 rounded-xl bg-white border border-slate-300 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition shadow-2xs cursor-pointer"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-1.5 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-30 animate-in fade-in zoom-in-95 duration-100">
                {permissions.canExportExcel && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      exportExcel();
                    }}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    <span>Export Excel</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Two Tabs: Invoices (n) | Customers (n) */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 rounded-xl">
        <button
          type="button"
          onClick={() => setActiveTab('invoices')}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-bold transition cursor-pointer ${
            activeTab === 'invoices'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Invoices ({feedEntries.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('customers')}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-bold transition cursor-pointer ${
            activeTab === 'customers'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Customers ({filteredSortedCustomers.length})
        </button>
      </div>

      {/* ====================================================================
          INVOICES TAB (DAILY REGISTER)
      ==================================================================== */}
      {activeTab === 'invoices' && (
        <div className="space-y-3">
          {/* One row of filters: Status dropdown + Period dropdown */}
          <div className="grid grid-cols-2 gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Filter by status"
              className="w-full h-[38px] px-3 text-sm font-semibold bg-white border border-slate-300 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="all">Status: All</option>
              <option value="unpaid">Unpaid</option>
              <option value="part_paid">Part paid</option>
              <option value="paid">Paid</option>
              <option value="cancelled">Cancelled</option>
              <option value="returns">Returns</option>
            </select>

            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
              aria-label="Filter by period"
              className="w-full h-[38px] px-3 text-sm font-semibold bg-white border border-slate-300 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="today">Today</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="all">All time</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          {/* Custom Date Range Picker when Custom is selected */}
          {periodFilter === 'custom' && (
            <div className="grid grid-cols-2 gap-2 bg-white p-2.5 rounded-xl border border-slate-200">
              <Field label="From">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="To">
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
          )}

          {/* Day-Grouped Invoice Rows */}
          {dayGroups.length === 0 ? (
            <Empty
              text={
                statusFilter === 'returns'
                  ? 'No sales returns in this period.'
                  : sales.length === 0 && salesReturns.length === 0
                  ? 'No sales yet. Tap "＋" to create your first invoice.'
                  : 'No invoices match this filter.'
              }
            />
          ) : (
            <div className="space-y-3">
              {dayGroups.map((grp) => {
                const countParts: string[] = [];
                if (grp.invoiceCount > 0) {
                  countParts.push(`${grp.invoiceCount} ${grp.invoiceCount === 1 ? 'INVOICE' : 'INVOICES'}`);
                }
                if (grp.returnCount > 0) {
                  countParts.push(`${grp.returnCount} ${grp.returnCount === 1 ? 'RETURN' : 'RETURNS'}`);
                }

                return (
                  <div
                    key={grp.dayKey}
                    className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs"
                  >
                    {/* Grey Day Header */}
                    <div className="px-3.5 py-2 bg-slate-100/90 border-b border-slate-200 flex items-center justify-between gap-2 text-[11px] font-bold tracking-wide text-slate-600">
                      <span className="truncate">
                        {grp.label} · {countParts.join(' · ') || '0 INVOICES'}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-slate-800">
                        {fmtMoney(grp.total)}
                        {grp.due > 0.009 && (
                          <span className="text-rose-600"> · DUE {fmtMoney(grp.due)}</span>
                        )}
                      </span>
                    </div>

                    {/* Compact Rows */}
                    <div className="divide-y divide-slate-100">
                      {grp.entries.map((entry) => {
                        if (entry.type === 'return') {
                          const r = entry.data;
                          const itemPreview = formatItemPreview(r.lines);
                          const timeStr = formatTimeShort(r.createdAt);
                          return (
                            <button
                              key={`ret-${r.id}`}
                              type="button"
                              onClick={() => setReturnDetail(r)}
                              className="w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-bold text-slate-900 truncate">
                                  {r.customerName}
                                </div>
                                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                  {[r.returnNumber, timeStr || `vs ${r.invoiceNumber}`, itemPreview]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </div>
                              </div>
                              <div className="text-right shrink-0 flex flex-col items-end gap-1">
                                <div className="text-sm font-bold font-mono tabular-nums text-slate-900">
                                  {fmtMoney(r.total)}
                                </div>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                  Return
                                </span>
                              </div>
                            </button>
                          );
                        }

                        const s = entry.data;
                        const pos = moneyPosition(s);
                        const timeStr = formatTimeShort(s.createdAt);
                        const itemPreview = formatItemPreview(s.lines);

                        let chipLabel = 'Paid';
                        let chipClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        if (s.status === 'cancelled') {
                          chipLabel = 'Cancelled';
                          chipClass = 'bg-slate-100 text-slate-600 border-slate-200';
                        } else if (pos.status === 'unpaid') {
                          chipLabel = 'Unpaid';
                          chipClass = 'bg-rose-50 text-rose-700 border-rose-200';
                        } else if (pos.status === 'partly_paid') {
                          chipLabel = 'Part paid';
                          chipClass = 'bg-amber-50 text-amber-700 border-amber-200';
                        } else if (pos.status === 'refund_due') {
                          chipLabel = 'Refund due';
                          chipClass = 'bg-amber-50 text-amber-700 border-amber-200';
                        }

                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => setDetailId(s.id)}
                            className="w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-bold text-slate-900 truncate">
                                {s.customer.name}
                              </div>
                              <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                {[s.invoiceNumber, timeStr, itemPreview].filter(Boolean).join(' · ')}
                              </div>
                            </div>

                            <div className="text-right shrink-0 flex flex-col items-end gap-1">
                              <div className="text-sm font-bold font-mono tabular-nums text-slate-900">
                                {fmtMoney(s.grandTotal)}
                              </div>
                              <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${chipClass}`}
                              >
                                {chipLabel}
                              </span>
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

          {/* Load More (50 at a time) */}
          {hasMoreToShow && (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                onClick={handleLoadMore}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 cursor-pointer shadow-2xs"
              >
                Load more
              </button>
            </div>
          )}

          {/* Dark Summary Bar at End for Selected Period */}
          <div className="bg-slate-900 text-white rounded-2xl p-3.5 grid grid-cols-4 gap-2 text-center shadow-sm">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Total
              </div>
              <div className="text-xs sm:text-sm font-bold font-mono tabular-nums mt-0.5 truncate">
                {fmtMoney(periodSummary.total)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Invoices
              </div>
              <div className="text-xs sm:text-sm font-bold font-mono tabular-nums mt-0.5">
                {periodSummary.invoices}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Unpaid
              </div>
              <div className="text-xs sm:text-sm font-bold font-mono tabular-nums text-rose-400 mt-0.5 truncate">
                {fmtMoney(periodSummary.unpaid)}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Returns
              </div>
              <div className="text-xs sm:text-sm font-bold font-mono tabular-nums text-purple-300 mt-0.5 truncate">
                {fmtMoney(periodSummary.returns)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          CUSTOMERS TAB (KHATA)
      ==================================================================== */}
      {activeTab === 'customers' && (
        <div className="space-y-3">
          {/* Sort + To collect red chip */}
          <div className="flex items-center justify-between gap-2">
            <select
              value={customerSort}
              onChange={(e) => setCustomerSort(e.target.value as CustomerSort)}
              aria-label="Sort customers"
              className="h-[38px] px-3 text-sm font-semibold bg-white border border-slate-300 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="balance_due">Sort: Balance due</option>
              <option value="name">Sort: Name</option>
              <option value="total_bought">Sort: Total bought</option>
              <option value="last_sale">Sort: Last sale</option>
            </select>

            <span className="inline-flex items-center px-3 py-1.5 rounded-full bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold font-mono tabular-nums shrink-0">
              To collect {fmtMoney(totalToCollect)}
            </span>
          </div>

          {filteredSortedCustomers.length === 0 ? (
            <Empty
              text={
                allCustomers.length === 0
                  ? 'No customers yet. Create a sale invoice to start a customer khata.'
                  : 'No customers match your search.'
              }
            />
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-2xs">
              {filteredSortedCustomers.map((c) => {
                let dueNote = '';
                if (c.balanceDue > 0.009) {
                  if (c.unpaidBillsCount > 1) {
                    dueNote = `${c.unpaidBillsCount} bills unpaid`;
                  } else if (c.oldestUnpaidDays >= 7) {
                    dueNote = `${c.oldestUnpaidDays} days overdue`;
                  } else if (c.anyPartPaid) {
                    dueNote = 'part paid';
                  } else {
                    dueNote = '1 bill unpaid';
                  }
                }

                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => handleOpenCustomer(c.key)}
                    className="w-full text-left px-3.5 py-3 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
                  >
                    {/* Round Initial Avatar */}
                    <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-xs flex items-center justify-center shrink-0">
                      {getInitials(c.name)}
                    </div>

                    {/* Name + city · bought ₹total */}
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-900 truncate">{c.name}</div>
                      <div className="text-xs text-slate-500 truncate mt-0.5">
                        {c.city ? `${c.city} · ` : ''}bought {fmtMoney(c.totalBought)}
                      </div>
                    </div>

                    {/* Right: Balance due + red note OR Settled chip + › */}
                    <div className="flex items-center gap-2 shrink-0">
                      {c.balanceDue > 0.009 ? (
                        <div className="text-right">
                          <div className="text-sm font-bold font-mono tabular-nums text-rose-600">
                            {fmtMoney(c.balanceDue)}
                          </div>
                          <div className="text-[10px] font-semibold text-rose-600">{dueNote}</div>
                        </div>
                      ) : c.balanceDue < -0.009 ? (
                        <div className="text-right">
                          <div className="text-xs font-bold font-mono tabular-nums text-emerald-700">
                            Advance {fmtMoney(-c.balanceDue)}
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold">
                          Settled
                        </span>
                      )}
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Floating "+" Action Button & Menu Bottom-Right on Both Tabs */}
      {(permissions.canCreateSales || permissions.canRecordPayments || permissions.canCreateSalesReturn) && (
        <>
          {fabMenuOpen && (
            <div
              onClick={() => setFabMenuOpen(false)}
              className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[1px]"
            />
          )}
          <div
            style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
            className="fixed right-4 z-50 flex flex-col items-end gap-2.5"
          >
            {fabMenuOpen && (
              <div className="w-56 bg-white rounded-2xl shadow-2xl border border-slate-200 p-1.5 space-y-1">
                {permissions.canCreateSales && (
                  <button
                    type="button"
                    onClick={() => {
                      setFabMenuOpen(false);
                      handleOpenNewSale();
                    }}
                    className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-bold text-slate-800 hover:bg-purple-50 active:bg-purple-100 flex items-center gap-2.5 transition cursor-pointer"
                  >
                    <span className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                      <Receipt className="w-4 h-4" />
                    </span>
                    <span>New sale</span>
                  </button>
                )}
                {permissions.canCreateSales && (
                  <button
                    type="button"
                    onClick={() => {
                      setFabMenuOpen(false);
                      handleOpenNewSale({ startWithPhoto: true });
                    }}
                    className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-bold text-slate-800 hover:bg-indigo-50 active:bg-indigo-100 flex items-center gap-2.5 transition cursor-pointer"
                  >
                    <span className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                      <Camera className="w-4 h-4" />
                    </span>
                    <span>Sale from bill photo</span>
                  </button>
                )}
                {permissions.canRecordPayments && (
                  <button
                    type="button"
                    onClick={() => {
                      setFabMenuOpen(false);
                      setReceivePayOpen({});
                    }}
                    className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-bold text-slate-800 hover:bg-emerald-50 active:bg-emerald-100 flex items-center gap-2.5 transition cursor-pointer"
                  >
                    <span className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                      <Wallet className="w-4 h-4" />
                    </span>
                    <span>₹ Receive payment</span>
                  </button>
                )}
                {permissions.canCreateSalesReturn && (
                  <button
                    type="button"
                    onClick={() => {
                      setFabMenuOpen(false);
                      handleOpenBatteryCheck();
                    }}
                    className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-bold text-slate-800 hover:bg-amber-50 active:bg-amber-100 flex items-center gap-2.5 transition cursor-pointer"
                  >
                    <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                      <BatteryCharging className="w-4 h-4" />
                    </span>
                    <span>Battery check</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFabMenuOpen(false)}
                  className="w-full px-3 py-2 rounded-xl text-center text-xs font-bold text-slate-500 hover:bg-slate-100 flex items-center justify-center gap-1.5 border-t border-slate-100 mt-1 pt-2 transition cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Close</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setFabMenuOpen((prev) => !prev)}
              aria-label={fabMenuOpen ? 'Close menu' : 'Sales actions'}
              className={`w-14 h-14 rounded-full text-white shadow-xl flex items-center justify-center cursor-pointer active:scale-95 transition ${
                fabMenuOpen ? 'bg-slate-800 hover:bg-slate-900' : 'bg-purple-600 hover:bg-purple-700'
              }`}
            >
              {fabMenuOpen ? <X className="w-6 h-6" /> : <Plus className="w-7 h-7" />}
            </button>
          </div>
        </>
      )}

      {sharedModals}
    </div>
  );
};

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
    {text}
  </div>
);

// ---------------------------------------------------------------------------
// Return Detail Sheet (when tapping a Return row in Invoices tab)
// ---------------------------------------------------------------------------
const ReturnDetailSheet: React.FC<{
  r: SalesReturn;
  sale?: Sale;
  canEdit?: boolean;
  canDelete?: boolean;
  onClose: () => void;
  onOpenParentSale: (saleId: string) => void;
  onEdit: (r: SalesReturn) => void;
  onDelete: (r: SalesReturn) => void;
  onError: (m: string) => void;
}> = ({ r, sale, canEdit, canDelete, onClose, onOpenParentSale, onEdit, onDelete, onError }) => (
  <Sheet
    open
    onClose={onClose}
    tone="amber"
    icon={Undo2}
    title={`${r.returnNumber} · Sales Return`}
    subtitle={`${r.customerName} · Against ${r.invoiceNumber}`}
  >
    <div className="flex gap-1.5 flex-wrap">
      <Chip tone={r.condition === 'good' ? 'emerald' : 'rose'}>
        {r.condition === 'good' ? 'Back to stock' : 'Damaged'}
      </Chip>
      <Chip tone="slate">Against {r.invoiceNumber}</Chip>
    </div>

    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
      {r.lines.map((l) => (
        <div key={l.itemId} className="p-3 text-xs flex justify-between gap-2">
          <div className="min-w-0">
            <div className="font-bold text-slate-800 truncate">{l.itemName}</div>
            <div className="text-slate-500">
              {l.quantity} {l.unit} × {formatINR(l.rate)}
            </div>
          </div>
          <div className="font-bold text-slate-900 shrink-0">{formatINR(l.amount)}</div>
        </div>
      ))}
    </div>

    <Totals rows={[{ label: 'Credit note total', value: formatINR(r.total), bold: true }]} />

    <div className="text-xs text-slate-500">
      Reason: <b className="text-slate-800">{r.reason}</b> · {fmtDate(r.date || r.createdAt)} · by{' '}
      {r.createdByName || '—'}
    </div>

    <div className="flex flex-wrap gap-2 pt-1">
      <PdfButtons
        build={() => salesReturnPdf(r, sale)}
        fileName={`${r.returnNumber}.pdf`}
        title={`Credit note ${r.returnNumber}`}
        onError={onError}
      />
      {sale && (
        <SmallButton icon={Eye} onClick={() => onOpenParentSale(sale.id)}>
          View {sale.invoiceNumber}
        </SmallButton>
      )}
      {canEdit && sale && (
        <SmallButton tone="indigo" icon={Pencil} onClick={() => onEdit(r)}>
          Edit
        </SmallButton>
      )}
      {canDelete && (
        <SmallButton tone="rose" icon={Trash2} onClick={() => onDelete(r)}>
          Delete
        </SmallButton>
      )}
    </div>
  </Sheet>
);


// ---------------------------------------------------------------------------
// Sale details
// ---------------------------------------------------------------------------
const SaleDetailSheet: React.FC<{
  sale: Sale;
  returns: SalesReturn[];
  actions: React.ReactNode;
  showProfit: boolean;
  onClose: () => void;
  onError: (m: string) => void;
}> = ({ sale, returns, actions, showProfit, onClose }) => {
  const pos = moneyPosition(sale);
  const cost = sale.lines.reduce((a, l) => a + (l.costPrice || 0) * l.quantity, 0);
  const profit = round2(sale.subtotal - cost);
  return (
    <Sheet
      open
      onClose={onClose}
      tone="emerald"
      icon={ShoppingCart}
      title={sale.status === 'cancelled' ? `${sale.invoiceNumber} · Cancelled` : sale.invoiceNumber}
      subtitle={`${sale.customer.name}${sale.customer.phone ? ` · ${sale.customer.phone}` : ''}`}
      wide
    >
      <div className="flex gap-1.5 flex-wrap">
        {sale.status === 'cancelled' ? (
          <Chip tone="slate">Cancelled</Chip>
        ) : (
          <Chip tone={PAY[pos.status].tone}>{PAY[pos.status].label}</Chip>
        )}
        {sale.returnStatus && sale.returnStatus !== 'none' && (
          <Chip tone="amber">
            {sale.returnStatus === 'fully_returned' ? 'Returned' : 'Partly returned'}
          </Chip>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
        {sale.lines.map((l) => (
          <div key={l.itemId} className="p-3 text-xs flex justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-slate-800 flex items-center gap-1.5 min-w-0">
                <span className="truncate">{l.itemName}</span>
                {l.rate === 0 && (
                  <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase tracking-wide">
                    FREE
                  </span>
                )}
              </div>
              <div className="text-slate-500">
                {l.quantity} {l.unit} × {l.rate === 0 ? 'FREE' : formatINR(l.rate)}
                {l.discountPct ? ` − ${l.discountPct}%` : ''}
                {(sale.returnedQty || {})[l.itemId] ? (
                  <span className="text-amber-600">
                    {' '}
                    · returned {(sale.returnedQty || {})[l.itemId]}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="font-bold text-slate-900 shrink-0">
              {l.rate === 0 ? 'FREE' : formatINR(l.amount)}
            </div>
          </div>
        ))}
      </div>
      <Totals
        rows={[
          { label: 'Subtotal', value: formatINR(sale.subtotal) },
          { label: 'Invoice total', value: formatINR(sale.grandTotal), bold: true },
          ...(sale.returnsTotal
            ? [{ label: 'Returns (credit notes)', value: `− ${formatINR(sale.returnsTotal)}` }]
            : []),
          { label: 'Paid', value: formatINR(pos.netPaid) },
          {
            label: pos.balance < 0 ? 'Refund due' : 'Balance due',
            value: formatINR(Math.abs(pos.balance)),
            bold: true,
          },
          ...(showProfit
            ? [
                {
                  label: 'Profit (before returns)',
                  value: `${formatINR(profit)} (${sale.subtotal ? round2((profit / sale.subtotal) * 100) : 0}%)`,
                },
              ]
            : []),
        ]}
      />
      {(sale.payments || []).length + (sale.refunds || []).length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Payments</div>
          {[
            ...(sale.payments || []).map((p) => ({ ...p, refund: false })),
            ...(sale.refunds || []).map((p) => ({ ...p, refund: true })),
          ].map((p) => (
            <div key={p.id} className="flex justify-between text-xs bg-slate-50 rounded-lg px-3 py-2">
              <span className="text-slate-600">
                {fmtDate(p.date)} · {p.mode.toUpperCase()}
                {p.note ? ` · ${p.note}` : ''}
                {p.refund ? ' · refund' : ''}
              </span>
              <b className={p.refund ? 'text-amber-600' : 'text-emerald-700'}>
                {p.refund ? '−' : '+'}
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
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2"
            >
              <span className="text-slate-700 min-w-0 truncate">
                <b>{r.returnNumber}</b> · {r.lines.map((l) => `${l.itemName} × ${l.quantity}`).join(', ')}
              </span>
              <b className="text-amber-700 shrink-0">{formatINR(r.total)}</b>
            </div>
          ))}
        </div>
      )}
      <div className="text-[11px] text-slate-400">
        Created by {sale.createdByName || '—'} · {fmtDateTime(sale.createdAt)}
        {sale.vehicleNumber ? ` · Vehicle ${sale.vehicleNumber}` : ''}
        {sale.trackingNumber ? ` · LR ${sale.trackingNumber}` : ''}
        {sale.cancelReason ? ` · Cancelled: ${sale.cancelReason}` : ''}
      </div>
      {actions}
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Sales return
// ---------------------------------------------------------------------------
const REASONS = ['Damaged in transit', 'Wrong item', 'Customer rejected', 'Quality issue', 'Other'];

const SalesReturnSheet: React.FC<{
  sale: Sale;
  onClose: () => void;
  onSaved: (r: SalesReturn) => void;
}> = ({ sale, onClose }) => {
  const { items, showActionToast } = useInventory();
  const { createSalesReturn } = useTrade();
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(REASONS[0]);
  const [condition, setCondition] = useState<SalesReturnCondition>('good');
  const [date, setDate] = useState(todayISODate());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = sale.lines.map((l) => {
    const already = (sale.returnedQty || {})[l.itemId] || 0;
    const left = round2(l.quantity - already);
    const n = Number(qty[l.itemId]) || 0;
    const calc = calcLine({
      quantity: n,
      rate: l.rate,
      discountPct: l.discountPct,
      gstPct: l.gstPct,
    });
    return { l, already, left, n, over: n > left + 1e-9, ...calc };
  });
  const totals = sumLines(lines);
  const anyOver = lines.some((x) => x.over);
  const pos = moneyPosition(sale);
  const newBalance = round2(pos.balance - totals.grandTotal);

  const submit = async () => {
    setError(null);
    if (anyOver) return setError('A return quantity is more than what can still be returned.');
    const input = lines.filter((x) => x.n > 0).map((x) => ({ itemId: x.l.itemId, quantity: x.n }));
    if (!input.length) return setError('Enter a return quantity for at least one item.');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return setError('No internet connection — nothing was saved. Please try again.');
    }
    setBusy(false);
    showActionToast('Saving…', `Return for ${sale.invoiceNumber}`, 'saving');
    onClose();
    createSalesReturn(sale.id, { lines: input, reason, condition, date, notes })
      .then((r) => {
        showActionToast(`Return ${r.returnNumber} saved`, `Credit note ${formatINR(r.total)}`, 'success');
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
      title={`Sales Return · ${sale.invoiceNumber}`}
      subtitle={sale.customer.name}
      footer={
        <PrimaryButton tone="amber" busy={busy} disabled={anyOver} onClick={submit}>
          Save Return & Credit Note
        </PrimaryButton>
      }
    >
      {lines.map(({ l, already, left, over, n }) => (
        <div
          key={l.itemId}
          className={`rounded-xl border p-3 ${
            over ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'
          }`}
        >
          <div className="text-sm font-bold text-slate-800 mb-2">{l.itemName}</div>
          <div className="grid grid-cols-3 gap-2 text-[11px] items-end">
            <div>
              <div className="text-slate-400 font-semibold">Sold</div>
              <div className="font-bold text-slate-800 mt-1">
                {l.quantity} {l.unit}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-semibold">Already returned</div>
              <div className="font-bold text-slate-800 mt-1">
                {already} {l.unit}
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
          {over && (
            <div className="text-[11px] text-rose-600 font-semibold mt-1.5">
              Only {left} {l.unit} can still be returned
            </div>
          )}
          {!over && n > 0 && condition === 'good' && (
            <div className="text-[11px] text-slate-500 mt-1.5">
              Stock goes {getItemQuantity(items.find((i) => i.id === l.itemId) || ({ quantity: 0 } as any))}{' '}
              →{' '}
              {round2(
                getItemQuantity(items.find((i) => i.id === l.itemId) || ({ quantity: 0 } as any)) + n
              )}{' '}
              {l.unit}
            </div>
          )}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Reason">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Condition">
        <div className="grid grid-cols-2 gap-2 text-xs font-bold">
          <button
            type="button"
            onClick={() => setCondition('good')}
            className={`px-3 py-2.5 rounded-xl border-2 cursor-pointer text-left ${
              condition === 'good'
                ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 text-slate-500'
            }`}
          >
            Good – back to stock
          </button>
          <button
            type="button"
            onClick={() => setCondition('damaged')}
            className={`px-3 py-2.5 rounded-xl border-2 cursor-pointer text-left ${
              condition === 'damaged'
                ? 'border-rose-400 bg-rose-50 text-rose-800'
                : 'border-slate-200 text-slate-500'
            }`}
          >
            Damaged – don't add to stock
          </button>
        </div>
      </Field>
      <Field label="Notes">
        <input
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
      </Field>
      <Totals
        rows={[
          { label: 'Subtotal', value: formatINR(totals.subtotal) },
          { label: 'Credit note', value: formatINR(totals.grandTotal), bold: true },
        ]}
      />
      {totals.grandTotal > 0 && (
        <InfoBox>
          {newBalance >= 0 ? (
            <>
              Balance due goes <b>{formatINR(Math.max(0, pos.balance))}</b> → <b>{formatINR(newBalance)}</b>.
            </>
          ) : (
            <>
              <AlertTriangle className="inline w-3.5 h-3.5 mr-1 text-amber-600" />
              The customer has paid more than the new total, so{' '}
              <b>{formatINR(-newBalance)} refund is due</b>.
            </>
          )}
        </InfoBox>
      )}
      <ErrorBox message={error} />
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Edit Sales Return Sheet
// ---------------------------------------------------------------------------
const EditSalesReturnSheet: React.FC<{
  r: SalesReturn;
  sale: Sale;
  onClose: () => void;
  onSaved: (r: SalesReturn) => void;
}> = ({ r, sale, onClose }) => {
  const { showActionToast } = useInventory();
  const { editSalesReturn } = useTrade();
  const [qty, setQty] = useState<Record<string, string>>(() =>
    r.lines.reduce((acc, l) => ({ ...acc, [l.itemId]: String(l.quantity) }), {})
  );
  const [reason, setReason] = useState(r.reason || REASONS[0]);
  const [condition, setCondition] = useState<SalesReturnCondition>(r.condition || 'good');
  const [date, setDate] = useState(r.date || todayISODate());
  const [notes, setNotes] = useState(r.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = sale.lines.map((l) => {
    const thisReturnPrev = r.lines.find((x) => x.itemId === l.itemId)?.quantity || 0;
    const otherReturns = Math.max(
      0,
      round2((sale.returnedQty || {})[l.itemId] || 0) - thisReturnPrev
    );
    const maxAllowed = round2(l.quantity - otherReturns);
    const n = Number(qty[l.itemId]) || 0;
    const calc = calcLine({
      quantity: n,
      rate: l.rate,
      discountPct: l.discountPct,
      gstPct: l.gstPct,
    });
    return {
      l,
      otherReturns,
      thisReturnPrev,
      maxAllowed,
      n,
      over: n > maxAllowed + 1e-9,
      ...calc,
    };
  });

  const totals = sumLines(lines);
  const anyOver = lines.some((x) => x.over);
  const pos = moneyPosition(sale);
  const newBalance = round2(pos.balance + (r.total || 0) - totals.grandTotal);

  const submit = async () => {
    setError(null);
    if (anyOver) return setError('A return quantity is more than what can still be returned.');
    const input = lines.filter((x) => x.n > 0).map((x) => ({ itemId: x.l.itemId, quantity: x.n }));
    if (!input.length) return setError('Enter a return quantity for at least one item.');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return setError('No internet connection — nothing was saved. Please try again.');
    }
    setBusy(false);
    showActionToast('Saving…', `Updating ${r.returnNumber}`, 'saving');
    onClose();
    editSalesReturn(r.id, {
      lines: input,
      reason,
      condition,
      date,
      notes,
    })
      .then((updated) => {
        showActionToast(`Return ${updated.returnNumber} updated`, `Credit note ${formatINR(updated.total)}.`, 'success');
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
      title={`Edit Sales Return · ${r.returnNumber}`}
      subtitle={`${sale.invoiceNumber} · ${sale.customer.name}`}
      footer={
        <PrimaryButton tone="amber" busy={busy} disabled={anyOver} onClick={submit}>
          Update Return & Stock
        </PrimaryButton>
      }
    >
      {lines.map(({ l, otherReturns, thisReturnPrev, maxAllowed, over, n }) => (
        <div
          key={l.itemId}
          className={`rounded-xl border p-3 ${
            over ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'
          }`}
        >
          <div className="text-sm font-bold text-slate-800 mb-2">{l.itemName}</div>
          <div className="grid grid-cols-3 gap-2 text-[11px] items-end">
            <div>
              <div className="text-slate-400 font-semibold">Sold</div>
              <div className="font-bold text-slate-800 mt-1">
                {l.quantity} {l.unit}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-semibold">Other returns</div>
              <div className="font-bold text-slate-800 mt-1">
                {otherReturns} {l.unit}
              </div>
            </div>
            <Field label="Return qty">
              <input
                className={`${qtyInputCls} ${over ? 'border-rose-400' : 'border-amber-300 bg-amber-50'} font-bold`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                disabled={maxAllowed <= 0}
                placeholder={maxAllowed <= 0 ? '—' : '0'}
                value={qty[l.itemId] ?? ''}
                onChange={(e) => setQty((q) => ({ ...q, [l.itemId]: e.target.value }))}
              />
            </Field>
          </div>
          {over && (
            <div className="text-[11px] text-rose-600 font-semibold mt-1.5">
              Max returnable is {maxAllowed} {l.unit}
            </div>
          )}
          {!over && (
            <div className="text-[11px] text-slate-500 mt-1.5">
              Previous in this return: {thisReturnPrev} {l.unit} → Now: <b>{n} {l.unit}</b>{' '}
              {condition === 'good' ? '(stock adjusted)' : '(damaged, no stock)'}
            </div>
          )}
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Reason">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((res) => (
              <option key={res}>{res}</option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Condition">
        <div className="grid grid-cols-2 gap-2 text-xs font-bold">
          <button
            type="button"
            onClick={() => setCondition('good')}
            className={`px-3 py-2.5 rounded-xl border-2 cursor-pointer text-left ${
              condition === 'good'
                ? 'border-emerald-400 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 text-slate-500'
            }`}
          >
            Good – back to stock
          </button>
          <button
            type="button"
            onClick={() => setCondition('damaged')}
            className={`px-3 py-2.5 rounded-xl border-2 cursor-pointer text-left ${
              condition === 'damaged'
                ? 'border-rose-400 bg-rose-50 text-rose-800'
                : 'border-slate-200 text-slate-500'
            }`}
          >
            Damaged – don't add to stock
          </button>
        </div>
      </Field>
      <Field label="Notes">
        <input
          className={inputCls}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />
      </Field>
      <Totals
        rows={[
          { label: 'Subtotal', value: formatINR(totals.subtotal) },
          { label: 'Credit note', value: formatINR(totals.grandTotal), bold: true },
        ]}
      />
      {totals.grandTotal > 0 && (
        <InfoBox>
          {newBalance >= 0 ? (
            <>
              Adjusted balance due: <b>{formatINR(newBalance)}</b>.
            </>
          ) : (
            <>
              <AlertTriangle className="inline w-3.5 h-3.5 mr-1 text-amber-600" />
              Adjusted balance: <b>{formatINR(-newBalance)} refund due to customer</b>.
            </>
          )}
        </InfoBox>
      )}
      <ErrorBox message={error} />
    </Sheet>
  );
};

