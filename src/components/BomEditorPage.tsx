import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  AlertCircle,
  Check,
  ChevronDown,
  Package,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Recipe, IngredientRequirement, InventoryItem } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { formatFirestoreError } from '../firebase/config';
import { getItemQuantity } from '../utils/itemResolver';

export interface BomEditorPageProps {
  mode: 'new' | 'edit' | 'duplicate';
  sourceRecipe?: Recipe | null;
  onCancel: () => void;
  onSaved: (savedRecipeId: string) => void;
  backHandlerRef?: React.MutableRefObject<(() => void) | null>;
}

interface FormMaterialRow {
  rowId: string;
  rawItemId: string;
  rawItemName: string;
  quantity: string;
  unit: string;
}

const formatStock = (val: number): string => {
  const num = Number(val) || 0;
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

export const BomEditorPage: React.FC<BomEditorPageProps> = ({
  mode,
  sourceRecipe,
  onCancel,
  onSaved,
  backHandlerRef,
}) => {
  const { items, addRecipe, updateRecipe } = useInventory();

  const isEdit = mode === 'edit' && Boolean(sourceRecipe);
  const pageTitle = isEdit ? 'Edit BOM' : 'New BOM';

  // Finished / output item candidates
  const finishedGoods = useMemo(() => {
    const candidates = items.filter(
      (i) => i.type === 'finished_good' || i.type === 'semi_finished' || i.type === 'both'
    );
    return [...(candidates.length > 0 ? candidates : items)].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [items]);

  const sortedAllItems = useMemo(() => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  // Initial snapshot computation (once on mount for this editor session)
  const initialSnapshot = useMemo(() => {
    if (sourceRecipe && (mode === 'edit' || mode === 'duplicate')) {
      const initName =
        mode === 'duplicate' ? `${sourceRecipe.name} (copy)` : sourceRecipe.name;
      const initFinishedId = sourceRecipe.finishedItemId || '';
      const initYield = String(sourceRecipe.yieldQuantity ?? 1);
      const initLabor = String(sourceRecipe.laborCost ?? 0);
      const initInstructions = sourceRecipe.instructions || '';
      const initIngredients: FormMaterialRow[] = (sourceRecipe.ingredients || []).map(
        (ing, idx) => {
          const matched = items.find((i) => i.id === ing.rawItemId);
          return {
            rowId: `row-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            rawItemId: ing.rawItemId,
            rawItemName: matched ? matched.name : ing.rawItemName,
            quantity: String(ing.quantity ?? 1),
            unit: matched ? matched.unit : ing.unit,
          };
        }
      );
      return {
        name: initName,
        finishedItemId: initFinishedId,
        yieldQuantity: initYield,
        laborCost: initLabor,
        instructions: initInstructions,
        ingredients: initIngredients,
      };
    }

    const defaultFinishedId = finishedGoods[0]?.id || '';
    return {
      name: '',
      finishedItemId: defaultFinishedId,
      yieldQuantity: '1',
      laborCost: '0',
      instructions: '',
      ingredients: [] as FormMaterialRow[],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sourceRecipe?.id]);

  const [name, setName] = useState(initialSnapshot.name);
  const [finishedItemId, setFinishedItemId] = useState(initialSnapshot.finishedItemId);
  const [yieldQuantity, setYieldQuantity] = useState(initialSnapshot.yieldQuantity);
  const [laborCost, setLaborCost] = useState(initialSnapshot.laborCost);
  const [instructions, setInstructions] = useState(initialSnapshot.instructions);
  const [ingredients, setIngredients] = useState<FormMaterialRow[]>(initialSnapshot.ingredients);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Picker modals
  const [isOutputPickerOpen, setIsOutputPickerOpen] = useState(false);
  const [outputSearch, setOutputSearch] = useState('');

  const [isMaterialPickerOpen, setIsMaterialPickerOpen] = useState(false);
  const [materialSearch, setMaterialSearch] = useState('');

  // Unsaved-changes discard confirmation dialog
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const serializeState = useCallback(
    (
      n: string,
      fId: string,
      y: string,
      l: string,
      inst: string,
      ings: FormMaterialRow[]
    ) =>
      JSON.stringify({
        name: n,
        finishedItemId: fId,
        yieldQuantity: y,
        laborCost: l,
        instructions: inst,
        ingredients: ings.map((i) => ({
          rawItemId: i.rawItemId,
          quantity: i.quantity,
        })),
      }),
    []
  );

  const initialSerializedRef = useRef<string>(
    serializeState(
      initialSnapshot.name,
      initialSnapshot.finishedItemId,
      initialSnapshot.yieldQuantity,
      initialSnapshot.laborCost,
      initialSnapshot.instructions,
      initialSnapshot.ingredients
    )
  );

  const isDirty = useMemo(() => {
    const current = serializeState(
      name,
      finishedItemId,
      yieldQuantity,
      laborCost,
      instructions,
      ingredients
    );
    return current !== initialSerializedRef.current;
  }, [
    name,
    finishedItemId,
    yieldQuantity,
    laborCost,
    instructions,
    ingredients,
    serializeState,
  ]);

  // Keep latest dirty/picker state in refs for popstate handler
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;

  const pickerStateRef = useRef({
    output: isOutputPickerOpen,
    material: isMaterialPickerOpen,
    discard: showDiscardConfirm,
  });
  pickerStateRef.current = {
    output: isOutputPickerOpen,
    material: isMaterialPickerOpen,
    discard: showDiscardConfirm,
  };

  // Register back-press handler for RecipesView's central popstate listener
  useEffect(() => {
    if (!backHandlerRef) return;
    backHandlerRef.current = () => {
      if (pickerStateRef.current.discard) {
        setShowDiscardConfirm(false);
        window.history.pushState({ view: 'bom_editor' }, '');
        return;
      }
      if (pickerStateRef.current.material) {
        setIsMaterialPickerOpen(false);
        window.history.pushState({ view: 'bom_editor' }, '');
        return;
      }
      if (pickerStateRef.current.output) {
        setIsOutputPickerOpen(false);
        window.history.pushState({ view: 'bom_editor' }, '');
        return;
      }
      if (isSubmittingRef.current) {
        window.history.pushState({ view: 'bom_editor' }, '');
        return;
      }
      if (isDirtyRef.current) {
        window.history.pushState({ view: 'bom_editor' }, '');
        setShowDiscardConfirm(true);
        return;
      }
      onCancel();
    };
    return () => {
      backHandlerRef.current = null;
    };
  }, [backHandlerRef, onCancel]);

  const handleRequestCancel = () => {
    if (isSubmitting) return;
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onCancel();
    }
  };

  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false);
    onCancel();
  };

  const selectedFinishedItem: InventoryItem | undefined = useMemo(
    () => items.find((i) => i.id === finishedItemId),
    [items, finishedItemId]
  );

  // Searchable Output Item options
  const filteredOutputItems = useMemo(() => {
    const q = outputSearch.trim().toLowerCase();
    if (!q) return finishedGoods;
    return finishedGoods.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.sku || '').toLowerCase().includes(q)
    );
  }, [finishedGoods, outputSearch]);

  // Searchable Add Material options (already-added materials are hidden!)
  const addedMaterialIds = useMemo(
    () => new Set(ingredients.map((ing) => ing.rawItemId)),
    [ingredients]
  );

  const filteredAvailableMaterials = useMemo(() => {
    const q = materialSearch.trim().toLowerCase();
    return sortedAllItems.filter((it) => {
      if (addedMaterialIds.has(it.id)) return false;
      if (!q) return true;
      return (
        it.name.toLowerCase().includes(q) ||
        (it.sku || '').toLowerCase().includes(q)
      );
    });
  }, [sortedAllItems, addedMaterialIds, materialSearch]);

  const handlePickMaterial = (item: InventoryItem) => {
    setIngredients((prev) => [
      ...prev,
      {
        rowId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        rawItemId: item.id,
        rawItemName: item.name,
        quantity: '1',
        unit: item.unit,
      },
    ]);
    setIsMaterialPickerOpen(false);
    setMaterialSearch('');
    if (error) setError(null);
  };

  const handleQuantityChange = (rowId: string, val: string) => {
    setIngredients((prev) =>
      prev.map((ing) => (ing.rowId === rowId ? { ...ing, quantity: val } : ing))
    );
    if (error) setError(null);
  };

  const handleRemoveIngredient = (rowId: string) => {
    setIngredients((prev) => prev.filter((ing) => ing.rowId !== rowId));
    if (error) setError(null);
  };

  // Disable Save until name, output item, and at least 1 material with qty > 0
  const hasMaterialWithPositiveQty = useMemo(
    () => ingredients.some((ing) => Number(ing.quantity) > 0),
    [ingredients]
  );

  const canSave =
    name.trim().length > 0 &&
    Boolean(finishedItemId) &&
    ingredients.length > 0 &&
    hasMaterialWithPositiveQty &&
    !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('BOM name is required.');
      return;
    }
    if (!finishedItemId) {
      setError('Please select a target finished good to be produced.');
      return;
    }
    if (ingredients.length === 0) {
      setError('Please add at least one raw material or component.');
      return;
    }

    // 1. Output product cannot be a material in its own BOM
    if (ingredients.some((ing) => ing.rawItemId === finishedItemId)) {
      const matchItem = items.find((i) => i.id === finishedItemId);
      setError(
        `The output product "${matchItem?.name || 'Product'}" cannot be one of its own materials.`
      );
      return;
    }

    // 2. The BOM form must not allow the same material twice
    const seenMaterials = new Set<string>();
    for (const ing of ingredients) {
      if (seenMaterials.has(ing.rawItemId)) {
        const mat = items.find((i) => i.id === ing.rawItemId);
        setError(
          `Duplicate material: "${mat?.name || ing.rawItemName}" is added more than once. Each material can only appear once in a BOM.`
        );
        return;
      }
      seenMaterials.add(ing.rawItemId);
    }

    // 3. Ensure every material row has qty > 0
    for (const ing of ingredients) {
      const q = Number(ing.quantity);
      if (!Number.isFinite(q) || q <= 0) {
        const mat = items.find((i) => i.id === ing.rawItemId);
        setError(`Quantity for "${mat?.name || ing.rawItemName}" must be greater than 0.`);
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);

    const finishedItem = items.find((i) => i.id === finishedItemId);
    const parsedYield =
      yieldQuantity.trim() === ''
        ? 1
        : Math.max(0.0001, Number(yieldQuantity) || 1);
    const parsedLabor =
      laborCost.trim() === '' ? 0 : Math.max(0, Number(laborCost) || 0);

    const sanitizedIngredients: IngredientRequirement[] = ingredients.map((ing) => {
      const matched = items.find((i) => i.id === ing.rawItemId);
      return {
        rawItemId: ing.rawItemId,
        rawItemName: matched ? matched.name : ing.rawItemName,
        unit: matched ? matched.unit : ing.unit,
        quantity: Math.max(0.0001, Number(ing.quantity) || 1),
      };
    });

    try {
      let savedId: string;
      if (isEdit && sourceRecipe) {
        await updateRecipe(sourceRecipe.id, {
          name: name.trim(),
          finishedItemId,
          finishedItemName: finishedItem?.name || 'Finished Product',
          yieldQuantity: parsedYield,
          laborCost: parsedLabor,
          instructions: instructions.trim(),
          ingredients: sanitizedIngredients,
        });
        savedId = sourceRecipe.id;
      } else {
        savedId = await addRecipe({
          name: name.trim(),
          finishedItemId,
          finishedItemName: finishedItem?.name || 'Finished Product',
          yieldQuantity: parsedYield,
          laborCost: parsedLabor,
          instructions: instructions.trim(),
          ingredients: sanitizedIngredients,
        });
      }

      onSaved(savedId);
    } catch (err: any) {
      setError(formatFirestoreError(err, 'Failed to save BOM.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto pb-24">
      {/* Unsaved Changes Confirm Modal */}
      {showDiscardConfirm && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDiscardConfirm(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-3 animate-in fade-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-slate-900">Discard changes?</h3>
            <p className="text-xs text-slate-500">
              You have unsaved changes to this BOM. If you leave now, your edits will be lost.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDiscardConfirm(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={handleConfirmDiscard}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition cursor-pointer"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Searchable Output Item Picker Modal */}
      {isOutputPickerOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsOutputPickerOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
        >
          <div
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[82vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
              <h3 className="text-sm font-bold text-slate-900">Select Output Item</h3>
              <button
                type="button"
                onClick={() => setIsOutputPickerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 border-b border-slate-100 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={outputSearch}
                  onChange={(e) => setOutputSearch(e.target.value)}
                  placeholder="Search output item by name or SKU…"
                  className="w-full pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                {outputSearch && (
                  <button
                    type="button"
                    onClick={() => setOutputSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              {filteredOutputItems.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No matching output items found.
                </div>
              ) : (
                filteredOutputItems.map((item) => {
                  const isSelected = item.id === finishedItemId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setFinishedItemId(item.id);
                        setIsOutputPickerOpen(false);
                        setOutputSearch('');
                        if (error) setError(null);
                      }}
                      className={`w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-slate-50 transition cursor-pointer ${
                        isSelected ? 'bg-purple-50/60' : ''
                      }`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
                        {item.photoThumb ? (
                          <img
                            src={item.photoThumb}
                            alt={item.name}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <Package className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 break-words">
                          {item.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Unit: {item.unit}
                          {item.sku ? ` · SKU: ${item.sku}` : ''}
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-purple-600 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Searchable Add Material Picker Modal */}
      {isMaterialPickerOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsMaterialPickerOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
        >
          <div
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[82vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
              <h3 className="text-sm font-bold text-slate-900">Add Material</h3>
              <button
                type="button"
                onClick={() => setIsMaterialPickerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 border-b border-slate-100 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={materialSearch}
                  onChange={(e) => setMaterialSearch(e.target.value)}
                  placeholder="Search material by name or SKU…"
                  className="w-full pl-9 pr-8 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                {materialSearch && (
                  <button
                    type="button"
                    onClick={() => setMaterialSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-slate-100">
              {filteredAvailableMaterials.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  {sortedAllItems.length === addedMaterialIds.size
                    ? 'All inventory items have already been added.'
                    : 'No matching materials found.'}
                </div>
              ) : (
                filteredAvailableMaterials.map((item) => {
                  const stock = getItemQuantity(item);
                  const isOutput = item.id === finishedItemId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handlePickMaterial(item)}
                      className="w-full px-4 py-2.5 text-left flex items-center justify-between gap-3 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-900 break-words">
                          {item.name}
                          {isOutput && (
                            <span className="ml-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                              Output item
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Unit: {item.unit}
                          {item.sku ? ` · SKU: ${item.sku}` : ''}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs font-bold text-slate-800 tabular-nums">
                          {formatStock(stock)} {item.unit}
                        </div>
                        <div className="text-[10px] text-slate-400">in stock</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Navigation & Page Title */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={handleRequestCancel}
            className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer py-1 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Cancel</span>
          </button>
          <span className="text-slate-300">|</span>
          <h1 className="text-lg font-bold text-slate-900 truncate">{pageTitle}</h1>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form id="bom-editor-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Header Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs space-y-3.5">
          {/* Top row inside card: 46px finished product photo + Full-width BOM name */}
          <div className="flex items-start gap-3">
            <div className="w-[46px] h-[46px] rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden mt-4">
              {selectedFinishedItem?.photoThumb ? (
                <img
                  src={selectedFinishedItem.photoThumb}
                  alt={selectedFinishedItem.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Package className="w-5 h-5 text-slate-400" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                BOM Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. 12/12 GRAY BLUE (1 battery)"
                className="w-full px-3 py-2 text-sm font-semibold rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
              />
            </div>
          </div>

          {/* One row of 3: Output item (searchable dropdown) | Yield / batch (number + unit) | Labour ₹ */}
          <div className="grid grid-cols-12 gap-2">
            {/* Output Item (5 cols) */}
            <div className="col-span-5 min-w-0">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 truncate">
                Output item <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  setOutputSearch('');
                  setIsOutputPickerOpen(true);
                }}
                className="w-full px-2.5 py-2 text-left text-xs sm:text-sm rounded-xl border border-slate-300 bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 flex items-center justify-between gap-1 cursor-pointer min-h-[38px]"
              >
                <span className="truncate font-medium text-slate-900">
                  {selectedFinishedItem ? selectedFinishedItem.name : 'Select item…'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>
            </div>

            {/* Yield / batch (4 cols) */}
            <div className="col-span-4 min-w-0">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 truncate">
                Yield / batch
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step="any"
                  min="0.0001"
                  value={yieldQuantity}
                  onChange={(e) => setYieldQuantity(e.target.value)}
                  className="w-full pl-2.5 pr-9 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold text-slate-900 tabular-nums min-h-[38px]"
                />
                <span className="absolute right-2 text-[11px] font-medium text-slate-400 pointer-events-none truncate max-w-[30px]">
                  {selectedFinishedItem?.unit || 'pc'}
                </span>
              </div>
            </div>

            {/* Labour ₹ (3 cols) */}
            <div className="col-span-3 min-w-0">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 truncate">
                Labour ₹
              </label>
              <div className="relative flex items-center">
                <span className="absolute left-2 text-slate-400 text-xs pointer-events-none">₹</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={laborCost}
                  onChange={(e) => setLaborCost(e.target.value)}
                  className="w-full pl-5 pr-2 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 font-semibold text-slate-900 tabular-nums min-h-[38px]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* MATERIALS Section */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
          {/* Section Header */}
          <div className="px-3.5 py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              MATERIALS ({ingredients.length})
            </h2>
            <span className="text-[11px] text-slate-400 font-medium">qty per batch</span>
          </div>

          {/* Compact Materials Table */}
          <table className="w-full table-fixed text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <th className="py-2 pl-3.5 pr-1.5">Material</th>
                <th className="py-2 px-1 text-right w-[74px]">Qty</th>
                <th className="py-2 px-1 w-[46px]">Unit</th>
                <th className="py-2 pr-2.5 w-[36px]" aria-label="Remove" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {ingredients.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-xs text-slate-400 px-4">
                    No materials added yet. Tap &quot;＋ Add material&quot; below.
                  </td>
                </tr>
              ) : (
                ingredients.map((ing) => {
                  const currentItem = items.find((i) => i.id === ing.rawItemId);
                  const isSameAsOutput = ing.rawItemId === finishedItemId;
                  const numericQty = Number(ing.quantity);
                  const isInvalidQty = !Number.isFinite(numericQty) || numericQty <= 0;

                  return (
                    <tr
                      key={ing.rowId}
                      className={isSameAsOutput ? 'bg-rose-50/50' : ''}
                    >
                      {/* FULL material name (wraps naturally up to 2 lines cleanly — never single-line ellipsis) */}
                      <td className="py-2.5 pl-3.5 pr-1.5 align-middle">
                        <div className="text-xs sm:text-sm font-semibold text-slate-900 leading-snug break-words line-clamp-2">
                          {currentItem ? currentItem.name : ing.rawItemName}
                        </div>
                        {isSameAsOutput && (
                          <div className="text-[10px] font-bold text-rose-600 mt-0.5">
                            Output product cannot be a material.
                          </div>
                        )}
                      </td>

                      {/* QTY: small right-aligned 64px input, decimals allowed */}
                      <td className="py-2 px-1 align-middle text-right">
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={ing.quantity}
                          onChange={(e) => handleQuantityChange(ing.rowId, e.target.value)}
                          className={`w-16 px-2 py-1.5 text-right text-xs sm:text-sm font-semibold rounded-lg border tabular-nums focus:outline-none focus:ring-2 ${
                            isInvalidQty
                              ? 'border-rose-400 bg-rose-50 text-rose-700 focus:ring-rose-400'
                              : 'border-slate-300 bg-white text-slate-900 focus:ring-purple-500'
                          }`}
                        />
                      </td>

                      {/* UNIT */}
                      <td className="py-2 px-1 align-middle text-xs text-slate-500 truncate">
                        {currentItem?.unit || ing.unit}
                      </td>

                      {/* Delete Icon */}
                      <td className="py-2 pr-2.5 align-middle text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveIngredient(ing.rowId)}
                          title="Remove material"
                          className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Last Row: "+ Add material" */}
          <button
            type="button"
            onClick={() => {
              setMaterialSearch('');
              setIsMaterialPickerOpen(true);
            }}
            className="w-full py-3 px-3.5 border-t border-slate-200 bg-slate-50/50 hover:bg-purple-50/60 text-purple-700 font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add material</span>
          </button>
        </div>

        {/* Manufacturing & Assembly Instructions */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
            Manufacturing & Assembly Instructions
          </label>
          <textarea
            rows={2}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Step-by-step plate grouping, welding, sealing, or charging steps..."
            className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
          />
        </div>
      </form>

      {/* Sticky Bottom Bar */}
      <div
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        className="fixed bottom-0 left-0 right-0 lg:left-64 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 py-3 shadow-lg"
      >
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={handleRequestCancel}
            disabled={isSubmitting}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="bom-editor-form"
            disabled={!canSave}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold text-white bg-purple-600 hover:bg-purple-700 transition shadow-xs cursor-pointer active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Saving...' : 'Save BOM'}
          </button>
        </div>
      </div>
    </div>
  );
};
