import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  BarChart3,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Boxes,
  PieChart,
  ShoppingBag,
  Layers,
  Sparkles,
  Search,
  MapPin,
  Archive,
  CheckCircle2,
  FileSpreadsheet,
  ArrowLeft,
  ChevronRight,
  Download,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { InventoryItem } from '../types/inventory';
import { downloadExcelFile } from '../utils/fileDownload';
import { formatQty, formatInrAmount } from '../utils/numberFormat';

interface AnalyticsViewProps {
  onOpenAdjustStock: (item: InventoryItem) => void;
  onOpenProduce: (recipe: any) => void;
}

type ReportId =
  | 'stock_value'
  | 'profit_in_stock'
  | 'reorder_list'
  | 'bom_profit'
  | 'by_category'
  | 'stock_flow'
  | 'shelves'
  | 'excel_reports';

const REPORT_TITLES: Record<ReportId, string> = {
  stock_value: 'Stock Value',
  profit_in_stock: 'Profit in Stock',
  reorder_list: 'Reorder List',
  bom_profit: 'BOM Profit',
  by_category: 'By Category',
  stock_flow: 'Stock Flow',
  shelves: 'Shelves & Storage',
  excel_reports: 'Excel Reports',
};

const formatInrCompact = (value: number): string => {
  return formatInrAmount(value, 0);
};

