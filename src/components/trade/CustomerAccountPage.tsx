import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  MessageCircle,
  MoreVertical,
  Pencil,
  Phone,
  Plus,
  Trash2,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';
import { useTrade } from '../../context/TradeContext';
import { CustomerAdvance, PartyInfo, PaymentEntry, PaymentMode, Sale } from '../../types/inventory';
import { CustomerAccount, KhataEntry } from './customerKhata';
import { formatINR, moneyPosition, round2, todayISODate } from '../../utils/tradeMath';
import { customerStatementPdf } from '../../utils/tradeDocuments';
import { shareOrDownloadPdf } from '../../utils/tradePdf';
import { formatShortDate } from '../../utils/numberFormat';
import { canChangeEntry, formatLockReason } from '../../utils/changeWindow';
import {
  ErrorBox,
  Field,
  InfoBox,
  PrimaryButton,
  Sheet,
  fmtDate,
  inputCls,
} from './TradeUI';

interface CustomerAccountPageProps {
  account: CustomerAccount;
  canRecordPayments: boolean;
  canCreateSales: boolean;
  canEditPayments: boolean;
  canDeletePayments: boolean;
  onBack: () => void;
  onOpenInvoice: (saleId: string) => void;
  onReceivePayment: () => void;
  onNewSaleForCustomer: (party: PartyInfo) => void;
  onError: (msg: string) => void;
}

