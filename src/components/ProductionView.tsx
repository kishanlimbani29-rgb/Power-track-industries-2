import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  History,
  ArrowLeft,
  ChevronDown,
  Package,
  Sparkles,
  Layers,
  Calendar,
  CheckCircle2,
  RotateCcw,
  FileSpreadsheet,
  Ban,
  X,
  ChevronRight,
  Plus,
  Flame,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { ProductionBatch, Recipe, InventoryItem } from '../types/inventory';
import { NewProductionRunPage } from './NewProductionRunPage';
import { BatchDetailView } from './BatchDetailView';
import { downloadExcelFile } from '../utils/fileDownload';
import { resolveInventoryItem, getAvailableStockForIngredient } from '../utils/itemResolver';
import { formatQty, formatShortDateTime } from '../utils/numberFormat';
import { canChangeEntry, formatLockReason } from '../utils/changeWindow';

interface ProductionViewProps {
  onOpenProduce?: () => void;
  initialRecipeId?: string | null;
  isNewRunInitiallyOpen?: boolean;
  onCloseNewRun?: () => void;
  onNavigateToRecipes?: () => void;
}

type SortOption = 'can_make' | 'name_asc' | 'recently_made';
type CategoryTab = 'finished' | 'semi_finished';

interface RecipeFeasibilityData {
  recipe: Recipe;
  finishedItem?: InventoryItem;
  isSemiFinished: boolean;
  batches: number | null; // null if no ingredients
  color: 'green' | 'amber' | 'red' | 'grey';
  limitingText?: string;
  lastMadeTimestamp: number;
}

