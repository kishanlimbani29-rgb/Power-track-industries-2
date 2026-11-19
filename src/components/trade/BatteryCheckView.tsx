import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BatteryCharging,
  Check,
  Package,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';
import { useTrade } from '../../context/TradeContext';
import { BatteryCheck, InventoryItem, Sale } from '../../types/inventory';
import { getItemQuantity } from '../../utils/itemResolver';
import { formatINR, round2, todayISODate } from '../../utils/tradeMath';
import { CustomerAccount, getCustomerKey } from './customerKhata';
import { ErrorBox, Field, fmtDate, inputCls, PrimaryButton, Sheet } from './TradeUI';

interface BatteryCheckViewProps {
  customerAccounts: CustomerAccount[];
  onBack: () => void;
  backHandlerRef?: React.MutableRefObject<(() => void) | null>;
}

type FaultyAction = 'replaced' | 'repaired_returned' | 'taken_back';

const fmtMoney = (n: number): string => {
  const v = round2(n);
  return formatINR(v, v % 1 !== 0);
};

const daysElapsed = (iso?: string): number => {
  if (!iso) return 0;
  const t = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

export const BatteryCheckView: React.FC<BatteryCheckViewProps> = ({
  customerAccounts,
  onBack,
  backHandlerRef,
}) => {
  const { permissions } = useAuth();
  const { items, showActionToast } = useInventory();
  const {
    batteryChecks,
    sales,
    salesReturns,
    customers: partySuggestions,
    createBatteryCheck,
    resolveBatteryCheck,
  } = useTrade();

  const [tab, setTab] = useState<'checking' | 'done'>('checking');
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [resolvingCheck, setResolvingCheck] = useState<BatteryCheck | null>(null);

  const handleBackAction = useCallback(() => {
    if (resolvingCheck) {
      setResolvingCheck(null);
      return;
    }
    if (receiveOpen) {
      setReceiveOpen(false);
      return;
    }
    onBack();
  }, [resolvingCheck, receiveOpen, onBack]);

  useEffect(() => {
    if (backHandlerRef) {
      backHandlerRef.current = handleBackAction;
      return () => {
        backHandlerRef.current = null;
      };
    }
  }, [backHandlerRef, handleBackAction]);

  const checkingList = useMemo(
    () =>
      batteryChecks
        .filter((c) => c.status === 'checking')
        .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()),
    [batteryChecks]
  );

  const doneList = useMemo(
    () =>
      batteryChecks
        .filter((c) => c.status !== 'checking')
        .sort(
          (a, b) =>
            new Date(b.resolvedAt || b.receivedAt).getTime() -
            new Date(a.resolvedAt || a.receivedAt).getTime()
        ),
    [batteryChecks]
  );

  // 30-day summary stats for Done tab
  const summary30 = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    const recent = batteryChecks.filter((c) => {
      const ms = new Date(c.receivedAt).getTime();
      return Number.isFinite(ms) && ms >= cutoff;
    });
    const okCount = recent.filter((c) => c.status === 'ok_returned').length;
    const faulty = recent.filter(
      (c) =>
        c.status === 'replaced' ||
        c.status === 'repaired_returned' ||
        c.status === 'taken_back'
    );
    const modelCounts = new Map<string, number>();
    for (const c of faulty) {
      modelCounts.set(c.itemName, (modelCounts.get(c.itemName) || 0) + (c.quantity || 1));
    }
    let topModel = '—';
    let topCount = 0;
    for (const [name, cnt] of modelCounts.entries()) {
      if (cnt > topCount) {
        topCount = cnt;
        topModel = name;
      }
    }
    return {
      total: recent.length,
      ok: okCount,
      faulty: faulty.length,
      topModel,
    };
  }, [batteryChecks]);

  const creditAmountForCheck = (c: BatteryCheck): number => {
    if (typeof c.creditAmount === 'number') return c.creditAmount;
    if (!c.linkedSaleIds || c.linkedSaleIds.length === 0) return 0;
    const linkedSet = new Set(c.linkedSaleIds);
    return round2(
      salesReturns
        .filter((r) => linkedSet.has(r.saleId) && r.lines.some((l) => l.itemId === c.itemId))
        .reduce((acc, r) => acc + (r.total || 0), 0)
    );
  };

  if (receiveOpen) {
    return (
      <ReceiveForCheckPage
        customerAccounts={customerAccounts}
        partySuggestions={partySuggestions}
        sales={sales}
        items={items}
        onCancel={() => setReceiveOpen(false)}
        onSubmit={async (input) => {
          await createBatteryCheck(input);
          showActionToast(
            'Received for check',
            `${input.partyName} · ${items.find((i) => i.id === input.itemId)?.name || 'Battery'}`,
            'success'
          );
          setReceiveOpen(false);
          setTab('checking');
        }}
      />
    );
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-24">
      {/* Sticky Top Header */}
      <div
        style={{ top: 'calc(4rem + env(safe-area-inset-top))' }}
        className="sticky z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 flex items-center justify-between gap-3"
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Sales</span>
        </button>
        <h1 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight truncate">
          Battery check
        </h1>
        <div className="w-14 shrink-0" aria-hidden />
      </div>

      {/* Tabs: Checking (n) | Done */}
      <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 rounded-xl">
        <button
          type="button"
          onClick={() => setTab('checking')}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-bold transition cursor-pointer ${
            tab === 'checking'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Checking ({checkingList.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('done')}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-bold transition cursor-pointer ${
            tab === 'done'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Done
        </button>
      </div>

      {/* CHECKING TAB */}
      {tab === 'checking' && (
        <div className="space-y-2.5">
          {checkingList.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              No batteries currently in checking. Tap &quot;＋ Receive for check&quot; when a customer brings one in.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-2xs">
              {checkingList.map((c) => {
                const days = daysElapsed(c.receivedAt);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      if (permissions.canCreateSalesReturn) {
                        setResolvingCheck(c);
                      }
                    }}
                    className="w-full text-left px-3.5 py-3 flex items-start justify-between gap-3 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="text-sm font-bold text-slate-900 truncate">{c.partyName}</div>
                      <div className="text-xs text-slate-700 break-words">
                        {c.itemName} × {c.quantity} · &quot;{c.problem}&quot;
                        {c.serial ? ` · S/N ${c.serial}` : ''}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Received {fmtDate(c.receivedAt)} · {days} {days === 1 ? 'day' : 'days'}
                      </div>
                    </div>
                    <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      Checking
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* DONE TAB */}
      {tab === 'done' && (
        <div className="space-y-3">
          {/* Slim 30-day summary bar */}
          <div className="bg-slate-900 text-white rounded-2xl p-3 grid grid-cols-4 gap-2 text-center shadow-sm">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                30d Total
              </div>
              <div className="text-xs sm:text-sm font-bold font-mono tabular-nums mt-0.5">
                {summary30.total}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                OK
              </div>
              <div className="text-xs sm:text-sm font-bold font-mono tabular-nums text-emerald-400 mt-0.5">
                {summary30.ok}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Faulty
              </div>
              <div className="text-xs sm:text-sm font-bold font-mono tabular-nums text-amber-400 mt-0.5">
                {summary30.faulty}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Most ret.
              </div>
              <div
                className="text-[11px] sm:text-xs font-bold text-slate-100 mt-0.5 truncate"
                title={summary30.topModel}
              >
                {summary30.topModel}
              </div>
            </div>
          </div>

          {doneList.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
              No completed battery checks yet.
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-2xs">
              {doneList.map((c) => {
                let chipText = 'OK · given back';
                let chipCls = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                if (c.status === 'replaced') {
                  chipText = 'Replaced';
                  chipCls = 'bg-indigo-50 text-indigo-700 border-indigo-200';
                } else if (c.status === 'repaired_returned') {
                  chipText = 'Repaired · given back';
                  chipCls = 'bg-sky-50 text-sky-700 border-sky-200';
                } else if (c.status === 'taken_back') {
                  const cred = creditAmountForCheck(c);
                  chipText = cred > 0 ? `Taken back · due −${fmtMoney(cred)}` : 'Taken back';
                  chipCls = 'bg-rose-50 text-rose-700 border-rose-200';
                }

                return (
                  <div key={c.id} className="px-3.5 py-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-bold text-slate-900 truncate min-w-0">
                        {c.partyName}
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${chipCls}`}
                      >
                        {chipText}
                      </span>
                    </div>
                    <div className="text-xs text-slate-700 break-words">
                      {c.itemName} × {c.quantity} · &quot;{c.problem}&quot;
                      {c.serial ? ` · S/N ${c.serial}` : ''}
                    </div>
                    <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                      <span>{fmtDate(c.resolvedAt || c.receivedAt)}</span>
                      {c.resultNote && <span className="text-slate-600">· {c.resultNote}</span>}
                      {c.resolvedByName && <span>· {c.resolvedByName}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Floating "+ Receive for check" button */}
      {permissions.canCreateSalesReturn && (
        <div
          style={{ bottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
          className="fixed right-4 z-30"
        >
          <button
            type="button"
            onClick={() => setReceiveOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-3 rounded-full text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white shadow-lg cursor-pointer active:scale-95 transition"
          >
            <Plus className="w-4 h-4" />
            <span>Receive for check</span>
          </button>
        </div>
      )}

      {/* Enter check result bottom sheet */}
      {resolvingCheck && (
        <ResolveCheckSheet
          check={resolvingCheck}
          items={items}
          sales={sales}
          onClose={() => setResolvingCheck(null)}
          onSave={async (outcome, resultNote) => {
            const updated = await resolveBatteryCheck(resolvingCheck.id, { outcome, resultNote });
            const msg =
              outcome === 'ok_returned'
                ? 'Marked OK · given back'
                : outcome === 'replaced'
                ? 'Replaced with new battery (stock deducted)'
                : outcome === 'repaired_returned'
                ? 'Marked Repaired · given back'
                : `Taken back · due −${fmtMoney(updated.creditAmount || 0)}`;
            showActionToast('Battery check updated', msg, 'success');
            setResolvingCheck(null);
          }}
        />
      )}
    </div>
  );
};

// ============================================================================
// Receive for check (full page)
// ============================================================================
const ReceiveForCheckPage: React.FC<{
  customerAccounts: CustomerAccount[];
  partySuggestions: { key: string; name: string; phone?: string }[];
  sales: Sale[];
  items: InventoryItem[];
  onCancel: () => void;
  onSubmit: (input: {
    partyName: string;
    partyPhone?: string;
    itemId: string;
    quantity: number;
    serial?: string;
    problem: string;
    receivedAt: string;
  }) => Promise<void>;
}> = ({ customerAccounts, partySuggestions, sales, items, onCancel, onSubmit }) => {
  const [partyName, setPartyName] = useState('');
  const [partyPhone, setPartyPhone] = useState('');
  const [partyDropOpen, setPartyDropOpen] = useState(false);
  const partyBoxRef = useRef<HTMLDivElement>(null);

  const [itemId, setItemId] = useState('');
  const [itemPickerOpen, setItemPickerOpen] = useState(false);
  const [itemSearch, setItemSearch] = useState('');

  const [quantity, setQuantity] = useState('1');
  const [serial, setSerial] = useState('');
  const [problem, setProblem] = useState('');
  const [receivedDate, setReceivedDate] = useState(() => todayISODate());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (partyDropOpen && partyBoxRef.current && !partyBoxRef.current.contains(e.target as Node)) {
        setPartyDropOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [partyDropOpen]);

  const partyChoices = useMemo(() => {
    const list: { key: string; name: string; phone: string }[] = customerAccounts.map((a) => ({
      key: a.key,
      name: a.name,
      phone: a.phone || '',
    }));
    const seen = new Set(list.map((c) => c.name.trim().toLowerCase()));
    for (const p of partySuggestions) {
      const clean = p.name.trim().toLowerCase();
      if (!seen.has(clean)) {
        list.push({ key: p.key, name: p.name, phone: p.phone || '' });
      }
    }
    const q = partyName.trim().toLowerCase();
    return (q ? list.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q)) : list).slice(0, 8);
  }, [customerAccounts, partySuggestions, partyName]);

  // Compute total qty of each item bought by this party
  const boughtByParty = useMemo(() => {
    const map = new Map<string, number>();
    const clean = partyName.trim().toLowerCase();
    if (!clean) return map;
    const targetKey = getCustomerKey({ name: partyName, phone: partyPhone });
    for (const s of sales) {
      if (s.status === 'cancelled') continue;
      const sk = getCustomerKey(s.customer);
      const match =
        sk === targetKey || (s.customer?.name || '').trim().toLowerCase() === clean;
      if (!match) continue;
      for (const l of s.lines) {
        map.set(l.itemId, round2((map.get(l.itemId) || 0) + l.quantity));
      }
    }
    return map;
  }, [sales, partyName, partyPhone]);

  const sortedItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    const list = q
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            (i.sku || '').toLowerCase().includes(q) ||
            (i.category || '').toLowerCase().includes(q)
        )
      : items;
    return [...list].sort((a, b) => {
      const ba = boughtByParty.get(a.id) || 0;
      const bb = boughtByParty.get(b.id) || 0;
      if (ba > 0 && bb === 0) return -1;
      if (bb > 0 && ba === 0) return 1;
      if (ba !== bb) return bb - ba;
      const fa = a.type === 'finished_good' || a.type === 'both' ? 0 : 1;
      const fb = b.type === 'finished_good' || b.type === 'both' ? 0 : 1;
      return fa - fb || a.name.localeCompare(b.name);
    });
  }, [items, boughtByParty, itemSearch]);

  const selectedItem = items.find((i) => i.id === itemId) || null;
  const qtyNum = Number(quantity);
  const canSubmit =
    Boolean(partyName.trim()) &&
    Boolean(selectedItem) &&
    Number.isFinite(qtyNum) &&
    qtyNum > 0 &&
    Boolean(problem.trim()) &&
    !busy;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!partyName.trim()) return setError('Enter customer name.');
    if (!selectedItem) return setError('Select the battery item.');
    if (!(qtyNum > 0)) return setError('Enter quantity more than 0.');
    if (!problem.trim()) return setError('Describe the problem.');
    setBusy(true);
    try {
      await onSubmit({
        partyName: partyName.trim(),
        partyPhone: partyPhone.trim(),
        itemId: selectedItem.id,
        quantity: qtyNum,
        serial: serial.trim() || undefined,
        problem: problem.trim(),
        receivedAt: receivedDate,
      });
    } catch (err: any) {
      setError(err?.message || 'Could not save battery check.');
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-32">
      <div
        style={{ top: 'calc(4rem + env(safe-area-inset-top))' }}
        className="sticky z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-4 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 flex items-center justify-between gap-3"
      >
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 cursor-pointer shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Cancel</span>
        </button>
        <h1 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight truncate">
          Receive for check
        </h1>
        <div className="w-16 shrink-0" aria-hidden />
      </div>

      <form id="battery-receive-form" onSubmit={handleSave} className="space-y-4">
        {/* Party */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
          <div className="relative" ref={partyBoxRef}>
            <Field label="Party *">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={partyName}
                  onFocus={() => setPartyDropOpen(true)}
                  onChange={(e) => {
                    setPartyName(e.target.value);
                    setPartyDropOpen(true);
                  }}
                  placeholder="Search customer or type name…"
                  className="w-full pl-9 pr-8 py-2.5 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                />
                {partyName && (
                  <button
                    type="button"
                    onClick={() => {
                      setPartyName('');
                      setPartyDropOpen(true);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </Field>

            {partyDropOpen && partyChoices.length > 0 && (
              <div className="absolute left-0 right-0 mt-1 bg-white rounded-2xl shadow-xl border border-slate-200 z-30 max-h-56 overflow-y-auto divide-y divide-slate-100">
                {partyChoices.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      setPartyName(c.name);
                      if (c.phone) setPartyPhone(c.phone);
                      setPartyDropOpen(false);
                    }}
                    className="w-full px-3.5 py-2.5 text-left hover:bg-purple-50/70 flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="text-xs sm:text-sm font-bold text-slate-900 truncate">{c.name}</span>
                    {c.phone && <span className="text-[11px] text-slate-500 shrink-0">{c.phone}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Field label="Phone (optional)">
            <input
              type="tel"
              className={inputCls}
              value={partyPhone}
              onChange={(e) => setPartyPhone(e.target.value)}
              placeholder="Mobile no."
            />
          </Field>
        </div>

        {/* Battery & details */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
          <div>
            <span className="block text-[11px] font-bold text-slate-600 mb-1">Battery *</span>
            <button
              type="button"
              onClick={() => {
                setItemSearch('');
                setItemPickerOpen(true);
              }}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-left flex items-center justify-between gap-2 cursor-pointer"
            >
              <span className={`text-sm truncate ${selectedItem ? 'font-bold text-slate-900' : 'text-slate-400'}`}>
                {selectedItem ? selectedItem.name : 'Choose battery model…'}
              </span>
              {selectedItem && (boughtByParty.get(selectedItem.id) || 0) > 0 && (
                <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  bought {boughtByParty.get(selectedItem.id)} from you
                </span>
              )}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Qty *">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className={inputCls}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </Field>
            <Field label="Date">
              <input
                type="date"
                className={inputCls}
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Serial / batch (optional)">
            <input
              type="text"
              className={inputCls}
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="e.g. PT-2409-018"
            />
          </Field>

          <Field label="Problem *">
            <input
              type="text"
              className={inputCls}
              value={problem}
              onChange={(e) => setProblem(e.target.value)}
              placeholder="e.g. Not holding charge, swollen…"
            />
          </Field>
        </div>

        <ErrorBox message={error} />
      </form>

      {/* Bottom Sticky Save Bar */}
      <div
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        className="fixed bottom-0 left-0 right-0 lg:left-64 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 py-3 shadow-lg"
      >
        <div className="max-w-3xl mx-auto">
          <PrimaryButton type="submit" form="battery-receive-form" tone="indigo" busy={busy} disabled={!canSubmit}>
            Receive for check
          </PrimaryButton>
        </div>
      </div>

      {/* Battery Item Picker Modal */}
      {itemPickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => setItemPickerOpen(false)}
        >
          <div
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[82vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Choose battery</h3>
                <p className="text-[11px] text-slate-500">
                  {partyName.trim() ? `Items bought by ${partyName.trim()} shown first` : 'Select battery item'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setItemPickerOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 border-b border-slate-100 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  autoFocus
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Search battery or SKU…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {sortedItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">No matching items.</div>
              ) : (
                sortedItems.map((it) => {
                  const bought = boughtByParty.get(it.id) || 0;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => {
                        setItemId(it.id);
                        setItemPickerOpen(false);
                      }}
                      className="w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-purple-50/70 transition cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                        <Package className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-semibold text-slate-900 truncate">
                          {it.name}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                          <span>stock {getItemQuantity(it)} {it.unit}</span>
                          {bought > 0 && (
                            <span className="font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded-full border border-indigo-200 text-[10px]">
                              bought {bought} from you
                            </span>
                          )}
                        </div>
                      </div>
                      {itemId === it.id && <Check className="w-4 h-4 text-purple-600 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Enter check result bottom sheet
// ============================================================================
const ResolveCheckSheet: React.FC<{
  check: BatteryCheck;
  items: InventoryItem[];
  sales: Sale[];
  onClose: () => void;
  onSave: (outcome: 'ok_returned' | FaultyAction, note: string) => Promise<void>;
}> = ({ check, items, sales, onClose, onSave }) => {
  const [verdict, setVerdict] = useState<'ok' | 'faulty'>('ok');
  const [faultyAction, setFaultyAction] = useState<FaultyAction>('replaced');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = items.find((i) => i.id === check.itemId);
  const onHand = item ? getItemQuantity(item) : 0;
  const notEnoughStock = onHand < check.quantity;

  // Preview take-back returnable invoices newest first
  const takeBackPreview = useMemo(() => {
    const partyKey = getCustomerKey({ name: check.partyName, phone: check.partyPhone });
    const cleanPartyName = check.partyName.trim().toLowerCase();
    const partySales = sales
      .filter((s) => {
        if (s.status === 'cancelled') return false;
        const sk = getCustomerKey(s.customer);
        return sk === partyKey || (s.customer?.name || '').trim().toLowerCase() === cleanPartyName;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    let remaining = round2(check.quantity);
    const matched: { invoiceNumber: string; qty: number }[] = [];
    let availTotal = 0;
    for (const s of partySales) {
      const sl = s.lines.find((l) => l.itemId === check.itemId);
      if (!sl) continue;
      const alreadyRet = Number((s.returnedQty || {})[check.itemId] || 0);
      const avail = Math.max(0, round2(sl.quantity - alreadyRet));
      if (avail <= 0) continue;
      availTotal = round2(availTotal + avail);
      if (remaining > 1e-9) {
        const take = Math.min(remaining, avail);
        matched.push({ invoiceNumber: s.invoiceNumber, qty: round2(take) });
        remaining = round2(remaining - take);
      }
    }
    return {
      enough: remaining <= 1e-9,
      availTotal,
      matched,
    };
  }, [check, sales]);

  const blocked =
    verdict === 'faulty' &&
    ((faultyAction === 'replaced' && notEnoughStock) ||
      (faultyAction === 'taken_back' && !takeBackPreview.enough));

  const submit = async () => {
    if (blocked || busy) return;
    setError(null);
    setBusy(true);
    try {
      const outcome = verdict === 'ok' ? 'ok_returned' : faultyAction;
      await onSave(outcome, note);
    } catch (err: any) {
      setError(err?.message || 'Could not save result.');
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      tone="amber"
      icon={BatteryCharging}
      title="Enter check result"
      subtitle={`${check.partyName} · ${check.itemName} × ${check.quantity}`}
      footer={
        <PrimaryButton tone={verdict === 'ok' ? 'emerald' : 'amber'} busy={busy} disabled={blocked} onClick={submit}>
          Save Result
        </PrimaryButton>
      }
    >
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
        <div className="font-bold text-slate-900">
          {check.itemName} × {check.quantity}
          {check.serial ? ` · S/N ${check.serial}` : ''}
        </div>
        <div className="text-slate-600">Reported: &quot;{check.problem}&quot;</div>
      </div>

      {/* Verdict: OK vs Faulty */}
      <Field label="Result">
        <div className="grid grid-cols-2 gap-2 text-xs font-bold">
          <button
            type="button"
            onClick={() => setVerdict('ok')}
            className={`px-3 py-2.5 rounded-xl border-2 cursor-pointer transition ${
              verdict === 'ok'
                ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 text-slate-600 bg-white'
            }`}
          >
            ✓ OK
          </button>
          <button
            type="button"
            onClick={() => setVerdict('faulty')}
            className={`px-3 py-2.5 rounded-xl border-2 cursor-pointer transition ${
              verdict === 'faulty'
                ? 'border-rose-500 bg-rose-50 text-rose-800'
                : 'border-slate-200 text-slate-600 bg-white'
            }`}
          >
            ✕ Faulty
          </button>
        </div>
      </Field>

      {verdict === 'ok' ? (
        <div className="text-xs text-slate-600 bg-emerald-50/70 border border-emerald-200 rounded-xl p-2.5">
          Battery checked OK — will be marked given back with no stock or balance change.
        </div>
      ) : (
        <Field label="Choose action">
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setFaultyAction('replaced')}
              className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition cursor-pointer ${
                faultyAction === 'replaced'
                  ? 'border-indigo-500 bg-indigo-50/70'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="text-xs font-bold text-slate-900">Replace with new</div>
              <div className={`text-[11px] mt-0.5 ${notEnoughStock ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>
                {notEnoughStock
                  ? `Not enough stock (in stock: ${onHand}, need ${check.quantity})`
                  : `Takes ${check.quantity} from stock (in stock: ${onHand})`}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setFaultyAction('repaired_returned')}
              className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition cursor-pointer ${
                faultyAction === 'repaired_returned'
                  ? 'border-indigo-500 bg-indigo-50/70'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="text-xs font-bold text-slate-900">Repair &amp; give back</div>
              <div className="text-[11px] text-slate-500 mt-0.5">No stock or balance change</div>
            </button>

            <button
              type="button"
              onClick={() => setFaultyAction('taken_back')}
              className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition cursor-pointer ${
                faultyAction === 'taken_back'
                  ? 'border-indigo-500 bg-indigo-50/70'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="text-xs font-bold text-slate-900">Take back, reduce due</div>
              <div className={`text-[11px] mt-0.5 ${!takeBackPreview.enough ? 'text-rose-600 font-bold' : 'text-slate-500'}`}>
                {takeBackPreview.enough
                  ? `Damaged return on newest ${takeBackPreview.matched
                      .map((m) => `${m.invoiceNumber} (×${m.qty})`)
                      .join(', ')}`
                  : `Only ${takeBackPreview.availTotal} returnable on active bills (need ${check.quantity})`}
              </div>
            </button>
          </div>
        </Field>
      )}

      <Field label="Note (optional)">
        <input
          className={inputCls}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Test voltage, remarks…"
        />
      </Field>

      <ErrorBox message={error} />
    </Sheet>
  );
};