export function getInitials(name: string): string {
  const words = (name || 'C').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'C';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const fmtShortDate = (iso?: string): string => {
  if (!iso) return '';
  return formatShortDate(iso, true);
};

const fmtCompactMoney = (n: number): string => {
  const v = round2(n);
  return '₹' + v.toLocaleString('en-IN', {
    minimumFractionDigits: v % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

const fmtPartyBalanceText = (n: number): string => {
  const v = round2(n);
  if (v < -0.009) return `Advance ${fmtCompactMoney(-v)}`;
  return fmtCompactMoney(Math.max(0, v));
};

const buildWhatsAppPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const EDIT_PAYMENT_MODES: { id: PaymentMode; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'bank', label: 'Bank' },
  { id: 'cheque', label: 'Cheque' },
];

type PaymentTarget =
  | {
      kind: 'sale_payment';
      sale: Sale;
      payment: PaymentEntry;
      amount: number;
      mode: PaymentMode;
      date: string;
      note: string;
    }
  | {
      kind: 'advance';
      advance: CustomerAdvance;
      amount: number;
      mode: PaymentMode;
      date: string;
      note: string;
    };

function targetFromRow(row: KhataEntry): PaymentTarget | null {
  if (row.kind === 'payment' && row.sale && row.paymentEntry) {
    return {
      kind: 'sale_payment',
      sale: row.sale,
      payment: row.paymentEntry,
      amount: round2(row.paymentEntry.amount || 0),
      mode: row.paymentEntry.mode || 'cash',
      date: (row.paymentEntry.date || todayISODate()).slice(0, 10),
      note: row.paymentEntry.note || '',
    };
  }
  if (row.kind === 'advance' && row.advance) {
    return {
      kind: 'advance',
      advance: row.advance,
      amount: round2(row.advance.amount || 0),
      mode: row.advance.mode || 'cash',
      date: (row.advance.date || todayISODate()).slice(0, 10),
      note: row.advance.note || '',
    };
  }
  return null;
}

export const CustomerAccountPage: React.FC<CustomerAccountPageProps> = ({
  account,
  canRecordPayments,
  canCreateSales,
  canEditPayments,
  canDeletePayments,
  onBack,
  onOpenInvoice,
  onReceivePayment,
  onNewSaleForCustomer,
  onError,
}) => {
  const { permissions, role, realUserUid } = useAuth();
  const { showActionToast } = useInventory();
  const {
    editSalePayment,
    deleteSalePayment,
    editCustomerAdvance,
    deleteCustomerAdvance,
  } = useTrade();

  const [sharingPdf, setSharingPdf] = useState(false);

  // Floating ⋮ menu state
  const [menuState, setMenuState] = useState<{
    rowId: string;
    target: PaymentTarget;
    top: number;
    right: number;
  } | null>(null);

  // Edit / Remove sheets
  const [editingTarget, setEditingTarget] = useState<PaymentTarget | null>(null);
  const [removingTarget, setRemovingTarget] = useState<PaymentTarget | null>(null);

  useEffect(() => {
    if (!menuState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuState(null);
    };
    const onScroll = () => setMenuState(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [menuState]);

  const hasPhone = Boolean(account.phone && account.phone.replace(/\D/g, '').length >= 6);
  const hasBalanceDue = account.balanceDue > 0.009;
  const hasAdvanceCredit = account.balanceDue < -0.009;
  const canManagePayments = canEditPayments || canDeletePayments;

  // WhatsApp reminder URL (opens WhatsApp directly without window.open)
  const billNumbersText = account.unpaidBills.map((b) => b.invoiceNumber).join(', ');
  const waAmountText = round2(account.balanceDue).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });
  const waMessage = `Namaste ${account.name}, your balance with Power Track is ₹${waAmountText} for bills ${billNumbersText || 'pending'}. Kindly pay. Thank you.`;
  const waPhone = buildWhatsAppPhone(account.phone);
  const waHref = waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waMessage)}`
    : `https://wa.me/?text=${encodeURIComponent(waMessage)}`;

  const handleShareStatement = async () => {
    if (sharingPdf) return;
    setSharingPdf(true);
    try {
      const blob = customerStatementPdf({
        customer: {
          name: account.name,
          phone: account.phone || undefined,
          address: account.address || undefined,
        },
        totalBought: account.totalBought,
        totalPaid: account.totalPaid,
        totalReturns: account.totalReturns,
        balanceDue: account.balanceDue,
        rows: account.khataRows.map((r) => {
          const baseDetail = r.subDetail ? `${r.detail} (${r.subDetail})` : r.detail;
          const detailWithInfo =
            r.kind === 'advance_use' && r.infoAmount
              ? `${baseDetail} (${fmtCompactMoney(r.infoAmount)})`
              : baseDetail;
          return {
            date: r.date,
            detail: detailWithInfo,
            billAmount: r.billAmount,
            paidAmount: r.paidAmount,
            balanceAfter: r.balanceAfter,
          };
        }),
      });
      const safeName = account.name.replace(/\s+/g, '_') || 'Customer';
      await shareOrDownloadPdf(
        blob,
        `Statement_${safeName}.pdf`,
        `${account.name} — Khata Statement`,
        'share'
      );
    } catch (e: any) {
      onError(e?.message || 'Could not generate statement PDF.');
    } finally {
      setSharingPdf(false);
    }
  };

  const openMenuForRow = (e: React.MouseEvent<HTMLButtonElement>, row: KhataEntry) => {
    e.stopPropagation();
    const target = targetFromRow(row);
    if (!target) return;
    if (menuState?.rowId === row.id) {
      setMenuState(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuHeight = (canEditPayments ? 40 : 0) + (canDeletePayments ? 40 : 0) + 12;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top =
      spaceBelow < menuHeight + 16
        ? Math.max(8, rect.top - menuHeight - 4)
        : rect.bottom + 4;
    const right = Math.max(8, window.innerWidth - rect.right);
    setMenuState({ rowId: row.id, target, top, right });
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-8">
      {/* Back Link */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-indigo-600 transition cursor-pointer py-1"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Customers</span>
        </button>
      </div>

      {/* Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-12 h-12 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-sm flex items-center justify-center shrink-0">
              {getInitials(account.name)}
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                {account.name}
              </h1>
              <p className="text-xs text-slate-500 truncate mt-0.5">
                {[account.city, account.phone].filter(Boolean).join(' · ') || 'No contact details'}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            {hasBalanceDue ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-rose-600">
                  Balance due
                </div>
                <div className="text-base sm:text-lg font-black text-rose-600 font-mono tabular-nums">
                  {formatINR(account.balanceDue, false)}
                </div>
              </div>
            ) : hasAdvanceCredit ? (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                  Advance
                </div>
                <div className="text-base sm:text-lg font-black text-emerald-700 font-mono tabular-nums">
                  {formatINR(-account.balanceDue, false)}
                </div>
              </div>
            ) : (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold">
                Settled
              </span>
            )}
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100">
          {hasPhone && (
            <a
              href={`tel:${account.phone.replace(/\s+/g, '')}`}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition active:scale-95"
            >
              <Phone className="w-3.5 h-3.5 text-slate-600" />
              <span>Call</span>
            </a>
          )}

          {hasBalanceDue && (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition active:scale-95"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>Remind</span>
            </a>
          )}

          {canRecordPayments && (
            <button
              type="button"
              onClick={onReceivePayment}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition cursor-pointer active:scale-95"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>₹ Receive payment</span>
            </button>
          )}

          {canCreateSales && (
            <button
              type="button"
              onClick={() => onNewSaleForCustomer(account.party)}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-700 text-white transition cursor-pointer active:scale-95 ml-auto sm:ml-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Sale</span>
            </button>
          )}
        </div>

        {/* 3 Small Stats */}
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center">
          <div className="bg-slate-50 rounded-xl px-2 py-2 border border-slate-100">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Total bought
            </div>
            <div className="text-xs sm:text-sm font-bold text-slate-900 font-mono tabular-nums mt-0.5 truncate">
              {formatINR(account.totalBought, false)}
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl px-2 py-2 border border-slate-100">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Paid
            </div>
            <div className="text-xs sm:text-sm font-bold text-emerald-700 font-mono tabular-nums mt-0.5 truncate">
              {formatINR(account.totalPaid, false)}
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl px-2 py-2 border border-slate-100">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Bills
            </div>
            <div className="text-xs sm:text-sm font-bold text-slate-900 font-mono tabular-nums mt-0.5">
              {account.billsCount}
            </div>
          </div>
        </div>
      </div>

      {/* Khata Table (newest first) */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
        <table className="w-full table-fixed text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <th className="py-2.5 pl-2.5 sm:pl-3 pr-1 w-[15%]">Date</th>
              <th className={`py-2.5 px-1 ${canManagePayments ? 'w-[32%]' : 'w-[35%]'}`}>Detail</th>
              <th className="py-2.5 px-1 text-right w-[15%]">Bill</th>
              <th className="py-2.5 px-1 text-right w-[15%]">Paid</th>
              <th
                className={`py-2.5 pl-1 ${
                  canManagePayments ? 'pr-1 w-[17%]' : 'pr-3 w-[18%]'
                } text-right`}
              >
                Bal
              </th>
              {canManagePayments && <th className="py-2.5 pr-1.5 w-[26px]" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-[11px] sm:text-xs">
            {account.khataRows.length === 0 ? (
              <tr>
                <td colSpan={canManagePayments ? 6 : 5} className="py-8 text-center text-slate-400 text-xs">
                  No active transactions for this customer.
                </td>
              </tr>
            ) : (
              account.khataRows.map((row) => {
                const isBillClickable = row.kind === 'bill' && Boolean(row.sale);
                const isPaymentEntry =
                  (row.kind === 'payment' && Boolean(row.sale) && Boolean(row.paymentEntry)) ||
                  (row.kind === 'advance' && Boolean(row.advance));

                const changeCheck =
                  canManagePayments && isPaymentEntry
                    ? row.kind === 'payment' && row.sale && row.paymentEntry
                      ? canChangeEntry(
                          {
                            createdByUid: row.paymentEntry.recordedBy || row.sale.createdBy,
                            createdByName: row.paymentEntry.recordedByName || row.sale.createdByName,
                            createdAt:
                              row.paymentEntry.recordedAt ||
                              row.paymentEntry.date ||
                              row.sale.createdAt,
                          },
                          realUserUid,
                          permissions,
                          role
                        )
                      : row.advance
                      ? canChangeEntry(
                          {
                            createdByUid: row.advance.createdBy,
                            createdByName: row.advance.createdByName,
                            createdAt: row.advance.createdAt || row.advance.date,
                          },
                          realUserUid,
                          permissions,
                          role
                        )
                      : null
                    : null;

                const isEditableRow = Boolean(canManagePayments && isPaymentEntry && changeCheck?.allowed);

                return (
                  <tr
                    key={row.id}
                    onClick={() => {
                      if (isBillClickable && row.sale) onOpenInvoice(row.sale.id);
                    }}
                    className={
                      isBillClickable
                        ? 'hover:bg-indigo-50/50 active:bg-indigo-50 cursor-pointer transition'
                        : ''
                    }
                  >
                    <td className="py-2.5 pl-2.5 sm:pl-3 pr-1 align-top text-slate-500 whitespace-nowrap">
                      {fmtShortDate(row.date)}
                    </td>
                    <td className="py-2.5 px-1 align-top min-w-0">
                      <div
                        className={`font-semibold leading-snug break-words line-clamp-2 ${
                          row.kind === 'advance' || row.kind === 'advance_use'
                            ? 'text-emerald-800'
                            : isBillClickable
                            ? 'text-slate-900'
                            : 'text-slate-700'
                        }`}
                      >
                        {row.detail}
                      </div>
                      {row.subDetail && (
                        <div className="text-[10px] text-slate-400 leading-tight mt-0.5 truncate">
                          {row.subDetail}
                        </div>
                      )}
                      {changeCheck && !changeCheck.allowed && (
                        <div className="text-[10px] text-slate-400 leading-tight mt-0.5 break-words">
                          {formatLockReason(changeCheck.reason)}
                        </div>
                      )}
                      {changeCheck &&
                        changeCheck.allowed &&
                        role !== 'admin' &&
                        changeCheck.timeLeftLabel && (
                          <div className="text-[10px] text-slate-400 leading-tight mt-0.5">
                            Can change for {changeCheck.timeLeftLabel} more
                          </div>
                        )}
                    </td>
                    <td className="py-2.5 px-1 text-right align-top font-mono tabular-nums text-rose-600 font-semibold whitespace-nowrap">
                      {row.billAmount !== null && row.billAmount > 0
                        ? fmtCompactMoney(row.billAmount)
                        : '—'}
                    </td>
                    <td className="py-2.5 px-1 text-right align-top font-mono tabular-nums font-semibold whitespace-nowrap">
                      {row.paidAmount !== null && row.paidAmount > 0 ? (
                        <span className="text-emerald-600">{fmtCompactMoney(row.paidAmount)}</span>
                      ) : row.kind === 'advance_use' && row.infoAmount ? (
                        <span
                          className="text-[10px] font-medium text-emerald-700/75"
                          title="Adjusted from advance"
                        >
                          ({fmtCompactMoney(row.infoAmount)})
                        </span>
                      ) : (
                        <span className="text-emerald-600">—</span>
                      )}
                    </td>
                    <td
                      className={`py-2.5 pl-1 ${
                        canManagePayments ? 'pr-1' : 'pr-3'
                      } text-right align-top font-mono tabular-nums font-bold whitespace-nowrap ${
                        row.balanceAfter < -0.009 ? 'text-emerald-700' : 'text-slate-900'
                      }`}
                    >
                      {row.balanceAfter < -0.009
                        ? `Adv ${fmtCompactMoney(-row.balanceAfter)}`
                        : fmtCompactMoney(row.balanceAfter)}
                    </td>
                    {canManagePayments && (
                      <td className="py-1.5 pr-1 align-top text-right">
                        {isEditableRow ? (
                          <button
                            type="button"
                            onClick={(e) => openMenuForRow(e, row)}
                            aria-label="Payment actions"
                            className="w-6 h-7 rounded-lg inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition cursor-pointer"
                          >
                            <MoreVertical className="w-3.5 h-3.5" />
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Bottom Link: Share statement */}
      <div className="flex justify-center pt-1">
        <button
          type="button"
          onClick={handleShareStatement}
          disabled={sharingPdf || account.khataRows.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition cursor-pointer active:scale-95 disabled:opacity-50"
        >
          <FileText className="w-4 h-4" />
          <span>{sharingPdf ? 'Creating PDF…' : 'Share statement'}</span>
        </button>
      </div>

      {/* Floating ⋮ Action Popover */}
      {menuState && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuState(null)}
            aria-hidden="true"
          />
          <div
            style={{ top: menuState.top, right: menuState.right }}
            className="fixed z-50 w-36 bg-white rounded-xl shadow-xl border border-slate-200 py-1 overflow-hidden"
          >
            {canEditPayments && (
              <button
                type="button"
                onClick={() => {
                  const t = menuState.target;
                  setMenuState(null);
                  setEditingTarget(t);
                }}
                className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 active:bg-slate-100 flex items-center gap-2 cursor-pointer"
              >
                <Pencil className="w-3.5 h-3.5 text-indigo-600" />
                <span>Edit</span>
              </button>
            )}
            {canDeletePayments && (
              <button
                type="button"
                onClick={() => {
                  const t = menuState.target;
                  setMenuState(null);
                  setRemovingTarget(t);
                }}
                className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 active:bg-rose-100 flex items-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>
        </>
      )}

      {/* Edit Payment / Advance Sheet */}
      {editingTarget && (
        <EditPaymentEntrySheet
          target={editingTarget}
          onClose={() => setEditingTarget(null)}
          onSave={async (input) => {
            if (editingTarget.kind === 'sale_payment') {
              await editSalePayment(editingTarget.sale.id, editingTarget.payment.id, input);
              showActionToast('Payment updated', `${editingTarget.sale.invoiceNumber}`, 'success');
            } else {
              await editCustomerAdvance(editingTarget.advance.id, input);
              showActionToast('Advance updated', `${account.name}`, 'success');
            }
          }}
        />
      )}

      {/* Remove Payment / Advance Confirm Sheet */}
      {removingTarget && (
        <RemovePaymentConfirmSheet
          target={removingTarget}
          currentPartyDue={account.balanceDue}
          onClose={() => setRemovingTarget(null)}
          onConfirm={async () => {
            if (removingTarget.kind === 'sale_payment') {
              await deleteSalePayment(removingTarget.sale.id, removingTarget.payment.id);
              showActionToast('Payment removed', `${removingTarget.sale.invoiceNumber}`, 'success');
            } else {
              await deleteCustomerAdvance(removingTarget.advance.id);
              showActionToast('Advance removed', `${account.name}`, 'success');
            }
          }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Edit Payment / Advance Bottom Sheet
// ---------------------------------------------------------------------------
const EditPaymentEntrySheet: React.FC<{
  target: PaymentTarget;
  onClose: () => void;
  onSave: (p: { amount: number; mode: PaymentMode; date: string; note: string }) => Promise<void>;
}> = ({ target, onClose, onSave }) => {
  const [amount, setAmount] = useState(String(target.amount));
  const [mode, setMode] = useState<PaymentMode>(
    EDIT_PAYMENT_MODES.some((m) => m.id === target.mode) ? target.mode : 'cash'
  );
  const [date, setDate] = useState(target.date || todayISODate());
  const [note, setNote] = useState(target.note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSalePay = target.kind === 'sale_payment';
  const maxForInvoice = isSalePay
    ? Math.max(0, round2(moneyPosition(target.sale).balance + target.payment.amount))
    : Infinity;
  const usedAdvance =
    target.kind === 'advance'
      ? round2((target.advance.uses || []).reduce((a, u) => a + (u.amount || 0), 0))
      : 0;
  const usedInvoicesLabel =
    target.kind === 'advance'
      ? Array.from(new Set((target.advance.uses || []).map((u) => u.invoiceNumber))).join(', ')
      : '';

  const submit = async () => {
    setError(null);
    const num = round2(Number(amount));
    if (!(num > 0)) {
      setError('Enter an amount more than 0.');
      return;
    }
    if (isSalePay && num > maxForInvoice + 0.009) {
      setError(`Max ${fmtCompactMoney(maxForInvoice)} for ${target.sale.invoiceNumber}`);
      return;
    }
    if (target.kind === 'advance' && num < usedAdvance - 0.009) {
      setError(
        `${fmtCompactMoney(usedAdvance)} already used on ${usedInvoicesLabel || 'invoices'}`
      );
      return;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('No internet connection — nothing was saved. Please try again.');
      return;
    }
    setBusy(true);
    try {
      await onSave({ amount: num, mode, date: date || todayISODate(), note });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not update payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      tone="emerald"
      icon={CheckCircle2}
      title={isSalePay ? 'Edit payment' : 'Edit advance payment'}
      subtitle={
        isSalePay
          ? `${target.sale.invoiceNumber} · ${target.sale.customer.name}`
          : target.advance.partyName
      }
      footer={
        <PrimaryButton tone="emerald" busy={busy} onClick={submit}>
          Save changes
        </PrimaryButton>
      }
    >
      {isSalePay ? (
        <InfoBox>
          Max for {target.sale.invoiceNumber}: <b>{formatINR(maxForInvoice, maxForInvoice % 1 !== 0)}</b>
        </InfoBox>
      ) : usedAdvance > 0.009 ? (
        <InfoBox>
          Minimum <b>{formatINR(usedAdvance, usedAdvance % 1 !== 0)}</b> (already used on{' '}
          <b>{usedInvoicesLabel || 'invoices'}</b>)
        </InfoBox>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Amount (₹) *">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError(null);
            }}
            className={inputCls}
            autoFocus
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="Paid by">
        <div className="grid grid-cols-4 gap-1.5">
          {EDIT_PAYMENT_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`py-2 rounded-lg text-xs font-bold border cursor-pointer transition ${
                mode === m.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Note">
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="UTR / cheque no. / note (optional)"
          className={inputCls}
        />
      </Field>

      <ErrorBox message={error} />
    </Sheet>
  );
};

// ---------------------------------------------------------------------------
// Remove Payment / Advance Confirm Sheet
// ---------------------------------------------------------------------------
const RemovePaymentConfirmSheet: React.FC<{
  target: PaymentTarget;
  currentPartyDue: number;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}> = ({ target, currentPartyDue, onClose, onConfirm }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amt = target.amount;
  const nextDue = round2(currentPartyDue + amt);
  const isAdvanceUsed =
    target.kind === 'advance' && (target.advance.uses || []).length > 0;

  const submit = async () => {
    setError(null);
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setError('No internet connection — nothing was saved. Please try again.');
      return;
    }
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not remove payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      tone="rose"
      icon={Trash2}
      title="Remove payment?"
      subtitle={
        target.kind === 'sale_payment'
          ? `${target.sale.invoiceNumber} · ${target.sale.customer.name}`
          : target.advance.partyName
      }
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="py-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-bold hover:bg-slate-50 cursor-pointer disabled:opacity-50"
          >
            Go Back
          </button>
          <PrimaryButton tone="rose" busy={busy} onClick={submit}>
            Remove
          </PrimaryButton>
        </div>
      }
    >
      <p className="text-sm text-slate-700 leading-relaxed">
        Remove payment of <b>{fmtCompactMoney(amt)}</b> on <b>{fmtDate(target.date)}</b>? Party due
        goes from <b>{fmtPartyBalanceText(currentPartyDue)}</b> to{' '}
        <b>{fmtPartyBalanceText(nextDue)}</b>.
      </p>

      {isAdvanceUsed && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5">
          Part of this advance was applied to bills ({target.advance.uses.map((u) => u.invoiceNumber).join(', ')}). Removing it will also remove those advance adjustments.
        </div>
      )}

      <ErrorBox message={error} />
    </Sheet>
  );
};
