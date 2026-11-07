import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Search,
  Plus,
  ArrowUpDown,
  Boxes,
  Sparkles,
  Trash2,
  X,
  FileSpreadsheet,
  ArrowLeft,
  ChevronRight,
  Layers,
  CheckCircle2,
  AlertCircle,
  Download,
  RefreshCw,
} from 'lucide-react';
import { InventoryItem, ItemType } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { ProductDetailHistoryView } from './ProductDetailHistoryView';
import { downloadExcelFile } from '../utils/fileDownload';

export type CategoryOption = 'raw_material' | 'finished_good' | 'semi_finished' | 'no_stock' | 'all';

interface InventoryViewProps {
  onOpenAddItem: () => void;
  onOpenEditItem: (item: InventoryItem) => void;
  onOpenAdjustStock: (item: InventoryItem) => void;
  onOpenProduce: (item?: InventoryItem) => void;
  onOpenExcelImport: () => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  onOpenAddItem,
  onOpenEditItem,
  onOpenAdjustStock,
  onOpenProduce,
  onOpenExcelImport,
}) => {
  const { items, recipes, deleteItem, listenerError, retryListeners } = useInventory();
  const { permissions } = useAuth();

  type SortField = 'name' | 'classification' | 'quantity' | 'cost' | 'margin';
  type SortOrder = 'asc' | 'desc';

  // Search and Sort State
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>(() => {
    try {
      const saved = localStorage.getItem('powertrack_inventory_sort_by');
      if (saved && ['name', 'classification', 'quantity', 'cost', 'margin'].includes(saved)) {
        return saved as SortField;
      }
    } catch {
      // ignore
    }
    return 'name';
  });

  const [sortOrder, setSortOrder] = useState<SortOrder>(() => {
    try {
      const saved = localStorage.getItem('powertrack_inventory_sort_order');
      if (saved === 'asc' || saved === 'desc') {
        return saved as SortOrder;
      }
    } catch {
      // ignore
    }
    return 'asc';
  });

  // Dedicated Category Page State (null when on main page, or 'raw_material' | 'finished_good' | 'semi_finished' | 'no_stock' | 'all')
  const [activeCategoryPage, setActiveCategoryPage] = useState<CategoryOption | null>(null);

  // Full-page Product Transaction History State
  const [selectedItemForHistory, setSelectedItemForHistory] = useState<InventoryItem | null>(null);

  // Persist sort preferences across tab changes
  useEffect(() => {
    try {
      localStorage.setItem('powertrack_inventory_sort_by', sortBy);
    } catch {
      // ignore
    }
  }, [sortBy]);

  useEffect(() => {
    try {
      localStorage.setItem('powertrack_inventory_sort_order', sortOrder);
    } catch {
      // ignore
    }
  }, [sortOrder]);

  // Fallback to name sort if finance permissions are revoked
  useEffect(() => {
    if (!permissions.canViewFinances && (sortBy === 'cost' || sortBy === 'margin')) {
      setSortBy('name');
    }
  }, [permissions.canViewFinances, sortBy]);

  // Sync with browser history for phone's hardware/gesture back swipe
  const handleOpenCategory = useCallback((cat: CategoryOption) => {
    setActiveCategoryPage(cat);
    setSearch('');
    window.history.pushState({ view: 'category_page', category: cat }, '');
  }, []);

  const handleCloseCategory = useCallback(() => {
    setActiveCategoryPage(null);
    setSearch('');
    if (window.history.state?.view === 'category_page') {
      window.history.back();
    }
  }, []);

  const handleOpenHistory = useCallback((item: InventoryItem) => {
    if (!permissions.canOpenProductDetail) return;
    setSelectedItemForHistory(item);
    window.history.pushState({ view: 'product_detail', itemId: item.id }, '');
  }, [permissions.canOpenProductDetail]);

  const handleCloseHistory = useCallback(() => {
    setSelectedItemForHistory(null);
    if (window.history.state?.view === 'product_detail') {
      window.history.back();
    }
  }, []);

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const currentView = e.state?.view ?? window.history.state?.view;
      if (selectedItemForHistory) {
        // If the state is still on product_detail (e.g. user just closed a modal popup with Back button),
        // DO NOT close the item history page!
        if (currentView !== 'product_detail') {
          setSelectedItemForHistory(null);
        }
      } else if (activeCategoryPage) {
        if (currentView !== 'category_page') {
          setActiveCategoryPage(null);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [selectedItemForHistory, activeCategoryPage]);

  // Category Configuration
  const categoryConfig: Record<
    CategoryOption,
    {
      title: string;
      singular: string;
      subtitle: string;
      icon: React.ElementType;
      color: string;
      badgeColor: string;
      activeBg: string;
      headerBg: string;
      borderColor: string;
    }
  > = {
    raw_material: {
      title: 'Raw Material',
      singular: 'Raw Material',
      subtitle: 'Base components, parts & batch ingredients',
      icon: Layers,
      color: 'text-amber-800',
      badgeColor: 'bg-amber-100/90 text-amber-900 border-amber-300',
      activeBg: 'bg-amber-600 text-white',
      headerBg: 'bg-amber-50/70 border-b border-amber-200/80',
      borderColor: 'border-amber-200/90',
    },
    finished_good: {
      title: 'Finished Goods',
      singular: 'Finished Good',
      subtitle: 'Ready-to-dispatch manufactured products',
      icon: CheckCircle2,
      color: 'text-indigo-800',
      badgeColor: 'bg-indigo-100/90 text-indigo-900 border-indigo-300',
      activeBg: 'bg-indigo-600 text-white',
      headerBg: 'bg-indigo-50/70 border-b border-indigo-200/80',
      borderColor: 'border-indigo-200/90',
    },
    semi_finished: {
      title: 'Semi-Finished',
      singular: 'Semi-Finished',
      subtitle: 'Intermediate assemblies & sub-components',
      icon: Sparkles,
      color: 'text-purple-800',
      badgeColor: 'bg-purple-100/90 text-purple-900 border-purple-300',
      activeBg: 'bg-purple-600 text-white',
      headerBg: 'bg-purple-50/70 border-b border-purple-200/80',
      borderColor: 'border-purple-200/90',
    },
    no_stock: {
      title: 'Non-Stock',
      singular: 'Non-Stock',
      subtitle: 'Out-of-stock items (zero or negative balance)',
      icon: AlertCircle,
      color: 'text-rose-800',
      badgeColor: 'bg-rose-100/90 text-rose-900 border-rose-300',
      activeBg: 'bg-rose-600 text-white',
      headerBg: 'bg-rose-50/70 border-b border-rose-200/80',
      borderColor: 'border-rose-200/90',
    },
    all: {
      title: 'All Items',
      singular: 'Item',
      subtitle: 'Complete inventory catalog & stock balances',
      icon: Boxes,
      color: 'text-slate-800',
      badgeColor: 'bg-slate-100 text-slate-800 border-slate-200',
      activeBg: 'bg-slate-900 text-white',
      headerBg: 'bg-slate-50 border-b border-slate-200',
      borderColor: 'border-slate-200',
    },
  };

  // Helper to sort items
  const sortItems = useCallback(
    (itemList: InventoryItem[]) => {
      return [...itemList].sort((a, b) => {
        let diff = 0;
        if (sortBy === 'name') {
          diff = a.name.localeCompare(b.name);
        } else if (sortBy === 'classification') {
          const getClassificationLabel = (type: ItemType) => {
            switch (type) {
              case 'finished_good':
                return 'Finished Goods';
              case 'raw_material':
                return 'Raw Material';
              case 'semi_finished':
                return 'Semi-Finished';
              case 'both':
                return 'Composite';
              default:
                return type || '';
            }
          };
          const labelA = getClassificationLabel(a.type);
          const labelB = getClassificationLabel(b.type);
          diff = labelA.localeCompare(labelB);
          if (diff === 0) {
            diff = a.name.localeCompare(b.name);
          }
        } else if (sortBy === 'quantity') {
          diff = a.quantity - b.quantity;
        } else if (sortBy === 'cost') {
          diff = a.unitCost - b.unitCost;
        } else if (sortBy === 'margin') {
          const marginA = a.sellingPrice > 0 ? (a.sellingPrice - a.unitCost) / a.sellingPrice : 0;
          const marginB = b.sellingPrice > 0 ? (b.sellingPrice - b.unitCost) / b.sellingPrice : 0;
          diff = marginA - marginB;
        }
        return sortOrder === 'asc' ? diff : -diff;
      });
    },
    [sortBy, sortOrder]
  );

  // Filtered and sorted products for a specific category
  const getCategoryFilteredItems = useCallback(
    (cat: CategoryOption) => {
      const filtered = items.filter((item) => {
        // Category filter
        if (cat === 'raw_material') {
          if (item.type !== 'raw_material' && item.type !== 'both') return false;
        } else if (cat === 'semi_finished') {
          if (item.type !== 'semi_finished') return false;
        } else if (cat === 'finished_good') {
          if (item.type !== 'finished_good' && item.type !== 'both') return false;
        } else if (cat === 'no_stock') {
          if (item.quantity > 0) return false;
        }

        // Search query
        if (search.trim()) {
          const query = search.toLowerCase();
          const matchesQuery =
            item.name.toLowerCase().includes(query) ||
            item.sku.toLowerCase().includes(query) ||
            (item.supplier && item.supplier.toLowerCase().includes(query));
          if (!matchesQuery) return false;
        }

        return true;
      });

      return sortItems(filtered);
    },
    [items, search, sortItems]
  );

  // Counts for the 4 primary categories
  const rawCount = useMemo(
    () => items.filter((i) => i.type === 'raw_material' || i.type === 'both').length,
    [items]
  );
  const finishedCount = useMemo(
    () => items.filter((i) => i.type === 'finished_good' || i.type === 'both').length,
    [items]
  );
  const semiFinishedCount = useMemo(
    () => items.filter((i) => i.type === 'semi_finished').length,
    [items]
  );
  const noStockCount = useMemo(
    () => items.filter((i) => i.quantity <= 0).length,
    [items]
  );
  const allCount = items.length;

  const [itemToDelete, setItemToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const blockingRecipes = useMemo(() => {
    if (!itemToDelete) return [];
    return recipes.filter(
      (r) => r.finishedItemId === itemToDelete.id || r.ingredients.some((ing) => ing.rawItemId === itemToDelete.id)
    );
  }, [itemToDelete, recipes]);

  const confirmDelete = async () => {
    if (itemToDelete) {
      if (blockingRecipes.length > 0) return;
      try {
        setDeleteError(null);
        await deleteItem(itemToDelete.id);
        setItemToDelete(null);
      } catch (err: any) {
        setDeleteError(err?.message || 'Failed to delete item.');
      }
    }
  };

  // Full-page transaction history view if a product is selected
  const currentSelectedItem = selectedItemForHistory && permissions.canOpenProductDetail
    ? items.find((i) => i.id === selectedItemForHistory.id) || selectedItemForHistory
    : null;

  if (currentSelectedItem && permissions.canOpenProductDetail) {
    return (
      <ProductDetailHistoryView
        item={currentSelectedItem}
        onBack={handleCloseHistory}
        onOpenAdjustStock={onOpenAdjustStock}
        onOpenEditItem={onOpenEditItem}
        onOpenProduce={onOpenProduce}
      />
    );
  }

  // Export stock items to genuine Excel (.xlsx) spreadsheet
  const exportInventoryExcel = (itemsToExport: InventoryItem[], categoryKey: string = 'all') => {
    const rows = itemsToExport.map((item) => {
      const isLow = item.quantity <= item.minStock;
      const isOut = item.quantity <= 0;
      const status = isOut ? 'OUT OF STOCK' : isLow ? 'LOW STOCK' : 'IN STOCK';
      const classification =
        item.type === 'raw_material'
          ? 'Raw Material'
          : item.type === 'semi_finished'
          ? 'Semi-Finished'
          : item.type === 'both'
          ? 'Composite'
          : 'Finished Good';

      return {
        'Item Name': item.name,
        'SKU / Code': item.sku || '',
        'Classification': classification,
        'Unit of Measure': item.unit,
        'Current Stock': item.quantity,
        'Min Stock Alert': item.minStock,
        'Stock Status': status,
        'Unit Cost (₹)': permissions.canViewCostPerUnit ? item.unitCost : '[Restricted]',
        'Total Valuation (₹)': permissions.canViewTotalAssetValue ? item.quantity * item.unitCost : '[Restricted]',
        'Selling Price (₹)': item.sellingPrice || 0,
        'Supplier / Vendor': item.supplier || '',
        'Shelf / Location': item.location || '',
        'Notes': item.notes || '',
      };
    });

    downloadExcelFile(
      rows,
      `powertrack_stock_master_${categoryKey}_${Date.now()}.xlsx`,
      'Stock Master'
    );
  };

  // Reusable Phone-Optimized Compact Product Card
  const renderProductCard = (item: InventoryItem) => {
    const isLow = item.quantity <= item.minStock;
    const isOut = item.quantity <= 0;
    const isRaw = item.type === 'raw_material';
    const canOpen = permissions.canOpenProductDetail;

    return (
      <div
        key={item.id}
        onClick={() => {
          if (canOpen) {
            handleOpenHistory(item);
          }
        }}
        className={`bg-white rounded-xl border border-slate-200/90 p-2 sm:p-2.5 shadow-2xs transition flex flex-col justify-between gap-1 ${
          canOpen
            ? 'hover:border-indigo-300 hover:shadow-xs cursor-pointer group active:bg-slate-50'
            : 'cursor-default'
        }`}
        title={canOpen ? 'Tap to open product details' : undefined}
      >
        {/* Top Bar: Item Title + SKU + Chevron */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h4
              className={`font-bold text-xs sm:text-[13px] text-slate-900 transition leading-snug break-words ${
                canOpen ? 'group-hover:text-indigo-600' : ''
              }`}
            >
              {item.name}
            </h4>
            {item.sku && (
              <span className="font-mono text-[9px] text-slate-400 bg-slate-50 px-1 py-0.2 rounded border border-slate-100 inline-block mt-0.5">
                SKU: {item.sku}
              </span>
            )}
          </div>
          {canOpen && (
            <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-500 shrink-0 mt-0.5" />
          )}
        </div>

        {/* Bottom Row: Classification Tag on Left & Stock Quantity on Right */}
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
          <span
            className={`text-[9px] font-bold px-1.5 py-0.2 rounded-md shrink-0 border ${
              isRaw
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : item.type === 'semi_finished'
                ? 'bg-purple-50 text-purple-800 border-purple-200'
                : item.type === 'both'
                ? 'bg-blue-50 text-blue-800 border-blue-200'
                : 'bg-indigo-50 text-indigo-800 border-indigo-200'
            }`}
          >
            {isRaw
              ? 'Raw Material'
              : item.type === 'semi_finished'
              ? 'Semi-Finished'
              : item.type === 'both'
              ? 'Composite'
              : 'Finished Goods'}
          </span>

          <div className="flex items-baseline gap-1 shrink-0">
            <span
              className={`text-sm sm:text-base font-black font-mono ${
                isOut
                  ? 'text-rose-600'
                  : isLow
                  ? 'text-amber-600'
                  : 'text-slate-900'
              }`}
            >
              {item.quantity.toFixed(1)}
            </span>
            <span className="text-[10px] font-medium text-slate-500">{item.unit}</span>
            <span className="text-[9px] font-bold ml-0.5">
              {isOut ? (
                <span className="text-rose-600 uppercase">No Stock</span>
              ) : isLow ? (
                <span className="text-amber-600 uppercase">Low</span>
              ) : (
                <span className="text-emerald-700">In Stock</span>
              )}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------
  // DEDICATED NEW PAGE: Category Products View (Phone-Optimized)
  // -------------------------------------------------------------
  if (activeCategoryPage) {
    const activeConf = categoryConfig[activeCategoryPage];
    const categoryItems = getCategoryFilteredItems(activeCategoryPage);
    const ActiveIcon = activeConf.icon;

    return (
      <div className="space-y-4 w-full overflow-x-hidden animate-in fade-in duration-150 pb-12">
        {/* Delete Confirmation Modal */}
        {itemToDelete && (
          <div
            onClick={(e) => {
              if (e.target === e.currentTarget) setItemToDelete(null);
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
                  onClick={() => setItemToDelete(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Delete Item?</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Are you sure you want to remove &quot;{itemToDelete.name}&quot; from inventory? This action cannot be undone.
                </p>
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setItemToDelete(null)}
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

        {/* Permission / Listener Error Banner */}
        {listenerError && (
          <div className="bg-amber-500 text-slate-950 p-4 rounded-2xl border border-amber-600 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-slate-950 shrink-0" />
              <span className="text-xs sm:text-sm font-bold">
                {listenerError}
              </span>
            </div>
            <button
              type="button"
              onClick={retryListeners}
              className="px-3.5 py-1.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition cursor-pointer shrink-0 shadow-xs active:scale-95 flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Tap to retry</span>
            </button>
          </div>
        )}

        {/* Top Navigation Bar for Phone View */}
        <div className="flex items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
          <button
            type="button"
            onClick={handleCloseCategory}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50/70 hover:bg-indigo-100 border border-indigo-200 transition cursor-pointer active:scale-95"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>← Back to Master Menu</span>
          </button>

          <div className="flex items-center gap-2">
            {permissions.canExportExcel && (
              <button
                type="button"
                onClick={() => exportInventoryExcel(categoryItems, activeCategoryPage)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 transition shadow-2xs cursor-pointer active:scale-95"
                title="Download this category to Excel (.xlsx)"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Export Excel</span>
              </button>
            )}

            {permissions.canEditItems && (
              <button
                type="button"
                onClick={onOpenAddItem}
                className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-xs cursor-pointer active:scale-95"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New Item</span>
              </button>
            )}
          </div>
        </div>

        {/* Page Title & Category Header */}
        <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-2xs">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${activeConf.badgeColor}`}>
              <ActiveIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                {activeConf.title}
              </h1>
              <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full border ${activeConf.badgeColor}`}>
                {categoryItems.length} Products
              </span>
            </div>
          </div>
        </div>

        {/* Search and Sort Bar */}
        <div className="p-2 bg-white rounded-xl border border-slate-200 flex items-center gap-2 shadow-2xs">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search in ${activeConf.title}...`}
              className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400"
            />
          </div>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 shrink-0 max-w-[130px] sm:max-w-none"
          >
            <option value="name">Sort: Name</option>
            <option value="classification">Sort: Class</option>
            <option value="quantity">Sort: Qty</option>
            {permissions.canViewFinances && <option value="cost">Sort: Cost</option>}
            {permissions.canViewFinances && <option value="margin">Sort: Margin</option>}
          </select>

          <button
            type="button"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            title="Toggle sort order"
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition cursor-pointer shrink-0"
          >
            <ArrowUpDown className="w-4 h-4" />
          </button>
        </div>

        {/* Products Grid */}
        {categoryItems.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center space-y-3 shadow-2xs">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mx-auto ${activeConf.badgeColor}`}>
              <ActiveIcon className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">
              {search.trim()
                ? `No matching items in ${activeConf.title}`
                : activeCategoryPage === 'no_stock'
                ? 'All Products Are In Stock! 🎉'
                : `No products in ${activeConf.title}`}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {search.trim()
                ? 'Try clearing or modifying your search query.'
                : activeCategoryPage === 'no_stock'
                ? 'Great job! None of your inventory items currently have zero or negative stock balance.'
                : `No items found matching the ${activeConf.title} category.`}
            </p>
            {permissions.canEditItems && activeCategoryPage !== 'no_stock' && (
              <button
                type="button"
                onClick={onOpenAddItem}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item to {activeConf.title}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5 sm:gap-2">
            {categoryItems.map(renderProductCard)}
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------
  // MAIN INVENTORY & STOCK MASTER PAGE
  // All items showing on the main page are neatly housed inside
  // the 4 category boxes:
  // 1. Raw material
  // 2. Finished goods
  // 3. Semi-finished
  // 4. Non-stock
  // -------------------------------------------------------------
  const primaryCategories: { key: CategoryOption; count: number }[] = [
    { key: 'raw_material', count: rawCount },
    { key: 'finished_good', count: finishedCount },
    { key: 'semi_finished', count: semiFinishedCount },
    { key: 'no_stock', count: noStockCount },
  ];

  return (
    <div className="space-y-6 w-full overflow-x-hidden pb-12">
      {/* Permission / Listener Error Banner */}
      {listenerError && (
        <div className="bg-amber-500 text-slate-950 p-4 rounded-2xl border border-amber-600 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-5 h-5 text-slate-950 shrink-0" />
            <span className="text-xs sm:text-sm font-bold">
              {listenerError}
            </span>
          </div>
          <button
            type="button"
            onClick={retryListeners}
            className="px-3.5 py-1.5 rounded-xl bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition cursor-pointer shrink-0 shadow-xs active:scale-95 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Tap to retry</span>
          </button>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {itemToDelete && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setItemToDelete(null);
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
                onClick={() => setItemToDelete(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              {blockingRecipes.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-1.5 text-amber-700">
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                    <span>Cannot Delete Item</span>
                  </h3>
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1.5">
                    <p className="font-semibold">
                      &quot;{itemToDelete.name}&quot; is used in {blockingRecipes.length} recipe{blockingRecipes.length > 1 ? 's' : ''}:
                    </p>
                    <ul className="list-disc pl-4 space-y-0.5 text-amber-800">
                      {blockingRecipes.map((r) => (
                        <li key={r.id} className="font-medium">
                          {r.name} {r.finishedItemId === itemToDelete.id ? '(Output Product)' : '(Ingredient)'}
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-amber-700 pt-1">
                      Please remove or update this item in those recipes before deleting it.
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="text-base font-bold text-slate-900">Delete Item?</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Are you sure you want to remove &quot;{itemToDelete.name}&quot; from inventory? This action cannot be undone.
                  </p>
                </div>
              )}

              {deleteError && (
                <div className="mt-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                  {deleteError}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setItemToDelete(null);
                  setDeleteError(null);
                }}
                className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                {blockingRecipes.length > 0 ? 'Close' : 'Cancel'}
              </button>
              {blockingRecipes.length === 0 && (
                <button
                  type="button"
                  onClick={confirmDelete}
                  className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition shadow-xs cursor-pointer active:scale-95"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Header & Action Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Inventory & Stock Master
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {permissions.canExportExcel && (
            <button
              type="button"
              onClick={() => exportInventoryExcel(items, 'all')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100 transition shadow-2xs cursor-pointer active:scale-95"
              title="Download full inventory to Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Export Excel</span>
            </button>
          )}

          {permissions.canEditItems && (
            <button
              onClick={onOpenExcelImport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition shadow-2xs cursor-pointer active:scale-95"
              title="Bulk import products from Excel (.xlsx) or CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
              <span>Import Excel</span>
            </button>
          )}
        </div>
      </div>

      {/* 
        THE 4 CATEGORY CARDS (Tap to Open Dedicated Page):
        1. Raw material
        2. Finished goods
        3. Semi-finished
        4. Non-stock
      */}
      <div className="space-y-3 pt-1">
        {primaryCategories.map(({ key, count }) => {
          const conf = categoryConfig[key];
          const CategoryIcon = conf.icon;

          return (
            <div
              key={key}
              onClick={() => handleOpenCategory(key)}
              className={`p-4 bg-white rounded-2xl border ${conf.borderColor} shadow-2xs hover:shadow-md transition cursor-pointer flex items-center justify-between gap-3 group active:scale-[0.99]`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${conf.badgeColor}`}
                >
                  <CategoryIcon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 group-hover:text-indigo-600 transition truncate">
                    {conf.title}
                  </h2>
                  <div className="mt-0.5">
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${conf.badgeColor}`}
                    >
                      {count} items
                    </span>
                  </div>
                </div>
              </div>

              {/* Single clean right arrow button */}
              <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 group-hover:text-indigo-600 group-hover:bg-indigo-50 group-hover:border-indigo-200 transition shrink-0">
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
