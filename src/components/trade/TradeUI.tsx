import React, { useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, CheckCircle2, FileText, Share2, Loader2 } from 'lucide-react';
import { PartyInfo, PaymentMode } from '../../types/inventory';
import { formatINR, round2, todayISODate } from '../../utils/tradeMath';
import { shareOrDownloadPdf } from '../../utils/tradePdf';
import type { PartySuggestion, PaymentInput } from '../../context/TradeContext';

// Full class strings (Tailwind can't see classes built with string templates).
export const TONES = {
  emerald: { soft: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: 'bg-emerald-500', icon: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', solid: 'bg-emerald-600 hover:bg-emerald-700 text-white', label: 'text-emerald-600' },
  sky: { soft: 'bg-sky-50 border-sky-200 text-sky-700', dot: 'bg-sky-500', icon: 'bg-sky-500/20 text-sky-300 border-sky-500/30', solid: 'bg-sky-600 hover:bg-sky-700 text-white', label: 'text-sky-600' },
  amber: { soft: 'bg-amber-50 border-amber-200 text-amber-700', dot: 'bg-amber-500', icon: 'bg-amber-500/20 text-amber-300 border-amber-500/30', solid: 'bg-amber-500 hover:bg-amber-600 text-white', label: 'text-amber-600' },
  rose: { soft: 'bg-rose-50 border-rose-200 text-rose-700', dot: 'bg-rose-500', icon: 'bg-rose-500/20 text-rose-300 border-rose-500/30', solid: 'bg-rose-600 hover:bg-rose-700 text-white', label: 'text-rose-600' },
  blue: { soft: 'bg-blue-50 border-blue-200 text-blue-700', dot: 'bg-blue-500', icon: 'bg-blue-500/20 text-blue-300 border-blue-500/30', solid: 'bg-blue-600 hover:bg-blue-700 text-white', label: 'text-blue-600' },
  indigo: { soft: 'bg-indigo-50 border-indigo-200 text-indigo-700', dot: 'bg-indigo-500', icon: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30', solid: 'bg-indigo-600 hover:bg-indigo-700 text-white', label: 'text-indigo-600' },
  slate: { soft: 'bg-slate-100 border-slate-200 text-slate-600', dot: 'bg-slate-400', icon: 'bg-slate-500/20 text-slate-300 border-slate-500/30', solid: 'bg-slate-800 hover:bg-slate-900 text-white', label: 'text-slate-500' },
} as const;
export type Tone = keyof typeof TONES;

export const inputCls =
  'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500';
/** Same as inputCls but without border colour/background, for highlighted quantity boxes. */
export const qtyInputCls =
  'w-full px-3 py-2 border-2 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-50 disabled:border-slate-200';

/** Close a popup with the phone's Back button. */
export function useBackClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    let popped = false;
    window.history.pushState({ tradeModal: true }, '');
    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped && window.history.state?.tradeModal) window.history.back();
    };
  }, [open]);
}

