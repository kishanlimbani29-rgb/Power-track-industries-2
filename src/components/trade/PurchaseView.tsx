import React, { useMemo, useState } from 'react';
import {
  ShoppingBag,
  Plus,
  Search,
  BarChart3,
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
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';
import { useTrade, PurchaseLineInput } from '../../context/TradeContext';
import { PartyInfo, Purchase, PurchaseReturn } from '../../types/inventory';
import { getItemQuantity } from '../../utils/itemResolver';
import { calcLine, formatINR, formatINRShort, GST_RATES, moneyPosition, round2, sumLines, todayISODate, weightedAverageCost } from '../../utils/tradeMath';
import { purchaseOrderPdf, purchaseReturnPdf } from '../../utils/tradeDocuments';
import { downloadExcelFile } from '../../utils/fileDownload';
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
type Filter = 'all' | 'open' | 'unpaid' | 'received' | 'cancelled' | 'returns';

type PurchaseFeedEntry =
  | { type: 'po'; data: Purchase; timestamp: string }
  | { type: 'return'; data: PurchaseReturn; timestamp: string };

const isThisMonth = (iso: string) => {
  const d = new Date(iso);
  const n = new Date();
  return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
};

export const PurchaseView: React.FC = () => {
  const { permissions } = useAuth();
  const trade = useTrade();
  const { purchases, purchaseReturns } = trade;
  const toast = useToast();
  const showPrices = permissions.canViewCostPerUnit;

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [newOpen, setNewOpen] = useState<null | 'blank' | 'lowstock'>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [receiveFor, setReceiveFor] = useState<Purchase | null>(null);
  const [payFor, setPayFor] = useState<{ po: Purchase; kind: 'payment' | 'refund' } | null>(null);
  const [returnFor, setReturnFor] = useState<Purchase | null>(null);
  const [cancelFor, setCancelFor] = useState<Purchase | null>(null);
  const [editFor, setEditFor] = useState<Purchase | null>(null);
  const [deleteFor, setDeleteFor] = useState<Purchase | null>(null);
  const [editReturnFor, setEditReturnFor] = useState<{ r: PurchaseReturn; po: Purchase } | null>(null);
  const [deleteReturnFor, setDeleteReturnFor] = useState<PurchaseReturn | null>(null);

  const detail = purchases.find((p) => p.id === detailId) || null;

  const stats = useMemo(() => {
    const live = purchases.filter((p) => p.status !== 'cancelled');
    const open = live.filter((p) => p.status === 'ordered' || p.status === 'partly_received');
    const pendingLines = open.reduce((a, p) => a + p.lines.filter((l) => ((p.receivedQty || {})[l.itemId] || 0) < l.quantity).length, 0);
    return {
      open: open.length,
      month: live.filter((p) => isThisMonth(p.createdAt)).reduce((a, p) => a + p.grandTotal, 0),
      pendingLines,
      payable: live.reduce((a, p) => a + Math.max(0, moneyPosition(p).balance), 0),
    };
  }, [purchases]);

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      purchases.filter((p) => {
        if (filter === 'open' && !(p.status === 'ordered' || p.status === 'partly_received')) return false;
        if (filter === 'unpaid' && (p.status === 'cancelled' || moneyPosition(p).balance <= 0.009)) return false;
        if (filter === 'received' && p.status !== 'received') return false;
        if (filter === 'cancelled' && p.status !== 'cancelled') return false;
        if (!q) return true;
        return p.poNumber.toLowerCase().includes(q) || p.supplier.name.toLowerCase().includes(q) || p.lines.some((l) => l.itemName.toLowerCase().includes(q));
      }),
    [purchases, filter, q]
  );
  const filteredReturns = useMemo(
    () => purchaseReturns.filter((r) => !q || r.returnNumber.toLowerCase().includes(q) || r.poNumber.toLowerCase().includes(q) || r.supplierName.toLowerCase().includes(q)),
    [purchaseReturns, q]
  );

  const feedItems = useMemo<PurchaseFeedEntry[]>(() => {
    if (filter === 'returns') {
      return filteredReturns.map((r) => ({
        type: 'return',
        data: r,
        timestamp: r.createdAt || r.date || '',
      }));
    }
    if (filter === 'all') {
      const poEntries: PurchaseFeedEntry[] = filtered.map((p) => ({
        type: 'po',
        data: p,
        timestamp: p.createdAt,
      }));
      const returnEntries: PurchaseFeedEntry[] = filteredReturns.map((r) => ({
        type: 'return',
        data: r,
        timestamp: r.createdAt || r.date || '',
      }));
      return [...poEntries, ...returnEntries].sort((a, b) => {
        const ta = new Date(a.timestamp).getTime() || 0;
        const tb = new Date(b.timestamp).getTime() || 0;
        return tb - ta;
      });
    }
    return filtered.map((p) => ({
      type: 'po',
      data: p,
      timestamp: p.createdAt,
    }));
  }, [filter, filtered, filteredReturns]);

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
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 shrink-0 rounded-2xl bg-sky-50 border border-sky-200 text-sky-600 flex items-center justify-center">
            <ShoppingBag className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">Purchase Orders</h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">Order raw materials, receive goods and pay suppliers.</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap shrink-0">
          {permissions.canExportExcel && (
            <SmallButton icon={FileSpreadsheet} onClick={exportExcel}>
              Export Excel
            </SmallButton>
          )}
          {permissions.canCreatePurchase && (
            <>
              <SmallButton tone="amber" icon={AlertTriangle} onClick={() => setNewOpen('lowstock')}>
                From Low Stock
              </SmallButton>
              <button type="button" onClick={() => setNewOpen('blank')} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer">
                <Plus className="w-3.5 h-3.5" />
                New PO
              </button>
            </>
          )}
        </div>
      </div>

      {trade.tradeError && <ErrorBox message={trade.tradeError} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Open orders" value={String(stats.open)} tone="sky" icon={ShoppingBag} />
        <StatCard label="Lines to receive" value={String(stats.pendingLines)} tone="amber" icon={Truck} />
        {showPrices && <StatCard label="Ordered (month)" value={formatINRShort(stats.month)} tone="indigo" icon={BarChart3} />}
        {showPrices && <StatCard label="Payable" value={formatINRShort(stats.payable)} tone="rose" icon={Wallet} />}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2.5">
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200">
          <Search className="w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO number, supplier or item…" className="flex-1 bg-transparent text-sm outline-none" />
        </div>
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          {(
            [
              ['all', purchaseReturns.length > 0 ? `All (${purchases.length + purchaseReturns.length})` : 'All'],
              ['open', 'To receive'],
              ...(showPrices ? [['unpaid', 'Unpaid']] : []),
              ['received', 'Received'],
              ['cancelled', 'Cancelled'],
              ...(permissions.canViewPurchaseOption ? [['returns', purchaseReturns.length > 0 ? `Returns (${purchaseReturns.length})` : 'Returns']] : []),
            ] as [Filter, string][]
          ).map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFilter(id)} className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer ${filter === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
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
                ? 'No purchase returns yet.'
                : purchases.length === 0 && purchaseReturns.length === 0
                ? 'No purchase orders yet.'
                : 'No orders or returns match this filter.'
            }
          />
        )}
        {feedItems.map((entry) => {
          if (entry.type === 'return') {
            const r = entry.data;
            const parentPo = purchases.find((p) => p.id === r.purchaseId);
            return (
              <PReturnCard
                key={`ret-${r.id}`}
                r={r}
                po={parentPo}
                showPrices={showPrices}
                canEdit={permissions.canEditPurchaseReturn}
                canDelete={permissions.canDeletePurchaseReturn}
                onEdit={(ret) => {
                  if (parentPo) setEditReturnFor({ r: ret, po: parentPo });
                }}
                onDelete={(ret) => setDeleteReturnFor(ret)}
                onError={(m) => toast.show('PDF failed', m, true)}
              />
            );
          }
          const p = entry.data;
          const pos = moneyPosition(p);
          return (
            <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono font-bold text-sm text-slate-900">{p.poNumber}</div>
                <div className="text-[11px] text-slate-400">{p.expectedDate ? `Due ${fmtDate(p.expectedDate)}` : fmtDateTime(p.createdAt)}</div>
              </div>
              <div className="flex gap-1.5 flex-wrap">
                <Chip tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Chip>
                {showPrices && p.status !== 'cancelled' && <Chip tone={PAY[pos.status].tone}>{PAY[pos.status].label}</Chip>}
                {p.returnStatus !== 'none' && <Chip tone="amber">{p.returnStatus === 'fully_returned' ? 'Fully returned' : 'Partly returned'}</Chip>}
              </div>
              <div className="font-bold text-slate-800">{p.supplier.name}</div>
              <div className="space-y-1.5">
                {p.lines.map((l) => {
                  const got = (p.receivedQty || {})[l.itemId] || 0;
                  return (
                    <div key={l.itemId} className="text-[11px]">
                      <div className="flex justify-between text-slate-600 gap-2">
                        <span className="truncate">
                          {l.itemName} ({l.unit})
                        </span>
                        <span className="font-mono font-bold shrink-0">
                          {got} / {l.quantity}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 mt-1">
                        <div className={`h-1.5 rounded-full ${got >= l.quantity ? 'bg-emerald-500' : 'bg-sky-500'}`} style={{ width: `${Math.min(100, (got / l.quantity) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {showPrices && (
                <div className="flex justify-between text-xs pt-1 border-t border-slate-100">
                  <span className="text-slate-500">
                    Total <b className="text-slate-900">{formatINR(p.grandTotal)}</b>
                  </span>
                  {p.status !== 'cancelled' && (
                    <span className={`font-bold ${pos.balance > 0.009 ? 'text-rose-600' : pos.balance < -0.009 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {pos.balance < -0.009 ? `Refund due ${formatINR(-pos.balance)}` : `Payable ${formatINR(Math.max(0, pos.balance))}`}
                    </span>
                  )}
                </div>
              )}
              {actions(p)}
            </div>
          );
        })}
        {filter !== 'returns' && <LoadMore show={trade.hasMorePurchases} onClick={trade.loadMorePurchases} />}
      </div>

      {newOpen && <NewPurchaseSheet lowStock={newOpen === 'lowstock'} onClose={() => setNewOpen(null)} onSaved={(p) => toast.show(`${p.poNumber} created`, `${p.lines.length} item(s) ordered from ${p.supplier.name}`)} />}
      {receiveFor && <ReceiveSheet po={receiveFor} showPrices={showPrices} onClose={() => setReceiveFor(null)} onSaved={() => toast.show('Goods received', 'Stock updated.')} />}
      {returnFor && <PurchaseReturnSheet po={returnFor} showPrices={showPrices} onClose={() => setReturnFor(null)} onSaved={(r) => toast.show(`Return ${r.returnNumber} saved`, showPrices ? `Debit note ${formatINR(r.total)}` : 'Stock updated.')} />}
      {detail && <PurchaseDetailSheet po={detail} showPrices={showPrices} returns={purchaseReturns.filter((r) => r.purchaseId === detail.id)} actions={actions(detail, true)} onClose={() => setDetailId(null)} />}

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
          if (payFor.kind === 'refund') await trade.recordPurchaseRefund(payFor.po.id, p);
          else await trade.recordPurchasePayment(payFor.po.id, p);
          toast.show(payFor.kind === 'refund' ? 'Refund saved' : 'Payment saved', `${formatINR(p.amount)} on ${payFor.po.poNumber}`);
        }}
      />

      {editFor && (
        <EditPurchaseSheet
          po={editFor}
          onClose={() => setEditFor(null)}
          onSaved={(p) => {
            toast.show(`PO ${p.poNumber} updated`, 'Changes saved.');
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
          await trade.deletePurchase(deleteFor.id, reason);
          toast.show(`${deleteFor.poNumber} deleted`, 'Received stock reversed if applicable.');
          const id = deleteFor.id;
          setDeleteFor(null);
          if (detailId === id) setDetailId(null);
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
          await trade.cancelPurchase(cancelFor.id, reason);
          toast.show(`${cancelFor.poNumber} cancelled`);
          setCancelFor(null);
        }}
      />
      {editReturnFor && (
        <EditPurchaseReturnSheet
          r={editReturnFor.r}
          po={editReturnFor.po}
          showPrices={showPrices}
          onClose={() => setEditReturnFor(null)}
          onSaved={(updated) => {
            toast.show(`Return ${updated.returnNumber} updated`, showPrices ? `Debit note ${formatINR(updated.total)}.` : 'Stock updated.');
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
          await trade.deletePurchaseReturn(deleteReturnFor.id, reason);
          toast.show(`${deleteReturnFor.returnNumber} deleted`, 'Debit note cancelled and stock restored to inventory.');
          setDeleteReturnFor(null);
        }}
      />
      {toast.view}
    </div>
  );
};

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{text}</div>
);

const PReturnCard: React.FC<{
  r: PurchaseReturn;
  po?: Purchase;
  showPrices: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  onEdit?: (r: PurchaseReturn) => void;
  onDelete?: (r: PurchaseReturn) => void;
  onError: (m: string) => void;
}> = ({ r, po, showPrices, canEdit, canDelete, onEdit, onDelete, onError }) => (
  <div className="bg-white rounded-2xl border border-amber-200/80 bg-gradient-to-r from-amber-50/15 via-white to-white p-4 space-y-2">
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <div className="font-mono font-bold text-sm text-slate-900">{r.returnNumber}</div>
        <Chip tone="amber">Purchase Return</Chip>
      </div>
      <div className="text-[11px] text-slate-400">{fmtDate(r.date || r.createdAt)}</div>
    </div>
    <Chip tone="slate">Against {r.poNumber}</Chip>
    <div className="font-bold text-slate-800">{r.supplierName}</div>
    <div className="text-xs text-slate-500">
      {r.lines.map((l) => `${l.itemName} × ${l.quantity}`).join(', ')} · {r.reason}
    </div>
    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100">
      {showPrices ? (
        <span className="text-slate-500">
          Debit note <b className="text-slate-900">{formatINR(r.total)}</b>
        </span>
      ) : (
        <span />
      )}
      <span className="text-slate-400">by {r.createdByName || '—'}</span>
    </div>
    <div className="flex flex-wrap gap-2">
      {showPrices && (
        <PdfButtons build={() => purchaseReturnPdf(r, po)} fileName={`${r.returnNumber}.pdf`} title={`Debit note ${r.returnNumber}`} onError={onError} />
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
  </div>
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

const NewPurchaseSheet: React.FC<{ lowStock: boolean; onClose: () => void; onSaved: (p: Purchase) => void }> = ({ lowStock, onClose, onSaved }) => {
  const { items } = useInventory();
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
    const lines: PurchaseLineInput[] = filled.map((r) => ({ itemId: r.itemId, quantity: Number(r.quantity), rate: Number(r.rate) || 0, gstPct: 0 }));
    setBusy(true);
    try {
      const po = await createPurchase({ supplier, lines, expectedDate: expected, notes });
      onSaved(po);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'The order could not be saved.');
    } finally {
      setBusy(false);
    }
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
const ReceiveSheet: React.FC<{ po: Purchase; showPrices: boolean; onClose: () => void; onSaved: () => void }> = ({ po, showPrices, onClose, onSaved }) => {
  const { items } = useInventory();
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
    setBusy(true);
    try {
      await receivePurchase(po.id, { lines: input, billNumber, billDate });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not receive the goods.');
    } finally {
      setBusy(false);
    }
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

const PurchaseReturnSheet: React.FC<{ po: Purchase; showPrices: boolean; onClose: () => void; onSaved: (r: PurchaseReturn) => void }> = ({ po, showPrices, onClose, onSaved }) => {
  const { items } = useInventory();
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
    setBusy(true);
    try {
      const r = await createPurchaseReturn(po.id, { lines: input, reason, vehicleNumber: vehicle, date, notes });
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
}> = ({ r, po, showPrices, onClose, onSaved }) => {
  const { items } = useInventory();
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
    setBusy(true);
    try {
      const updated = await editPurchaseReturn(r.id, { lines: input, reason, vehicleNumber: vehicle, date, notes });
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
const EditPurchaseSheet: React.FC<{ po: Purchase; onClose: () => void; onSaved: (p: Purchase) => void }> = ({ po, onClose, onSaved }) => {
  const { items } = useInventory();
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
    const lines: PurchaseLineInput[] = filled.map((r) => ({
      itemId: r.itemId,
      quantity: Number(r.quantity),
      rate: Number(r.rate) || 0,
      gstPct: 0,
    }));
    setBusy(true);
    try {
      const updated = await editPurchase(po.id, { supplier, lines, expectedDate: expected, notes });
      onSaved(updated);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'The purchase order could not be updated.');
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

