import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Flame,
  CheckCircle2,
  AlertTriangle,
  ClipboardCheck,
  Plus,
  Trash2,
  RotateCcw,
  Boxes,
  Package,
  Layers,
  ChevronRight,
  Info,
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
    getRecipeFeasibility,
  } = useInventory();
  const { permissions, simulatedName, role } = useAuth();

  // Recipe selection
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>(() => {
    if (initialRecipeId && recipes.some((r) => r.id === initialRecipeId)) {
      return initialRecipeId;
    }
    return recipes.length > 0 ? recipes[0].id : '';
  });

  // Batch multiplier & custom yield
  const [batchMultiplier, setBatchMultiplier] = useState<number | ''>(1);
  const [customYield, setCustomYield] = useState<number | ''>('');
  const [selectedFinishedItemId, setSelectedFinishedItemId] = useState<string>('');

  // Editable list of ingredients for this run
  const [adjustedIngredients, setAdjustedIngredients] = useState<AdjustableIngredient[]>([]);

  // Extra item adder state
  const [extraItemId, setExtraItemId] = useState<string>('');
  const [extraItemQty, setExtraItemQty] = useState<number>(1);
  const [isAddingExtra, setIsAddingExtra] = useState<boolean>(false);

  // Notes & execution mode
  const [notes, setNotes] = useState<string>('');
  const [directApproval, setDirectApproval] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
        unit: ing.unit || (matched ? matched.unit : 'kg'),
        unitCost,
      };
    });

    setAdjustedIngredients(initialList);
    setErrorMessage(null);
  }, [currentRecipe?.id, batchMultiplier]);

  // Multiplier change handler
  const handleMultiplierChange = (newMultiplier: number) => {
    if (newMultiplier <= 0) return;
    setBatchMultiplier(newMultiplier);
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
        unit: ing.unit || (matched ? matched.unit : 'kg'),
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

    // Check if already in list
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
      const shortage = isMissing ? ing.quantity : isSufficient ? 0 : Math.round((ing.quantity - available) * 1000) / 1000;
      const remainingAfter = Math.max(0, Math.round((available - ing.quantity) * 1000) / 1000);
      const lineCost = (Number(ing.quantity) || 0) * (Number(ing.unitCost) || 0);

      return {
        ...ing,
        isMissing,
        available,
        isSufficient,
        shortage,
        remainingAfter,
        lineCost,
      };
    });
  }, [adjustedIngredients, items]);

  const hasMissingMaterial = ingredientStockAnalysis.some((a) => a.isMissing);
  const hasShortages = ingredientStockAnalysis.some((a) => !a.isSufficient);

  const resolvedYield = Number(customYield) > 0
    ? Number(customYield)
    : (Number(currentRecipe?.yieldQuantity) || 1) * effectiveMultiplier;

  // Recipe feasibility helper
  const feasibility = currentRecipe ? getRecipeFeasibility(currentRecipe) : { maxBatchesPossible: 0, maxUnitsPossible: 0 };

  // Handle Form Submission
  const handleSubmitProduction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRecipe) return;

    if (adjustedIngredients.length === 0) {
      setErrorMessage('Please include at least one raw material or ingredient in this batch run.');
      return;
    }

    if (resolvedYield <= 0) {
      setErrorMessage('Finished output quantity must be greater than zero.');
      return;
    }

    if (hasMissingMaterial) {
      setErrorMessage('Missing material — edit recipe');
      return;
    }

    if (hasShortages) {
      setErrorMessage(
        'Cannot proceed: One or more required products have insufficient on-hand inventory stock. Please adjust quantities or restock inventory first.'
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    // Sum quantities per material first
    const materialTotals = new Map<string, { rawItemId: string; rawItemName: string; quantity: number; unit: string }>();
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
        // Direct Auditor Execution (Immediate update to Firestore inventory)
        const result = await produceRecipeBatch(
          currentRecipe.id,
          effectiveMultiplier,
          notes.trim() || undefined,
          materialsPayload,
          resolvedYield,
          finishedItem?.id
        );

        if (result.success) {
          try {
            confetti({
              particleCount: 60,
              spread: 70,
              origin: { y: 0.6 },
            });
          } catch {}

          setSuccessMessage(
            `Batch Production Successfully Executed! Produced ${resolvedYield} ${
              finishedItem?.unit || 'units'
            } of ${finishedItem?.name || currentRecipe.name}. Raw material stocks have been deducted and inventory updated.`
          );
          // Keep button disabled until page transitions back
          setTimeout(() => {
            onBack();
          }, 2400);
        } else {
          setErrorMessage(result.error || 'Failed to complete production run.');
          setIsSubmitting(false);
        }
      } else {
        // Standard Audit Workflow: Submits request to Audit Queue
        const auditPayload: Parameters<typeof submitAuditRequest>[0] = {
          type: 'production',
          title: `Production: ${currentRecipe.name} (${resolvedYield} ${finishedItem?.unit || 'units'})`,
          recipeId: currentRecipe.id,
          recipeName: currentRecipe.name,
          finishedItemId: finishedItem?.id || currentRecipe.finishedItemId,
          finishedItemName: finishedItem?.name || currentRecipe.finishedItemName,
          batchMultiplier: effectiveMultiplier,
          expectedYield: resolvedYield,
          unit: finishedItem?.unit || 'units',
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
          `Production run for "${currentRecipe.name}" (${resolvedYield} ${
            finishedItem?.unit || 'units'
          }) has been submitted for Audit! Raw materials will be deducted and inventory updated after an authorized auditor approves the entry in the Audit Report shelf.`
        );
        // Keep button disabled until page transitions back
        setTimeout(() => {
          onBack();
        }, 2500);
      }
    } catch (err: any) {
      setErrorMessage(formatFirestoreError(err, 'Failed to complete production request.'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header & Breadcrumb Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-xs font-bold text-indigo-700 bg-white hover:bg-indigo-50 px-3.5 py-2 rounded-xl border border-indigo-200 transition shadow-2xs cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>← Back to Batch Production Runs</span>
          </button>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
            <span>Batch Production & Manufacturing</span>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="font-semibold text-slate-700">New Production Run</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium">Operator:</span>
          <span className="font-bold text-slate-800">{simulatedName}</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 capitalize">
            {role}
          </span>
        </div>
      </div>

      {/* Main Page Title Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-xl shadow-xs shrink-0">
            <Flame className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Execute New Production Run
            </h1>
            <p className="text-xs sm:text-sm text-slate-500">
              Select your recipe formula, customize finished goods yield, and adjust product & raw material quantities before executing or submitting for audit.
            </p>
          </div>
        </div>
      </div>

      {/* Alert / Feedback Messages */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2.5 animate-in fade-in">
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
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <strong className="block font-bold">Success</strong>
            <span>{successMessage}</span>
          </div>
        </div>
      )}

      {/* Main Configuration Form */}
      <form onSubmit={handleSubmitProduction} className="max-w-3xl mx-auto space-y-6">
        {/* Card 1: Formula & Finished Good Output Selection */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              <span>1. Recipe Formula & Finished Product</span>
            </h2>
            <span className="text-xs font-medium text-slate-500">
              Formula yields {currentRecipe?.yieldQuantity || 1} {finishedItem?.unit || 'units'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Recipe Selector */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Select Recipe Formula <span className="text-rose-500">*</span>
              </label>
              <select
                value={selectedRecipeId}
                onChange={(e) => setSelectedRecipeId(e.target.value)}
                className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition cursor-pointer"
              >
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} (Yield: {r.yieldQuantity} {r.finishedItemName})
                  </option>
                ))}
              </select>
            </div>

            {/* Target Finished Item */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Output Finished Product
              </label>
              <div className="flex items-center gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
                  <Package className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-xs font-bold text-slate-900 truncate">
                    {finishedItem?.name || currentRecipe?.finishedItemName}
                  </span>
                  <span className="block text-[10px] text-slate-500">
                    SKU: {finishedItem?.sku || 'N/A'} • On-hand: {finishedItem ? Number((getItemQuantity(finishedItem)).toFixed(2)) : 0} {finishedItem?.unit || 'units'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Batch Multiplier & Custom Output Yield */}
          <div className="pt-3 border-t border-slate-100 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Batch Size / Multiplier
                </label>
                <p className="text-[11px] text-slate-400">
                  Quickly scale formula or set custom output yield
                </p>
              </div>

              {/* Multiplier Presets */}
              <div className="flex items-center gap-1.5">
                {[0.5, 1, 2, 4, 10].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handleMultiplierChange(preset)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition cursor-pointer ${
                      batchMultiplier === preset
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    {preset}x
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              {/* Batch Multiplier Input */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Batch Scale Multiplier
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
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
                    placeholder="1"
                    className="w-full text-xs font-bold bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs font-bold text-slate-400">
                    Multiplier (x)
                  </span>
                </div>
              </div>

              {/* Direct Custom Yield Input */}
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Adjusted Finished Output Yield <span className="text-emerald-700 font-bold">(Target Units)</span>
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={customYield}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setCustomYield('');
                        return;
                      }
                      const val = parseFloat(raw);
                      if (!isNaN(val)) {
                        setCustomYield(val);
                      }
                    }}
                    className="w-full text-xs font-bold text-emerald-800 bg-emerald-50/50 border border-emerald-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    placeholder="e.g. 10"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs font-bold text-emerald-700">
                    {finishedItem?.unit || 'units'}
                  </span>
                </div>
              </div>
            </div>

            {/* Feasibility Indicator */}
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-xs text-slate-600">
              <span className="flex items-center gap-1.5 font-medium">
                <Info className="w-3.5 h-3.5 text-slate-400" />
                <span>Catalog Stock Capacity:</span>
              </span>
              <span className="font-bold text-emerald-700">
                Up to {feasibility.maxBatchesPossible} batches ({feasibility.maxUnitsPossible} {finishedItem?.unit || 'units'}) based on current raw stock
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Adjust Products & Quantities (Raw Materials & BOM) */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Boxes className="w-4 h-4 text-indigo-600" />
                <span>2. Adjust Products & Consumption Quantities</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Adjust ingredient quantities up or down, add extra items, or customize consumption for this batch run
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleResetToFormula}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition cursor-pointer"
                title="Reset all quantities back to standard formula ratio"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                <span>Reset to Formula</span>
              </button>

              <button
                type="button"
                onClick={() => setIsAddingExtra((prev) => !prev)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ Add Extra Material</span>
              </button>
            </div>
          </div>

          {/* Inline Extra Item Adder */}
          {isAddingExtra && (
            <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-xl space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-900">
                  Add Extra Inventory Product to this Run:
                </span>
                <button
                  type="button"
                  onClick={() => setIsAddingExtra(false)}
                  className="text-indigo-600 hover:text-indigo-900 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <select
                    value={extraItemId}
                    onChange={(e) => setExtraItemId(e.target.value)}
                    className="w-full text-xs bg-white border border-indigo-200 rounded-lg px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">-- Choose Raw Material / Item --</option>
                    {items
                      .filter(
                        (item) =>
                          !adjustedIngredients.some((ing) => ing.rawItemId === item.id)
                      )
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} (Stock: {item.quantity} {item.unit})
                        </option>
                      ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="any"
                    min="0.01"
                    value={extraItemQty}
                    onChange={(e) => setExtraItemQty(parseFloat(e.target.value) || 1)}
                    className="w-24 text-xs font-bold bg-white border border-indigo-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Qty"
                  />
                  <button
                    type="button"
                    onClick={handleAddExtraItem}
                    disabled={!extraItemId}
                    className="flex-1 px-3 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-2xs transition disabled:opacity-50 cursor-pointer"
                  >
                    Add Item
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* List of Editable Ingredients */}
          <div className="space-y-2.5">
            {ingredientStockAnalysis.map((ing) => {
              const isShortage = !ing.isSufficient;
              const formattedAvailable = Number(ing.available.toFixed(3));

              return (
                <div
                  key={ing.rawItemId}
                  className={`p-3 sm:p-3.5 rounded-xl border transition ${
                    isShortage
                      ? 'bg-rose-50/60 border-rose-200'
                      : ing.isExtra
                      ? 'bg-indigo-50/40 border-indigo-200'
                      : 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    {/* Left: Product Name & Stock Info */}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                          {ing.rawItemName}
                        </span>
                        {ing.isExtra ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                            Extra Item
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200/80 text-slate-700">
                            Std: {Number(ing.standardQuantityPerBatch.toFixed(3))} {ing.unit}/batch
                          </span>
                        )}
                      </div>

                      {/* Stock Status */}
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-500">
                          On-hand: <strong className="text-slate-700">{formattedAvailable} {ing.unit}</strong>
                        </span>
                        {isShortage && (
                          <span className="font-bold text-rose-700 flex items-center gap-1">
                            • <AlertTriangle className="w-3.5 h-3.5 text-rose-600 inline" />
                            Shortage: {Number(ing.shortage.toFixed(3))} {ing.unit}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Right: Quantity Input & Delete Action */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Editable Number Input */}
                      <div className="relative w-28 sm:w-32">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={ing.quantity}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            handleUpdateIngredientQuantity(ing.rawItemId, isNaN(val) ? 0 : val);
                          }}
                          className={`w-full text-xs font-bold text-right pr-9 pl-2.5 py-1.5 rounded-lg border focus:outline-none focus:ring-2 ${
                            isShortage
                              ? 'bg-rose-50 border-rose-300 text-rose-900 focus:ring-rose-500'
                              : 'bg-white border-slate-300 text-slate-900 focus:ring-indigo-500'
                          }`}
                        />
                        <span className="absolute right-2 top-1.5 text-[10px] font-bold text-slate-400 pointer-events-none">
                          {ing.unit}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveIngredient(ing.rawItemId)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 transition cursor-pointer rounded-lg hover:bg-rose-50"
                        title="Remove ingredient from this run"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 3: Batch Observations & Notes */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-3">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-indigo-600" />
            <span>3. Production Notes & Lot Observations</span>
          </h2>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition"
            placeholder="e.g. Line 2 run, adjusted water and color ratio by +0.5 kg for viscosity..."
          />
        </div>

        {/* Direct Execute Option (Only for users with audit rights) & Submission Actions */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-4">
          {permissions.canAuditRequests && (
            <div className="pb-3 border-b border-slate-100">
              <label className="flex items-center gap-2.5 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={directApproval}
                  onChange={(e) => setDirectApproval(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                />
                <span className="font-semibold text-slate-800">
                  Direct Execute (Bypass Audit Queue)
                </span>
              </label>
              <p className="text-[10px] text-slate-400 mt-0.5 pl-6">
                Available for Managers and Owners with direct auditing authority.
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-center gap-3">
            <button
              type="submit"
              disabled={isSubmitting || hasShortages || hasMissingMaterial || !!successMessage || adjustedIngredients.length === 0}
              className={`flex-1 w-full py-3 px-4 rounded-xl text-xs font-bold text-white shadow-sm flex items-center justify-center gap-2 transition cursor-pointer ${
                hasShortages || hasMissingMaterial || isSubmitting || !!successMessage
                  ? 'bg-slate-400 cursor-not-allowed'
                  : directApproval
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              }`}
            >
              {isSubmitting ? (
                <span>Processing Run...</span>
              ) : directApproval ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Execute Batch Run ({resolvedYield} Units)</span>
                </>
              ) : (
                <>
                  <ClipboardCheck className="w-4 h-4" />
                  <span>Submit for Audit ({resolvedYield} Units)</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onBack}
              disabled={isSubmitting}
              className="w-full sm:w-auto py-3 px-5 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
            >
              Cancel & Return
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};


