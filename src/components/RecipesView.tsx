import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  Download,
  Edit2,
  FileSpreadsheet,
  FileText,
  MoreVertical,
  Package,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Recipe, InventoryItem } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { ProductDetailHistoryView } from './ProductDetailHistoryView';
import { BomEditorPage } from './BomEditorPage';
import {
  resolveInventoryItem,
  getAvailableStockForIngredient,
} from '../utils/itemResolver';
import { downloadExcelFile } from '../utils/fileDownload';
import { generateBomPdf } from '../utils/bomPdf';
import { formatQty } from '../utils/numberFormat';

interface RecipesViewProps {
  onOpenExcelImport: () => void;
  onOpenAdjustStock: (item: InventoryItem) => void;
  onOpenEditItem: (item: InventoryItem) => void;
}

const formatInr = (val: number): string => {
  const num = Number(val) || 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

const getBatchBadgeClasses = (maxBatches: number): string => {
  if (maxBatches >= 5) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (maxBatches >= 1) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  return 'bg-rose-50 text-rose-700 border-rose-200';
};

const getBatchBadgeLabel = (maxBatches: number): string => {
  if (maxBatches <= 0) return "Can't make";
  return `Can make ${maxBatches}`;
};

export const RecipesView: React.FC<RecipesViewProps> = ({
  onOpenExcelImport,
  onOpenAdjustStock,
  onOpenEditItem,
}) => {
  const { recipes, items, deleteRecipe, getRecipeFeasibility } = useInventory();
  const { permissions } = useAuth();

  // Screen 1 (List) -> Screen 2 (BOM Sheet) -> Screen 3 (Full-page BOM Editor)
  const [selectedBomId, setSelectedBomId] = useState<string | null>(null);
  const [bomEditor, setBomEditor] = useState<{
    mode: 'new' | 'edit' | 'duplicate';
    sourceRecipe?: Recipe | null;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Menus & Modals
  const [isExcelMenuOpen, setIsExcelMenuOpen] = useState(false);
  const [isSheetMenuOpen, setIsSheetMenuOpen] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [recipeToDelete, setRecipeToDelete] = useState<{ id: string; name: string } | null>(null);

  // Selected product state for opening item details from BOM Sheet
  const [selectedItemForDetail, setSelectedItemForDetail] = useState<InventoryItem | null>(null);

  const excelMenuRef = useRef<HTMLDivElement>(null);
  const sheetMenuRef = useRef<HTMLDivElement>(null);
  const ignoreNextPopCountRef = useRef(0);
  const editorBackHandlerRef = useRef<(() => void) | null>(null);

  // Close dropdown menus on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (isExcelMenuOpen && excelMenuRef.current && !excelMenuRef.current.contains(e.target as Node)) {
        setIsExcelMenuOpen(false);
      }
      if (isSheetMenuOpen && sheetMenuRef.current && !sheetMenuRef.current.contains(e.target as Node)) {
        setIsSheetMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isExcelMenuOpen, isSheetMenuOpen]);

  // Open / close Screen 2 (BOM Sheet) with phone back-button support
  const handleOpenBomSheet = useCallback((recipeId: string) => {
    setSelectedBomId(recipeId);
    setIsSheetMenuOpen(false);
    window.history.pushState({ view: 'bom_sheet', recipeId }, '');
  }, []);

  const handleCloseBomSheet = useCallback(() => {
    setSelectedBomId(null);
    setIsSheetMenuOpen(false);
    if (window.history.state?.view === 'bom_sheet') {
      ignoreNextPopCountRef.current += 1;
      window.history.back();
    }
  }, []);

  // Open / close Screen 3 (Full-page BOM Editor)
  const handleOpenEditor = useCallback(
    (mode: 'new' | 'edit' | 'duplicate', sourceRecipe?: Recipe | null) => {
      setIsSheetMenuOpen(false);
      setBomEditor({ mode, sourceRecipe: sourceRecipe || null });
      window.history.pushState({ view: 'bom_editor' }, '');
    },
    []
  );

  const handleCancelEditor = useCallback(() => {
    setBomEditor(null);
    if (window.history.state?.view === 'bom_editor') {
      ignoreNextPopCountRef.current += 1;
      window.history.back();
    }
  }, []);

  const handleSavedEditor = useCallback(
    (savedRecipeId: string) => {
      const currentMode = bomEditor?.mode;
      setBomEditor(null);
      setSelectedBomId(savedRecipeId);
      setIsSheetMenuOpen(false);

      if (currentMode === 'new') {
        // Came from BOM List -> replace editor entry with BOM Sheet so Back goes cleanly to List
        window.history.replaceState({ view: 'bom_sheet', recipeId: savedRecipeId }, '');
      } else if (window.history.state?.view === 'bom_editor') {
        // Came from BOM Sheet (edit / duplicate) -> pop editor entry back to BOM Sheet
        ignoreNextPopCountRef.current += 1;
        window.history.back();
      }
    },
    [bomEditor?.mode]
  );

  // Open / close Product Detail sub-view with phone back-button support
  const handleOpenItemDetail = useCallback(
    (item: InventoryItem) => {
      if (!permissions.canOpenProductDetail) return;
      setSelectedItemForDetail(item);
      window.history.pushState({ view: 'product_detail', itemId: item.id }, '');
    },
    [permissions.canOpenProductDetail]
  );

  const handleCloseDetail = useCallback(() => {
    setSelectedItemForDetail(null);
    if (window.history.state?.view === 'product_detail') {
      ignoreNextPopCountRef.current += 1;
      window.history.back();
    }
  }, []);

  // Handle system / phone back button cleanly across Editor -> Product Detail -> BOM Sheet -> BOM List
  useEffect(() => {
    const handlePopState = () => {
      if (ignoreNextPopCountRef.current > 0) {
        ignoreNextPopCountRef.current -= 1;
        return;
      }
      if (bomEditor) {
        if (editorBackHandlerRef.current) {
          editorBackHandlerRef.current();
        } else {
          setBomEditor(null);
        }
      } else if (selectedItemForDetail) {
        setSelectedItemForDetail(null);
      } else if (selectedBomId) {
        setSelectedBomId(null);
        setIsSheetMenuOpen(false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [bomEditor, selectedItemForDetail, selectedBomId]);

  const confirmDelete = async () => {
    if (!recipeToDelete) return;
    const deletedId = recipeToDelete.id;
    await deleteRecipe(deletedId);
    setRecipeToDelete(null);
    if (selectedBomId === deletedId) {
      handleCloseBomSheet();
    }
  };

  const exportRecipesExcel = () => {
    const rows: Record<string, any>[] = [];
    recipes.forEach((r) => {
      if (!r.ingredients || r.ingredients.length === 0) {
        rows.push({
          'BOM Name': r.name,
          'Finished Product': r.finishedItemName,
          'Yield Quantity': r.yieldQuantity,
          'Labor & Overhead Cost (₹)': r.laborCost || 0,
          'Material Item': 'None',
          'Material Quantity': 0,
          'Material Unit': '',
          'Instructions': r.instructions || '',
        });
      } else {
        r.ingredients.forEach((ing) => {
          rows.push({
            'BOM Name': r.name,
            'Finished Product': r.finishedItemName,
            'Yield Quantity': r.yieldQuantity,
            'Labor & Overhead Cost (₹)': r.laborCost || 0,
            'Material Item': ing.rawItemName,
            'Material Quantity': ing.quantity,
            'Material Unit': ing.unit,
            'Instructions': r.instructions || '',
          });
        });
      }
    });

    downloadExcelFile(rows, `powertrack_product_bom_${Date.now()}.xlsx`, 'Product BOM');
  };

  // Compute material cost summary for any BOM
  const getBomCostSummary = useCallback(
    (recipe: Recipe) => {
      const yieldQty = Number(recipe.yieldQuantity) > 0 ? Number(recipe.yieldQuantity) : 1;
      let batchMaterialCost = 0;
      (recipe.ingredients || []).forEach((ing) => {
        const { item: raw } = getAvailableStockForIngredient(items, ing);
        const qty = Number(ing.quantity) || 0;
        const unitCost = Number(raw?.unitCost) || 0;
        batchMaterialCost += qty * unitCost;
      });
      const laborPerBatch = Number(recipe.laborCost) || 0;
      return {
        yieldQty,
        batchMaterialCost,
        materialCostPerUnit: batchMaterialCost / yieldQty,
        laborCostPerUnit: laborPerBatch / yieldQty,
        hasLabor: laborPerBatch > 0,
      };
    },
    [items]
  );

  const filteredRecipes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((r) => {
      const finishedItem = resolveInventoryItem(items, {
        id: r.finishedItemId,
        name: r.finishedItemName,
      });
      return (
        r.name.toLowerCase().includes(q) ||
        (r.finishedItemName || '').toLowerCase().includes(q) ||
        (finishedItem?.name || '').toLowerCase().includes(q)
      );
    });
  }, [recipes, items, searchQuery]);

  const selectedRecipe = useMemo(() => {
    if (!selectedBomId) return null;
    return recipes.find((r) => r.id === selectedBomId) || null;
  }, [recipes, selectedBomId]);

  const canExportExcel = recipes.length > 0 && permissions.canExportExcel;
  const canImportExcel = permissions.canEditRecipes;
  const showExcelButton = canExportExcel || canImportExcel;

  // ============================================================================
  // SCREEN 3 — FULL-PAGE BOM EDITOR (Create / Edit / Duplicate)
  // ============================================================================
  if (bomEditor) {
    return (
      <BomEditorPage
        mode={bomEditor.mode}
        sourceRecipe={bomEditor.sourceRecipe}
        onCancel={handleCancelEditor}
        onSaved={handleSavedEditor}
        backHandlerRef={editorBackHandlerRef}
      />
    );
  }

  // Full-page Product Detail View from BOM Sheet material tap
  const currentSelectedItem =
    selectedItemForDetail && permissions.canOpenProductDetail
      ? items.find((i) => i.id === selectedItemForDetail.id) || selectedItemForDetail
      : null;

  if (currentSelectedItem && permissions.canOpenProductDetail) {
    return (
      <ProductDetailHistoryView
        item={currentSelectedItem}
        onBack={handleCloseDetail}
        onOpenAdjustStock={onOpenAdjustStock}
        onOpenEditItem={onOpenEditItem}
        backLabel={selectedRecipe ? selectedRecipe.name : 'Product BOM'}
      />
    );
  }

  // Delete Confirmation Modal (shared across Screen 1 & Screen 2)
  const deleteModal = recipeToDelete && (
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
          <h3 className="text-base font-bold text-slate-900">Delete BOM?</h3>
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
  );

  // ============================================================================
  // SCREEN 2 — BOM SHEET
  // ============================================================================
  if (selectedRecipe) {
    const finishedItem = resolveInventoryItem(items, {
      id: selectedRecipe.finishedItemId,
      name: selectedRecipe.finishedItemName,
    });
    const feasibility = getRecipeFeasibility(selectedRecipe);
    const maxBatches = feasibility.maxBatchesPossible;
    const unitLabel = finishedItem?.unit || 'pc';
    const costSummary = getBomCostSummary(selectedRecipe);
    const ingredients = selectedRecipe.ingredients || [];

    const handleDownloadPdf = async () => {
      if (isExportingPdf) return;
      setIsExportingPdf(true);
      try {
        await generateBomPdf({
          recipe: selectedRecipe,
          items,
          finishedItem,
          canViewCostPerUnit: permissions.canViewCostPerUnit,
          mode: 'download',
        });
      } finally {
        setIsExportingPdf(false);
      }
    };

    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        {deleteModal}

        {/* Back Link */}
        <div>
          <button
            type="button"
            onClick={handleCloseBomSheet}
            className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-indigo-600 transition cursor-pointer py-1 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>All BOMs</span>
          </button>
        </div>

        {/* Header Card */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
          <div className="flex items-start gap-3">
            {/* 52px Finished Product Photo */}
            <div className="w-[52px] h-[52px] rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
              {finishedItem?.photoThumb ? (
                <img
                  src={finishedItem.photoThumb}
                  alt={finishedItem.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <Package className="w-6 h-6 text-slate-400" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h1 className="text-base sm:text-lg font-bold text-slate-900 leading-snug break-words">
                  {selectedRecipe.name}
                </h1>

                {permissions.canDeleteRecipes && (
                  <div className="relative shrink-0" ref={sheetMenuRef}>
                    <button
                      type="button"
                      onClick={() => setIsSheetMenuOpen((prev) => !prev)}
                      aria-label="BOM actions menu"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition cursor-pointer"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {isSheetMenuOpen && (
                      <div className="absolute right-0 mt-1 w-40 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-30 animate-in fade-in zoom-in-95 duration-100">
                        <button
                          type="button"
                          onClick={() => {
                            setIsSheetMenuOpen(false);
                            setRecipeToDelete({ id: selectedRecipe.id, name: selectedRecipe.name });
                          }}
                          className="w-full px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete BOM</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <p className="text-xs text-slate-500 mt-0.5">
                1 batch = {formatQty(costSummary.yieldQty, unitLabel)} {unitLabel} · {ingredients.length}{' '}
                {ingredients.length === 1 ? 'material' : 'materials'}
              </p>

              <div className="mt-2">
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-md border text-[11px] font-semibold ${getBatchBadgeClasses(
                    maxBatches
                  )}`}
                >
                  {getBatchBadgeLabel(maxBatches)}
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons Row: Edit BOM, Duplicate, PDF share one row equally */}
          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2">
            {permissions.canEditRecipes && (
              <button
                type="button"
                onClick={() => handleOpenEditor('edit', selectedRecipe)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition cursor-pointer active:scale-95 whitespace-nowrap"
              >
                <Edit2 className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <span>Edit BOM</span>
              </button>
            )}

            {permissions.canEditRecipes && (
              <button
                type="button"
                onClick={() => handleOpenEditor('duplicate', selectedRecipe)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition cursor-pointer active:scale-95 whitespace-nowrap"
              >
                <Copy className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <span>Duplicate</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition cursor-pointer active:scale-95 disabled:opacity-50 whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>{isExportingPdf ? 'PDF...' : 'PDF'}</span>
            </button>
          </div>
        </div>

        {/* Materials Table (fits phone width cleanly, no horizontal overflow) */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
          <table className="w-full table-fixed text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th
                  className={`py-2.5 pl-3.5 pr-1.5 ${
                    permissions.canViewCostPerUnit ? 'w-[42%]' : 'w-[54%]'
                  }`}
                >
                  Material
                </th>
                <th
                  className={`py-2.5 px-1.5 text-right ${
                    permissions.canViewCostPerUnit ? 'w-[18%]' : 'w-[23%]'
                  }`}
                >
                  Qty/batch
                </th>
                <th
                  className={`py-2.5 px-1.5 text-right ${
                    permissions.canViewCostPerUnit ? 'w-[20%]' : 'w-[23%] pr-3.5'
                  }`}
                >
                  Stock
                </th>
                {permissions.canViewCostPerUnit && (
                  <th className="py-2.5 pl-1.5 pr-3.5 text-right w-[20%]">Cost</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {ingredients.length === 0 ? (
                <tr>
                  <td
                    colSpan={permissions.canViewCostPerUnit ? 4 : 3}
                    className="py-8 text-center text-slate-400 text-xs"
                  >
                    No materials listed in this BOM.
                  </td>
                </tr>
              ) : (
                ingredients.map((ing, idx) => {
                  const { item: raw, totalAvailable } = getAvailableStockForIngredient(items, ing);
                  const qtyPerBatch = Number(ing.quantity) || 0;
                  const unit = raw?.unit || ing.unit || '';
                  const unitCost = Number(raw?.unitCost) || 0;
                  const lineCost = qtyPerBatch * unitCost;

                  const batchesForThisMat =
                    qtyPerBatch > 0 ? Math.floor(totalAvailable / qtyPerBatch) : Infinity;
                  const notEnoughForOne = !raw || (qtyPerBatch > 0 && totalAvailable < qtyPerBatch);
                  const limitsBelowFive = !notEnoughForOne && batchesForThisMat < 5;

                  const stockColorClass = notEnoughForOne
                    ? 'text-rose-600 font-bold'
                    : limitsBelowFive
                    ? 'text-amber-600 font-bold'
                    : 'text-slate-700 font-medium';

                  const canInspectItem = Boolean(raw && permissions.canOpenProductDetail);

                  return (
                    <tr
                      key={`${ing.rawItemId}-${idx}`}
                      onClick={() => {
                        if (raw && canInspectItem) handleOpenItemDetail(raw);
                      }}
                      className={
                        canInspectItem
                          ? 'hover:bg-slate-50 active:bg-slate-100 cursor-pointer transition'
                          : ''
                      }
                    >
                      <td className="py-2.5 pl-3.5 pr-1.5 align-top">
                        <div className="font-semibold text-slate-900 leading-snug break-words">
                          {raw ? raw.name : ing.rawItemName}
                        </div>
                        <div className="text-[11px] text-slate-400 leading-tight mt-0.5">
                          {unit || 'unit'}
                        </div>
                      </td>
                      <td className="py-2.5 px-1.5 text-right align-top tabular-nums font-medium text-slate-800 whitespace-nowrap">
                        {formatQty(qtyPerBatch, unit)}
                      </td>
                      <td
                        className={`py-2.5 px-1.5 text-right align-top tabular-nums whitespace-nowrap ${stockColorClass} ${
                          !permissions.canViewCostPerUnit ? 'pr-3.5' : ''
                        }`}
                      >
                        {formatQty(totalAvailable, unit)}
                      </td>
                      {permissions.canViewCostPerUnit && (
                        <td className="py-2.5 pl-1.5 pr-3.5 text-right align-top tabular-nums font-medium text-slate-800">
                          {unitCost > 0 ? (
                            <span className="whitespace-nowrap">₹{formatInr(lineCost)}</span>
                          ) : (
                            <span className="text-slate-400 font-normal text-[11px] leading-tight">
                              Cost not set
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          {/* Dark Total Footer Row (hidden if user can't view unit cost) */}
          {permissions.canViewCostPerUnit && (
            <div className="bg-slate-900 text-white px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs sm:text-sm">
                <span className="font-medium text-slate-300">Material cost / battery</span>
                <span className="font-bold tabular-nums">
                  {costSummary.materialCostPerUnit > 0 ? (
                    `₹${formatInr(costSummary.materialCostPerUnit)}`
                  ) : (
                    <span className="text-slate-400 font-normal">Cost not set</span>
                  )}
                </span>
              </div>
              {costSummary.hasLabor && (
                <>
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>Labour cost / battery</span>
                    <span className="font-semibold tabular-nums">
                      ₹{formatInr(costSummary.laborCostPerUnit)}
                    </span>
                  </div>
                  <div className="pt-1.5 border-t border-slate-700/80 flex items-center justify-between text-xs sm:text-sm">
                    <span className="font-semibold text-white">Total cost / battery</span>
                    <span className="font-bold tabular-nums text-emerald-400">
                      ₹{formatInr(costSummary.materialCostPerUnit + costSummary.laborCostPerUnit)}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Instructions Note if Present */}
        {selectedRecipe.instructions && selectedRecipe.instructions.trim() && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
              Manufacturing Instructions
            </h2>
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
              {selectedRecipe.instructions.trim()}
            </p>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // SCREEN 1 — BOM LIST
  // ============================================================================
  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      {deleteModal}

      {/* Top Row: Search + Excel menu + + BOM */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search BOMs"
            className="w-full h-[38px] pl-9 pr-8 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 placeholder:text-slate-400"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {showExcelButton && (
          <div className="relative shrink-0" ref={excelMenuRef}>
            <button
              type="button"
              onClick={() => setIsExcelMenuOpen((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer active:scale-95"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Excel</span>
            </button>

            {isExcelMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-30 animate-in fade-in zoom-in-95 duration-100">
                {canImportExcel && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsExcelMenuOpen(false);
                      onOpenExcelImport();
                    }}
                    className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-purple-600" />
                    <span>Import Excel</span>
                  </button>
                )}
                {canExportExcel && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsExcelMenuOpen(false);
                      exportRecipesExcel();
                    }}
                    className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Export Excel</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {permissions.canEditRecipes && (
          <button
            type="button"
            onClick={() => handleOpenEditor('new')}
            className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-xs cursor-pointer active:scale-95 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>BOM</span>
          </button>
        )}
      </div>

      {/* Empty States or Compact BOM List */}
      {recipes.length === 0 ? (
        <div className="p-10 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
          <Package className="w-11 h-11 text-slate-300 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-700">No BOMs defined yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Create BOMs that combine raw materials into finished goods to unlock automated stock
            deductions and cost tracking.
          </p>
          {permissions.canEditRecipes && (
            <button
              type="button"
              onClick={() => handleOpenEditor('new')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First BOM</span>
            </button>
          )}
        </div>
      ) : filteredRecipes.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 space-y-2">
          <p className="text-xs font-medium text-slate-500">
            No BOMs matching &quot;{searchQuery}&quot;.
          </p>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="text-xs font-semibold text-indigo-600 hover:underline cursor-pointer"
          >
            Clear search
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-2xs">
          {filteredRecipes.map((recipe) => {
            const feasibility = getRecipeFeasibility(recipe);
            const maxBatches = feasibility.maxBatchesPossible;
            const finishedItem = resolveInventoryItem(items, {
              id: recipe.finishedItemId,
              name: recipe.finishedItemName,
            });
            const unitLabel = finishedItem?.unit || 'pc';
            const costSummary = getBomCostSummary(recipe);
            const materialCount = (recipe.ingredients || []).length;

            return (
              <button
                key={recipe.id}
                type="button"
                onClick={() => handleOpenBomSheet(recipe.id)}
                className="w-full text-left px-3.5 py-3 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition cursor-pointer"
              >
                {/* 40px Finished Product Photo */}
                <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0 overflow-hidden">
                  {finishedItem?.photoThumb ? (
                    <img
                      src={finishedItem.photoThumb}
                      alt={finishedItem.name}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Package className="w-5 h-5 text-slate-400" />
                  )}
                </div>

                {/* Bold BOM name + grey materials & cost summary */}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900 truncate">{recipe.name}</div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">
                    {materialCount} {materialCount === 1 ? 'material' : 'materials'}
                    {permissions.canViewCostPerUnit && (
                      costSummary.materialCostPerUnit > 0 ? (
                        <span>
                          {' '}
                          · ₹{formatInr(costSummary.materialCostPerUnit)}/{unitLabel}
                        </span>
                      ) : (
                        <span className="text-slate-400"> · Cost not set</span>
                      )
                    )}
                  </div>
                </div>

                {/* Can make N badge + Chevron */}
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold whitespace-nowrap ${getBatchBadgeClasses(
                      maxBatches
                    )}`}
                  >
                    {getBatchBadgeLabel(maxBatches)}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
