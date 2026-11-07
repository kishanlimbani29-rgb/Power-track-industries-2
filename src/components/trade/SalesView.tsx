import React, { useMemo, useState } from 'react';
import {
  ShoppingCart,
  Plus,
  Search,
  TrendingUp,
  BarChart3,
  Wallet,
  Undo2,
  Truck,
  CheckCircle2,
  XCircle,
  Trash2,
  FileSpreadsheet,
  Eye,
  AlertTriangle,
  Camera,
  Pencil,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';
import { useTrade, SaleLineInput } from '../../context/TradeContext';
import { PartyInfo, Sale, SalesReturn, SalesReturnCondition } from '../../types/inventory';
import { getItemQuantity } from '../../utils/itemResolver';
import { calcLine, formatINR, formatINRShort, GST_RATES, moneyPosition, round2, sumLines, todayISODate } from '../../utils/tradeMath';
import { saleInvoicePdf, salesReturnPdf } from '../../utils/tradeDocuments';
import { downloadExcelFile } from '../../utils/fileDownload';
import { PhotoBillModal } from './PhotoBillModal';
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
  StatCard,
  Totals,
  Tone,
  useToast,
  fmtDate,
  fmtDateTime,
} from './TradeUI';

const STATUS: Record<Sale['status'], { label: string; tone: Tone }> = {
  confirmed: { label: 'Confirmed', tone: 'indigo' },
  dispatched: { label: 'Dispatched', tone: 'blue' },
  delivered: { label: 'Delivered', tone: 'emerald' },
  cancelled: { label: 'Cancelled', tone: 'slate' },
};
const PAY: Record<string, { label: string; tone: Tone }> = {
  unpaid: { label: 'Unpaid', tone: 'rose' },
  partly_paid: { label: 'Partly paid', tone: 'amber' },
  paid: { label: 'Paid', tone: 'emerald' },
  refund_due: { label: 'Refund due', tone: 'amber' },
};

type Filter = 'all' | 'open' | 'unpaid' | 'delivered' | 'cancelled' | 'returns';

type SaleFeedEntry =
  | { type: 'sale'; data: Sale; timestamp: string }
  | { type: 'return'; data: SalesReturn; timestamp: string };