export const Chip: React.FC<{ tone: Tone; children: React.ReactNode }> = ({ tone, children }) => (
  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${TONES[tone].soft}`}>
    <span className={`w-1.5 h-1.5 rounded-full ${TONES[tone].dot}`} />
    {children}
  </span>
);

export const StatCard: React.FC<{ label: string; value: string; tone: Tone; icon: React.ElementType }> = ({ label, value, tone, icon: Icon }) => (
  <div className="bg-white rounded-2xl border border-slate-200 p-3.5 flex items-start justify-between gap-2 min-w-0">
    <div className="min-w-0">
      <div className={`text-[10px] font-bold uppercase tracking-wider ${TONES[tone].label}`}>{label}</div>
      <div className="text-lg sm:text-xl font-black text-slate-900 mt-1 truncate">{value}</div>
    </div>
    <div className={`w-9 h-9 shrink-0 rounded-xl border flex items-center justify-center ${TONES[tone].soft}`}>
      <Icon className="w-4 h-4" />
    </div>
  </div>
);

export const Field: React.FC<{ label: string; children: React.ReactNode; hint?: string }> = ({ label, children, hint }) => (
  <label className="block">
    <span className="block text-[11px] font-bold text-slate-600 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[10px] text-slate-400 mt-0.5">{hint}</span>}
  </label>
);

export const ErrorBox: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  ) : null;

export const InfoBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] text-slate-600 bg-blue-50 border border-blue-200 rounded-xl p-2.5 leading-relaxed">{children}</div>
);

/** Bottom sheet on phones, centred dialog on larger screens. Closes with the Back button. */
export const Sheet: React.FC<{
  open: boolean;
  onClose: () => void;
  tone: Tone;
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}> = ({ open, onClose, tone, icon: Icon, title, subtitle, children, footer, wide }) => {
  useBackClose(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        className={`bg-white w-full ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'} rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 bg-slate-900 text-white flex items-center gap-3 shrink-0">
          <div className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${TONES[tone].icon}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm truncate">{title}</div>
            {subtitle && <div className="text-[11px] text-slate-400 truncate">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="p-4 border-t border-slate-100 shrink-0">{footer}</div>}
      </div>
    </div>
  );
};

export const PrimaryButton: React.FC<{
  tone: Tone;
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
  form?: string;
  children: React.ReactNode;
}> = ({ tone, busy, disabled, onClick, type = 'button', form, children }) => (
  <button
    type={type}
    form={form}
    onClick={onClick}
    disabled={disabled || busy}
    className={`w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${TONES[tone].solid}`}
  >
    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
    {children}
  </button>
);

