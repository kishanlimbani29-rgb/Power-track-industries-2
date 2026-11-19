import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Package,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  RotateCcw,
  Search,
  X,
  Edit3,
  Check,
  Layers,
  Sparkles,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Recipe, InventoryItem } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { formatFirestoreError } from '../firebase/config';
import {
  resolveInventoryItem,
  getAvailableStockForIngredient,
  getItemQuantity,
} from '../utils/itemResolver';
import { formatQty, isWholeUnit } from '../utils/numberFormat';

interface AdjustableIngredient {
  rawItemId: string;
  rawItemName: string;
  standardQuantityPerBatch: number;
  quantity: number;
  unit: string;
  unitCost: number;
  isExtra?: boolean;
}

interface NewProductionRunPageProps {
  onBack: () => void;
  initialRecipeId?: string | null;
}

export const NewProductionRunPage: React.FC<NewProductionRunPageProps> = ({
  onBack,
  initialRecipeId,
}) => {
  const {
    items,
    recipes,
    produceRecipeBatch,
    submitAuditRequest,
    showActionToast,
  } = useInventory();
  const { permissions, simulatedName, role } = useAuth();

  // Recipe selection
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>(() => {
    if (initialRecipeId && recipes.some((r) => r.id === initialRecipeId)) {
      return initialRecipeId;
    }
    return recipes.length > 0 ? recipes[0].id : '';
  });

  // Recipe Picker modal state
  const [isRecipePickerOpen, setIsRecipePickerOpen] = useState(false);
  const [recipeSearchQuery, setRecipeSearchQuery] = useState('');

  // Batch multiplier & custom yield
  const [batchMultiplier, setBatchMultiplier] = useState<number | ''>(1);
  const [customYield, setCustomYield] = useState<number | ''>('');
  const [showCustomYieldInput, setShowCustomYieldInput] = useState(false);
  const [selectedFinishedItemId, setSelectedFinishedItemId] = useState<string>('');

  // Editable list of ingredients for this run
  const [adjustedIngredients, setAdjustedIngredients] = useState<AdjustableIngredient[]>([]);
  const [isEditingAmounts, setIsEditingAmounts] = useState(false);

  // Extra item adder state
  const [isAddingExtra, setIsAddingExtra] = useState(false);
  const [extraItemId, setExtraItemId] = useState('');
  const [extraItemQty, setExtraItemQty] = useState<number>(1);

  // Notes state
  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const [notes, setNotes] = useState('');

  // Direct approval (bypass audit queue for managers/admins)
  const [directApproval, setDirectApproval] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Mobile Back Button: Close pickers/modals first
  useEffect(() => {
    const anyModalOpen = isRecipePickerOpen || isAddingExtra;
    if (!anyModalOpen) return;

    window.history.pushState({ modalOpen: true }, '');

    const handlePopState = () => {
      setIsRecipePickerOpen(false);
      setIsAddingExtra(false);
    };

    window.addEventListener('popstate', handlePopState, { once: true });
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isRecipePickerOpen, isAddingExtra]);

  // Active recipe reference
  const currentRecipe = useMemo(() => {
    return recipes.find((r) => r.id === selectedRecipeId) || recipes[0] || null;
  }, [recipes, selectedRecipeId]);

  // Target finished good item
  const finishedItem = useMemo(() => {
    if (!currentRecipe) return null;
    const targetId = selectedFinishedItemId || currentRecipe.finishedItemId;
    return (
      items.find((i) => i.id === targetId) ||
      resolveInventoryItem(items, {
        id: currentRecipe.finishedItemId,
        name: currentRecipe.finishedItemName,
      })
    );
  }, [items, currentRecipe, selectedFinishedItemId]);

  const effectiveMultiplier = typeof batchMultiplier === 'number' && batchMultiplier > 0 ? batchMultiplier : 1;

  // Initialize or reset ingredients when recipe or multiplier changes
  useEffect(() => {
    if (!currentRecipe) return;

    setSelectedFinishedItemId(currentRecipe.finishedItemId);

    const standardYield = (Number(currentRecipe.yieldQuantity) || 1) * effectiveMultiplier;
    setCustomYield(standardYield);

    // Build standard ingredients scaled by multiplier
    const initialList: AdjustableIngredient[] = currentRecipe.ingredients.map((ing) => {
      const matched = resolveInventoryItem(items, ing);
      const unitCost = Number(matched?.unitCost) || 0;
      const stdQty = Number(ing.quantity) || 0;
      return {
        rawItemId: ing.rawItemId || (matched ? matched.id : `ing-${Math.random()}`),
        rawItemName: ing.rawItemName || (matched ? matched.name : 'Raw Material'),
        standardQuantityPerBatch: stdQty,
        quantity: Math.round(stdQty * effectiveMultiplier * 1000) / 1000,
        unit: ing.unit || (matched ? matched.unit : 'pcs'),
        unitCost,
      };
    });

    setAdjustedIngredients(initialList);
    setErrorMessage(null);
  }, [currentRecipe?.id, batchMultiplier]);

  // Feasibility calculation for current recipe
  const feasibility = useMemo(() => {
    if (!currentRecipe || !currentRecipe.ingredients || currentRecipe.ingredients.length === 0) {
      return { maxBatches: 0, limitingMaterial: '', color: 'grey' as const };
    }

    const materialTotals = new Map<
      string,
      { rawItemId: string; rawItemName: string; quantity: number; unit: string }
    >();
    for (const ing of currentRecipe.ingredients) {
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

    let minBatches = Infinity;
    let limitingName = '';

    for (const ing of materialTotals.values()) {
      const needed = Number(ing.quantity) || 0;
      if (needed <= 0) continue;

      const { item, totalAvailable } = getAvailableStockForIngredient(items, ing);
      const available = Math.max(0, totalAvailable);
      const itemName = item?.name || ing.rawItemName || 'Material';

      const possible = Math.floor(available / needed);
      if (possible < minBatches) {
        minBatches = possible;
        limitingName = itemName;
      }
    }

    if (minBatches === Infinity) {
      return { maxBatches: 0, limitingMaterial: '', color: 'grey' as const };
    }

    const maxBatches = Math.max(0, minBatches);
    const color = maxBatches === 0 ? ('red' as const) : maxBatches < 5 ? ('amber' as const) : ('green' as const);

    return { maxBatches, limitingMaterial: limitingName, color };
  }, [currentRecipe, items]);

  // Stepper handlers
  const handleMultiplierChange = (val: number) => {
    if (val <= 0) return;
    setBatchMultiplier(Math.round(val * 100) / 100);
  };

  const handleStepMinus = () => {
    const cur = typeof batchMultiplier === 'number' ? batchMultiplier : 1;
    if (cur > 1) {
      handleMultiplierChange(cur - 1);
    } else if (cur > 0.5) {
      handleMultiplierChange(0.5);
    }
  };

  const handleStepPlus = () => {
    const cur = typeof batchMultiplier === 'number' ? batchMultiplier : 1;
    handleMultiplierChange(cur + 1);
  };

  // Reset ingredients back to recipe formula standards
  const handleResetToFormula = () => {
    if (!currentRecipe) return;
    const standardYield = (Number(currentRecipe.yieldQuantity) || 1) * effectiveMultiplier;
    setCustomYield(standardYield);

    const resetList: AdjustableIngredient[] = currentRecipe.ingredients.map((ing) => {
      const matched = resolveInventoryItem(items, ing);
      const unitCost = Number(matched?.unitCost) || 0;
      const stdQty = Number(ing.quantity) || 0;
      return {
        rawItemId: ing.rawItemId || (matched ? matched.id : `ing-${Math.random()}`),
        rawItemName: ing.rawItemName || (matched ? matched.name : 'Raw Material'),
        standardQuantityPerBatch: stdQty,
        quantity: Math.round(stdQty * effectiveMultiplier * 1000) / 1000,
        unit: ing.unit || (matched ? matched.unit : 'pcs'),
        unitCost,
      };
    });

    setAdjustedIngredients(resetList);
  };

  // Ingredient quantity update handler
  const handleUpdateIngredientQuantity = (rawItemId: string, newQty: number) => {
    setAdjustedIngredients((prev) =>
      prev.map((ing) =>
        ing.rawItemId === rawItemId
          ? { ...ing, quantity: Math.max(0, Math.round(newQty * 1000) / 1000) }
          : ing
      )
    );
  };

  // Remove an ingredient from this run
  const handleRemoveIngredient = (rawItemId: string) => {
    setAdjustedIngredients((prev) => prev.filter((ing) => ing.rawItemId !== rawItemId));
  };

  // Add an extra ingredient / product
  const handleAddExtraItem = () => {
    if (!extraItemId || extraItemQty <= 0) return;
    const item = items.find((i) => i.id === extraItemId);
    if (!item) return;

    const existingIndex = adjustedIngredients.findIndex((ing) => ing.rawItemId === item.id);
    if (existingIndex >= 0) {
      setAdjustedIngredients((prev) =>
        prev.map((ing, idx) =>
          idx === existingIndex
            ? { ...ing, quantity: Math.round((ing.quantity + extraItemQty) * 1000) / 1000 }
            : ing
        )
      );
    } else {
      setAdjustedIngredients((prev) => [
        ...prev,
        {
          rawItemId: item.id,
          rawItemName: item.name,
          standardQuantityPerBatch: 0,
          quantity: extraItemQty,
          unit: item.unit,
          unitCost: Number(item.unitCost) || 0,
          isExtra: true,
        },
      ]);
    }

    setExtraItemId('');
    setExtraItemQty(1);
    setIsAddingExtra(false);
  };

  // Ingredients stock availability analysis
  const ingredientStockAnalysis = useMemo(() => {
    return adjustedIngredients.map((ing) => {
      const item = items.find((i) => i.id === ing.rawItemId);
      const isMissing = !item;
      const available = item ? getItemQuantity(item) : 0;
      const isSufficient = !isMissing && available >= ing.quantity;
      const shortage = isMissing
        ? ing.quantity
        : isSufficient
        ? 0
        : Math.round((ing.quantity - available) * 1000) / 1000;
      const remainingAfter = Math.max(0, Math.round((available - ing.quantity) * 1000) / 1000);
      const isBelowMinAfter =
        item && typeof item.minStock === 'number' && item.minStock > 0
          ? remainingAfter < item.minStock
          : false;

      // Check if amount is modified compared to formula standard
      const standardForRun = Math.round(ing.standardQuantityPerBatch * effectiveMultiplier * 1000) / 1000;
      const isModified = ing.isExtra || Math.abs(ing.quantity - standardForRun) > 0.001;

      return {
        ...ing,
        isMissing,
        available,
        isSufficient,
        shortage,
        remainingAfter,
        isBelowMinAfter,
        isModified,
        minStock: item?.minStock,
      };
    });
  }, [adjustedIngredients, items, effectiveMultiplier]);

  const hasMissingMaterial = ingredientStockAnalysis.some((a) => a.isMissing);
  const shortCount = ingredientStockAnalysis.filter((a) => !a.isSufficient).length;
  const hasShortages = shortCount > 0;

  const resolvedYield =
    Number(customYield) > 0
      ? Number(customYield)
      : (Number(currentRecipe?.yieldQuantity) || 1) * effectiveMultiplier;

  const finishedUnit = finishedItem?.unit || 'units';
  const finishedStockOnHand = finishedItem ? getItemQuantity(finishedItem) : 0;

  // Format table numbers:
  // STOCK: whole numbers without decimals (35,920), other numbers max 1 decimal (6,102.3, 8,999.9).
  // If a number still doesn't fit (>= 60,000), shorten it (e.g. 68.1k, 1.2M) instead of cutting it off.
  const formatTableNum = (num: number, isStock: boolean = false, unit?: string): string => {
    if (num === null || num === undefined || isNaN(num)) return '0';
    const abs = Math.abs(num);
    const sign = num < 0 ? '-' : '';

    if (abs >= 1_000_000) {
      const val = abs / 1_000_000;
      const formatted = (Math.round(val * 10) / 10).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      });
      return `${sign}${formatted}M`;
    }

    if (abs >= 60_000) {
      const val = abs / 1_000;
      const formatted = (Math.round(val * 10) / 10).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      });
      return `${sign}${formatted}k`;
    }

    if (isWholeUnit(unit) || (isStock && abs % 1 === 0)) {
      return Math.round(num).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
    }

    const rounded = Math.round(abs * 100) / 100;
    const formatted = rounded.toLocaleString('en-IN', {
      minimumFractionDigits: 0,
      maximumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    });
    return `${sign}${formatted}`;
  };

  // Filtered recipe list for the recipe picker modal
  const filteredPickerRecipes = useMemo(() => {
    if (!recipeSearchQuery.trim()) return recipes;
    const q = recipeSearchQuery.toLowerCase();
    return recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.finishedItemName || '').toLowerCase().includes(q)
    );
  }, [recipes, recipeSearchQuery]);

  // Handle Form Submission
  const handleSubmitProduction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRecipe) return;

    if (adjustedIngredients.length === 0) {
      setErrorMessage('Please include at least one raw material in this batch run.');
      return;
    }

    if (resolvedYield <= 0) {
      setErrorMessage('Finished output quantity must be greater than zero.');
      return;
    }

    if (hasMissingMaterial) {
      setErrorMessage('Missing material — edit BOM');
      return;
    }

    if (hasShortages) {
      setErrorMessage(
        'Cannot proceed: One or more required items have insufficient on-hand inventory stock. Please adjust quantities or restock inventory first.'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    // Sum quantities per material first
    const materialTotals = new Map<
      string,
      { rawItemId: string; rawItemName: string; quantity: number; unit: string }
    >();
    for (const ing of adjustedIngredients) {
      const existing = materialTotals.get(ing.rawItemId);
      if (existing) {
        existing.quantity += Number(ing.quantity) || 0;
      } else {
        materialTotals.set(ing.rawItemId, {
          rawItemId: ing.rawItemId,
          rawItemName: ing.rawItemName,
          quantity: Number(ing.quantity) || 0,
          unit: ing.unit,
        });
      }
    }
    const materialsPayload = Array.from(materialTotals.values());

    try {
      if (directApproval && permissions.canAuditRequests) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setErrorMessage('No internet connection — nothing was saved. Please try again.');
          setIsSubmitting(false);
          return;
        }
        const fName = finishedItem?.name || currentRecipe.name;
        const yieldLabel = `+${resolvedYield} ${finishedUnit} ${fName}`;

        try {
          confetti({
            particleCount: 60,
            spread: 70,
            origin: { y: 0.6 },
          });
        } catch {}

        showActionToast('Saving…', yieldLabel, 'saving');
        const promise = produceRecipeBatch(
          currentRecipe.id,
          effectiveMultiplier,
          notes.trim() || undefined,
          materialsPayload,
          resolvedYield,
          finishedItem?.id
        );
        setIsSubmitting(false);
        onBack();

        promise
          .then((result) => {
            if (result.success) {
              showActionToast('Batch produced', yieldLabel, 'success');
            } else {
              showActionToast('Production failed', result.error || 'Failed to complete production run.', 'error');
            }
          })
          .catch((err: any) => {
            showActionToast('Production failed', formatFirestoreError(err, 'Failed to complete production run.'), 'error');
          });
        return;
      } else {
        // Standard Audit Workflow: Submits request to Audit Queue
        const auditPayload: Parameters<typeof submitAuditRequest>[0] = {
          type: 'production',
          title: `Production: ${currentRecipe.name} (${resolvedYield} ${finishedUnit})`,
          recipeId: currentRecipe.id,
          recipeName: currentRecipe.name,
          finishedItemId: finishedItem?.id || currentRecipe.finishedItemId,
          finishedItemName: finishedItem?.name || currentRecipe.finishedItemName,
          batchMultiplier: effectiveMultiplier,
          expectedYield: resolvedYield,
          unit: finishedUnit,
          materialsNeeded: materialsPayload,
        };

        if (notes.trim()) {
          auditPayload.notes = notes.trim();
        }

        await submitAuditRequest(auditPayload);

        try {
          confetti({
            particleCount: 50,
            spread: 60,
            origin: { y: 0.6 },
          });
        } catch {}

        setSuccessMessage(
          `Production run for "${currentRecipe.name}" (${resolvedYield} ${finishedUnit}) has been submitted for Audit! Raw materials will be deducted after approval.`
        );
        setTimeout(() => {
          onBack();
        }, 2200);
      }
    } catch (err: any) {
      setErrorMessage(formatFirestoreError(err, 'Failed to complete production request.'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-24 space-y-3.5 animate-in fade-in duration-150">
      {/* =====================================================================
          1. TOP ROW: Back Link + Operator / Role Badge
      ===================================================================== */}
      <div className="flex items-center justify-between gap-2 pt-1 pb-1">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          <span>Production</span>
        </button>

        <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="font-medium text-slate-600">{simulatedName}</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 capitalize">
            {role}
          </span>
        </div>
      </div>

      {/* Alert / Feedback Messages */}
      {errorMessage && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong className="block font-bold">Production Error</strong>
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-500 hover:text-rose-700 text-xs font-bold cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong className="block font-bold">Success</strong>
            <span>{successMessage}</span>
          </div>
        </div>
      )}

      {/* =====================================================================
          2. PRODUCT CARD (One card)
      ===================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-2xs">
        <div className="flex items-center justify-between gap-3">
          {/* Left: 52px photo + Name + Subtitle + Feasibility Badge */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Photo: 52px */}
            <div className="w-[52px] h-[52px] rounded-xl bg-slate-50 border border-slate-200/80 overflow-hidden flex items-center justify-center shrink-0">
              {finishedItem?.photoThumb ? (
                <img
                  src={finishedItem.photoThumb}
                  alt={finishedItem.name || currentRecipe?.name}
                  className="w-full h-full object-contain p-1"
                />
              ) : (
                <Package className="w-6 h-6 text-slate-400" />
              )}
            </div>

            {/* Details */}
            <div className="min-w-0 flex-1">
              <h2 className="text-sm sm:text-base font-extrabold text-slate-900 truncate leading-snug">
                {currentRecipe?.name || 'Unnamed BOM'}
              </h2>
              <div className="text-[11px] text-slate-500 truncate mt-0.5">
                <span>BOM</span>
                <span className="mx-1 text-slate-300">·</span>
                <span>
                  1 batch = {formatQty(currentRecipe?.yieldQuantity || 1, finishedUnit)} {finishedUnit}
                </span>
                <span className="mx-1 text-slate-300">·</span>
                <span>
                  on hand {formatQty(finishedStockOnHand, finishedUnit)} {finishedUnit}
                </span>
              </div>

              {/* Feasibility Badge */}
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {feasibility.color === 'green' ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Can make up to {feasibility.maxBatches}
                  </span>
                ) : feasibility.color === 'amber' ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                    Can make up to {feasibility.maxBatches}
                  </span>
                ) : feasibility.color === 'red' ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                    Can make up to 0
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                    Can make —
                  </span>
                )}

                {feasibility.limitingMaterial && (
                  <span className="text-[10px] text-slate-400 truncate">
                    limit: {feasibility.limitingMaterial}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: "Change" Recipe Button */}
          <button
            type="button"
            onClick={() => {
              setRecipeSearchQuery('');
              setIsRecipePickerOpen(true);
            }}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl border border-indigo-200 transition cursor-pointer shrink-0 active:scale-95"
            title="Choose a different BOM"
          >
            Change
          </button>
        </div>
      </div>

      {/* =====================================================================
          3. HOW MANY: Stepper + Quick Chips + "Makes {output}"
      ===================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            How Many Batches
          </span>
          <span className="text-xs text-slate-400">
            Formula base: {formatQty(currentRecipe?.yieldQuantity || 1, finishedUnit)} {finishedUnit}/batch
          </span>
        </div>

        {/* Compact Stepper: height 44px, − and + buttons 44x44px, number 22px */}
        <div className="flex items-center justify-center gap-2 h-[44px]">
          <button
            type="button"
            onClick={handleStepMinus}
            className="w-[44px] h-[44px] rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-lg flex items-center justify-center transition cursor-pointer active:scale-90 shadow-2xs select-none shrink-0"
            title="Decrease 1 batch"
          >
            −
          </button>

          <div className="relative h-[44px]">
            <input
              type="number"
              step="any"
              min="0.1"
              value={batchMultiplier}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setBatchMultiplier('');
                  return;
                }
                const val = parseFloat(raw);
                if (!isNaN(val)) {
                  setBatchMultiplier(val);
                }
              }}
              onBlur={() => {
                if (batchMultiplier === '' || batchMultiplier <= 0) {
                  setBatchMultiplier(1);
                }
              }}
              className="w-24 sm:w-28 h-[44px] text-center text-[22px] font-black font-mono text-slate-900 bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
            />
          </div>

          <button
            type="button"
            onClick={handleStepPlus}
            className="w-[44px] h-[44px] rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-lg flex items-center justify-center transition cursor-pointer active:scale-90 shadow-2xs select-none shrink-0"
            title="Increase 1 batch"
          >
            +
          </button>
        </div>

        {/* Quick Chips: height 30px, 13px text, on one line */}
        <div className="flex items-center justify-center gap-1.5 overflow-x-auto no-scrollbar flex-nowrap w-full py-0.5">
          {[1, 5, 10, 25, 50].map((val) => (
            <button
              key={val}
              type="button"
              onClick={() => handleMultiplierChange(val)}
              className={`h-[30px] px-2.5 sm:px-3 text-[13px] font-bold rounded-lg transition cursor-pointer active:scale-95 whitespace-nowrap shrink-0 flex items-center justify-center ${
                batchMultiplier === val
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              {val}
            </button>
          ))}

          {feasibility.maxBatches > 0 && (
            <button
              type="button"
              onClick={() => handleMultiplierChange(feasibility.maxBatches)}
              className={`h-[30px] px-2.5 sm:px-3 text-[13px] font-bold rounded-lg transition cursor-pointer active:scale-95 whitespace-nowrap shrink-0 flex items-center justify-center ${
                batchMultiplier === feasibility.maxBatches
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
              }`}
              title="Scale to maximum available inventory stock"
            >
              Max {feasibility.maxBatches}
            </button>
          )}
        </div>

        {/* Under Stepper: "Makes {output} {unit}" + "Set output instead" link */}
        <div className="flex items-center justify-center gap-2 pt-1 text-xs text-slate-600">
          <span>
            Makes <strong className="text-slate-900 font-extrabold">{formatQty(resolvedYield, finishedUnit)} {finishedUnit}</strong>
          </span>
          <span className="text-slate-300">·</span>
          <button
            type="button"
            onClick={() => setShowCustomYieldInput((v) => !v)}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer underline"
          >
            {showCustomYieldInput ? 'Use standard yield' : 'Set output instead'}
          </button>
        </div>

        {/* Collapsible Custom Output Input if toggled */}
        {showCustomYieldInput && (
          <div className="pt-2 animate-in fade-in duration-100">
            <div className="p-3 bg-indigo-50/60 rounded-xl border border-indigo-200 flex items-center justify-between gap-3 text-xs">
              <span className="font-semibold text-indigo-900">Custom Target Output:</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step="any"
                  value={customYield}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setCustomYield(raw === '' ? '' : parseFloat(raw) || 0);
                  }}
                  className="w-24 px-2 py-1 text-xs font-bold font-mono text-right bg-white border border-indigo-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="e.g. 50"
                />
                <span className="font-bold text-indigo-800">{finishedUnit}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* =====================================================================
          4. MATERIALS TABLE (All materials in ONE compact table)
      ===================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        {/* Header: Line 1 = MATERIALS (count) · ALL OK, Line 2 = right-aligned buttons with gap of 8px (flex-wrap) */}
        <div className="p-3 sm:p-3.5 border-b border-slate-200 flex flex-col gap-2 bg-slate-50/70 select-none">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-black uppercase tracking-wider text-slate-700 whitespace-nowrap">
              MATERIALS ({adjustedIngredients.length})
            </span>
            <span className="text-slate-300">·</span>
            {hasShortages ? (
              <span className="text-xs font-bold text-rose-600 whitespace-nowrap">
                {shortCount} SHORT
              </span>
            ) : (
              <span className="text-xs font-bold text-emerald-700 whitespace-nowrap">
                ALL OK
              </span>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 flex-wrap">
            {isEditingAmounts ? (
              <>
                <button
                  type="button"
                  onClick={handleResetToFormula}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer px-1.5 py-1 whitespace-nowrap"
                  title="Reset to formula"
                >
                  ↺ Reset to formula
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingAmounts(false)}
                  className="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-1 rounded-lg border border-indigo-200 transition cursor-pointer whitespace-nowrap"
                >
                  Done
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingAmounts(true)}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 transition cursor-pointer px-1.5 py-1 whitespace-nowrap"
                title="Edit amounts"
              >
                ✎ Edit amounts
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsAddingExtra((v) => !v)}
              className="text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg transition cursor-pointer whitespace-nowrap"
              title="Add material"
            >
              ＋ Add
            </button>
          </div>
        </div>

        {/* Collapsible Inline Add Extra Material Bar */}
        {isAddingExtra && (
          <div className="p-3 bg-indigo-50/70 border-b border-indigo-200 space-y-2 animate-in fade-in duration-100">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-indigo-900">Add Extra Raw Material / Product:</span>
              <button
                type="button"
                onClick={() => setIsAddingExtra(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <select
                value={extraItemId}
                onChange={(e) => setExtraItemId(e.target.value)}
                className="flex-1 min-w-[180px] h-[38px] text-sm bg-white border border-indigo-200 rounded-lg px-2.5 text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">-- Choose item --</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({formatQty(i.quantity, i.unit)} {i.unit} on hand)
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="any"
                min="0.01"
                value={extraItemQty}
                onChange={(e) => setExtraItemQty(parseFloat(e.target.value) || 1)}
                className="w-20 h-9 text-xs font-bold font-mono text-right bg-white border border-indigo-200 rounded-lg px-2 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="Qty"
              />
              <button
                type="button"
                onClick={handleAddExtraItem}
                disabled={!extraItemId}
                className="h-9 px-3.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition disabled:opacity-50 cursor-pointer shrink-0"
              >
                Add to Run
              </button>
            </div>
          </div>
        )}

        {/* Table: Fixed layout 100%, column widths 38% | 16% | 18% | 28% */}
        <div className="w-full overflow-hidden">
          <table className="w-full table-fixed border-collapse text-[13px]">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[16%]" />
              <col className="w-[18%]" />
              <col className="w-[28%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/90 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 select-none">
                <th className="py-2 pl-3 pr-1 text-left">Material</th>
                <th className="py-2 px-1 text-right">/Batch</th>
                <th className="py-2 pl-2 pr-1 text-right text-slate-700">Need</th>
                <th className="py-2 pl-2 pr-3 text-right">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ingredientStockAnalysis.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-xs text-slate-400">
                    No materials configured for this BOM. Tap &quot;＋ Add&quot; to add materials.
                  </td>
                </tr>
              ) : (
                ingredientStockAnalysis.map((ing, idx) => {
                  const isShortage = !ing.isSufficient;
                  const rowClass = isShortage
                    ? 'bg-rose-50/80 text-rose-950 font-medium'
                    : ing.isBelowMinAfter
                    ? 'bg-amber-50/60 text-slate-900'
                    : idx % 2 === 1
                    ? 'bg-slate-50/40 text-slate-800'
                    : 'bg-white text-slate-800';

                  return (
                    <tr key={ing.rawItemId} className={`h-[44px] transition hover:bg-indigo-50/30 ${rowClass}`}>
                      {/* Column 1: MATERIAL (38%) */}
                      <td className="py-1.5 pl-3 pr-1 min-w-0 align-middle">
                        <div
                          className="font-bold text-[13px] text-slate-900 line-clamp-2 leading-tight break-words"
                          title={ing.rawItemName}
                        >
                          {ing.rawItemName}
                          {ing.isExtra && (
                            <span className="ml-1 px-1 py-0.2 rounded text-[9px] font-bold bg-indigo-100 text-indigo-700 inline-block align-middle">
                              Extra
                            </span>
                          )}
                        </div>
                        {/* Unit under material name, small and grey */}
                        <div className="flex items-center justify-between text-[11px] text-slate-400 mt-0.5 leading-none">
                          <span className="truncate">
                            {ing.unit}
                            {isShortage ? (
                              <span className="ml-1 text-rose-600 font-bold">
                                · short by {formatTableNum(ing.shortage, false, ing.unit)}
                              </span>
                            ) : ing.isBelowMinAfter ? (
                              <span className="ml-1 text-amber-600 font-medium">
                                · leaves {formatTableNum(ing.remainingAfter, true, ing.unit)} (low)
                              </span>
                            ) : null}
                          </span>

                          {isEditingAmounts && (
                            <button
                              type="button"
                              onClick={() => handleRemoveIngredient(ing.rawItemId)}
                              className="p-0.5 text-slate-400 hover:text-rose-600 transition cursor-pointer ml-1"
                              title="Remove material from run"
                            >
                              <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Column 2: /BATCH (16%) */}
                      <td className="py-1.5 px-1 text-right font-mono text-[12px] text-slate-500 tabular-nums whitespace-nowrap align-middle">
                        {ing.isExtra ? '–' : formatTableNum(ing.standardQuantityPerBatch, false, ing.unit)}
                      </td>

                      {/* Column 3: NEED (18%) with 8px left padding */}
                      <td className="py-1.5 pl-2 pr-1 text-right font-mono text-[12px] tabular-nums whitespace-nowrap align-middle">
                        {isEditingAmounts ? (
                          <input
                            type="number"
                            step="any"
                            min="0"
                            value={ing.quantity}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              handleUpdateIngredientQuantity(ing.rawItemId, isNaN(val) ? 0 : val);
                            }}
                            className={`w-full text-right text-[12px] font-mono font-bold px-1 py-0.5 rounded border focus:outline-none focus:ring-1 ${
                              isShortage
                                ? 'bg-rose-100 border-rose-300 text-rose-900 focus:ring-rose-500'
                                : ing.isModified
                                ? 'bg-amber-100 border-amber-300 text-amber-950 focus:ring-amber-500'
                                : 'bg-white border-slate-300 text-slate-900 focus:ring-indigo-500'
                            }`}
                          />
                        ) : (
                          <span
                            className={`font-bold ${
                              isShortage
                                ? 'text-rose-600'
                                : ing.isModified
                                ? 'bg-amber-100 text-amber-900 px-1 py-0.5 rounded'
                                : 'text-slate-800'
                            }`}
                          >
                            {formatTableNum(ing.quantity, false, ing.unit)}
                          </span>
                        )}
                      </td>

                      {/* Column 4: STOCK (28%) with 8px left padding */}
                      <td
                        className={`py-1.5 pl-2 pr-3 text-right font-mono text-[12px] tabular-nums whitespace-nowrap align-middle ${
                          isShortage ? 'text-rose-700 font-bold' : 'text-slate-700 font-medium'
                        }`}
                      >
                        {formatTableNum(ing.available, true, ing.unit)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* =====================================================================
          5. NOTES: Collapsed "＋ Add note" link
      ===================================================================== */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-2xs">
        {!isNotesOpen && !notes ? (
          <button
            type="button"
            onClick={() => setIsNotesOpen(true)}
            className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>＋ Add note</span>
          </button>
        ) : (
          <div className="space-y-1.5 animate-in fade-in duration-100">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>Production Notes & Observations:</span>
              {!notes && (
                <button
                  type="button"
                  onClick={() => setIsNotesOpen(false)}
                  className="text-slate-400 hover:text-slate-600 font-normal text-xs"
                >
                  Hide
                </button>
              )}
            </div>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Line 2 run, adjusted water and color ratio by +0.5 kg for viscosity..."
              className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:bg-white transition"
            />
          </div>
        )}
      </div>

      {/* =====================================================================
          6. STICKY BOTTOM BAR (Always visible)
      ===================================================================== */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-xs border-t border-slate-200 p-3 sm:p-4 shadow-lg">
        <div
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3"
        >
          {/* Direct Execute Toggle (only for roles allowed today: canAuditRequests) */}
          <div className="w-full sm:w-auto">
            {permissions.canAuditRequests ? (
              <label className="flex items-center gap-2 cursor-pointer text-xs select-none">
                <input
                  type="checkbox"
                  checked={directApproval}
                  onChange={(e) => setDirectApproval(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                />
                <span className="font-semibold text-slate-700">
                  Direct execute (skip audit · managers only)
                </span>
              </label>
            ) : (
              <span className="text-[11px] text-slate-400 font-medium">
                Standard audit request flow
              </span>
            )}
          </div>

          {/* Main Action Button */}
          <div className="w-full sm:w-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleSubmitProduction}
              disabled={
                isSubmitting ||
                hasShortages ||
                hasMissingMaterial ||
                !!successMessage ||
                adjustedIngredients.length === 0
              }
              className={`w-full sm:w-auto min-w-[240px] py-2.5 px-5 rounded-xl text-xs font-bold text-white shadow-xs flex items-center justify-center gap-2 transition active:scale-95 cursor-pointer ${
                hasShortages || hasMissingMaterial || isSubmitting || !!successMessage || adjustedIngredients.length === 0
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none'
                  : directApproval
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {isSubmitting ? (
                <span>Processing Run...</span>
              ) : hasShortages ? (
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-slate-500" />
                  <span>Fix shortages first</span>
                </span>
              ) : directApproval ? (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>
                    Execute Now · {formatQty(resolvedYield, finishedUnit)} {finishedUnit}
                  </span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    Submit for Audit · {formatQty(resolvedYield, finishedUnit)} {finishedUnit}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* =====================================================================
          RECIPE PICKER MODAL (Searchable list with photos)
      ===================================================================== */}
      {isRecipePickerOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsRecipePickerOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-100"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-100">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">Choose BOM</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsRecipePickerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Box */}
            <div className="p-3 border-b border-slate-100 bg-slate-50">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  autoFocus
                  value={recipeSearchQuery}
                  onChange={(e) => setRecipeSearchQuery(e.target.value)}
                  placeholder="Search BOMs or items..."
                  className="w-full h-9 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-2xs"
                />
              </div>
            </div>

            {/* BOM List */}
            <div className="p-3 overflow-y-auto divide-y divide-slate-100 flex-1 space-y-1">
              {filteredPickerRecipes.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  No BOMs found matching &quot;{recipeSearchQuery}&quot;
                </div>
              ) : (
                filteredPickerRecipes.map((r) => {
                  const targetItem =
                    items.find((i) => i.id === r.finishedItemId) ||
                    resolveInventoryItem(items, { id: r.finishedItemId, name: r.finishedItemName });
                  const isSelected = r.id === selectedRecipeId;

                  return (
                    <div
                      key={r.id}
                      onClick={() => {
                        setSelectedRecipeId(r.id);
                        setIsRecipePickerOpen(false);
                      }}
                      className={`p-2.5 rounded-xl flex items-center justify-between gap-3 cursor-pointer transition hover:bg-slate-50 ${
                        isSelected ? 'bg-indigo-50/60 border border-indigo-200' : ''
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                          {targetItem?.photoThumb ? (
                            <img
                              src={targetItem.photoThumb}
                              alt={r.name}
                              className="w-full h-full object-contain p-0.5"
                            />
                          ) : (
                            <Package className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="font-bold text-xs text-slate-900 block truncate">
                            {r.name}
                          </span>
                          <span className="text-[10px] text-slate-500 block truncate">
                            Yield: {formatQty(r.yieldQuantity, targetItem?.unit)} {targetItem?.unit || 'units'} · {r.ingredients?.length || 0} materials
                          </span>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
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
