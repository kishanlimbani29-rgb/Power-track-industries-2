import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, Wallet, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';
import { useTrade } from '../../context/TradeContext';
import { PaymentMode, Sale } from '../../types/inventory';
import { formatINR, moneyPosition, round2, todayISODate } from '../../utils/tradeMath';
import { CustomerAccount } from './customerKhata';
import { ErrorBox, Field, inputCls, PrimaryButton, Sheet } from './TradeUI';

interface ReceivePaymentSheetProps {
  open: boolean;
  initialCustomerKey?: string | null;
  customerAccounts: CustomerAccount[];
  onClose: () => void;
  onSaved?: (info: { customerName: string; amount: number; billsCount: number; advanceAmount: number }) => void;
}

const PAY_MODES: { id: PaymentMode; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'bank', label: 'Bank' },
  { id: 'cheque', label: 'Cheque' },
];

const fmtMoney = (n: number): string => {
  const v = round2(n);
  return formatINR(v, v % 1 !== 0);
};

export const ReceivePaymentSheet: React.FC<ReceivePaymentSheetProps> = ({
  open,
  initialCustomerKey = null,
  customerAccounts,
  onClose,
  onSaved,
}) => {
  const { permissions } = useAuth();
  const { showActionToast } = useInventory();
  const { recordSalePayment, createCustomerAdvance } = useTrade();

  const [selectedKey, setSelectedKey] = useState<string | null>(initialCustomerKey);
  const [partySearch, setPartySearch] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('cash');
  const [date, setDate] = useState(() => todayISODate());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedKey(initialCustomerKey || null);
      setPartySearch('');
      setAmount('');
      setMode('cash');
      setDate(todayISODate());
      setNote('');
      setBusy(false);
      setError(null);
    }
  }, [open, initialCustomerKey]);

  const selectedAccount = useMemo(
    () => (selectedKey ? customerAccounts.find((c) => c.key === selectedKey) || null : null),
    [selectedKey, customerAccounts]
  );

  // Any customer can be picked (highest due first)
  const partyOptions = useMemo(() => {
    const q = partySearch.trim().toLowerCase();
    return [...customerAccounts]
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          c.city.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.balanceDue - a.balanceDue || a.name.localeCompare(b.name));
  }, [customerAccounts, partySearch]);

  const billsDue = useMemo(() => {
    if (!selectedAccount) return 0;
    return round2(
      selectedAccount.unpaidBills.reduce(
        (acc, b) => acc + Math.max(0, round2(moneyPosition(b).balance)),
        0
      )
    );
  }, [selectedAccount]);

  const amountNum = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  }, [amount]);

  // Oldest-first allocation plan across unpaid / part-paid invoices
  const { allocationPlan, allocatedTotal, advanceExtra } = useMemo(() => {
    if (!selectedAccount || !(amountNum > 0)) {
      return { allocationPlan: [], allocatedTotal: 0, advanceExtra: 0 };
    }
    const oldestFirst = [...selectedAccount.unpaidBills].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const steps: {
      sale: Sale;
      alloc: number;
      dueAfter: number;
      statusAfter: 'Paid' | 'Part paid';
    }[] = [];
    let rem = amountNum;
    let allocated = 0;
    for (const bill of oldestFirst) {
      if (rem <= 0.009) break;
      const dueBefore = Math.max(0, round2(moneyPosition(bill).balance));
      if (dueBefore <= 0.009) continue;
      const alloc = round2(Math.min(rem, dueBefore));
      const dueAfter = Math.max(0, round2(dueBefore - alloc));
      rem = round2(rem - alloc);
      allocated = round2(allocated + alloc);
      steps.push({
        sale: bill,
        alloc,
        dueAfter,
        statusAfter: dueAfter <= 0.009 ? 'Paid' : 'Part paid',
      });
    }
    const extra = round2(Math.max(0, amountNum - allocated));
    return {
      allocationPlan: steps,
      allocatedTotal: allocated,
      advanceExtra: extra > 0.009 ? extra : 0,
    };
  }, [selectedAccount, amountNum]);

  const canSave =
    permissions.canRecordPayments &&
    Boolean(selectedAccount) &&
    amountNum > 0 &&
    (allocationPlan.length > 0 || advanceExtra > 0) &&
    !busy;

  const handleSubmit = async () => {
    setError(null);
    if (!permissions.canRecordPayments) {
      return setError('Your role is not allowed to record payments.');
    }
    if (!selectedAccount) {
      return setError('Choose a party first.');
    }
    if (!(amountNum > 0)) {
      return setError('Enter an amount more than 0.');
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return setError('No internet connection — nothing was saved. Please try again.');
    }

    const noteClean = note.trim();
    const noteWithRef = noteClean ? `${noteClean} · On-account payment` : 'On-account payment';
    const planSnapshot = [...allocationPlan];
    const extraAdvance = advanceExtra;
    const targetAccount = selectedAccount;
    const paidAmount = amountNum;

    setBusy(true);
    showActionToast('Saving…', `${fmtMoney(paidAmount)} from ${targetAccount.name}`, 'saving');

    try {
      for (const step of planSnapshot) {
        await recordSalePayment(step.sale.id, {
          amount: step.alloc,
          date,
          mode,
          note: noteWithRef,
        });
      }
      if (extraAdvance > 0.009) {
        await createCustomerAdvance({
          partyKey: targetAccount.key,
          partyName: targetAccount.name,
          partyPhone: targetAccount.phone || undefined,
          amount: extraAdvance,
          mode,
          date,
          note: noteClean || undefined,
        });
      }

      const detailMsg =
        planSnapshot.length > 0 && extraAdvance > 0
          ? `${fmtMoney(allocatedTotal)} cleared ${planSnapshot.length} ${
              planSnapshot.length === 1 ? 'bill' : 'bills'
            } + ${fmtMoney(extraAdvance)} kept as advance.`
          : planSnapshot.length > 0
          ? `${fmtMoney(paidAmount)} cleared across ${planSnapshot.length} ${
              planSnapshot.length === 1 ? 'bill' : 'bills'
            }.`
          : `${fmtMoney(extraAdvance)} saved as customer advance.`;

      showActionToast('Payment saved', detailMsg, 'success');
      onSaved?.({
        customerName: targetAccount.name,
        amount: paidAmount,
        billsCount: planSnapshot.length,
        advanceAmount: extraAdvance,
      });
      onClose();
    } catch (e: any) {
      showActionToast('Could not save', e?.message || 'Payment could not be saved.', 'error');
      setError(e?.message || 'Could not save payment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tone="emerald"
      icon={Wallet}
      title="₹ Receive payment"
      subtitle={selectedAccount ? selectedAccount.name : 'Clears oldest bills first · Extra kept as advance'}
      footer={
        <PrimaryButton tone="emerald" busy={busy} disabled={!canSave} onClick={handleSubmit}>
          {amountNum > 0 && selectedAccount
            ? `Save ${fmtMoney(amountNum)} Payment`
            : 'Save Payment'}
        </PrimaryButton>
      }
    >
      {/* PARTY PICKER */}
      {!selectedAccount ? (
        <div className="space-y-2">
          <Field label="Party *">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                autoFocus
                value={partySearch}
                onChange={(e) => setPartySearch(e.target.value)}
                placeholder="Search customer…"
                className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              {partySearch && (
                <button
                  type="button"
                  onClick={() => setPartySearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </Field>

          <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100 bg-white">
            {partyOptions.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                {partySearch ? 'No matching customers.' : 'No customers yet.'}
              </div>
            ) : (
              partyOptions.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => {
                    setSelectedKey(c.key);
                    setError(null);
                  }}
                  className="w-full px-3 py-2.5 text-left flex items-center justify-between gap-2 hover:bg-emerald-50/60 transition cursor-pointer"
                >
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-bold text-slate-900 truncate">{c.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">
                      {[c.city, c.phone].filter(Boolean).join(' · ') ||
                        (c.unpaidBillsCount > 0 ? `${c.unpaidBillsCount} unpaid` : 'Customer')}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {c.balanceDue > 0.009 ? (
                      <span className="text-xs font-bold font-mono tabular-nums text-rose-600">
                        Due {fmtMoney(c.balanceDue)}
                      </span>
                    ) : c.balanceDue < -0.009 ? (
                      <span className="text-xs font-bold font-mono tabular-nums text-emerald-700">
                        Advance {fmtMoney(-c.balanceDue)}
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-emerald-700">₹0 due</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 truncate">{selectedAccount.name}</div>
            <div className="text-[11px] text-slate-500 truncate">
              {billsDue > 0.009 ? (
                <>
                  {selectedAccount.unpaidBillsCount}{' '}
                  {selectedAccount.unpaidBillsCount === 1 ? 'unpaid bill' : 'unpaid bills'} · Bills due{' '}
                  <b className="text-rose-600 font-mono">{fmtMoney(billsDue)}</b>
                </>
              ) : (
                'No unpaid bills'
              )}
              {selectedAccount.advanceRemaining > 0.009 && (
                <>
                  {' '}
                  · <b className="text-emerald-700 font-mono">Advance {fmtMoney(selectedAccount.advanceRemaining)}</b>
                </>
              )}
            </div>
          </div>
          {!initialCustomerKey && (
            <button
              type="button"
              onClick={() => {
                setSelectedKey(null);
                setAmount('');
                setError(null);
              }}
              className="px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-bold text-slate-700 hover:bg-slate-100 shrink-0 cursor-pointer"
            >
              Change
            </button>
          )}
        </div>
      )}

      {selectedAccount && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-bold text-slate-600">Amount (₹) *</span>
                {billsDue > 0.009 && (
                  <button
                    type="button"
                    onClick={() => setAmount(String(round2(billsDue)))}
                    className="text-[10px] font-bold text-emerald-700 hover:underline cursor-pointer"
                  >
                    Full {fmtMoney(billsDue)}
                  </button>
                )}
              </div>
              <input
                className={`${inputCls} font-mono font-bold`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                autoFocus={Boolean(initialCustomerKey)}
                placeholder="0"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                }}
              />
            </div>
            <Field label="Date">
              <input
                className={inputCls}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Paid by">
            <div className="grid grid-cols-4 gap-1.5">
              {PAY_MODES.map((m) => (
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

          <Field label="Note (optional)">
            <input
              className={inputCls}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="UTR / cheque no."
            />
          </Field>

          {(allocationPlan.length > 0 || advanceExtra > 0) && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 space-y-1.5">
              {allocationPlan.length > 0 && (
                <>
                  <div className="text-[11px] font-bold text-emerald-900 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-700" />
                    <span>Will clear (oldest first):</span>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    {allocationPlan.map((step) => (
                      <div
                        key={step.sale.id}
                        className="flex items-center justify-between gap-2 text-slate-700"
                      >
                        <span className="font-mono font-bold text-slate-900 truncate">
                          {step.sale.invoiceNumber}{' '}
                          <span className="font-sans font-semibold text-emerald-800">
                            {fmtMoney(step.alloc)}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          → <b>{step.statusAfter}</b> · Due after{' '}
                          <b className="font-mono">{fmtMoney(step.dueAfter)}</b>
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {advanceExtra > 0 && (
                <div
                  className={`text-[11px] font-bold text-emerald-800 flex items-center justify-between gap-2 ${
                    allocationPlan.length > 0 ? 'pt-1.5 border-t border-emerald-200/80' : ''
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                    <span>Advance kept</span>
                  </span>
                  <span className="font-mono text-emerald-900">{fmtMoney(advanceExtra)}</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ErrorBox message={error} />
    </Sheet>
  );
};
