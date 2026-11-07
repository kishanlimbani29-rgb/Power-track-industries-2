import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Plus, Trash2, CookingPot, AlertCircle } from 'lucide-react';
import { Recipe, IngredientRequirement } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { formatFirestoreError } from '../firebase/config';
import { resolveInventoryItem } from '../utils/itemResolver';

interface RecipeModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipeToEdit?: Recipe | null;
}

interface FormIngredientRequirement {
  rowId: string; // Unique React key preventing duplicate key errors
  rawItemId: string;
  rawItemName: string;
  quantity: number | string;
  unit: string;
}

export const RecipeModal: React.FC<RecipeModalProps> = ({ isOpen, onClose, recipeToEdit }) => {
  const { items, addRecipe, updateRecipe } = useInventory();
  const { permissions } = useAuth();

  const [name, setName] = useState('');
  const [finishedItemId, setFinishedItemId] = useState('');
  const [yieldQuantity, setYieldQuantity] = useState<number | string>(1);
  const [laborCost, setLaborCost] = useState<number | string>(0);
  const [instructions, setInstructions] = useState('');
  const [ingredients, setIngredients] = useState<FormIngredientRequirement[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track initialization to prevent background sync from clearing user's in-progress form
  const wasOpenRef = useRef<boolean>(false);
  const lastRecipeIdRef = useRef<string | null | undefined>(undefined);

  // Allow items to be used as materials, sorted nicely
  const availableMaterials = useMemo(() => {
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }, [items]);

  const finishedGoods = useMemo(() => {
    return items.filter(
      (i) => i.type === 'finished_good' || i.type === 'semi_finished' || i.type === 'both'
    );
  }, [items]);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Initialise ONLY when dialog opens or when recipeToEdit identity explicitly changes
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    const currentTargetId = recipeToEdit ? recipeToEdit.id : null;
    const isNewOpening = !wasOpenRef.current;
    const isRecipeSwitched = lastRecipeIdRef.current !== currentTargetId;

    if (isNewOpening || isRecipeSwitched) {
      wasOpenRef.current = true;
      lastRecipeIdRef.current = currentTargetId;

      if (recipeToEdit) {
        setName(recipeToEdit.name);
        setFinishedItemId(recipeToEdit.finishedItemId);
        setYieldQuantity(recipeToEdit.yieldQuantity || 1);
        setLaborCost(recipeToEdit.laborCost || 0);
        setInstructions(recipeToEdit.instructions || '');

        const mappedIngredients: FormIngredientRequirement[] = (recipeToEdit.ingredients || []).map(
          (ing, idx) => {
            const matched = items.find((i) => i.id === ing.rawItemId);
            return {
              rowId: `row-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
              rawItemId: ing.rawItemId,
              rawItemName: matched ? matched.name : ing.rawItemName,
              quantity: ing.quantity,
              unit: matched ? matched.unit : ing.unit,
            };
          }
        );
        setIngredients(mappedIngredients);
      } else {
        setName('');
        const defaultFinished = finishedGoods.length > 0 ? finishedGoods[0].id : items[0]?.id || '';
        setFinishedItemId(defaultFinished);
        setYieldQuantity(1);
        setLaborCost(1.0);
        setInstructions('');

        // Find first material that is not the default finished good
        const firstMat = availableMaterials.find((m) => m.id !== defaultFinished) || availableMaterials[0];
        if (firstMat) {
          setIngredients([
            {
              rowId: `row-${Date.now()}-0`,
              rawItemId: firstMat.id,
              rawItemName: firstMat.name,
              quantity: 1,
              unit: firstMat.unit,
            },
          ]);
        } else {
          setIngredients([]);
        }
      }
      setError(null);
    }
  }, [isOpen, recipeToEdit?.id]);

  if (!isOpen) return null;

  const handleAddIngredient = () => {
    // Pick an unused material that is NOT the finished product and not already in ingredients
    const unusedRaw = availableMaterials.find(
      (m) => m.id !== finishedItemId && !ingredients.some((ing) => ing.rawItemId === m.id)
    );
    const target = unusedRaw || availableMaterials.find((m) => m.id !== finishedItemId) || availableMaterials[0];
    if (target) {
      setIngredients([
        ...ingredients,
        {
          rowId: `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          rawItemId: target.id,
          rawItemName: target.name,
          quantity: 1,
          unit: target.unit,
        },
      ]);
    }
  };

  const handleIngredientChange = (rowId: string, newRawItemId: string) => {
    const raw = items.find((r) => r.id === newRawItemId);
    if (!raw) return;

    setIngredients((prev) =>
      prev.map((ing) =>
        ing.rowId === rowId
          ? {
              ...ing,
              rawItemId: raw.id,
              rawItemName: raw.name,
              unit: raw.unit,
            }
          : ing
      )
    );
    if (error) setError(null);
  };

  const handleQuantityChange = (rowId: string, val: string) => {
    setIngredients((prev) =>
      prev.map((ing) => (ing.rowId === rowId ? { ...ing, quantity: val } : ing))
    );
  };

  const handleRemoveIngredient = (rowId: string) => {
    setIngredients((prev) => prev.filter((ing) => ing.rowId !== rowId));
  };

  const selectedFinishedItem = items.find((i) => i.id === finishedItemId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Recipe name is required.');
      return;
    }
    if (!finishedItemId) {
      setError('Please select a target finished good to be produced.');
      return;
    }
    if (ingredients.length === 0) {
      setError('Please add at least one material or component ingredient.');
      return;
    }

    // 1. Output product cannot be an ingredient in its own recipe
    if (ingredients.some((ing) => ing.rawItemId === finishedItemId)) {
      const matchItem = items.find((i) => i.id === finishedItemId);
      setError(`The output product "${matchItem?.name || 'Product'}" cannot be one of its own ingredients.`);
      return;
    }

    // 2. The recipe form must not allow the same material twice
    const seenMaterials = new Set<string>();
    for (const ing of ingredients) {
      if (seenMaterials.has(ing.rawItemId)) {
        const mat = items.find((i) => i.id === ing.rawItemId);
        setError(`Duplicate material: "${mat?.name || ing.rawItemName}" is added more than once. Each ingredient can only appear once in a recipe.`);
        return;
      }
      seenMaterials.add(ing.rawItemId);
    }

    setIsSubmitting(true);
    setError(null);

    const finishedItem = items.find((i) => i.id === finishedItemId);
    const parsedYield = yieldQuantity === '' ? 1 : Math.max(0.0001, Number(yieldQuantity) || 1);
    const parsedLabor = laborCost === '' ? 0 : Math.max(0, Number(laborCost) || 0);

    const sanitizedIngredients: IngredientRequirement[] = ingredients.map((ing) => {
      const matched = items.find((i) => i.id === ing.rawItemId);
      return {
        rawItemId: ing.rawItemId,
        rawItemName: matched ? matched.name : ing.rawItemName,
        unit: matched ? matched.unit : ing.unit,
        quantity: ing.quantity === '' ? 1 : Math.max(0.0001, Number(ing.quantity) || 1),
      };
    });

    try {
      if (recipeToEdit) {
        await updateRecipe(recipeToEdit.id, {
          name: name.trim(),
          finishedItemId,
          finishedItemName: finishedItem?.name || 'Finished Product',
          yieldQuantity: parsedYield,
          laborCost: parsedLabor,
          instructions: instructions.trim(),
          ingredients: sanitizedIngredients,
        });
      } else {
        await addRecipe({
          name: name.trim(),
          finishedItemId,
          finishedItemName: finishedItem?.name || 'Finished Product',
          yieldQuantity: parsedYield,
          laborCost: parsedLabor,
          instructions: instructions.trim(),
          ingredients: sanitizedIngredients,
        });
      }
      onClose();
    } catch (err: any) {
      setError(formatFirestoreError(err, 'Failed to save recipe.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Pinned Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {recipeToEdit ? 'Edit Recipe (BOM)' : 'Create New Recipe'}
            </h2>
            <p className="text-xs text-slate-500">
              Configure production yield and exact material consumption
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close dialog (Esc)"
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Scrollable Form Body */}
        <form id="recipe-form" onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Recipe Name & Finished Good Target */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Recipe Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sourdough Boule (Batch of 6)"
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Target Output Item <span className="text-rose-500">*</span>
              </label>
              <select
                required
                value={finishedItemId}
                onChange={(e) => setFinishedItemId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                {finishedGoods.length === 0 ? (
                  <option value="">No output items available. Create one first!</option>
                ) : (
                  finishedGoods.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} {item.type === 'semi_finished' ? '• Semi-Finished' : ''} ({item.unit})
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* Batch Yield and Labor Overhead */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Batch Yield Quantity ({selectedFinishedItem?.unit || 'units'})
              </label>
              <input
                type="number"
                step="any"
                min="0.1"
                value={yieldQuantity}
                onChange={(e) => setYieldQuantity(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Labor & Overhead (₹)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-slate-400 text-sm">₹</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={laborCost}
                  onChange={(e) => setLaborCost(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Dynamic Ingredients */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <span>Materials & Components</span>
                <span className="text-slate-400 font-normal">({ingredients.length} items)</span>
              </label>
              <button
                type="button"
                onClick={handleAddIngredient}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item</span>
              </button>
            </div>

            {ingredients.length === 0 ? (
              <div className="p-4 rounded-xl border border-dashed border-slate-300 text-center text-xs text-slate-500">
                No materials added yet. Click &quot;Add Item&quot; to pick ingredients.
              </div>
            ) : (
              <div className="space-y-2">
                {ingredients.map((ing) => {
                  const currentItem = items.find((i) => i.id === ing.rawItemId);
                  // Highlight if duplicate in form
                  const isDup = ingredients.filter((other) => other.rawItemId === ing.rawItemId).length > 1;
                  const isSameAsOutput = ing.rawItemId === finishedItemId;

                  return (
                    <div
                      key={ing.rowId}
                      className={`flex items-center gap-2 p-2 rounded-xl border transition ${
                        isDup || isSameAsOutput
                          ? 'border-rose-400 bg-rose-50/50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      {/* Material selector (filter out current output where possible, but allow full select) */}
                      <div className="flex-1 min-w-0">
                        <select
                          value={ing.rawItemId}
                          onChange={(e) => handleIngredientChange(ing.rowId, e.target.value)}
                          className="w-full text-sm font-semibold px-2.5 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 truncate focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {availableMaterials.map((rm) => (
                            <option
                              key={rm.id}
                              value={rm.id}
                              disabled={rm.id === finishedItemId}
                            >
                              {rm.name} {rm.id === finishedItemId ? '(Target Output - Cannot Use)' : ''} ({rm.unit})
                            </option>
                          ))}
                        </select>
                        {(isDup || isSameAsOutput) && (
                          <div className="text-[11px] text-rose-600 font-bold mt-0.5">
                            {isSameAsOutput
                              ? 'Output product cannot be an ingredient.'
                              : 'Duplicate material: already added.'}
                          </div>
                        )}
                      </div>

                      {/* Quantity needed per batch */}
                      <div className="w-28 shrink-0">
                        <div className="relative">
                          <input
                            type="number"
                            step="any"
                            min="0.0001"
                            value={ing.quantity}
                            onChange={(e) => handleQuantityChange(ing.rowId, e.target.value)}
                            placeholder="Qty"
                            className="w-full text-sm px-2.5 py-2 pr-9 rounded-lg border border-slate-300 bg-white font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <span className="absolute right-2.5 top-2 text-xs font-medium text-slate-400 truncate max-w-[28px]">
                            {currentItem?.unit || ing.unit}
                          </span>
                        </div>
                      </div>

                      {/* Remove button */}
                      <button
                        type="button"
                        onClick={() => handleRemoveIngredient(ing.rowId)}
                        className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                        title="Remove ingredient"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Manufacturing & Assembly Instructions
            </label>
            <textarea
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Step-by-step mixing, heating, cooling, or packaging steps..."
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
        </form>

        {/* Pinned Bottom Actions */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded-xl transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="recipe-form"
            disabled={isSubmitting}
            className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer active:scale-95"
          >
            {isSubmitting ? 'Saving...' : recipeToEdit ? 'Save Changes' : 'Create Recipe'}
          </button>
        </div>
      </div>
    </div>
  );
};