export const SmallButton: React.FC<{
  tone?: Tone | 'plain';
  icon?: React.ElementType;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ tone = 'plain', icon: Icon, onClick, children, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition cursor-pointer disabled:opacity-50 ${
      tone === 'plain' ? 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100' : TONES[tone].soft
    }`}
  >
    {Icon && <Icon className="w-3.5 h-3.5" />}
    <span>{children}</span>
  </button>
);

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  withReason?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}> = ({ open, title, message, confirmLabel, withReason, onCancel, onConfirm }) => {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBackClose(open, onCancel);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-5 shadow-2xl space-y-3">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <p className="text-xs text-slate-500 leading-relaxed">{message}</p>
        {withReason && (
          <input className={inputCls} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
        <ErrorBox message={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onCancel} className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer">
            Go Back
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason);
              } catch (e: any) {
                setError(e?.message || 'Something went wrong.');
              } finally {
                setBusy(false);
              }
            }}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export function useToast() {
  const [toast, setToast] = useState<{ title: string; message?: string; error?: boolean } | null>(null);
  const timer = useRef<any>(null);
  const show = (title: string, message?: string, error = false) => {
    setToast({ title, message, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3500);
  };
  const view = toast ? (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] w-[calc(100vw-2rem)] max-w-sm bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-start gap-3" role="status">
      {toast.error ? <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <div className="text-xs font-bold">{toast.title}</div>
        {toast.message && <div className="text-[11px] text-slate-300 mt-0.5">{toast.message}</div>}
      </div>
    </div>
  ) : null;
  return { show, view };
}

/** Customer / supplier fields with suggestions from earlier documents. */
export const PartyFields: React.FC<{
  label: string;
  value: PartyInfo;
  onChange: (p: PartyInfo) => void;
  suggestions: PartySuggestion[];
  withAddress?: boolean;
  listId: string;
}> = ({ label, value, onChange, suggestions, withAddress, listId }) => (
  <div className="space-y-2">
    <div className="grid grid-cols-2 gap-2">
      <Field label={`${label} *`}>
        <input
          className={inputCls}
          list={listId}
          value={value.name}
          placeholder={`${label} name`}
          onChange={(e) => {
            const name = e.target.value;
            const known = suggestions.find((s) => s.key === name.trim().toLowerCase());
            onChange(known ? { name, phone: known.phone || '', gstin: known.gstin || '', address: known.address || '' } : { ...value, name });
          }}
        />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s.key} value={s.name} />
          ))}
        </datalist>
      </Field>
      <Field label="Phone">
        <input className={inputCls} inputMode="tel" value={value.phone || ''} onChange={(e) => onChange({ ...value, phone: e.target.value })} placeholder="Optional" />
      </Field>
    </div>
    {withAddress && (
      <Field label="Address">
        <input className={inputCls} value={value.address || ''} onChange={(e) => onChange({ ...value, address: e.target.value })} placeholder="Optional address" />
      </Field>
    )}
  </div>
);

export const Totals: React.FC<{ rows: { label: string; value: string; bold?: boolean }[] }> = ({ rows }) => (
  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-xs space-y-1">
    {rows.map((r) => (
      <div key={r.label} className={`flex justify-between gap-2 ${r.bold ? 'font-black text-slate-900 text-sm pt-1 border-t border-slate-200' : 'text-slate-600'}`}>
        <span>{r.label}</span>
        <span>{r.value}</span>
      </div>
    ))}
  </div>
);

export const PAYMENT_MODES: { id: PaymentMode; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'bank', label: 'Bank' },
  { id: 'cheque', label: 'Cheque' },
  { id: 'other', label: 'Other' },
];

export const PaymentSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  maxAmount: number;
  maxLabel: string;
  submitLabel: string;
  onSubmit: (p: PaymentInput) => Promise<void>;
}> = ({ open, onClose, title, subtitle, maxAmount, maxLabel, submitLabel, onSubmit }) => {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISODate());
  const [mode, setMode] = useState<PaymentMode>('upi');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setAmount(maxAmount > 0 ? String(round2(maxAmount)) : '');
      setDate(todayISODate());
      setNote('');
      setError(null);
    }
  }, [open, maxAmount]);
  const submit = async () => {
    setError(null);
    const n = Number(amount);
    if (!(n > 0)) return setError('Enter an amount more than 0.');
    if (n > maxAmount + 0.009) return setError(`Amount can't be more than ${formatINR(maxAmount)}.`);
    setBusy(true);
    try {
      await onSubmit({ amount: n, date, mode, note });
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      tone="emerald"
      icon={CheckCircle2}
      title={title}
      subtitle={subtitle}
      footer={
        <PrimaryButton tone="emerald" busy={busy} onClick={submit}>
          {submitLabel}
        </PrimaryButton>
      }
    >
      <InfoBox>
        {maxLabel}: <b>{formatINR(maxAmount)}</b>
      </InfoBox>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Amount (₹) *">
          <input className={inputCls} type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date">
          <input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <Field label="Mode">
        <div className="grid grid-cols-5 gap-1.5">
          {PAYMENT_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`py-2 rounded-lg text-[11px] font-bold border cursor-pointer ${mode === m.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Note">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="UTR / cheque no. (optional)" />
      </Field>
      <ErrorBox message={error} />
    </Sheet>
  );
};

/** "PDF" + "Share" buttons for a document. */
export const PdfButtons: React.FC<{ build: () => Blob; fileName: string; title: string; onError: (msg: string) => void }> = ({ build, fileName, title, onError }) => {
  const run = async (mode: 'share' | 'download') => {
    try {
      await shareOrDownloadPdf(build(), fileName, title, mode);
    } catch (e: any) {
      onError(e?.message || 'Could not create the PDF.');
    }
  };
  return (
    <>
      <SmallButton icon={FileText} onClick={() => run('download')}>
        PDF
      </SmallButton>
      <SmallButton icon={Share2} onClick={() => run('share')}>
        Share
      </SmallButton>
    </>
  );
};

export const LoadMore: React.FC<{ show: boolean; onClick: () => void }> = ({ show, onClick }) =>
  show ? (
    <div className="flex justify-center">
      <button type="button" onClick={onClick} className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 cursor-pointer">
        Load more
      </button>
    </div>
  ) : null;

export const fmtDate = (iso?: string) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
export const fmtDateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