export const ProductionView: React.FC<ProductionViewProps> = ({
  initialRecipeId,
  isNewRunInitiallyOpen = false,
  onCloseNewRun,
  onNavigateToRecipes,
}) => {
  const { items, recipes, batches, voidBatch, loadMoreBatches, hasMoreBatches, showActionToast } = useInventory();
  const { permissions, role, realUserUid } = useAuth();

  // Navigation & Sub-view states
  const [isNewRunOpen, setIsNewRunOpen] = useState(isNewRunInitiallyOpen);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(initialRecipeId || null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // Filter & Sort states for "Can make" grid
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryTab, setCategoryTab] = useState<CategoryTab>('finished');
  const [sortBy, setSortBy] = useState<SortOption>('can_make');

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

  // Support phone back gesture and popstate for New Production Run page
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

  // Support phone back gesture for History view
  useEffect(() => {
    if (!showHistory) return;

    window.history.pushState({ productionHistory: true }, '');

    const handlePopState = () => {
      setShowHistory(false);
    };

    window.addEventListener('popstate', handlePopState, { once: true });
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [showHistory]);

  // Support phone back gesture for Batch Detail view
  useEffect(() => {
    if (!selectedBatchId) return;

    window.history.pushState({ batchDetail: true }, '');

    const handlePopState = () => {
      setSelectedBatchId(null);
    };

    window.addEventListener('popstate', handlePopState, { once: true });
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [selectedBatchId]);

  // Support phone back gesture for Void Batch modal
  useEffect(() => {
    if (!batchToVoid) return;

    window.history.pushState({ voidModal: true }, '');

    const handlePopState = () => {
      setBatchToVoid(null);
      setVoidError(null);
      setVoidReason('');
    };

    window.addEventListener('popstate', handlePopState, { once: true });
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [batchToVoid]);

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
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setVoidError('No internet connection — nothing was saved. Please try again.');
      return;
    }

    const target = batchToVoid;
    const reason = voidReason.trim();
    setBatchToVoid(null);
    setVoidReason('');
    setVoidError(null);
    setIsVoiding(false);

    showActionToast('Saving…', `Voiding ${target.recipeName}`, 'saving');
    const res = await voidBatch(target.id, reason);
    if (res.success) {
      showActionToast('Batch voided', `${target.recipeName} stock restored`, 'success');
      setVoidSuccessMsg(`Batch run #${target.id} for "${target.recipeName}" was voided and stock was restored.`);
      setTimeout(() => setVoidSuccessMsg(null), 4000);
    } else {
      showActionToast('Could not void batch', res.error || 'Failed to void batch run.', 'error');
    }
  };

  const exportBatchesExcel = () => {
    const rows = batches.map((b) => {
      const d = new Date(b.timestamp);
      return {
        'Batch ID': b.id,
        'Status': b.isVoid ? 'VOIDED' : 'COMPLETED',
        'Date': d.toLocaleDateString(),
        'Time': d.toLocaleTimeString(),
        'BOM Name': b.recipeName,
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

  // =========================================================================
  // CAN MAKE FEASIBILITY CALCULATION (Live with inventory stock updates)
  // =========================================================================
  const allCardData: RecipeFeasibilityData[] = useMemo(() => {
    return recipes.map((recipe) => {
      const finishedItem =
        items.find((i) => i.id === recipe.finishedItemId) ||
        resolveInventoryItem(items, { id: recipe.finishedItemId, name: recipe.finishedItemName });

      const isSemiFinished = finishedItem?.type === 'semi_finished';

      // Find the most recent batch execution timestamp for this recipe
      let lastMadeTimestamp = 0;
      for (const b of batches) {
        if (b.recipeId === recipe.id || b.recipeName === recipe.name) {
          const t = new Date(b.timestamp).getTime();
          if (t > lastMadeTimestamp) {
            lastMadeTimestamp = t;
          }
        }
      }

      // If no ingredients in recipe: "Can make —" in grey
      if (!recipe.ingredients || recipe.ingredients.length === 0) {
        return {
          recipe,
          finishedItem,
          isSemiFinished,
          batches: null,
          color: 'grey',
          limitingText: undefined,
          lastMadeTimestamp,
        };
      }

      // Aggregate ingredients by rawItemId in case recipe has duplicate ingredient rows
      const materialTotals = new Map<
        string,
        { rawItemId: string; rawItemName: string; quantity: number; unit: string }
      >();
      for (const ing of recipe.ingredients) {
        const key = (ing.rawItemId || ing.rawItemName || '').trim();
        if (!key) continue;
        const existing = materialTotals.get(key);
        const qty = Number(ing.quantity) || 0;
        if (existing) {
          existing.quantity += qty;
        } else {
          materialTotals.set(key, {
            rawItemId: ing.rawItemId,
            rawItemName: ing.rawItemName,
            quantity: qty,
            unit: ing.unit,
          });
        }
      }

      if (materialTotals.size === 0) {
        return {
          recipe,
          finishedItem,
          isSemiFinished,
          batches: null,
          color: 'grey',
          limitingText: undefined,
          lastMadeTimestamp,
        };
      }

      let minBatches = Infinity;
      let limitingName = '';
      let limitingAvailable = 0;
      let limitingUnit = '';
      let anyIngredientBelowMinStock = false;

      for (const ing of materialTotals.values()) {
        const needed = Number(ing.quantity) || 0;
        if (needed <= 0) continue;

        const { item, totalAvailable } = getAvailableStockForIngredient(items, ing);
        const available = Math.max(0, totalAvailable);
        const itemName = item?.name || ing.rawItemName || 'Material';
        const unit = item?.unit || ing.unit || 'pcs';

        // Check if ingredient is below its minimum stock
        if (item && typeof item.minStock === 'number' && item.minStock > 0) {
          if (item.quantity <= item.minStock) {
            anyIngredientBelowMinStock = true;
          }
        }

        const possible = Math.floor(available / needed);
        if (possible < minBatches) {
          minBatches = possible;
          limitingName = itemName;
          limitingAvailable = available;
          limitingUnit = unit;
        }
      }

      if (minBatches === Infinity) {
        return {
          recipe,
          finishedItem,
          isSemiFinished,
          batches: null,
          color: 'grey',
          limitingText: undefined,
          lastMadeTimestamp,
        };
      }

      const batchesPossible = Math.max(0, minBatches);

      if (batchesPossible === 0) {
        return {
          recipe,
          finishedItem,
          isSemiFinished,
          batches: 0,
          color: 'red',
          limitingText: `Out: ${limitingName}`,
          lastMadeTimestamp,
        };
      }

      if (batchesPossible < 5 || anyIngredientBelowMinStock) {
        return {
          recipe,
          finishedItem,
          isSemiFinished,
          batches: batchesPossible,
          color: 'amber',
          limitingText: `Low: ${limitingName} (${formatQty(limitingAvailable, limitingUnit)} ${limitingUnit})`,
          lastMadeTimestamp,
        };
      }

      return {
        recipe,
        finishedItem,
        isSemiFinished,
        batches: batchesPossible,
        color: 'green',
        limitingText: undefined,
        lastMadeTimestamp,
      };
    });
  }, [recipes, items, batches]);

  // Tab counts
  const finishedCount = useMemo(
    () => allCardData.filter((c) => !c.isSemiFinished).length,
    [allCardData]
  );
  const semiFinishedCount = useMemo(
    () => allCardData.filter((c) => c.isSemiFinished).length,
    [allCardData]
  );

  // Filtered & Sorted Card List
  const displayedCards = useMemo(() => {
    // 1. Tab filter
    let list = allCardData.filter((c) => {
      if (categoryTab === 'semi_finished') {
        return c.isSemiFinished;
      }
      return !c.isSemiFinished;
    });

    // 2. Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((c) => {
        const prodName = (c.finishedItem?.name || c.recipe.finishedItemName || c.recipe.name || '').toLowerCase();
        const recipeName = (c.recipe.name || '').toLowerCase();
        return prodName.includes(q) || recipeName.includes(q);
      });
    }

    // 3. Sorting
    const sorted = [...list].sort((a, b) => {
      if (sortBy === 'can_make') {
        // Most batches possible first (null/no ingredients counted as -1)
        const aBatches = a.batches !== null ? a.batches : -1;
        const bBatches = b.batches !== null ? b.batches : -1;
        if (bBatches !== aBatches) {
          return bBatches - aBatches;
        }
        const aName = a.finishedItem?.name || a.recipe.finishedItemName || a.recipe.name;
        const bName = b.finishedItem?.name || b.recipe.finishedItemName || b.recipe.name;
        return aName.localeCompare(bName);
      } else if (sortBy === 'name_asc') {
        const aName = a.finishedItem?.name || a.recipe.finishedItemName || a.recipe.name;
        const bName = b.finishedItem?.name || b.recipe.finishedItemName || b.recipe.name;
        return aName.localeCompare(bName);
      } else if (sortBy === 'recently_made') {
        if (b.lastMadeTimestamp !== a.lastMadeTimestamp) {
          return b.lastMadeTimestamp - a.lastMadeTimestamp;
        }
        const aName = a.finishedItem?.name || a.recipe.finishedItemName || a.recipe.name;
        const bName = b.finishedItem?.name || b.recipe.finishedItemName || b.recipe.name;
        return aName.localeCompare(bName);
      }
      return 0;
    });

    return sorted;
  }, [allCardData, categoryTab, searchQuery, sortBy]);

  // If New Production Run is open, show full-screen page
  if (isNewRunOpen) {
    return (
      <NewProductionRunPage
        onBack={handleCloseNewRun}
        initialRecipeId={activeRecipeId}
      />
    );
  }

  // If Batch Details is open, show detail view
  if (selectedBatchId) {
    return (
      <BatchDetailView
        batchId={selectedBatchId}
        onBack={() => setSelectedBatchId(null)}
      />
    );
  }

  const canVoid = role === 'admin' || role === 'manager';

  // =========================================================================
  // VIEW: HISTORY LIST (When "History" button is tapped)
  // =========================================================================
  if (showHistory) {
    return (
      <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-150">
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
                    <span>Batch BOM:</span>
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
                    placeholder="e.g. Wrong BOM quantity, damaged plates, operator error"
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

        {/* Top Header Row for History */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowHistory(false)}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-indigo-600 transition cursor-pointer py-1 whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Can Make</span>
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {batches.length > 0 && permissions.canExportExcel && (
              <button
                type="button"
                onClick={exportBatchesExcel}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer active:scale-98"
                title="Download production run history as Excel (.xlsx)"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Export Excel</span>
              </button>
            )}

            {permissions.canProduceBatch && (
              <button
                type="button"
                onClick={() => handleStartNewRun()}
                className="flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-xs cursor-pointer active:scale-98"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>New Production Run</span>
              </button>
            )}
          </div>
        </div>

        {/* Batches List */}
        {batches.length === 0 ? (
          <div className="p-8 sm:p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
            <Flame className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-sm font-semibold text-slate-700">No batch runs recorded yet</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Execute a BOM batch from the &quot;Can make&quot; cards. It will automatically deduct raw
              materials and log the finished goods.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map((batch) => {
              const finishedItem = items.find((i) => i.id === batch.finishedItemId);
              const finishedUnit = finishedItem?.unit;
              const dateTimeStr = formatShortDateTime(batch.timestamp);

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
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition ${
                          batch.isVoid
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-emerald-100 text-emerald-700 group-hover:bg-indigo-100 group-hover:text-indigo-700'
                        }`}
                      >
                        {batch.isVoid ? <Ban className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`font-bold text-sm transition break-words ${
                              batch.isVoid ? 'text-rose-900 line-through' : 'text-slate-900 group-hover:text-indigo-600'
                            }`}
                          >
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
                        <div className="text-xs text-emerald-700 font-semibold mt-0.5">
                          <div>
                            <span>Produced: </span>
                            <strong className={batch.isVoid ? 'text-slate-500 line-through' : 'text-slate-900'}>
                              +{formatQty(batch.quantityProduced, finishedUnit)} {batch.finishedItemName}
                            </strong>
                          </div>
                          {batch.isVoid && (
                            <div className="text-[11px] font-normal text-rose-600 mt-0.5">
                              (Stock reversed)
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start justify-between sm:justify-end gap-3 pt-1 sm:pt-0">
                      <div className="flex flex-col items-start sm:items-end text-xs text-slate-500 min-w-0">
                        <div className="flex items-center gap-1 font-medium text-slate-700 whitespace-nowrap">
                          <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{dateTimeStr}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 break-words">
                          By <span className="font-semibold text-slate-700">{batch.performedByName || 'Operator'}</span>
                        </div>
                      </div>

                      {/* Void Batch Action Button */}
                      {canVoid && !batch.isVoid && (() => {
                        const changeCheck = canChangeEntry(
                          {
                            createdByUid: batch.performedBy,
                            createdByName: batch.performedByName,
                            createdAt: batch.timestamp,
                          },
                          realUserUid,
                          permissions,
                          role
                        );
                        if (!changeCheck.allowed) {
                          return (
                            <span className="text-[11px] text-slate-400 shrink-0 text-right max-w-[160px]">
                              {formatLockReason(changeCheck.reason)}
                            </span>
                          );
                        }
                        return (
                          <div className="flex flex-col items-end gap-0.5 shrink-0">
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
                            {role !== 'admin' && changeCheck.timeLeftLabel && (
                              <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                Can change for {changeCheck.timeLeftLabel} more
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Voided Details Banner */}
                  {batch.isVoid && (
                    <div className="mt-2 p-2.5 bg-rose-50/80 rounded-xl border border-rose-200/70 text-xs text-rose-900 flex items-start gap-2">
                      <Ban className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">
                          Voided on {formatShortDateTime(batch.voidedAt || batch.timestamp)} by{' '}
                          {batch.voidedByName || 'Admin'}
                        </span>
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
                            -{formatQty(mat.quantity, mat.unit)} {mat.unit}
                          </span>
                        </div>
                      ))}
                    </div>

                    {batch.rawMaterialsDeducted.length > 3 && (
                      <div className="text-[11px] text-slate-400 mt-1 font-medium">
                        + {batch.rawMaterialsDeducted.length - 3} more items deducted...
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
  }

  // =========================================================================
  // VIEW: "CAN MAKE" PRODUCT CARDS (MAIN SCREEN)
  // =========================================================================
  return (
    <div className="space-y-3.5 sm:space-y-4">
      {/* 1. TOP ROW: Search Box + History Button */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search product…"
            className="w-full h-[40px] pl-9 pr-8 text-xs sm:text-sm rounded-xl border border-slate-300 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className="h-[40px] px-3.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 transition flex items-center gap-2 shadow-2xs cursor-pointer shrink-0 active:scale-95"
          title="Open previous batch production logs"
        >
          <History className="w-4 h-4 text-slate-500" />
          <span>History</span>
          {batches.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 font-semibold">
              {batches.length}
            </span>
          )}
        </button>
      </div>

      {/* 2. TABS UNDER SEARCH: Finished (n) and Semi-Finished (n) */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setCategoryTab('finished')}
          className={`pb-2.5 px-3 text-xs sm:text-sm font-bold transition border-b-2 cursor-pointer flex items-center gap-1.5 ${
            categoryTab === 'finished'
              ? 'border-indigo-600 text-indigo-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Finished</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              categoryTab === 'finished'
                ? 'bg-indigo-100 text-indigo-800'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {finishedCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setCategoryTab('semi_finished')}
          className={`pb-2.5 px-3 text-xs sm:text-sm font-bold transition border-b-2 cursor-pointer flex items-center gap-1.5 ${
            categoryTab === 'semi_finished'
              ? 'border-indigo-600 text-indigo-700'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>Semi-Finished</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
              categoryTab === 'semi_finished'
                ? 'bg-indigo-100 text-indigo-800'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {semiFinishedCount}
          </span>
        </button>
      </div>

      {/* 3. SORT ROW */}
      <div className="flex items-center justify-end pt-0.5">
        <div className="relative shrink-0">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="h-[38px] appearance-none pl-3 pr-7 text-sm font-semibold rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-2xs"
          >
            <option value="can_make">Sort: Can make</option>
            <option value="name_asc">Sort: Name A–Z</option>
            <option value="recently_made">Sort: Recently made</option>
          </select>
          <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* 4. RECIPES EMPTY STATE (No recipes at all) */}
      {recipes.length === 0 ? (
        <div className="p-8 sm:p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
          <Layers className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">No BOMs yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            No BOMs yet. Add one in Product BOM.
          </p>
          {onNavigateToRecipes && (
            <button
              type="button"
              onClick={onNavigateToRecipes}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition cursor-pointer active:scale-95 shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Go to Product BOM</span>
            </button>
          )}
        </div>
      ) : displayedCards.length === 0 ? (
        /* Empty state for search / current tab filter */
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
          <Package className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-xs sm:text-sm font-semibold text-slate-700">
            {searchQuery
              ? `No items matching "${searchQuery}" in ${
                  categoryTab === 'finished' ? 'Finished' : 'Semi-Finished'
                }`
              : `No ${categoryTab === 'finished' ? 'Finished' : 'Semi-Finished'} product BOMs found`}
          </h3>
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-xs font-bold text-indigo-600 hover:text-indigo-700 cursor-pointer pt-1"
            >
              Clear search filter
            </button>
          )}
        </div>
      ) : (
        /* 4. CARDS GRID: 2 per row on phones, 3-4 per row on wider screens */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
          {displayedCards.map((card) => {
            const productName = card.finishedItem?.name || card.recipe.finishedItemName || card.recipe.name;
            const hasPhoto = Boolean(card.finishedItem?.photoThumb);

            return (
              <div
                key={card.recipe.id}
                className="bg-white rounded-2xl border border-slate-200/90 p-3 sm:p-3.5 flex flex-col justify-between hover:border-indigo-300 hover:shadow-xs transition duration-150 shadow-2xs"
              >
                {/* Upper Content */}
                <div>
                  {/* Photo: Height 64px, object-contain */}
                  <div className="w-full h-[64px] bg-slate-50 rounded-xl overflow-hidden flex items-center justify-center border border-slate-100 select-none shrink-0">
                    {hasPhoto ? (
                      <img
                        src={card.finishedItem!.photoThumb || undefined}
                        alt={productName}
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400">
                        <Package className="w-7 h-7 text-slate-400" />
                      </div>
                    )}
                  </div>

                  {/* Finished product name (bold, max 2 lines) */}
                  <h3
                    className="font-bold text-xs sm:text-sm text-slate-900 line-clamp-2 leading-snug mt-2.5 h-8 sm:h-9"
                    title={productName}
                  >
                    {productName}
                  </h3>

                  {/* Badge & Limiting material line */}
                  <div className="mt-2 space-y-1">
                    {/* Badge "Can make N" */}
                    {card.batches === null ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                        Can make —
                      </span>
                    ) : card.color === 'green' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Can make {card.batches}
                      </span>
                    ) : card.color === 'amber' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        Can make {card.batches}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                        Can make 0
                      </span>
                    )}

                    {/* Limiting material for amber and red only (single line, small grey) */}
                    {card.limitingText ? (
                      <p
                        className="text-[10px] sm:text-[11px] text-slate-500 truncate h-3.5 sm:h-4 font-medium"
                        title={card.limitingText}
                      >
                        {card.limitingText}
                      </p>
                    ) : (
                      <div className="h-3.5 sm:h-4" />
                    )}
                  </div>
                </div>

                {/* Bottom Action Button */}
                <div className="mt-3 pt-2 border-t border-slate-100">
                  {permissions.canProduceBatch ? (
                    card.batches !== null && card.batches > 0 ? (
                      <button
                        type="button"
                        onClick={() => handleStartNewRun(card.recipe.id)}
                        className="w-full py-1.5 sm:py-2 px-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-2xs active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                        title={`Make ${productName}`}
                      >
                        <span>▶ Make</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="w-full py-1.5 sm:py-2 px-2 rounded-xl text-[11px] sm:text-xs font-bold bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed flex items-center justify-center select-none"
                      >
                        <span>Not enough stock</span>
                      </button>
                    )
                  ) : permissions.canSubmitAuditRequests ? (
                    card.batches !== null && card.batches > 0 ? (
                      <button
                        type="button"
                        onClick={() => handleStartNewRun(card.recipe.id)}
                        className="w-full py-1.5 sm:py-2 px-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-2xs active:scale-95 cursor-pointer flex items-center justify-center gap-1.5"
                        title={`Submit production request for ${productName}`}
                      >
                        <span>▶ Request</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="w-full py-1.5 sm:py-2 px-2 rounded-xl text-[11px] sm:text-xs font-bold bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed flex items-center justify-center select-none"
                      >
                        <span>Not enough stock</span>
                      </button>
                    )
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