const isThisMonth = (iso: string) => {
  const d = new Date(iso);
  const n = new Date();
  return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
};
const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export const SalesView: React.FC = () => {
  const { permissions } = useAuth();
  const trade = useTrade();
  const { sales, salesReturns } = trade;
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [newOpen, setNewOpen] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [memoUploaded, setMemoUploaded] = useState(() => {
    try {
      return localStorage.getItem('stodo_memo_1110_uploaded') === 'true';
    } catch {
      return false;
    }
  });
  const [detailId, setDetailId] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<{ sale: Sale; kind: 'payment' | 'refund' } | null>(null);
  const [returnFor, setReturnFor] = useState<Sale | null>(null);
  const [cancelFor, setCancelFor] = useState<Sale | null>(null);
  const [editFor, setEditFor] = useState<Sale | null>(null);
  const [deleteFor, setDeleteFor] = useState<Sale | null>(null);
  const [editReturnFor, setEditReturnFor] = useState<{ r: SalesReturn; sale: Sale } | null>(null);
  const [deleteReturnFor, setDeleteReturnFor] = useState<SalesReturn | null>(null);

  const detail = sales.find((s) => s.id === detailId) || null;

  const stats = useMemo(() => {
    const live = sales.filter((s) => s.status !== 'cancelled');
    const today = live.filter((s) => isToday(s.createdAt)).reduce((a, s) => a + s.grandTotal, 0);
    const month = live.filter((s) => isThisMonth(s.createdAt)).reduce((a, s) => a + s.grandTotal, 0);
    const unpaid = live.reduce((a, s) => a + Math.max(0, moneyPosition(s).balance), 0);
    const returnsMonth = salesReturns.filter((r) => isThisMonth(r.createdAt)).reduce((a, r) => a + r.total, 0);
    const top = new Map<string, { name: string; qty: number; unit: string; value: number }>();
    for (const s of live.filter((x) => isThisMonth(x.createdAt))) {
      for (const l of s.lines) {
        const t = top.get(l.itemId) || { name: l.itemName, qty: 0, unit: l.unit, value: 0 };
        t.qty += l.quantity;
        t.value += l.amount;
        top.set(l.itemId, t);
      }
    }
    return {
      today,
      month,
      unpaid,
      returnsMonth,
      top: Array.from(top.values()).sort((a, b) => b.value - a.value).slice(0, 5),
    };
  }, [sales, salesReturns]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      sales.filter((s) => {
        if (filter === 'open' && !(s.status === 'confirmed' || s.status === 'dispatched')) return false;
        if (filter === 'unpaid' && (s.status === 'cancelled' || moneyPosition(s).balance <= 0.009)) return false;
        if (filter === 'delivered' && s.status !== 'delivered') return false;
        if (filter === 'cancelled' && s.status !== 'cancelled') return false;
        if (!q) return true;
        return (
          s.invoiceNumber.toLowerCase().includes(q) ||
          s.customer.name.toLowerCase().includes(q) ||
          (s.customer.phone || '').includes(q) ||
          s.lines.some((l) => l.itemName.toLowerCase().includes(q))
        );
      }),
    [sales, filter, q]
  );
  const filteredReturns = useMemo(
    () =>
      salesReturns.filter(
        (r) =>
          !q ||
          r.returnNumber.toLowerCase().includes(q) ||
          r.invoiceNumber.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          r.lines.some((l) => l.itemName.toLowerCase().includes(q))
      ),
    [salesReturns, q]
  );

  const feedItems = useMemo<SaleFeedEntry[]>(() => {
    if (filter === 'returns') {
      return filteredReturns.map((r) => ({
        type: 'return',
        data: r,
        timestamp: r.createdAt || r.date || '',
      }));
    }
    if (filter === 'all') {
      const salesEntries: SaleFeedEntry[] = filtered.map((s) => ({
        type: 'sale',
        data: s,
        timestamp: s.createdAt,
      }));
      const returnEntries: SaleFeedEntry[] = filteredReturns.map((r) => ({
        type: 'return',
        data: r,
        timestamp: r.createdAt || r.date || '',
      }));
      return [...salesEntries, ...returnEntries].sort((a, b) => {
        const ta = new Date(a.timestamp).getTime() || 0;
        const tb = new Date(b.timestamp).getTime() || 0;
        return tb - ta;
      });
    }
    return filtered.map((s) => ({
      type: 'sale',
      data: s,
      timestamp: s.createdAt,
    }));
  }, [filter, filtered, filteredReturns]);

  const exportExcel = () => {
    if (filter === 'returns') {
      downloadExcelFile(
        filteredReturns.map((r) => ({
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

    if (filter === 'all' && filteredReturns.length > 0) {
      downloadExcelFile(
        feedItems.map((item) => {
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
              Status: STATUS[s.status].label,
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
      filtered.map((s) => {
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
          Status: STATUS[s.status].label,
          Payment: PAY[pos.status].label,
          'Created by': s.createdByName || '',
        };
      }),
      `powertrack_sales_${todayISODate()}`,
      'Sales'
    );
  };

  const run = async (fn: () => Promise<void>, ok: string) => {
    try {
      await fn();
      toast.show(ok);
    } catch (e: any) {
      toast.show('Could not save', e?.message, true);
    }
  };

  const actions = (s: Sale, inDetail = false) => {
    const pos = moneyPosition(s);
    return (
      <div className="flex flex-wrap gap-2">
        {!inDetail && (
          <SmallButton icon={Eye} onClick={() => setDetailId(s.id)}>
            Details
          </SmallButton>
        )}
        <PdfButtons build={() => saleInvoicePdf(s)} fileName={`${s.invoiceNumber}.pdf`} title={`Invoice ${s.invoiceNumber}`} onError={(m) => toast.show('PDF failed', m, true)} />
        {permissions.canRecordPayments && s.status !== 'cancelled' && pos.balance > 0.009 && (
          <SmallButton tone="emerald" icon={Wallet} onClick={() => setPayFor({ sale: s, kind: 'payment' })}>
            Payment
          </SmallButton>
        )}
        {permissions.canRecordPayments && s.status !== 'cancelled' && pos.balance < -0.009 && (
          <SmallButton tone="amber" icon={Wallet} onClick={() => setPayFor({ sale: s, kind: 'refund' })}>
            Record Refund
          </SmallButton>
        )}
        {permissions.canCreateSales && s.status === 'confirmed' && (
          <SmallButton tone="blue" icon={Truck} onClick={() => run(() => trade.setSaleStatus(s.id, 'dispatched'), `${s.invoiceNumber} marked Dispatched`)}>
            Mark Dispatched
          </SmallButton>
        )}
        {permissions.canCreateSales && (s.status === 'confirmed' || s.status === 'dispatched') && (
          <SmallButton tone="emerald" icon={CheckCircle2} onClick={() => run(() => trade.setSaleStatus(s.id, 'delivered'), `${s.invoiceNumber} marked Delivered`)}>
            Mark Delivered
          </SmallButton>
        )}
        {permissions.canEditSales && (s.status === 'confirmed' || s.status === 'dispatched') && (
          <SmallButton tone="indigo" icon={Pencil} onClick={() => setEditFor(s)}>
            Edit
          </SmallButton>
        )}
        {permissions.canCreateSalesReturn && (s.status === 'dispatched' || s.status === 'delivered') && s.returnStatus !== 'fully_returned' && (
          <SmallButton tone="amber" icon={Undo2} onClick={() => setReturnFor(s)}>
            Return
          </SmallButton>
        )}
        {permissions.canCreateSales && (s.status === 'confirmed' || s.status === 'dispatched') && !(s.amountPaid > 0) && !(s.returnsTotal > 0) && (
          <SmallButton tone="rose" icon={XCircle} onClick={() => setCancelFor(s)}>
            Cancel
          </SmallButton>
        )}
        {permissions.canDeleteSales && (
          <SmallButton tone="rose" icon={Trash2} onClick={() => setDeleteFor(s)}>
            Delete
          </SmallButton>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 shrink-0 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
            <ShoppingCart className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">Sales & Invoices</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Sell finished goods, share invoices and track payments and returns.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 shrink-0 w-full sm:w-auto">
          {permissions.canExportExcel && (
            <div className="col-span-2 sm:col-span-1">
              <SmallButton icon={FileSpreadsheet} onClick={exportExcel}>
                Export Excel
              </SmallButton>
            </div>
          )}
          {permissions.canCreateSales && (
            <>
              <button
                type="button"
                onClick={() => setPhotoModalOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer shadow-xs transition active:scale-98"
              >
                <Camera className="w-4 h-4 text-indigo-400 shrink-0" />
                <span>Upload Bill Photo</span>
              </button>
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer shadow-xs transition active:scale-98"
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>New Sale</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Pending Photo Bill Banner (Memo 1110) */}
      {!memoUploaded && permissions.canCreateSales && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50/90 via-sky-50/90 to-emerald-50/90 p-3.5 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white border border-indigo-200 p-1 shadow-2xs shrink-0 overflow-hidden">
              <img
                src="/assets/aistudio/Image_November_03__2026_-_4_23PM_b3aa97f1"
                alt="Memo 1110 Bill Photo"
                className="w-full h-full object-cover rounded-lg"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-600 text-white shadow-2xs">
                  Pending Bill from Photo
                </span>
                <span className="text-xs font-bold text-slate-800 font-mono">Memo #1110</span>
                <span className="text-[11px] text-slate-500 font-medium">• 31/10/2026</span>
              </div>
              <p className="text-xs text-slate-600 mt-1 line-clamp-2 sm:line-clamp-none">
                Customer: <strong className="text-slate-900">Chamunda Kuwadava</strong> • Items: <strong className="text-slate-900">WB.30, WB.40Z, WB.38B20L</strong> • Rate: ₹0
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setPhotoModalOpen(true)}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs cursor-pointer flex items-center justify-center gap-1.5 transition active:scale-98"
            >
              <CheckCircle2 className="w-4 h-4" />
              Review & Upload Bill
            </button>
          </div>
        </div>
      )}

      {trade.tradeError && <ErrorBox message={trade.tradeError} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Sales today" value={formatINRShort(stats.today)} tone="emerald" icon={TrendingUp} />
        <StatCard label="This month" value={formatINRShort(stats.month)} tone="indigo" icon={BarChart3} />
        <StatCard label="Unpaid" value={formatINRShort(stats.unpaid)} tone="rose" icon={Wallet} />
        <StatCard label="Returns (month)" value={formatINRShort(stats.returnsMonth)} tone="amber" icon={Undo2} />
      </div>

      {stats.top.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">Top products this month</div>
          <div className="space-y-1.5">
            {stats.top.map((t, i) => (
              <div key={t.name} className="flex items-center justify-between text-xs gap-2">
                <span className="text-slate-700 truncate">
                  <b className="text-slate-400 mr-1.5">{i + 1}.</b>
                  {t.name}
                </span>
                <span className="font-mono text-slate-600 shrink-0">
                  {round2(t.qty)} {t.unit} · <b className="text-slate-900">{formatINR(t.value, false)}</b>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2.5">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
          <Search className="w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice, customer, phone or item…" className="flex-1 bg-transparent text-sm outline-none" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {(
            [
              ['all', salesReturns.length > 0 ? `All (${sales.length + salesReturns.length})` : 'All'],
              ['open', 'Open'],
              ['unpaid', 'Unpaid'],
              ['delivered', 'Delivered'],
              ['cancelled', 'Cancelled'],
              ['returns', salesReturns.length > 0 ? `Returns (${salesReturns.length})` : 'Returns'],
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${filter === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {feedItems.length === 0 && (
          <Empty
            text={
              filter === 'returns'
                ? 'No sales returns yet.'
                : sales.length === 0 && salesReturns.length === 0
                ? 'No sales yet. Tap “New Sale” to create your first invoice.'
                : 'No sales or returns match this filter.'
            }
          />
        )}
        {feedItems.map((entry) => {
          if (entry.type === 'return') {
            const r = entry.data;
            const parentSale = sales.find((s) => s.id === r.saleId);
            return (
              <ReturnCard
                key={`ret-${r.id}`}
                r={r}
                sale={parentSale}
                canEdit={permissions.canEditSalesReturn}
                canDelete={permissions.canDeleteSalesReturn}
                onEdit={(ret) => {
                  if (parentSale) setEditReturnFor({ r: ret, sale: parentSale });
                }}
                onDelete={(ret) => setDeleteReturnFor(ret)}
                onError={(m) => toast.show('PDF failed', m, true)}
              />
            );
          }
          const s = entry.data;
          const pos = moneyPosition(s);
          return (
            <div key={s.id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono font-bold text-sm text-slate-900">{s.invoiceNumber}</div>
                <div className="text-[11px] text-slate-400">{fmtDateTime(s.createdAt)}</div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <Chip tone={STATUS[s.status].tone}>{STATUS[s.status].label}</Chip>
                {s.status !== 'cancelled' && <Chip tone={PAY[pos.status].tone}>{PAY[pos.status].label}</Chip>}
                {s.returnStatus !== 'none' && <Chip tone="amber">{s.returnStatus === 'fully_returned' ? 'Fully returned' : 'Partly returned'}</Chip>}
              </div>
              <div className="font-bold text-slate-800">{s.customer.name}</div>
              <div className="flex flex-wrap gap-1.5">
                {s.lines.map((l) => (
                  <span key={l.itemId} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
                    {l.itemName} × {l.quantity}
                  </span>
                ))}
              </div>
              <div className="flex justify-between text-xs pt-1 border-t border-slate-100">
                <span className="text-slate-500">
                  Total <b className="text-slate-900">{formatINR(s.grandTotal)}</b>
                </span>
                {s.status !== 'cancelled' && (
                  <span className={`font-bold ${pos.balance > 0.009 ? 'text-rose-600' : pos.balance < -0.009 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {pos.balance < -0.009 ? `Refund ${formatINR(-pos.balance)}` : `Due ${formatINR(Math.max(0, pos.balance))}`}
                  </span>
                )}
              </div>
              {actions(s)}
            </div>
          );
        })}
        {filter !== 'returns' && <LoadMore show={trade.hasMoreSales} onClick={trade.loadMoreSales} />}
      </div>

      <NewSaleSheet open={newOpen} onClose={() => setNewOpen(false)} onSaved={(s) => toast.show(`Sale ${s.invoiceNumber} saved`, `Stock taken off for ${s.lines.length} item(s).`)} />

      {detail && (
        <SaleDetailSheet sale={detail} onClose={() => setDetailId(null)} returns={salesReturns.filter((r) => r.saleId === detail.id)} actions={actions(detail, true)} showProfit={permissions.canViewFinances} onError={(m) => toast.show('PDF failed', m, true)} />
      )}

      <PaymentSheet
        open={!!payFor}
        onClose={() => setPayFor(null)}
        title={payFor?.kind === 'refund' ? `Refund · ${payFor?.sale.invoiceNumber}` : `Payment · ${payFor?.sale.invoiceNumber || ''}`}
        subtitle={payFor?.sale.customer.name || ''}
        maxAmount={payFor ? Math.abs(moneyPosition(payFor.sale).balance) : 0}
        maxLabel={payFor?.kind === 'refund' ? 'Refund due to customer' : 'Balance due'}
        submitLabel={payFor?.kind === 'refund' ? 'Save Refund' : 'Save Payment'}
        onSubmit={async (p) => {
          if (!payFor) return;
          if (payFor.kind === 'refund') await trade.recordSaleRefund(payFor.sale.id, p);
          else await trade.recordSalePayment(payFor.sale.id, p);
          toast.show(payFor.kind === 'refund' ? 'Refund saved' : 'Payment saved', `${formatINR(p.amount)} on ${payFor.sale.invoiceNumber}`);
        }}
      />

      {returnFor && <SalesReturnSheet sale={returnFor} onClose={() => setReturnFor(null)} onSaved={(r) => toast.show(`Return ${r.returnNumber} saved`, `Credit note ${formatINR(r.total)}`)} />}

      {editFor && (
        <EditSaleSheet
          sale={editFor}
          onClose={() => setEditFor(null)}
          onSaved={(s) => {
            toast.show(`Sale ${s.invoiceNumber} updated`, 'Stock adjustments saved.');
            setEditFor(null);
            if (detailId === s.id) setDetailId(s.id);
          }}
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
          await trade.deleteSale(deleteFor.id, reason);
          toast.show(`${deleteFor.invoiceNumber} deleted`, 'Allocated stock restored to inventory.');
          const id = deleteFor.id;
          setDeleteFor(null);
          if (detailId === id) setDetailId(null);
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
          await trade.cancelSale(cancelFor.id, reason);
          toast.show(`${cancelFor.invoiceNumber} cancelled`, 'Stock returned.');
          setCancelFor(null);
        }}
      />

      {editReturnFor && (
        <EditSalesReturnSheet
          r={editReturnFor.r}
          sale={editReturnFor.sale}
          onClose={() => setEditReturnFor(null)}
          onSaved={(updated) => {
            toast.show(`Return ${updated.returnNumber} updated`, `Credit note ${formatINR(updated.total)}.`);
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
          await trade.deleteSalesReturn(deleteReturnFor.id, reason);
          toast.show(`${deleteReturnFor.returnNumber} deleted`, 'Credit note cancelled and stock reversed.');
          setDeleteReturnFor(null);
        }}
      />

      <PhotoBillModal
        open={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
        onSaved={(savedSale) => {
          setMemoUploaded(true);
          toast.show(`${savedSale.invoiceNumber} created from Memo #1110`);
          setDetailId(savedSale.id);
        }}
      />

      {toast.view}
    </div>
  );
};

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{text}</div>
);

const ReturnCard: React.FC<{
  r: SalesReturn;
  sale?: Sale;
  canEdit?: boolean;
  canDelete?: boolean;
  onEdit?: (r: SalesReturn) => void;
  onDelete?: (r: SalesReturn) => void;
  onError: (m: string) => void;
}> = ({ r, sale, canEdit, canDelete, onEdit, onDelete, onError }) => (
  <div className="bg-white rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50/15 via-white to-white p-4 space-y-2">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <div className="font-mono font-bold text-sm text-slate-900">{r.returnNumber}</div>
        <Chip tone="amber">Sales Return</Chip>
      </div>
      <div className="text-[11px] text-slate-400">{fmtDate(r.date || r.createdAt)}</div>
    </div>
    <div className="flex gap-1.5 flex-wrap">
      <Chip tone={r.condition === 'good' ? 'emerald' : 'rose'}>{r.condition === 'good' ? 'Back to stock' : 'Damaged'}</Chip>
      <Chip tone="slate">Against {r.invoiceNumber}</Chip>
    </div>
    <div className="font-bold text-slate-800">{r.customerName}</div>
    <div className="text-xs text-slate-500">{r.lines.map((l) => `${l.itemName} × ${l.quantity}`).join(', ')} · {r.reason}</div>
    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
      <span className="text-slate-500">
        Credit note <b className="text-slate-900">{formatINR(r.total)}</b>
      </span>
      <span className="text-slate-400">by {r.createdByName || '—'}</span>
    </div>
    <div className="flex flex-wrap gap-2">
      <PdfButtons build={() => salesReturnPdf(r, sale)} fileName={`${r.returnNumber}.pdf`} title={`Credit note ${r.returnNumber}`} onError={onError} />
      {canEdit && onEdit && sale && (
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
  </div>
);

// ---------------------------------------------------------------------------
// New Sale
// ---------------------------------------------------------------------------
interface Row {
  key: string;
  itemId: string;
  quantity: string;
  rate: string;
  discountPct: string;
}
const emptyRow = (): Row => ({ key: Math.random().toString(36).slice(2), itemId: '', quantity: '', rate: '', discountPct: '0' });

const NewSaleSheet: React.FC<{ open: boolean; onClose: () => void; onSaved: (s: Sale) => void }> = ({ open, onClose, onSaved }) => {
  const { items } = useInventory();
  const { customers, createSale } = useTrade();
  const [customer, setCustomer] = useState<PartyInfo>({ name: '', phone: '', gstin: '', address: '' });
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [vehicle, setVehicle] = useState('');
  const [tracking, setTracking] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setCustomer({ name: '', phone: '', gstin: '', address: '' });
      setRows([emptyRow()]);
      setVehicle('');
      setTracking('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  const sellable = useMemo(
    () =>
      [...items].sort((a, b) => {
        const fa = a.type === 'finished_good' ? 0 : 1;
        const fb = b.type === 'finished_good' ? 0 : 1;
        return fa - fb || a.name.localeCompare(b.name);
      }),
    [items]
  );

  const computed = rows.map((r) => {
    const item = items.find((i) => i.id === r.itemId);
    const qty = Number(r.quantity) || 0;
    const stock = item ? getItemQuantity(item) : 0;
    const calc = calcLine({ quantity: qty, rate: Number(r.rate) || 0, discountPct: Number(r.discountPct) || 0 });
    return { r, item, qty, stock, over: !!item && qty > stock, ...calc };
  });
  const totals = sumLines(computed.filter((c) => c.item));
  const anyOver = computed.some((c) => c.over);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async () => {
    setError(null);
    if (!customer.name.trim()) return setError('Enter the customer name.');
    const filled = rows.filter((r) => r.itemId);
    if (!filled.length) return setError('Add at least one item.');
    if (filled.some((r) => !(Number(r.quantity) > 0))) return setError('Enter a quantity on every item row.');
    if (anyOver) return setError('One of the quantities is more than the stock on hand.');
    const lines: SaleLineInput[] = filled.map((r) => ({
      itemId: r.itemId,
      quantity: Number(r.quantity),
      rate: Number(r.rate) || 0,
      discountPct: Number(r.discountPct) || 0,
      gstPct: 0,
    }));
    setBusy(true);
    try {
      const sale = await createSale({ customer, lines, vehicleNumber: vehicle, trackingNumber: tracking, notes });
      onSaved(sale);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'The sale could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tone="emerald"
      icon={ShoppingCart}
      title="New Sale"
      subtitle="Stock is taken off when you save"
      wide
      footer={
        <>
          <PrimaryButton tone="indigo" busy={busy} disabled={anyOver} onClick={submit}>
            Save Sale & Take Stock Off
          </PrimaryButton>
          {anyOver && <div className="text-[10px] text-center text-rose-500 mt-1.5">Fix the red row to continue</div>}
        </>
      }
    >
      <PartyFields label="Customer" value={customer} onChange={setCustomer} suggestions={customers} withAddress listId="sale-customers" />

      <div className="flex justify-between items-center pt-1">
        <div className="text-xs font-bold text-slate-700">Items</div>
        <SmallButton tone="indigo" icon={Plus} onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          Add Item
        </SmallButton>
      </div>

      {computed.map(({ r, item, stock, over, amount }) => {
        const usedElsewhere = new Set(rows.filter((x) => x.key !== r.key).map((x) => x.itemId));
        return (
          <div key={r.key} className={`rounded-xl border p-3 space-y-2 ${over ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'}`}>
            <div className="flex gap-2 items-start">
              <select
                className={inputCls}
                value={r.itemId}
                onChange={(e) => {
                  const it = items.find((i) => i.id === e.target.value);
                  update(r.key, { itemId: e.target.value, rate: it ? String(it.sellingPrice || '') : '' });
                }}
              >
                <option value="">— Choose item —</option>
                {sellable
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
              <div className={`text-[11px] font-mono ${over ? 'text-rose-600' : 'text-slate-500'}`}>
                In stock: <b>{stock} {item.unit}</b>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Field label="Qty">
                <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
              </Field>
              <Field label="Rate ₹">
                <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={r.rate} onChange={(e) => update(r.key, { rate: e.target.value })} />
              </Field>
              <Field label="Disc %">
                <input className={inputCls} type="number" inputMode="decimal" min="0" max="100" step="any" value={r.discountPct} onChange={(e) => update(r.key, { discountPct: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-between text-[11px]">
              {over ? <span className="text-rose-600 font-semibold">Only {stock} {item?.unit} in stock — reduce the quantity</span> : <span />}
              <span className="font-bold text-slate-900">{formatINR(amount)}</span>
            </div>
          </div>
        );
      })}

      <Totals
        rows={[
          { label: 'Subtotal', value: formatINR(totals.subtotal) },
          { label: 'Grand total', value: formatINR(totals.grandTotal), bold: true },
        ]}
      />

      <div className="grid grid-cols-2 gap-2">
        <Field label="Vehicle no.">
          <input className={inputCls} value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder="Optional" />
        </Field>
        <Field label="LR / Tracking no.">
          <input className={inputCls} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
      <Field label="Notes">
        <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </Field>
      <ErrorBox message={error} />
    </Sheet>
  );
};

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
}> = ({ sale, returns, actions, showProfit, onClose, onError }) => {
  const pos = moneyPosition(sale);
  const cost = sale.lines.reduce((a, l) => a + (l.costPrice || 0) * l.quantity, 0);
  const profit = round2(sale.subtotal - cost);
  return (
    <Sheet open onClose={onClose} tone="emerald" icon={ShoppingCart} title={`${sale.invoiceNumber} · ${STATUS[sale.status].label}`} subtitle={`${sale.customer.name}${sale.customer.phone ? ` · ${sale.customer.phone}` : ''}`} wide>
      <div className="flex gap-1.5 flex-wrap">
        <Chip tone={STATUS[sale.status].tone}>{STATUS[sale.status].label}</Chip>
        {sale.status !== 'cancelled' && <Chip tone={PAY[pos.status].tone}>{PAY[pos.status].label}</Chip>}
      </div>
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
        {sale.lines.map((l) => (
          <div key={l.itemId} className="p-3 text-xs flex justify-between gap-2">
            <div className="min-w-0">
              <div className="font-bold text-slate-800 truncate">{l.itemName}</div>
              <div className="text-slate-500">
                {l.quantity} {l.unit} × {formatINR(l.rate)}
                {l.discountPct ? ` − ${l.discountPct}%` : ''}
                {(sale.returnedQty || {})[l.itemId] ? <span className="text-amber-600"> · returned {(sale.returnedQty || {})[l.itemId]}</span> : null}
              </div>
            </div>
            <div className="font-bold text-slate-900 shrink-0">{formatINR(l.amount)}</div>
          </div>
        ))}
      </div>
      <Totals
        rows={[
          { label: 'Subtotal', value: formatINR(sale.subtotal) },
          { label: 'Invoice total', value: formatINR(sale.grandTotal), bold: true },
          ...(sale.returnsTotal ? [{ label: 'Returns (credit notes)', value: `− ${formatINR(sale.returnsTotal)}` }] : []),
          { label: 'Paid', value: formatINR(pos.netPaid) },
          { label: pos.balance < 0 ? 'Refund due' : 'Balance due', value: formatINR(Math.abs(pos.balance)), bold: true },
          ...(showProfit ? [{ label: 'Profit (before returns)', value: `${formatINR(profit)} (${sale.subtotal ? round2((profit / sale.subtotal) * 100) : 0}%)` }] : []),
        ]}
      />
      {(sale.payments || []).length + (sale.refunds || []).length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Payments</div>
          {[...(sale.payments || []).map((p) => ({ ...p, refund: false })), ...(sale.refunds || []).map((p) => ({ ...p, refund: true }))].map((p) => (
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
            <div key={r.id} className="flex items-center justify-between gap-2 text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
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

const SalesReturnSheet: React.FC<{ sale: Sale; onClose: () => void; onSaved: (r: SalesReturn) => void }> = ({ sale, onClose, onSaved }) => {
  const { items } = useInventory();
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
    const calc = calcLine({ quantity: n, rate: l.rate, discountPct: l.discountPct, gstPct: l.gstPct });
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
    setBusy(true);
    try {
      const r = await createSalesReturn(sale.id, { lines: input, reason, condition, date, notes });
      onSaved(r);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'The return could not be saved.');
    } finally {
      setBusy(false);
    }
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
        <div key={l.itemId} className={`rounded-xl border p-3 ${over ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'}`}>
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
          {over && <div className="text-[11px] text-rose-600 font-semibold mt-1.5">Only {left} {l.unit} can still be returned</div>}
          {!over && n > 0 && condition === 'good' && (
            <div className="text-[11px] text-slate-500 mt-1.5">
              Stock goes {getItemQuantity(items.find((i) => i.id === l.itemId) || ({ quantity: 0 } as any))} → {round2(getItemQuantity(items.find((i) => i.id === l.itemId) || ({ quantity: 0 } as any)) + n)} {l.unit}
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
          <button type="button" onClick={() => setCondition('good')} className={`px-3 py-2.5 rounded-xl border-2 cursor-pointer text-left ${condition === 'good' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'}`}>
            Good – back to stock
          </button>
          <button type="button" onClick={() => setCondition('damaged')} className={`px-3 py-2.5 rounded-xl border-2 cursor-pointer text-left ${condition === 'damaged' ? 'border-rose-400 bg-rose-50 text-rose-800' : 'border-slate-200 text-slate-500'}`}>
            Damaged – don't add to stock
          </button>
        </div>
      </Field>
      <Field label="Notes">
        <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
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
              The customer has paid more than the new total, so <b>{formatINR(-newBalance)} refund is due</b>.
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
}> = ({ r, sale, onClose, onSaved }) => {
  const { items } = useInventory();
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
    const otherReturns = Math.max(0, round2((sale.returnedQty || {})[l.itemId] || 0) - thisReturnPrev);
    const maxAllowed = round2(l.quantity - otherReturns);
    const n = Number(qty[l.itemId]) || 0;
    const calc = calcLine({ quantity: n, rate: l.rate, discountPct: l.discountPct, gstPct: l.gstPct });
    return { l, otherReturns, thisReturnPrev, maxAllowed, n, over: n > maxAllowed + 1e-9, ...calc };
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
    setBusy(true);
    try {
      const updated = await editSalesReturn(r.id, { lines: input, reason, condition, date, notes });
      onSaved(updated);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'The return could not be updated.');
    } finally {
      setBusy(false);
    }
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
        <div key={l.itemId} className={`rounded-xl border p-3 ${over ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'}`}>
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
          {over && <div className="text-[11px] text-rose-600 font-semibold mt-1.5">Max returnable is {maxAllowed} {l.unit}</div>}
          {!over && (
            <div className="text-[11px] text-slate-500 mt-1.5">
              Previous in this return: {thisReturnPrev} {l.unit} → Now: <b>{n} {l.unit}</b> {condition === 'good' ? '(stock adjusted)' : '(damaged, no stock)'}
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
          <button type="button" onClick={() => setCondition('good')} className={`px-3 py-2.5 rounded-xl border-2 cursor-pointer text-left ${condition === 'good' ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'}`}>
            Good – back to stock
          </button>
          <button type="button" onClick={() => setCondition('damaged')} className={`px-3 py-2.5 rounded-xl border-2 cursor-pointer text-left ${condition === 'damaged' ? 'border-rose-400 bg-rose-50 text-rose-800' : 'border-slate-200 text-slate-500'}`}>
            Damaged – don't add to stock
          </button>
        </div>
      </Field>
      <Field label="Notes">
        <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
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

// ---------------------------------------------------------------------------
// Edit Sale Sheet
// ---------------------------------------------------------------------------
const EditSaleSheet: React.FC<{ sale: Sale; onClose: () => void; onSaved: (s: Sale) => void }> = ({ sale, onClose, onSaved }) => {
  const { items } = useInventory();
  const { customers, editSale } = useTrade();

  const [customer, setCustomer] = useState<PartyInfo>(() => ({
    name: sale.customer.name,
    phone: sale.customer.phone || '',
    gstin: sale.customer.gstin || '',
    address: sale.customer.address || '',
  }));

  const [rows, setRows] = useState<Row[]>(() =>
    sale.lines.map((l) => ({
      key: Math.random().toString(36).slice(2),
      itemId: l.itemId,
      quantity: String(l.quantity),
      rate: String(l.rate),
      discountPct: String(l.discountPct || 0),
    }))
  );

  const [vehicle, setVehicle] = useState(sale.vehicleNumber || '');
  const [tracking, setTracking] = useState(sale.trackingNumber || '');
  const [notes, setNotes] = useState(sale.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Map of original quantities on this sale to compute effective stock availability
  const originalAllocated = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of sale.lines) {
      map.set(l.itemId, (map.get(l.itemId) || 0) + l.quantity);
    }
    return map;
  }, [sale]);

  const sellable = useMemo(
    () =>
      [...items].sort((a, b) => {
        const fa = a.type === 'finished_good' ? 0 : 1;
        const fb = b.type === 'finished_good' ? 0 : 1;
        return fa - fb || a.name.localeCompare(b.name);
      }),
    [items]
  );

  const computed = rows.map((r) => {
    const item = items.find((i) => i.id === r.itemId);
    const qty = Number(r.quantity) || 0;
    const baseStock = item ? getItemQuantity(item) : 0;
    const origAlloc = r.itemId ? originalAllocated.get(r.itemId) || 0 : 0;
    const available = baseStock + origAlloc;
    const calc = calcLine({
      quantity: qty,
      rate: Number(r.rate) || 0,
      discountPct: Number(r.discountPct) || 0,
    });
    return { r, item, qty, baseStock, available, over: !!item && qty > available, ...calc };
  });

  const totals = sumLines(computed.filter((c) => c.item));
  const anyOver = computed.some((c) => c.over);

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async () => {
    setError(null);
    if (!customer.name.trim()) return setError('Enter the customer name.');
    const filled = rows.filter((r) => r.itemId);
    if (!filled.length) return setError('Add at least one item.');
    if (filled.some((r) => !(Number(r.quantity) > 0))) return setError('Enter a quantity on every item row.');
    if (anyOver) return setError('One of the quantities exceeds the total available stock (stock on hand + already allocated).');

    const lines: SaleLineInput[] = filled.map((r) => ({
      itemId: r.itemId,
      quantity: Number(r.quantity),
      rate: Number(r.rate) || 0,
      discountPct: Number(r.discountPct) || 0,
      gstPct: 0,
    }));

    setBusy(true);
    try {
      const updated = await editSale(sale.id, {
        customer,
        lines,
        vehicleNumber: vehicle,
        trackingNumber: tracking,
        notes,
      });
      onSaved(updated);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'The sale could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      tone="indigo"
      icon={Pencil}
      title={`Edit Sale · ${sale.invoiceNumber}`}
      subtitle="Stock is automatically adjusted based on net quantity differences"
      wide
      footer={
        <>
          <PrimaryButton tone="indigo" busy={busy} disabled={anyOver} onClick={submit}>
            Save Changes & Update Stock
          </PrimaryButton>
          {anyOver && <div className="text-[10px] text-center text-rose-500 mt-1.5">Fix the red row to continue</div>}
        </>
      }
    >
      <PartyFields label="Customer" value={customer} onChange={setCustomer} suggestions={customers} withAddress listId="sale-customers" />

      <div className="flex justify-between items-center pt-1">
        <div className="text-xs font-bold text-slate-700">Items</div>
        <SmallButton tone="indigo" icon={Plus} onClick={() => setRows((rs) => [...rs, emptyRow()])}>
          Add Item
        </SmallButton>
      </div>

      {computed.map(({ r, item, available, over, amount }) => {
        const usedElsewhere = new Set(rows.filter((x) => x.key !== r.key).map((x) => x.itemId));
        return (
          <div key={r.key} className={`rounded-xl border p-3 space-y-2 ${over ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'}`}>
            <div className="flex gap-2 items-start">
              <select
                className={inputCls}
                value={r.itemId}
                onChange={(e) => {
                  const it = items.find((i) => i.id === e.target.value);
                  update(r.key, { itemId: e.target.value, rate: it ? String(it.sellingPrice || '') : '' });
                }}
              >
                <option value="">— Choose item —</option>
                {sellable
                  .filter((it) => !usedElsewhere.has(it.id))
                  .map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} (available {getItemQuantity(it) + (originalAllocated.get(it.id) || 0)} {it.unit})
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
              <div className={`text-[11px] font-mono ${over ? 'text-rose-600' : 'text-slate-500'}`}>
                Available for this order: <b>{available} {item.unit}</b>
              </div>
            )}
            <div className="grid grid-cols-3 gap-2">
              <Field label="Qty">
                <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={r.quantity} onChange={(e) => update(r.key, { quantity: e.target.value })} />
              </Field>
              <Field label="Rate ₹">
                <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={r.rate} onChange={(e) => update(r.key, { rate: e.target.value })} />
              </Field>
              <Field label="Disc %">
                <input className={inputCls} type="number" inputMode="decimal" min="0" max="100" step="any" value={r.discountPct} onChange={(e) => update(r.key, { discountPct: e.target.value })} />
              </Field>
            </div>
            <div className="text-right text-xs font-mono text-slate-600">
              Line total: <b className="text-slate-900">{formatINR(amount)}</b>
            </div>
          </div>
        );
      })}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Vehicle No.">
          <input className={inputCls} value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. GJ-03-AB-1234" />
        </Field>
        <Field label="Tracking / LR">
          <input className={inputCls} value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="e.g. LR-98765" />
        </Field>
      </div>

      <Field label="Notes">
        <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Terms, delivery instructions…" />
      </Field>

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

