import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Flame,
  Layers,
  Package,
  User,
  X,
  AlertTriangle,
  Boxes,
  FileText,
  DollarSign,
  ChevronRight,
  ShieldAlert,
  Ban,
  RotateCcw,
} from 'lucide-react';
import { ProductionBatch } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { formatFirestoreError } from '../firebase/config';

interface BatchDetailViewProps {
  batchId: string;
  onBack: () => void;
}

export const BatchDetailView: React.FC<BatchDetailViewProps> = ({ batchId, onBack }) => {
  const { batches, voidBatch, items } = useInventory();
  const { permissions, role } = useAuth();

  // Find latest batch object from state
  const batch = batches.find((b) => b.id === batchId);

  // Void confirmation state
  const [showVoidModal, setShowVoidModal] = useState<boolean>(false);
  const [voidReason, setVoidReason] = useState<string>('');
  const [isVoiding, setIsVoiding] = useState<boolean>(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Handle hardware / browser back navigation
  useEffect(() => {
    window.history.pushState({ batchDetailPage: true }, '');

    const handlePopState = () => {
      onBack();
    };

    window.addEventListener('popstate', handlePopState, { once: true });
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [onBack]);

  if (!batch) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-4 max-w-lg mx-auto">
        <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto" />
        <h2 className="text-base font-bold text-slate-800">Batch Record Not Found</h2>
        <p className="text-xs text-slate-500">
          The requested production batch could not be found or may have been deleted.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Batch Production</span>
        </button>
      </div>
    );
  }

  const dateFormatted = new Date(batch.timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeFormatted = new Date(batch.timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });

  const canVoid = (role === 'admin' || role === 'manager') && !batch.isVoid;

  const handleExecuteVoid = async () => {
    if (!voidReason.trim()) {
      setVoidError('Please enter a reason for voiding this batch.');
      return;
    }

    setIsVoiding(true);
    setVoidError(null);

    const res = await voidBatch(batch.id, voidReason.trim());
    if (res.success) {
      setStatusMessage({
        type: 'success',
        text: `Batch #${batch.id} was successfully voided and inventory was reversed.`,
      });
      setShowVoidModal(false);
      setVoidReason('');
      setTimeout(() => setStatusMessage(null), 4000);
    } else {
      setVoidError(res.error || 'Failed to void batch run.');
    }
    setIsVoiding(false);
  };

  return (
    <div className="space-y-4 sm:space-y-6 max-w-4xl mx-auto pb-12">
      {/* Void Batch Confirmation Modal */}
      {showVoidModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isVoiding) {
              setShowVoidModal(false);
              setVoidError(null);
            }
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 space-y-4">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Ban className="w-5 h-5" />
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowVoidModal(false);
                  setVoidError(null);
                }}
                disabled={isVoiding}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">Void Batch Run #{batch.id}?</h3>
              <p className="text-xs text-slate-500 mt-1">
                This will deduct <strong className="text-slate-800">+{batch.quantityProduced} {batch.finishedItemName}</strong> from inventory and restore all deducted raw materials back into stock.
              </p>

              <div className="mt-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Reason for Voiding <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={voidReason}
                  onChange={(e) => {
                    setVoidReason(e.target.value);
                    if (voidError) setVoidError(null);
                  }}
                  placeholder="e.g. Test batch, contaminated ingredients, wrong recipe"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              {voidError && (
                <div className="mt-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                  {voidError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowVoidModal(false);
                  setVoidError(null);
                }}
                disabled={isVoiding}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteVoid}
                disabled={isVoiding || !voidReason.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isVoiding ? 'Voiding...' : 'Confirm Void Batch'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top Breadcrumb & Controls */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition cursor-pointer active:scale-95 shadow-2xs"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Production Runs</span>
        </button>

        <div className="flex items-center gap-2">
          {canVoid && (
            <button
              type="button"
              onClick={() => {
                setShowVoidModal(true);
                setVoidReason('');
                setVoidError(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl transition cursor-pointer active:scale-95"
            >
              <Ban className="w-3.5 h-3.5" />
              <span>Void Batch</span>
            </button>
          )}
        </div>
      </div>

      {/* Status Feedback Toast */}
      {statusMessage && (
        <div
          className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-2 animate-in fade-in ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span className="font-medium">{statusMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="text-slate-400 hover:text-slate-600 text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Prominent Void Banner if Batch is Void */}
      {batch.isVoid && (
        <div className="p-4 bg-rose-50 rounded-2xl border border-rose-200 text-rose-900 flex items-start gap-3 shadow-xs">
          <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
            <Ban className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-extrabold text-sm uppercase tracking-wide text-rose-800">
                This Production Batch Is Void
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-200 text-rose-900">
                Stock Reversed
              </span>
            </div>
            <p className="text-xs text-rose-700 mt-1">
              Voided on {new Date(batch.voidedAt || batch.timestamp).toLocaleString()} by{' '}
              <strong>{batch.voidedByName || 'Admin'}</strong>.
            </p>
            {batch.voidReason && (
              <p className="text-xs text-rose-800 mt-1 font-medium bg-rose-100/70 p-2 rounded-lg border border-rose-200/60">
                Reason: &ldquo;{batch.voidReason}&rdquo;
              </p>
            )}
          </div>
        </div>
      )}

      {/* Master Batch Header Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                batch.isVoid
                  ? 'bg-rose-100 text-rose-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {batch.isVoid ? <Ban className="w-6 h-6" /> : <Flame className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-slate-900 tracking-tight">
                  {batch.recipeName}
                </h1>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {batch.batchMultiplier}x Batch
                </span>
                {batch.isVoid && (
                  <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
                    VOID
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 font-mono mt-0.5">Batch ID: {batch.id}</p>
            </div>
          </div>

          <div className="text-xs text-slate-500 sm:text-right shrink-0">
            <div className="flex items-center gap-1 font-medium text-slate-700 sm:justify-end">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>{dateFormatted} at {timeFormatted}</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1 sm:justify-end">
              <User className="w-3 h-3 text-slate-400" />
              <span>Operator: <strong>{batch.performedByName || 'Operator'}</strong></span>
            </div>
          </div>
        </div>

        {/* Highlight Stats Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-[11px] text-slate-500 font-medium block">Quantity Produced</span>
            <span className={`text-base font-bold ${batch.isVoid ? 'text-slate-400 line-through' : 'text-emerald-700'}`}>
              +{batch.quantityProduced}
            </span>
            <span className="text-[10px] text-slate-400 block truncate">
              {batch.finishedItemName}
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-[11px] text-slate-500 font-medium block">Batch Multiplier</span>
            <span className="text-base font-bold text-slate-900">{batch.batchMultiplier}x</span>
            <span className="text-[10px] text-slate-400 block">Scaled Formula</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-[11px] text-slate-500 font-medium block">Raw Materials Deducted</span>
            <span className="text-base font-bold text-slate-900">
              {batch.rawMaterialsDeducted?.length || 0}
            </span>
            <span className="text-[10px] text-slate-400 block">Line Items</span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80">
            <span className="text-[11px] text-slate-500 font-medium block">Total Batch Cost</span>
            <span className="text-base font-bold text-slate-900">
              {permissions.canViewFinances ? `₹${Number(batch.totalBatchCost || 0).toFixed(2)}` : '[Restricted]'}
            </span>
            <span className="text-[10px] text-slate-400 block">
              {permissions.canViewCostPerUnit && batch.quantityProduced > 0
                ? `₹${(batch.totalBatchCost / batch.quantityProduced).toFixed(2)} / unit`
                : ''}
            </span>
          </div>
        </div>

        {batch.notes && (
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-700">
            <span className="font-bold text-slate-900 block mb-0.5">Batch Notes:</span>
            <p className="italic">{batch.notes}</p>
          </div>
        )}
      </div>

      {/* Raw Materials Deducted Breakdown Card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-600" />
          <span>Consumed Raw Materials ({batch.rawMaterialsDeducted?.length || 0})</span>
        </h3>

        <div className="divide-y divide-slate-100">
          {batch.rawMaterialsDeducted?.map((mat, idx) => (
            <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
              <div>
                <span className="font-bold text-slate-800">{mat.rawItemName}</span>
                <span className="text-[11px] text-slate-400 block font-mono">ID: {mat.rawItemId}</span>
              </div>
              <div className="text-right">
                <span className={`font-bold ${batch.isVoid ? 'text-slate-400 line-through' : 'text-rose-700'}`}>
                  -{mat.quantity} {mat.unit}
                </span>
                {permissions.canViewCostPerUnit && (
                  <span className="text-[11px] text-slate-400 block">
                    @ ₹{Number(mat.unitCost || 0).toFixed(2)}/{mat.unit}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
