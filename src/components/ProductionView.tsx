import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  Calendar,
  Layers,
  CheckCircle2,
  Flame,
  User,
  ChevronRight,
  AlertTriangle,
  X,
  FileSpreadsheet,
  Ban,
  RotateCcw,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { ProductionBatch } from '../types/inventory';
import { NewProductionRunPage } from './NewProductionRunPage';
import { BatchDetailView } from './BatchDetailView';
import { downloadExcelFile } from '../utils/fileDownload';

interface ProductionViewProps {
  onOpenProduce?: () => void;
  initialRecipeId?: string | null;
  isNewRunInitiallyOpen?: boolean;
  onCloseNewRun?: () => void;
}

export const ProductionView: React.FC<ProductionViewProps> = ({
  initialRecipeId,
  isNewRunInitiallyOpen = false,
  onCloseNewRun,
}) => {
  const { batches, voidBatch, loadMoreBatches, hasMoreBatches } = useInventory();
  const { permissions, role } = useAuth();
  const [isNewRunOpen, setIsNewRunOpen] = useState(isNewRunInitiallyOpen);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(initialRecipeId || null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);

  // Void batch modal state (Manager/Admin only)
  const [batchToVoid, setBatchToVoid] = useState<ProductionBatch | null>(null);
  const [voidReason, setVoidReason] = useState<string>('');
  const [isVoiding, setIsVoiding] = useState<boolean>(false);
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidSuccessMsg, setVoidSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isNewRunInitiallyOpen) {
      setIsNewRunOpen(true);
      if (initialRecipeId) {
        setActiveRecipeId(initialRecipeId);
      }
    }
  }, [isNewRunInitiallyOpen, initialRecipeId]);

  // Support phone back gesture and popstate
  useEffect(() => {
    if (!isNewRunOpen) return;

    window.history.pushState({ newProductionPage: true }, '');

    const handlePopState = () => {
      setIsNewRunOpen(false);
      if (onCloseNewRun) onCloseNewRun();
    };

    window.addEventListener('popstate', handlePopState, { once: true });
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isNewRunOpen, onCloseNewRun]);

  const handleStartNewRun = (recipeId?: string) => {
    setActiveRecipeId(recipeId || null);
    setIsNewRunOpen(true);
  };

  const handleCloseNewRun = () => {
    setIsNewRunOpen(false);
    setActiveRecipeId(null);
    if (onCloseNewRun) onCloseNewRun();
  };

  const handleConfirmVoid = async () => {
    if (!batchToVoid) return;
    if (!voidReason.trim()) {
      setVoidError('Please provide a reason for voiding this batch run.');
      return;
    }

    setIsVoiding(true);
    setVoidError(null);

    const res = await voidBatch(batchToVoid.id, voidReason.trim());
    if (res.success) {
      setVoidSuccessMsg(`Batch run #${batchToVoid.id} for "${batchToVoid.recipeName}" was voided and stock was restored.`);
      setBatchToVoid(null);
      setVoidReason('');
      setTimeout(() => setVoidSuccessMsg(null), 4000);
    } else {
      setVoidError(res.error || 'Failed to void batch run.');
    }
    setIsVoiding(false);
  };

  const exportBatchesExcel = () => {
    const rows = batches.map((b) => {
      const d = new Date(b.timestamp);
      return {
        'Batch ID': b.id,
        'Status': b.isVoid ? 'VOIDED' : 'COMPLETED',
        'Date': d.toLocaleDateString(),
        'Time': d.toLocaleTimeString(),
        'Recipe Name': b.recipeName,
        'Finished Product': b.finishedItemName,
        'Quantity Produced': b.quantityProduced,
        'Batch Multiplier': b.batchMultiplier,
        'Total Raw Material Cost (₹)': permissions.canViewFinances ? b.totalBatchCost : '[Restricted]',
        'Unit Production Cost (₹)': permissions.canViewCostPerUnit
          ? b.quantityProduced > 0
            ? Number((b.totalBatchCost / b.quantityProduced).toFixed(2))
            : 0
          : '[Restricted]',
        'Operator': b.performedByName || '',
        'Voided By': b.voidedByName || '',
        'Void Reason': b.voidReason || '',
        'Notes': b.notes || '',
      };
    });

    downloadExcelFile(
      rows,
      `powertrack_production_runs_${Date.now()}.xlsx`,
      'Production Runs'
    );
  };

  if (isNewRunOpen) {
    return (
      <NewProductionRunPage
        onBack={handleCloseNewRun}
        initialRecipeId={activeRecipeId}
      />
    );
  }

  if (selectedBatchId) {
    return (
      <BatchDetailView
        batchId={selectedBatchId}
        onBack={() => setSelectedBatchId(null)}
      />
    );
  }

  const canVoid = role === 'admin' || role === 'manager';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Void Batch Confirmation Modal */}
      {batchToVoid && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isVoiding) {
              setBatchToVoid(null);
              setVoidError(null);
              setVoidReason('');
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
                  setBatchToVoid(null);
                  setVoidError(null);
                  setVoidReason('');
                }}
                disabled={isVoiding}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">Void Production Batch?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Voiding this batch will reverse <strong className="text-slate-800">+{batchToVoid.quantityProduced} {batchToVoid.finishedItemName}</strong> and restore all deducted raw materials back to inventory. The batch record is permanently marked VOID in history.
              </p>

              <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                <div className="flex justify-between text-slate-600">
                  <span>Batch Recipe:</span>
                  <span className="font-bold text-slate-900">{batchToVoid.recipeName}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Produced:</span>
                  <span className="font-bold text-slate-900">
                    +{batchToVoid.quantityProduced} {batchToVoid.finishedItemName}
                  </span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>Materials to restore:</span>
                  <span className="font-semibold text-emerald-700">
                    {batchToVoid.rawMaterialsDeducted?.length || 0} items
                  </span>
                </div>
              </div>

              {/* Reason input */}
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
                  placeholder="e.g. Spoiled mixture, wrong recipe multiplier, operator error"
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
                  setBatchToVoid(null);
                  setVoidError(null);
                  setVoidReason('');
                }}
                disabled={isVoiding}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmVoid}
                disabled={isVoiding || !voidReason.trim()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{isVoiding ? 'Voiding & Reversing Stock...' : 'Confirm Void Batch'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void feedback message */}
      {voidSuccessMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-center justify-between gap-2 animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="font-medium">{voidSuccessMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setVoidSuccessMsg(null)}
            className="text-slate-400 hover:text-slate-600 text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Batch Production Runs</h1>
          <p className="text-xs text-slate-500">
            Real-time execution log of manufactured finished goods and deducted ingredients
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {batches.length > 0 && permissions.canExportExcel && (
            <button
              type="button"
              onClick={exportBatchesExcel}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer active:scale-98"
              title="Download production run history as Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Export Excel</span>
            </button>
          )}

          {permissions.canProduceBatch && (
            <button
              onClick={() => handleStartNewRun()}
              className="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white transition shadow-xs cursor-pointer active:scale-98"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>New Production Run</span>
            </button>
          )}
        </div>
      </div>

      {batches.length === 0 ? (
        <div className="p-8 sm:p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
          <Flame className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-700">No batch runs recorded yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Tap &quot;New Production Run&quot; to execute a recipe batch. It will automatically deduct raw
            materials and log the finished goods.
          </p>
          {permissions.canProduceBatch && (
            <button
              onClick={() => handleStartNewRun()}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition cursor-pointer active:scale-98"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Start First Production Run</span>
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => {
            const dateStr = new Date(batch.timestamp).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            });
            const timeStr = new Date(batch.timestamp).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={batch.id}
                onClick={() => setSelectedBatchId(batch.id)}
                className={`bg-white rounded-2xl border p-4 sm:p-5 shadow-2xs hover:shadow-xs transition cursor-pointer active:scale-[0.99] group ${
                  batch.isVoid
                    ? 'border-rose-200 bg-rose-50/20 opacity-85'
                    : 'border-slate-200 hover:border-indigo-300'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition ${
                        batch.isVoid
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-emerald-100 text-emerald-700 group-hover:bg-indigo-100 group-hover:text-indigo-700'
                      }`}
                    >
                      {batch.isVoid ? <Ban className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-bold text-sm transition truncate ${
                          batch.isVoid ? 'text-rose-900 line-through' : 'text-slate-900 group-hover:text-indigo-600'
                        }`}>
                          {batch.recipeName}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          {batch.batchMultiplier}x Batch
                        </span>
                        {batch.isVoid && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                            VOIDED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-emerald-700 font-semibold mt-0.5 flex items-center gap-1">
                        <span>Produced:</span>
                        <strong className={batch.isVoid ? 'text-slate-500 line-through' : 'text-slate-900'}>
                          +{batch.quantityProduced} {batch.finishedItemName}
                        </strong>
                        {batch.isVoid && (
                          <span className="text-[11px] font-normal text-rose-600">(Stock reversed)</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 pt-1 sm:pt-0">
                    <div className="flex sm:flex-col items-center sm:items-end text-xs text-slate-500 shrink-0">
                      <div className="flex items-center gap-1 font-medium text-slate-700">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{dateStr} {timeStr}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                        <span>Operator:</span>
                        <span className="font-semibold text-slate-600 truncate max-w-[120px]">
                          {batch.performedByName || 'Operator'}
                        </span>
                      </div>
                    </div>

                    {/* Void Batch Action Button (Manager/Admin only, only if not yet voided) */}
                    {canVoid && !batch.isVoid && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBatchToVoid(batch);
                          setVoidReason('');
                          setVoidError(null);
                        }}
                        className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 transition cursor-pointer flex items-center gap-1"
                        title="Void this batch run and restore stock"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Void</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Voided Details Banner */}
                {batch.isVoid && (
                  <div className="mt-2 p-2.5 bg-rose-50/80 rounded-xl border border-rose-200/70 text-xs text-rose-900 flex items-start gap-2">
                    <Ban className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Voided on {new Date(batch.voidedAt || batch.timestamp).toLocaleString()} by {batch.voidedByName || 'Admin'}</span>
                      {batch.voidReason && (
                        <p className="text-[11px] text-rose-700 mt-0.5 italic">
                          &ldquo;{batch.voidReason}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Raw Materials Deducted Breakdown */}
                <div className="pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      Raw Materials Deducted ({batch.rawMaterialsDeducted?.length || 0}):
                    </span>
                    <span className="text-xs font-bold text-indigo-600 group-hover:translate-x-0.5 transition flex items-center gap-1">
                      <span>View Details</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                    {batch.rawMaterialsDeducted.slice(0, 3).map((mat, idx) => (
                      <div
                        key={idx}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/70 text-xs flex items-center justify-between"
                      >
                        <span className="font-medium text-slate-800 truncate pr-2">
                          {mat.rawItemName}
                        </span>
                        <span className="font-bold text-rose-700 shrink-0">
                          -{Number(mat.quantity.toFixed(2))} {mat.unit}
                        </span>
                      </div>
                    ))}
                  </div>

                  {batch.rawMaterialsDeducted.length > 3 && (
                    <div className="text-[11px] text-slate-400 mt-1 font-medium">
                      + {batch.rawMaterialsDeducted.length - 3} more items deducted...
                    </div>
                  )}

                  {batch.notes && (
                    <div className="mt-2 text-xs text-slate-600 italic bg-slate-50/60 px-2.5 py-1.5 rounded-lg border border-slate-100 truncate">
                      Note: &ldquo;{batch.notes}&rdquo;
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Load More Batches */}
          {hasMoreBatches && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={loadMoreBatches}
                className="px-5 py-2 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition cursor-pointer"
              >
                Load More Production Runs
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