const formatQtyShort = (value: number): string => {
  return formatQty(value);
};

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  onOpenAdjustStock,
  onOpenProduce,
}) => {
  const { items, recipes, movements, calculateRecipeCost } = useInventory();
  const { permissions } = useAuth();

  const [activeReport, setActiveReport] = useState<ReportId | null>(null);
  const [shelfSearch, setShelfSearch] = useState('');
  const [shelfFilter, setShelfFilter] = useState<'all' | 'low_stock' | 'unassigned'>('all');
  const reportHistoryPushedRef = useRef(false);

  // Guard: if user role loses shelf or export permission while viewing that report, fallback to tiles
  useEffect(() => {
    if (!permissions.canViewShelfOption && activeReport === 'shelves') {
      setActiveReport(null);
    }
    if (!permissions.canExportExcel && activeReport === 'excel_reports') {
      setActiveReport(null);
    }
  }, [permissions.canViewShelfOption, permissions.canExportExcel, activeReport]);

  // Phone back button support when a report is open
  useEffect(() => {
    if (activeReport !== null) {
      if (!reportHistoryPushedRef.current) {
        reportHistoryPushedRef.current = true;
        window.history.pushState({ analyticsReport: activeReport }, '');
      }
      const handlePopState = (e: PopStateEvent) => {
        if (e.state?.analyticsReport) return;
        reportHistoryPushedRef.current = false;
        setActiveReport(null);
      };
      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    } else if (reportHistoryPushedRef.current) {
      reportHistoryPushedRef.current = false;
      if (window.history.state?.analyticsReport) {
        window.history.back();
      }
    }
  }, [activeReport]);

  const handleOpenReport = (id: ReportId) => {
    setActiveReport(id);
  };

  const handleCloseReport = () => {
    if (reportHistoryPushedRef.current && window.history.state?.analyticsReport) {
      window.history.back();
    } else {
      setActiveReport(null);
    }
  };

  // 1. Valuation Metrics
  const metrics = useMemo(() => {
    let totalCostValue = 0;
    let totalRetailValue = 0;
    let rawMaterialCost = 0;
    let finishedGoodsCost = 0;

    items.forEach((item) => {
      const costValue = item.quantity * item.unitCost;
      totalCostValue += costValue;

      if (item.type === 'raw_material') {
        rawMaterialCost += costValue;
      } else {
        finishedGoodsCost += costValue;
        totalRetailValue += item.quantity * (item.sellingPrice || item.unitCost);
      }
    });

    const potentialGrossProfit = totalRetailValue - finishedGoodsCost;
    const grossMarginPercent =
      totalRetailValue > 0 ? (potentialGrossProfit / totalRetailValue) * 100 : 0;

    return {
      totalCostValue,
      totalRetailValue,
      rawMaterialCost,
      finishedGoodsCost,
      potentialGrossProfit,
      grossMarginPercent,
    };
  }, [items]);

  const hasItemsWithoutCost = useMemo(
    () => items.some((i) => !(Number(i.unitCost) > 0)),
    [items]
  );

  // 2. Shelf & Storage Location Analytics Data Aggregation
  const shelfData = useMemo(() => {
    const map = new Map<
      string,
      {
        shelfName: string;
        isUnassigned: boolean;
        items: InventoryItem[];
        totalUnits: number;
        totalCostValue: number;
        totalRetailValue: number;
        lowStockCount: number;
        rawCount: number;
        finishedCount: number;
      }
    >();

    items.forEach((item) => {
      const rawLoc = item.location?.trim();
      const shelfName = rawLoc ? rawLoc : 'Unassigned / Staging';
      const isUnassigned = !rawLoc;

      const existing = map.get(shelfName) || {
        shelfName,
        isUnassigned,
        items: [],
        totalUnits: 0,
        totalCostValue: 0,
        totalRetailValue: 0,
        lowStockCount: 0,
        rawCount: 0,
        finishedCount: 0,
      };

      existing.items.push(item);
      existing.totalUnits += item.quantity;
      existing.totalCostValue += item.quantity * item.unitCost;
      existing.totalRetailValue += item.quantity * (item.sellingPrice || item.unitCost);
      if (item.quantity <= item.minStock) {
        existing.lowStockCount += 1;
      }
      if (item.type === 'raw_material') {
        existing.rawCount += 1;
      } else {
        existing.finishedCount += 1;
      }

      map.set(shelfName, existing);
    });

    const list = Array.from(map.values());
    // Sort assigned shelves alphabetically, and unassigned at the end
    list.sort((a, b) => {
      if (a.isUnassigned) return 1;
      if (b.isUnassigned) return -1;
      return a.shelfName.localeCompare(b.shelfName);
    });

    const totalActiveShelves = list.filter((s) => !s.isUnassigned).length;
    const unassignedCount = list.find((s) => s.isUnassigned)?.items.length || 0;
    const shelvesWithLowStock = list.filter((s) => s.lowStockCount > 0).length;
    const totalStoredUnits = items.reduce((acc, i) => acc + i.quantity, 0);

    return {
      shelves: list,
      totalActiveShelves,
      unassignedCount,
      shelvesWithLowStock,
      totalStoredUnits,
    };
  }, [items]);

  // Filtered Shelves based on search query and filter chips
  const filteredShelves = useMemo(() => {
    let result = shelfData.shelves;

    if (shelfFilter === 'low_stock') {
      result = result.filter((s) => s.lowStockCount > 0);
    } else if (shelfFilter === 'unassigned') {
      result = result.filter((s) => s.isUnassigned);
    }

    if (shelfSearch.trim()) {
      const q = shelfSearch.toLowerCase().trim();
      result = result.filter(
        (s) =>
          s.shelfName.toLowerCase().includes(q) ||
          s.items.some(
            (i) =>
              i.name.toLowerCase().includes(q) ||
              i.sku.toLowerCase().includes(q) ||
              (i.category && i.category.toLowerCase().includes(q))
          )
      );
    }

    return result;
  }, [shelfData.shelves, shelfFilter, shelfSearch]);

  // 3. Category Distribution
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; costValue: number }>();

    items.forEach((item) => {
      const cat = item.category || 'General';
      const existing = map.get(cat) || { count: 0, costValue: 0 };
      existing.count += 1;
      existing.costValue += item.quantity * item.unitCost;
      map.set(cat, existing);
    });

    const list = Array.from(map.entries()).map(([name, data]) => ({
      name,
      count: data.count,
      costValue: data.costValue,
      percentage: metrics.totalCostValue > 0 ? (data.costValue / metrics.totalCostValue) * 100 : 0,
    }));

    return list.sort((a, b) => b.costValue - a.costValue);
  }, [items, metrics.totalCostValue]);

  // 4. Reorder Guide
  const reorderItems = useMemo(() => {
    return items
      .filter((i) => i.quantity <= i.minStock)
      .map((item) => {
        const suggestedOrderQty = Math.max(1, Math.ceil(item.minStock * 2 - item.quantity));
        const estimatedCost = suggestedOrderQty * item.unitCost;
        return {
          item,
          suggestedOrderQty,
          estimatedCost,
        };
      })
      .sort((a, b) => b.estimatedCost - a.estimatedCost);
  }, [items]);

  const totalReplenishmentCost = reorderItems.reduce((sum, r) => sum + r.estimatedCost, 0);

  // 5. Recipe Profitability Ranking
  const recipeRankings = useMemo(() => {
    return recipes
      .map((rec) => {
        const economics = calculateRecipeCost(rec);
        return {
          recipe: rec,
          ...economics,
        };
      })
      .sort((a, b) => b.marginPercent - a.marginPercent);
  }, [recipes, calculateRecipeCost]);

  // 6. Movement Volume and Waste Summary
  const movementSummary = useMemo(() => {
    let restockTotal = 0;
    let salesTotal = 0;
    let recipeConsumeTotal = 0;
    let wasteTotal = 0;

    movements.forEach((m) => {
      if (m.type === 'in') restockTotal += m.quantity;
      if (m.type === 'out') salesTotal += m.quantity;
      if (m.type === 'production_consume') recipeConsumeTotal += m.quantity;
      if (m.type === 'waste') wasteTotal += m.quantity;
    });

    return {
      restockTotal,
      salesTotal,
      recipeConsumeTotal,
      wasteTotal,
    };
  }, [movements]);

  // Excel Export for Full Inventory Valuation
  const exportValuationExcel = () => {
    const rows = items.map((i) => ({
      'Item Name': i.name,
      'SKU': i.sku || '',
      'Classification': i.type.replace('_', ' ').toUpperCase(),
      'Category': i.category || 'General',
      'Quantity': i.quantity,
      'Unit of Measure': i.unit,
      'Unit Cost (₹)': permissions.canViewCostPerUnit ? i.unitCost : '[Restricted]',
      'Total Valuation (₹)': permissions.canViewTotalAssetValue ? i.quantity * i.unitCost : '[Restricted]',
      'Selling Price (₹)': i.sellingPrice,
      'Retail Potential (₹)': i.quantity * i.sellingPrice,
      'Min Stock Level': i.minStock,
      'Supplier / Vendor': i.supplier || '',
      'Storage Location': i.location || '',
    }));

    downloadExcelFile(
      rows,
      `powertrack_inventory_valuation_${Date.now()}.xlsx`,
      'Valuation Report'
    );
  };

  // Excel Export for Shelf Location Audit
  const exportShelfReportExcel = () => {
    const rows: Record<string, any>[] = [];

    shelfData.shelves.forEach((shelf) => {
      shelf.items.forEach((item) => {
        const status =
          item.quantity === 0
            ? 'Out of Stock'
            : item.quantity <= item.minStock
            ? 'Low Stock'
            : 'Optimal';

        rows.push({
          'Shelf / Storage Location': shelf.shelfName,
          'Item Name': item.name,
          'SKU': item.sku || '',
          'Classification': item.type.replace('_', ' ').toUpperCase(),
          'Category': item.category || 'General',
          'Quantity': item.quantity,
          'Unit': item.unit,
          'Min Stock Level': item.minStock,
          'Stock Status': status,
          'Unit Cost (₹)': permissions.canViewCostPerUnit ? item.unitCost : '[Restricted]',
          'Total Value (₹)': permissions.canViewTotalAssetValue ? item.quantity * item.unitCost : '[Restricted]',
          'Supplier / Vendor': item.supplier || '',
        });
      });
    });

    downloadExcelFile(
      rows,
      `powertrack_shelf_storage_audit_${Date.now()}.xlsx`,
      'Shelf Audit'
    );
  };

  const renderValuationCards = (highlightProfit = false) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Total Cost Value */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
        <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>Total Inventory Value (Asset Valuation)</span>
          <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
            <DollarSign className="w-4 h-4" />
          </span>
        </div>
        <div className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
          {permissions.canViewTotalAssetValue ? (
            formatInrAmount(metrics.totalCostValue, 2)
          ) : (
            <span className="text-slate-400 font-mono tracking-widest text-lg">••••••</span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
          {permissions.canViewTotalAssetValue ? (
            <>
              <span>Raw: {formatInrAmount(metrics.rawMaterialCost, 0)}</span>
              <span>•</span>
              <span>Finished: {formatInrAmount(metrics.finishedGoodsCost, 0)}</span>
            </>
          ) : (
            <span className="text-slate-400">Valuation restricted</span>
          )}
        </div>
        {permissions.canViewTotalAssetValue && hasItemsWithoutCost && (
          <div className="text-[11px] text-amber-600 mt-1.5">
            Some items have no cost price — add it on the item page
          </div>
        )}
      </div>

      {/* Total Retail Selling Value */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
        <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>Finished Goods Retail Value</span>
          <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
            <ShoppingBag className="w-4 h-4" />
          </span>
        </div>
        <div className="text-2xl font-black text-slate-900 mt-2 font-mono tabular-nums">
          {formatInrAmount(metrics.totalRetailValue, 2)}
        </div>
        <div className="text-[11px] text-emerald-600 font-medium mt-1">
          Expected gross revenue from stock
        </div>
      </div>

      {/* Potential Gross Profit */}
      <div
        className={`p-5 rounded-2xl bg-white border shadow-2xs transition ${
          highlightProfit
            ? 'border-emerald-400 ring-2 ring-emerald-500/30 bg-emerald-50/20'
            : 'border-slate-200'
        }`}
      >
        <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>Estimated Profit in Stock</span>
          <span className="p-1.5 rounded-lg bg-sky-50 text-sky-600">
            <TrendingUp className="w-4 h-4" />
          </span>
        </div>
        <div className="text-2xl font-black text-emerald-600 mt-2 font-mono tabular-nums">
          {formatInrAmount(metrics.potentialGrossProfit, 2)}
        </div>
        <div className="text-[11px] text-slate-500 mt-1">
          Avg Gross Margin:{' '}
          <strong className="text-slate-800">{metrics.grossMarginPercent.toFixed(1)}%</strong>
        </div>
      </div>

      {/* Low Stock Replenishment Forecast */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
        <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>Replenishment Budget Needed</span>
          <span className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
            <AlertTriangle className="w-4 h-4" />
          </span>
        </div>
        <div className="text-2xl font-black text-rose-600 mt-2 font-mono tabular-nums">
          {formatInrAmount(totalReplenishmentCost, 2)}
        </div>
        <div className="text-[11px] text-slate-500 mt-1">
          For <strong className="text-rose-600">{reorderItems.length} items</strong> below safety
          threshold
        </div>
      </div>
    </div>
  );

  // =========================================================================
  // SUB-VIEW: FULL-SCREEN INDIVIDUAL REPORT
  // =========================================================================
  if (activeReport !== null) {
    return (
      <div className="max-w-[1000px] mx-auto space-y-5 pb-10 overflow-x-clip">
        {/* Top bar: "← Reports / Report title" */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={handleCloseReport}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4 h-4 shrink-0" />
              <span>Reports</span>
            </button>
            <span className="text-slate-300 shrink-0">/</span>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
              {REPORT_TITLES[activeReport]}
            </h1>
          </div>

          {activeReport === 'reorder_list' && (
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 shrink-0">
              {reorderItems.length} Low
            </span>
          )}
        </div>

        {activeReport === 'stock_value' && renderValuationCards(false)}

        {activeReport === 'profit_in_stock' && renderValuationCards(true)}

        {activeReport === 'reorder_list' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs space-y-3">
            {reorderItems.length === 0 ? (
              <div className="p-8 text-center bg-emerald-50/60 rounded-xl border border-emerald-100 space-y-1">
                <span className="text-sm font-semibold text-emerald-800">
                  All inventory levels healthy!
                </span>
                <p className="text-xs text-emerald-600">
                  No items are currently below their minimum safety thresholds.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {reorderItems.map(({ item, suggestedOrderQty, estimatedCost }) => {
                  const matchingBom = recipes.find(
                    (r) =>
                      r.finishedItemId === item.id ||
                      (r.finishedItemName || '').trim().toLowerCase() === item.name.trim().toLowerCase()
                  );
                  const hasCost = Number(item.unitCost) > 0;

                  return (
                    <div key={item.id} className="py-3 flex items-center justify-between text-xs gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{item.name}</div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-rose-600 font-bold">
                            {formatQty(item.quantity, item.unit)} {item.unit} remaining
                          </span>
                          <span>• Min: {formatQty(item.minStock, item.unit)} {item.unit}</span>
                          {item.location && <span>• Shelf: {item.location}</span>}
                          {item.supplier && <span>• {item.supplier}</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0 text-right">
                        <div>
                          <div className="font-bold text-slate-900">
                            {matchingBom ? 'Make' : 'Order'} +{formatQty(suggestedOrderQty, item.unit)} {item.unit}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {!permissions.canViewCostPerUnit
                              ? 'Est cost masked'
                              : !hasCost
                              ? 'Cost not set'
                              : `Est: ${formatInrAmount(estimatedCost, 2)}`}
                          </div>
                        </div>

                        {matchingBom ? (
                          permissions.canProduceBatch && (
                            <button
                              type="button"
                              onClick={() => onOpenProduce(matchingBom)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 hover:bg-emerald-100 text-emerald-700 transition cursor-pointer"
                            >
                              Make
                            </button>
                          )
                        ) : (
                          permissions.canAdjustStock && (
                            <button
                              type="button"
                              onClick={() => onOpenAdjustStock(item)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition cursor-pointer"
                            >
                              Restock
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeReport === 'bom_profit' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span>BOM Profitability Leaderboard</span>
                </h2>
                <p className="text-xs text-slate-500">
                  Ranked by gross margin percentage to inform product line and production choices
                </p>
              </div>
            </div>

            {recipeRankings.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500">
                No BOMs available yet.
              </div>
            ) : (
              <div className="space-y-3">
                {recipeRankings.map(
                  ({ recipe, costPerUnit, sellingPrice, unitGrossProfit, marginPercent }) => (
                    <div
                      key={recipe.id}
                      className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-white transition space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 text-xs truncate">
                          {recipe.name}
                        </span>
                        <span
                          className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                            marginPercent >= 60
                              ? 'bg-emerald-100 text-emerald-800'
                              : marginPercent >= 40
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {marginPercent.toFixed(1)}% Margin
                        </span>
                      </div>

                      {/* Progress bar visual */}
                      <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            marginPercent >= 60
                              ? 'bg-emerald-500'
                              : marginPercent >= 40
                              ? 'bg-amber-500'
                              : 'bg-rose-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(5, marginPercent))}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 gap-2 flex-wrap">
                        <span>
                          Cost / unit:{' '}
                          {costPerUnit > 0 ? (
                            <strong className="text-slate-700">{formatInrAmount(costPerUnit, 2)}</strong>
                          ) : (
                            <span className="text-slate-400">Cost not set</span>
                          )}
                        </span>
                        <span>
                          Retail: <strong className="text-slate-700">{formatInrAmount(sellingPrice, 2)}</strong>
                        </span>
                        <span className="font-bold text-emerald-700">
                          +{formatInrAmount(unitGrossProfit, 2)} Profit
                        </span>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {activeReport === 'by_category' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <h2 className="text-base font-bold text-slate-900">Capital Distribution by Category</h2>
            <div className="space-y-3">
              {categoryBreakdown.map((cat) => (
                <div key={cat.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-medium text-slate-700 truncate">{cat.name}</span>
                    <span className="font-semibold text-slate-900 font-mono tabular-nums shrink-0">
                      {formatInrAmount(cat.costValue, 2)}{' '}
                      <span className="text-slate-400 font-normal">
                        ({cat.percentage.toFixed(1)}%)
                      </span>
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-600"
                      style={{ width: `${Math.min(100, Math.max(3, cat.percentage))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeReport === 'stock_flow' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <h2 className="text-base font-bold text-slate-900">Stock Velocity &amp; Movement Volume</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-100">
                <div className="text-[11px] font-medium text-emerald-800">Total Inflow Restocked</div>
                <div className="text-lg font-black text-emerald-900 mt-1 font-mono tabular-nums">
                  +{formatQty(movementSummary.restockTotal)} units
                </div>
                <div className="text-[10px] text-emerald-600 mt-0.5">Purchased from suppliers</div>
              </div>

              <div className="p-3.5 rounded-xl bg-indigo-50/70 border border-indigo-100">
                <div className="text-[11px] font-medium text-indigo-800">BOM Materials Consumed</div>
                <div className="text-lg font-black text-indigo-900 mt-1 font-mono tabular-nums">
                  -{formatQty(movementSummary.recipeConsumeTotal)} units
                </div>
                <div className="text-[10px] text-indigo-600 mt-0.5">Used in batch production</div>
              </div>

              <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-100">
                <div className="text-[11px] font-medium text-amber-800">Sales / Dispatches</div>
                <div className="text-lg font-black text-amber-900 mt-1 font-mono tabular-nums">
                  -{formatQty(movementSummary.salesTotal)} units
                </div>
                <div className="text-[10px] text-amber-600 mt-0.5">Dispatched to customers</div>
              </div>

              <div className="p-3.5 rounded-xl bg-rose-50/70 border border-rose-100">
                <div className="text-[11px] font-medium text-rose-800">Scrap &amp; Damage</div>
                <div className="text-lg font-black text-rose-900 mt-1 font-mono tabular-nums">
                  -{formatQty(movementSummary.wasteTotal)} units
                </div>
                <div className="text-[10px] text-rose-600 mt-0.5">Scrap, damaged or rejected stock</div>
              </div>
            </div>
          </div>
        )}

        {activeReport === 'shelves' && permissions.canViewShelfOption && (
          <div className="space-y-6">
            {/* Shelf Metric Summary KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Total Active Shelves */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Active Shelves &amp; Storage Zones</span>
                  <span className="p-1.5 rounded-lg bg-cyan-50 text-cyan-600">
                    <Layers className="w-4 h-4" />
                  </span>
                </div>
                <div className="text-2xl font-black text-slate-900 mt-2">
                  {shelfData.totalActiveShelves} Shelves
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  Configured across {items.length} inventory items
                </div>
              </div>

              {/* Physical Stored Units */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Total Units Stored on Shelves</span>
                  <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                    <Boxes className="w-4 h-4" />
                  </span>
                </div>
                <div className="text-2xl font-black text-slate-900 mt-2">
                  {formatQty(shelfData.totalStoredUnits)} units
                </div>
                <div className="text-[11px] text-emerald-600 font-medium mt-1">
                  Real-time physical inventory count
                </div>
              </div>

              {/* Shelf Inventory Valuation */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Shelf Asset Valuation</span>
                  <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                    <DollarSign className="w-4 h-4" />
                  </span>
                </div>
                <div className="text-2xl font-black text-slate-900 mt-2">
                  {permissions.canViewTotalAssetValue ? (
                    formatInrAmount(metrics.totalCostValue, 2)
                  ) : (
                    <span className="text-slate-400 font-mono tracking-widest text-lg">••••••</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {permissions.canViewTotalAssetValue ? (
                    'Allocated across active racks'
                  ) : (
                    <span className="text-slate-400">Valuation restricted by role</span>
                  )}
                </div>
              </div>

              {/* Shelves Requiring Attention */}
              <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Shelves with Low Stock Alerts</span>
                  <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                    <AlertTriangle className="w-4 h-4" />
                  </span>
                </div>
                <div className="text-2xl font-black text-amber-600 mt-2">
                  {shelfData.shelvesWithLowStock} Shelves
                </div>
                <div className="text-[11px] text-slate-500 mt-1">
                  {shelfData.unassignedCount > 0 ? (
                    <span className="text-indigo-600 font-medium">
                      {shelfData.unassignedCount} items pending shelf assignment
                    </span>
                  ) : (
                    <span className="text-emerald-600 font-medium">All items have shelf locations</span>
                  )}
                </div>
              </div>
            </div>

            {/* Search, Filter & Quick Options Toolbar */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              {/* Search Input */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={shelfSearch}
                  onChange={(e) => setShelfSearch(e.target.value)}
                  placeholder="Search shelf name (e.g. Shelf A-1, Rack 2) or item SKU..."
                  className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent bg-slate-50"
                />
              </div>

              {/* Filter Chips */}
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShelfFilter('all')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border ${
                    shelfFilter === 'all'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                  }`}
                >
                  All Shelves ({shelfData.shelves.length})
                </button>

                <button
                  type="button"
                  onClick={() => setShelfFilter('low_stock')}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border flex items-center gap-1.5 ${
                    shelfFilter === 'low_stock'
                      ? 'bg-amber-600 text-white border-amber-600'
                      : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-200'
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span>Needs Restock ({shelfData.shelvesWithLowStock})</span>
                </button>

                {shelfData.unassignedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShelfFilter('unassigned')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer border ${
                      shelfFilter === 'unassigned'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200'
                    }`}
                  >
                    Unassigned Staging ({shelfData.unassignedCount})
                  </button>
                )}
              </div>
            </div>

            {/* Shelves Cards Grid */}
            {filteredShelves.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                  <Layers className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">No Shelves Match Your Filter</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  No storage shelves or items matched &quot;{shelfSearch}&quot;. Clear your search or change the
                  filter pills above.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShelfSearch('');
                    setShelfFilter('all');
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition cursor-pointer"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {filteredShelves.map((shelf) => (
                  <div
                    key={`shelf-${shelf.shelfName}`}
                    className={`bg-white rounded-2xl border shadow-2xs overflow-hidden flex flex-col transition hover:shadow-md ${
                      shelf.isUnassigned
                        ? 'border-indigo-200 bg-indigo-50/10'
                        : shelf.lowStockCount > 0
                        ? 'border-amber-200 bg-white'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    {/* Shelf Card Header */}
                    <div
                      className={`px-5 py-4 border-b flex items-start justify-between gap-3 ${
                        shelf.isUnassigned
                          ? 'bg-indigo-50/60 border-indigo-100'
                          : shelf.lowStockCount > 0
                          ? 'bg-amber-50/60 border-amber-100'
                          : 'bg-slate-50/60 border-slate-100'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                            shelf.isUnassigned
                              ? 'bg-indigo-100 text-indigo-700 border-indigo-200'
                              : shelf.lowStockCount > 0
                              ? 'bg-amber-100 text-amber-700 border-amber-200'
                              : 'bg-cyan-100 text-cyan-700 border-cyan-200'
                          }`}
                        >
                          {shelf.isUnassigned ? (
                            <Archive className="w-5 h-5" />
                          ) : (
                            <MapPin className="w-5 h-5" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-slate-900 truncate">
                              {shelf.shelfName}
                            </h3>
                            {shelf.isUnassigned && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                                Staging &amp; Intake
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                            <span>{shelf.items.length} SKUs</span>
                            <span>•</span>
                            <span className="font-semibold text-slate-700">
                              {formatQty(shelf.totalUnits)} units
                            </span>
                            <span>•</span>
                            <span>
                              {shelf.rawCount} Raw, {shelf.finishedCount} Finished
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Shelf Valuation Chip */}
                      <div className="text-right shrink-0">
                        <div className="text-xs font-bold text-slate-900">
                          {permissions.canViewTotalAssetValue ? (
                            formatInrAmount(shelf.totalCostValue, 2)
                          ) : (
                            <span className="text-slate-400 font-mono">••••</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400">Shelf value</div>
                      </div>
                    </div>

                    {/* Warning banner if low stock on shelf */}
                    {shelf.lowStockCount > 0 && (
                      <div className="px-5 py-2 bg-amber-50 border-b border-amber-100 flex items-center gap-2 text-xs text-amber-800 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>
                          {shelf.lowStockCount} {shelf.lowStockCount === 1 ? 'item is' : 'items are'} below
                          minimum stock threshold on this shelf
                        </span>
                      </div>
                    )}

                    {/* Items List Inside Shelf */}
                    <div className="divide-y divide-slate-100 p-2 sm:p-3 flex-1 overflow-y-auto max-h-72">
                      {shelf.items.map((item) => {
                        const isLow = item.quantity <= item.minStock;
                        const isOut = item.quantity === 0;

                        return (
                          <div
                            key={`item-${item.id}`}
                            className="p-2.5 rounded-xl hover:bg-slate-50 transition flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-slate-900 truncate">
                                  {item.name}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded shrink-0">
                                  {item.sku}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                                <span
                                  className={`font-bold ${
                                    isOut
                                      ? 'text-rose-600'
                                      : isLow
                                      ? 'text-amber-600'
                                      : 'text-emerald-700'
                                  }`}
                                >
                                  {formatQty(item.quantity, item.unit)} {item.unit}
                                </span>
                                <span>(Min: {formatQty(item.minStock, item.unit)})</span>
                                {item.category && <span>• {item.category}</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {permissions.canViewTotalAssetValue && (
                                Number(item.unitCost) > 0 ? (
                                  <span className="text-[11px] font-medium text-slate-600">
                                    {formatInrAmount(item.quantity * item.unitCost, 2)}
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400">
                                    Cost not set
                                  </span>
                                )
                              )}

                              {permissions.canAdjustStock && (
                                <button
                                  type="button"
                                  onClick={() => onOpenAdjustStock(item)}
                                  className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition cursor-pointer ${
                                    isLow
                                      ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                  }`}
                                >
                                  {isLow ? 'Restock' : 'Adjust'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Shelf Card Footer */}
                    <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 gap-2">
                      <span className="flex items-center gap-1.5 min-w-0 truncate">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate">{shelf.items.length} items logged in this location</span>
                      </span>
                      <span className="font-medium text-slate-700 shrink-0">
                        {shelf.rawCount} Raw / {shelf.finishedCount} Finished
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeReport === 'excel_reports' && permissions.canExportExcel && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={exportValuationExcel}
              className="p-5 rounded-2xl bg-white border border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50/40 shadow-2xs transition text-left flex items-center justify-between gap-4 cursor-pointer active:scale-[0.98]"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-slate-900">Inventory valuation (.xlsx)</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Full stock list, cost &amp; retail values ({items.length} items)
                  </div>
                </div>
              </div>
              <Download className="w-5 h-5 text-emerald-600 shrink-0" />
            </button>

            {permissions.canViewShelfOption && (
              <button
                type="button"
                onClick={exportShelfReportExcel}
                className="p-5 rounded-2xl bg-white border border-cyan-200 hover:border-cyan-300 hover:bg-cyan-50/40 shadow-2xs transition text-left flex items-center justify-between gap-4 cursor-pointer active:scale-[0.98]"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-cyan-50 border border-cyan-200 text-cyan-600 flex items-center justify-center shrink-0">
                    <Layers className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">Shelf audit (.xlsx)</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Physical stock across {shelfData.totalActiveShelves} shelves
                    </div>
                  </div>
                </div>
                <Download className="w-5 h-5 text-cyan-600 shrink-0" />
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // HOME: REPORT TILES GRID
  // =========================================================================
  const topBom = recipeRankings[0];
  const topCategory = categoryBreakdown[0];
  const excelCount = permissions.canViewShelfOption ? 2 : 1;

  return (
    <div className="max-w-[1000px] mx-auto space-y-4 pb-10 overflow-x-clip">
      {/* A1. Compact Header (hidden on mobile to avoid duplicating Top Bar title) */}
      <div className="hidden sm:flex items-center justify-between gap-2">
        <h1 className="hidden sm:block text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Reports</h1>
      </div>

      {/* A2 & A4. 2-col mobile / 3-col desktop Tile Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {/* 1. Stock Value */}
        <button
          type="button"
          onClick={() => handleOpenReport('stock_value')}
          className="h-full bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-4 shadow-2xs flex flex-col justify-between text-left transition cursor-pointer active:scale-[0.98] min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <DollarSign className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-slate-700 leading-tight line-clamp-2">Stock Value</span>
            </div>
            <ChevronRight className="hidden sm:block w-3.5 h-3.5 text-slate-300 shrink-0" />
          </div>
          <div className="mt-3 min-w-0">
            <div className="font-mono tabular-nums text-lg sm:text-xl font-black text-indigo-600 truncate">
              {permissions.canViewTotalAssetValue ? (
                formatInrCompact(metrics.totalCostValue)
              ) : (
                <span className="text-slate-400 tracking-widest">••••••</span>
              )}
            </div>
            <div className="text-[11px] font-medium text-slate-500 mt-0.5 truncate">
              {permissions.canViewTotalAssetValue ? 'raw + finished' : 'Restricted'}
            </div>
          </div>
        </button>

        {/* 2. Profit in Stock */}
        <button
          type="button"
          onClick={() => handleOpenReport('profit_in_stock')}
          className="h-full bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-4 shadow-2xs flex flex-col justify-between text-left transition cursor-pointer active:scale-[0.98] min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-slate-700 leading-tight line-clamp-2">Profit in Stock</span>
            </div>
            <ChevronRight className="hidden sm:block w-3.5 h-3.5 text-slate-300 shrink-0" />
          </div>
          <div className="mt-3 min-w-0">
            <div className="font-mono tabular-nums text-lg sm:text-xl font-black text-emerald-600 truncate">
              {formatInrCompact(metrics.potentialGrossProfit)}
            </div>
            <div className="text-[11px] font-medium text-emerald-600 mt-0.5 truncate">
              if all sold
            </div>
          </div>
        </button>

        {/* 3. Reorder List */}
        <button
          type="button"
          onClick={() => handleOpenReport('reorder_list')}
          className="h-full bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-4 shadow-2xs flex flex-col justify-between text-left transition cursor-pointer active:scale-[0.98] min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-slate-700 leading-tight line-clamp-2">Reorder List</span>
            </div>
            <ChevronRight className="hidden sm:block w-3.5 h-3.5 text-slate-300 shrink-0" />
          </div>
          <div className="mt-3 min-w-0">
            <div
              className={`font-mono tabular-nums text-lg sm:text-xl font-black truncate ${
                reorderItems.length > 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              {reorderItems.length} {reorderItems.length === 1 ? 'item' : 'items'}
            </div>
            <div
              className={`text-[11px] font-medium mt-0.5 truncate ${
                reorderItems.length > 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              {reorderItems.length > 0
                ? `${formatInrCompact(totalReplenishmentCost)} needed`
                : 'All stocked ✓'}
            </div>
          </div>
        </button>

        {/* 4. BOM Profit */}
        <button
          type="button"
          onClick={() => handleOpenReport('bom_profit')}
          className="h-full bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-4 shadow-2xs flex flex-col justify-between text-left transition cursor-pointer active:scale-[0.98] min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-slate-700 leading-tight line-clamp-2">BOM Profit</span>
            </div>
            <ChevronRight className="hidden sm:block w-3.5 h-3.5 text-slate-300 shrink-0" />
          </div>
          <div className="mt-3 min-w-0">
            <div className="font-mono tabular-nums text-base sm:text-lg font-black text-slate-900 truncate">
              {topBom ? topBom.recipe.name : '—'}
            </div>
            <div className="text-[11px] font-medium text-slate-500 mt-0.5 truncate">
              {topBom ? `${topBom.marginPercent.toFixed(1)}% margin` : 'No BOMs'}
            </div>
          </div>
        </button>

        {/* 5. By Category */}
        <button
          type="button"
          onClick={() => handleOpenReport('by_category')}
          className="h-full bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-4 shadow-2xs flex flex-col justify-between text-left transition cursor-pointer active:scale-[0.98] min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <PieChart className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-slate-700 leading-tight line-clamp-2">By Category</span>
            </div>
            <ChevronRight className="hidden sm:block w-3.5 h-3.5 text-slate-300 shrink-0" />
          </div>
          <div className="mt-3 min-w-0">
            <div className="font-mono tabular-nums text-lg sm:text-xl font-black text-slate-900 truncate">
              {categoryBreakdown.length} {categoryBreakdown.length === 1 ? 'group' : 'groups'}
            </div>
            <div className="text-[11px] font-medium text-slate-500 mt-0.5 truncate">
              {topCategory
                ? `${topCategory.name} · ${topCategory.percentage.toFixed(0)}%`
                : 'No items'}
            </div>
          </div>
        </button>

        {/* 6. Stock Flow */}
        <button
          type="button"
          onClick={() => handleOpenReport('stock_flow')}
          className="h-full bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-4 shadow-2xs flex flex-col justify-between text-left transition cursor-pointer active:scale-[0.98] min-w-0"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                <BarChart3 className="w-4 h-4" />
              </span>
              <span className="text-xs font-bold text-slate-700 leading-tight line-clamp-2">Stock Flow</span>
            </div>
            <ChevronRight className="hidden sm:block w-3.5 h-3.5 text-slate-300 shrink-0" />
          </div>
          <div className="mt-3 min-w-0">
            <div className="font-mono tabular-nums text-lg sm:text-xl font-black text-amber-600 truncate">
              In / Out
            </div>
            <div className="text-[11px] font-medium text-slate-500 mt-0.5 line-clamp-2 leading-snug">
              +{formatQtyShort(movementSummary.restockTotal)} in · −
              {formatQtyShort(movementSummary.salesTotal)} out (units)
            </div>
          </div>
        </button>

        {/* 7. Shelves (only if canViewShelfOption) */}
        {permissions.canViewShelfOption && (
          <button
            type="button"
            onClick={() => handleOpenReport('shelves')}
            className="h-full bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-4 shadow-2xs flex flex-col justify-between text-left transition cursor-pointer active:scale-[0.98] min-w-0"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                  <Layers className="w-4 h-4" />
                </span>
                <span className="text-xs font-bold text-slate-700 leading-tight line-clamp-2">Shelves</span>
              </div>
              <ChevronRight className="hidden sm:block w-3.5 h-3.5 text-slate-300 shrink-0" />
            </div>
            <div className="mt-3 min-w-0">
              <div className="font-mono tabular-nums text-lg sm:text-xl font-black text-slate-900 truncate">
                {shelfData.totalActiveShelves}{' '}
                {shelfData.totalActiveShelves === 1 ? 'shelf' : 'shelves'}
              </div>
              <div className="text-[11px] font-medium text-slate-500 mt-0.5 truncate">
                {shelfData.shelvesWithLowStock} low · {shelfData.unassignedCount} no shelf
              </div>
            </div>
          </button>
        )}

        {/* 8. Excel Reports (only if canExportExcel) */}
        {permissions.canExportExcel && (
          <button
            type="button"
            onClick={() => handleOpenReport('excel_reports')}
            className="h-full bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-4 shadow-2xs flex flex-col justify-between text-left transition cursor-pointer active:scale-[0.98] min-w-0"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                </span>
                <span className="text-xs font-bold text-slate-700 leading-tight line-clamp-2">Excel Reports</span>
              </div>
              <ChevronRight className="hidden sm:block w-3.5 h-3.5 text-slate-300 shrink-0" />
            </div>
            <div className="mt-3 min-w-0">
              <div className="font-mono tabular-nums text-lg sm:text-xl font-black text-slate-900 truncate">
                {excelCount} {excelCount === 1 ? 'file' : 'files'}
              </div>
              <div className="text-[11px] font-medium text-slate-500 mt-0.5 truncate">
                {permissions.canViewShelfOption ? 'valuation · shelves' : 'valuation'}
              </div>
            </div>
          </button>
        )}
      </div>
    </div>
  );
};
