import React, { useState, useEffect, useCallback } from 'react';
import {
  CookingPot,
  Plus,
  Sparkles,
  Flame,
  Edit2,
  Trash2,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  Layers,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  X,
  FileSpreadsheet,
} from 'lucide-react';
import { Recipe, InventoryItem } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { ProductDetailHistoryView } from './ProductDetailHistoryView';
import {
  resolveInventoryItem,
  getItemQuantity,
  getAvailableStockForIngredient,
} from '../utils/itemResolver';
import { downloadExcelFile } from '../utils/fileDownload';

interface RecipesViewProps {
  onOpenAddRecipe: () => void;
  onOpenEditRecipe: (recipe: Recipe) => void;
  onOpenProduce: (recipe: Recipe) => void;
  onOpenExcelImport: () => void;
  onOpenAdjustStock: (item: InventoryItem) => void;
  onOpenEditItem: (item: InventoryItem) => void;
}

export const RecipesView: React.FC<RecipesViewProps> = ({
  onOpenAddRecipe,
  onOpenEditRecipe,
  onOpenProduce,
  onOpenExcelImport,
  onOpenAdjustStock,
  onOpenEditItem,
}) => {
  const { recipes, items, deleteRecipe, getRecipeFeasibility } = useInventory();
  const { permissions } = useAuth();
  const [expandedRecipeId, setExpandedRecipeId] = useState<string | null>(null);

  const [recipeToDelete, setRecipeToDelete] = useState<{ id: string; name: string } | null>(null);

  // Selected product state for opening item details from BOM or yields
  const [selectedItemForDetail, setSelectedItemForDetail] = useState<InventoryItem | null>(null);

  const handleOpenItemDetail = useCallback((item: InventoryItem) => {
    if (!permissions.canOpenProductDetail) return;
    setSelectedItemForDetail(item);
    window.history.pushState({ view: 'product_detail', itemId: item.id }, '');
  }, [permissions.canOpenProductDetail]);

  const handleCloseDetail = useCallback(() => {
    setSelectedItemForDetail(null);
    if (window.history.state?.view === 'product_detail') {
      window.history.back();
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (selectedItemForDetail) {
        setSelectedItemForDetail(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [selectedItemForDetail]);

  const confirmDelete = async () => {
    if (recipeToDelete) {
      await deleteRecipe(recipeToDelete.id);
      setRecipeToDelete(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedRecipeId(expandedRecipeId === id ? null : id);
  };

  const exportRecipesExcel = () => {
    const rows: Record<string, any>[] = [];
    recipes.forEach((r) => {
      if (!r.ingredients || r.ingredients.length === 0) {
        rows.push({
          'Recipe Name': r.name,
          'Finished Product': r.finishedItemName,
          'Yield Quantity': r.yieldQuantity,
          'Labor & Overhead Cost (₹)': r.laborCost || 0,
          'Ingredient Item': 'None',
          'Ingredient Quantity': 0,
          'Ingredient Unit': '',
          'Instructions': r.instructions || '',
        });
      } else {
        r.ingredients.forEach((ing) => {
          rows.push({
            'Recipe Name': r.name,
            'Finished Product': r.finishedItemName,
            'Yield Quantity': r.yieldQuantity,
            'Labor & Overhead Cost (₹)': r.laborCost || 0,
            'Ingredient Item': ing.rawItemName,
            'Ingredient Quantity': ing.quantity,
            'Ingredient Unit': ing.unit,
            'Instructions': r.instructions || '',
          });
        });
      }
    });

    downloadExcelFile(
      rows,
      `powertrack_recipes_bom_${Date.now()}.xlsx`,
      'Recipes & BOM'
    );
  };

  // Full-page Product Detail View from Inventory & Stock Master if an item was tapped
  const currentSelectedItem = selectedItemForDetail && permissions.canOpenProductDetail
    ? items.find((i) => i.id === selectedItemForDetail.id) || selectedItemForDetail
    : null;

  if (currentSelectedItem && permissions.canOpenProductDetail) {
    return (
      <ProductDetailHistoryView
        item={currentSelectedItem}
        onBack={handleCloseDetail}
        onOpenAdjustStock={onOpenAdjustStock}
        onOpenEditItem={onOpenEditItem}
        onOpenProduce={(item) => {
          const rec = recipes.find((r) => r.finishedItemId === item?.id);
          if (rec) {
            onOpenProduce(rec);
          } else {
            handleCloseDetail();
          }
        }}
        backLabel="Recipes & BOM"
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Delete Confirmation Modal */}
      {recipeToDelete && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setRecipeToDelete(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 space-y-3">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <button
                type="button"
                onClick={() => setRecipeToDelete(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Delete Recipe?</h3>
              <p className="text-xs text-slate-500 mt-1">
                Are you sure you want to delete &quot;{recipeToDelete.name}&quot;? Existing batch production logs will remain in history.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRecipeToDelete(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition shadow-xs cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Recipes & Bill of Materials (BOM)
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {recipes.length > 0 && permissions.canExportExcel && (
            <button
              type="button"
              onClick={exportRecipesExcel}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer active:scale-95"
              title="Download all recipes and BOM to Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Export Excel</span>
            </button>
          )}

          {permissions.canEditRecipes && (
            <button
              onClick={onOpenExcelImport}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer active:scale-95"
              title="Bulk import recipes and BOM from Excel (.xlsx) or CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-purple-600" />
              <span>Import Excel</span>
            </button>
          )}

          {permissions.canEditRecipes && (
            <button
              onClick={onOpenAddRecipe}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create New Recipe</span>
            </button>
          )}
        </div>
      </div>

      {recipes.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
          <CookingPot className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-700">No recipes defined yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Create formulas that combine raw materials into finished goods to unlock automated stock
            deductions and profitability tracking.
          </p>
          {permissions.canEditRecipes && (
            <button
              onClick={onOpenAddRecipe}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First Recipe</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {recipes.map((recipe) => {
            const feasibility = getRecipeFeasibility(recipe);
            const finishedItem = resolveInventoryItem(items, {
              id: recipe.finishedItemId,
              name: recipe.finishedItemName,
            });
            const isExpanded = expandedRecipeId === recipe.id;

            const canProduce = feasibility.maxBatchesPossible > 0;

            return (
              <div
                key={recipe.id}
                className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs hover:border-slate-300 transition flex flex-col"
              >
                {/* Recipe Header Card */}
                <div className="p-3.5 sm:p-4 flex-1">
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shrink-0" />
                        <h3 className="font-bold text-base text-slate-900 truncate">{recipe.name}</h3>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        Yields:{' '}
                        <strong className="text-slate-800">
                          {recipe.yieldQuantity} {finishedItem?.unit || 'units'}
                        </strong>{' '}
                        of{' '}
                        {finishedItem ? (
                          <button
                            type="button"
                            onClick={() => handleOpenItemDetail(finishedItem)}
                            className="font-semibold text-slate-800 hover:text-indigo-600 hover:underline cursor-pointer inline-flex items-center gap-0.5"
                            title="Tap to view item details in Stock Master"
                          >
                            <span>{finishedItem.name}</span>
                            <ChevronRight className="w-3 h-3 text-slate-400" />
                          </button>
                        ) : (
                          <span className="font-semibold text-slate-800">
                            {recipe.finishedItemName}
                          </span>
                        )}
                      </p>
                    </div>

                    {/* Quick Produce Action Button */}
                    {permissions.canProduceBatch && (
                      <button
                        onClick={() => onOpenProduce(recipe)}
                        disabled={!canProduce}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition shrink-0 shadow-xs ${
                          canProduce
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                            : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                      >
                        <Flame className="w-3.5 h-3.5" />
                        <span>Produce Batch</span>
                      </button>
                    )}
                  </div>

                  {/* Compact Feasibility Badge */}
                  <div className="mt-2.5">
                    {canProduce ? (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200/60 text-xs font-semibold max-w-full">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate">
                          Can produce up to {feasibility.maxBatchesPossible} batches ({feasibility.maxUnitsPossible} units)
                        </span>
                      </div>
                    ) : (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200/60 text-xs font-semibold max-w-full">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        {feasibility.limitingIngredient ? (
                          <button
                            type="button"
                            onClick={() => {
                              const limiting = resolveInventoryItem(items, {
                                name: feasibility.limitingIngredient?.name,
                                rawItemName: feasibility.limitingIngredient?.name,
                              });
                              if (limiting) handleOpenItemDetail(limiting);
                            }}
                            className="text-left hover:underline cursor-pointer truncate"
                            title="Tap to view item details and restock"
                          >
                            Shortage: {feasibility.limitingIngredient.name} (has{' '}
                            {feasibility.limitingIngredient.available}{' '}
                            {feasibility.limitingIngredient.unit}) &bull; Tap to view stock
                          </button>
                        ) : (
                          <span>Insufficient raw materials to produce</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Raw Materials Ingredient List Accordion */}
                  <div className="mt-2.5 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => toggleExpand(recipe.id)}
                      className="w-full flex items-center justify-between text-xs font-semibold text-slate-600 hover:text-slate-900 py-0.5"
                    >
                      <span>
                        Raw Materials BOM ({recipe.ingredients.length} items required)
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-400" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="mt-2 space-y-1.5 pt-2 border-t border-slate-100">
                        {recipe.ingredients.map((ing, idx) => {
                          const { item: raw, totalAvailable } = getAvailableStockForIngredient(items, ing);
                          const isLow = totalAvailable < (Number(ing.quantity) || 0);

                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                if (raw) {
                                  handleOpenItemDetail(raw);
                                }
                              }}
                              className={`flex items-center justify-between text-xs p-2.5 rounded-xl transition ${
                                raw
                                  ? 'bg-slate-50 hover:bg-indigo-50/80 active:bg-indigo-100 border border-slate-200/50 hover:border-indigo-300 cursor-pointer group/item shadow-2xs'
                                  : 'bg-slate-50 border border-slate-200/50'
                              }`}
                              title={raw ? `Tap to view ${raw.name} details in Stock Master` : undefined}
                            >
                              <div className="min-w-0 pr-2 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <div className="font-bold text-slate-900 group-hover/item:text-indigo-600 transition truncate text-xs sm:text-sm">
                                    {raw ? raw.name : ing.rawItemName}
                                  </div>
                                  {raw && (
                                    <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover/item:text-indigo-600 transition shrink-0" />
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                  <span>
                                    On-hand:{' '}
                                    <span className={isLow ? 'text-rose-600 font-bold' : 'text-slate-700 font-semibold'}>
                                      {totalAvailable.toFixed(1)} {raw?.unit || ing.unit}
                                    </span>
                                  </span>
                                  {raw?.sku && (
                                    <span className="text-slate-400 font-mono">
                                      SKU: {raw.sku}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-bold text-slate-800 text-xs sm:text-sm">
                                  {ing.quantity} {ing.unit}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        {recipe.instructions && (
                          <div className="mt-2 p-2.5 rounded-lg bg-indigo-50/60 text-slate-700 text-xs">
                            <span className="font-semibold text-indigo-900 block mb-0.5">
                              Instructions:
                            </span>
                            <p className="text-[11px] leading-relaxed text-slate-600">
                              {recipe.instructions}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer Controls: Edit & Delete */}
                <div className="px-3.5 sm:px-4 py-2 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] text-slate-400 truncate pr-2">
                    Created by: {recipe.createdBy || 'Production'}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {permissions.canEditRecipes && (
                      <button
                        onClick={() => onOpenEditRecipe(recipe)}
                        className="flex items-center gap-1 text-slate-600 hover:text-indigo-600 px-2 py-1 rounded-lg hover:bg-slate-100 font-medium transition cursor-pointer text-xs"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>
                    )}

                    {permissions.canDeleteRecipes && (
                      <button
                        onClick={() => setRecipeToDelete({ id: recipe.id, name: recipe.name })}
                        className="flex items-center gap-1 text-slate-400 hover:text-rose-600 px-2 py-1 rounded-lg hover:bg-rose-50 font-medium transition cursor-pointer text-xs"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
