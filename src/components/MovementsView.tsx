import React, { useState, useMemo } from 'react';
import {
  History,
  Search,
  Download,
  ArrowDownRight,
  ArrowUpRight,
  Trash2,
  ClipboardCheck,
  CookingPot,
  Sparkles,
  SlidersHorizontal,
  TrendingUp,
  TrendingDown,
  Calendar,
  Clock,
  User,
  X,
  Layers,
  ChevronRight,
  FileSpreadsheet,
} from 'lucide-react';
import { StockMovement, StockMovementType, InventoryItem } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { downloadExcelFile, downloadCSVFile } from '../utils/fileDownload';

interface MovementsViewProps {
  onOpenAdjustStock?: (item?: InventoryItem) => void;
}

export const MovementsView: React.FC<MovementsViewProps> = ({ onOpenAdjustStock }) => {
  const { movements, items, hasMoreMovements, loadMoreMovements } = useInventory();
  const { permissions } = useAuth();
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');

  // Map items for rapid lookup of units, SKUs, and item details
  const itemMap = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    items.forEach((i) => {
      map.set(i.id, i);
      map.set(i.name.toLowerCase(), i);
    });
    return map;
  }, [items]);

  const getItemUnit = (mov: StockMovement): string => {
    const it = itemMap.get(mov.itemId) || itemMap.get(mov.itemName.toLowerCase());
    return it?.unit || 'units';
  };

  const getMatchedItem = (mov: StockMovement): InventoryItem | undefined => {
    return itemMap.get(mov.itemId) || itemMap.get(mov.itemName.toLowerCase());
  };

  const filteredMovements = useMemo(() => {
    return movements
      .filter((mov) => {
        if (selectedType !== 'all') {
          if (selectedType === 'in_all') {
            if (mov.type !== 'in' && mov.type !== 'production_yield') return false;
          } else if (selectedType === 'out_all') {
            if (mov.type !== 'out' && mov.type !== 'production_consume' && mov.type !== 'waste') {
              return false;
            }
          } else if (mov.type !== selectedType) {
            return false;
          }
        }

        if (search.trim()) {
          const query = search.toLowerCase();
          const matches =
            mov.itemName.toLowerCase().includes(query) ||
            (mov.reason && mov.reason.toLowerCase().includes(query)) ||
            (mov.performedByName && mov.performedByName.toLowerCase().includes(query)) ||
            (mov.referenceId && mov.referenceId.toLowerCase().includes(query));
          if (!matches) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [movements, search, selectedType]);

  // Aggregate metrics summary for the audit trail
  const metrics = useMemo(() => {
    let totalInUnits = 0;
    let totalOutUnits = 0;
    let totalAdjustments = 0;

    movements.forEach((m) => {
      if (m.type === 'in' || m.type === 'production_yield') {
        totalInUnits += m.quantity;
      } else if (m.type === 'out' || m.type === 'production_consume' || m.type === 'waste') {
        totalOutUnits += m.quantity;
      } else if (m.type === 'adjustment') {
        totalAdjustments += 1;
      }
    });

    return {
      totalEvents: movements.length,
      totalInUnits,
      totalOutUnits,
      totalAdjustments,
    };
  }, [movements]);

  const typeConfig: Record<
    StockMovementType,
    { label: string; icon: React.ElementType; color: string; prefix: string; bgBadge: string }
  > = {
    in: {
      label: 'Restock In',
      icon: ArrowDownRight,
      color: 'bg-emerald-50 text-emerald-800 border-emerald-300',
      prefix: '+',
      bgBadge: 'bg-emerald-50 text-emerald-700',
    },
    out: {
      label: 'Stock Out',
      icon: ArrowUpRight,
      color: 'bg-amber-50 text-amber-800 border-amber-300',
      prefix: '-',
      bgBadge: 'bg-amber-50 text-amber-700',
    },
    production_consume: {
      label: 'Recipe Consume',
      icon: CookingPot,
      color: 'bg-rose-50 text-rose-800 border-rose-300',
      prefix: '-',
      bgBadge: 'bg-rose-50 text-rose-700',
    },
    production_yield: {
      label: 'Recipe Yield',
      icon: Sparkles,
      color: 'bg-indigo-50 text-indigo-800 border-indigo-300',
      prefix: '+',
      bgBadge: 'bg-indigo-50 text-indigo-700',
    },
    adjustment: {
      label: 'Audit Count',
      icon: ClipboardCheck,
      color: 'bg-blue-50 text-blue-800 border-blue-300',
      prefix: '±',
      bgBadge: 'bg-blue-50 text-blue-700',
    },
    waste: {
      label: 'Waste / Spoilage',
      icon: Trash2,
      color: 'bg-red-50 text-red-800 border-red-300',
      prefix: '-',
      bgBadge: 'bg-red-50 text-red-700',
    },
  };

  // Filter option pills with live counts
  const filterOptions = useMemo(() => {
    return [
      { id: 'all', label: 'All Events', count: movements.length },
      {
        id: 'in',
        label: 'Restocks In',
        count: movements.filter((m) => m.type === 'in').length,
      },
      {
        id: 'production_yield',
        label: 'Recipe Yields',
        count: movements.filter((m) => m.type === 'production_yield').length,
      },
      {
        id: 'out',
        label: 'Sales / Stock Out',
        count: movements.filter((m) => m.type === 'out').length,
      },
      {
        id: 'production_consume',
        label: 'Recipe Consumed',
        count: movements.filter((m) => m.type === 'production_consume').length,
      },
      {
        id: 'adjustment',
        label: 'Audit Counts',
        count: movements.filter((m) => m.type === 'adjustment').length,
      },
      {
        id: 'waste',
        label: 'Waste / Spoilage',
        count: movements.filter((m) => m.type === 'waste').length,
      },
    ];
  }, [movements]);

  const exportExcel = () => {
    const excelRows = filteredMovements.map((m) => {
      const conf = typeConfig[m.type];
      const d = new Date(m.timestamp);
      return {
        'Date': d.toLocaleDateString(),
        'Time': d.toLocaleTimeString(),
        'Item Name': m.itemName,
        'Action Type': conf ? conf.label : m.type,
        'Quantity Delta': m.quantity,
        'Previous Qty': m.previousQuantity,
        'Closing Qty': m.newQuantity,
        'Reason / Notes': m.reason || '',
        'Reference ID': m.referenceId || '',
        'Recorded By': m.performedByName || '',
      };
    });

    downloadExcelFile(
      excelRows,
      `powertrack_movements_audit_${Date.now()}.xlsx`,
      'Movements Trail'
    );
  };

  const exportCSV = () => {
    const headers = [
      'Timestamp',
      'Item Name',
      'Action Type',
      'Quantity Delta',
      'Previous Qty',
      'New Qty',
      'Reason / Reference',
      'Recorded By',
    ];
    const rows = filteredMovements.map((m) => [
      new Date(m.timestamp).toISOString(),
      `"${m.itemName.replace(/"/g, '""')}"`,
      m.type,
      m.quantity,
      m.previousQuantity,
      m.newQuantity,
      `"${(m.reason || '').replace(/"/g, '""')}"`,
      `"${(m.performedByName || '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    downloadCSVFile(csvContent, `powertrack_movements_audit_${Date.now()}.csv`);
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    };
  };

  return (
    <div className="space-y-4 sm:space-y-6 pb-12 w-full overflow-x-hidden">
      {/* Top Header & Action Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Stock Movement Audit Trail
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable transaction ledger tracking all stock intakes, batch production usages, dispatches, and count audits.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* New Stock Adjustment Action Button */}
          {permissions.canAdjustStock && (
            <button
              type="button"
              onClick={() => onOpenAdjustStock?.()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-xs cursor-pointer active:scale-95"
              title="Record a stock adjustment"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>+ New Adjustment</span>
            </button>
          )}

          {permissions.canExportExcel && (
            <button
              type="button"
              onClick={exportExcel}
              disabled={filteredMovements.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-800 transition shadow-2xs cursor-pointer active:scale-95 disabled:opacity-40"
              title="Download Excel (.xlsx) report"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Export Excel</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile-Friendly Summary Metric Strip (2x2 on mobile, 4-col on tablet/desktop) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-2.5">
        {/* Total Inflow */}
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center justify-between">
            <span>Total Inflow</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          </div>
          <div className="text-base sm:text-lg font-black text-emerald-700 mt-1">
            +{metrics.totalInUnits.toFixed(1)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">Intakes & Yields</div>
        </div>

        {/* Total Outflow */}
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-rose-700 uppercase tracking-wider flex items-center justify-between">
            <span>Total Outflow</span>
            <TrendingDown className="w-3.5 h-3.5 text-rose-600 shrink-0" />
          </div>
          <div className="text-base sm:text-lg font-black text-rose-700 mt-1">
            -{metrics.totalOutUnits.toFixed(1)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">Sales, Consumed, Waste</div>
        </div>

        {/* Audit Adjustments */}
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider flex items-center justify-between">
            <span>Audit Counts</span>
            <ClipboardCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" />
          </div>
          <div className="text-base sm:text-lg font-black text-blue-700 mt-1">
            {metrics.totalAdjustments}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">Physical Stock Checks</div>
        </div>

        {/* Total Events */}
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center justify-between">
            <span>Audit Entries</span>
            <History className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </div>
          <div className="text-base sm:text-lg font-black text-slate-900 mt-1">
            {metrics.totalEvents}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">Complete Ledger Trail</div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="space-y-2.5">
        <div className="p-2 bg-white rounded-xl border border-slate-200 flex items-center gap-2 shadow-2xs">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by product, reason, reference ID, or operator..."
              className="w-full pl-9 pr-8 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder:text-slate-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Horizontal Scrollable Filter Strip for Smooth Phone Navigation */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {filterOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelectedType(opt.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 shrink-0 cursor-pointer ${
                selectedType === opt.id
                  ? 'bg-slate-900 text-white shadow-xs font-bold'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100/70 shadow-2xs'
              }`}
            >
              <span>{opt.label}</span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.2 rounded-md ${
                  selectedType === opt.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-800'
                }`}
              >
                {opt.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Ledger Content */}
      {filteredMovements.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center space-y-3 shadow-2xs">
          <History className="w-12 h-12 text-slate-300 mx-auto" />
          <h3 className="text-sm font-bold text-slate-800">No stock movements found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            {search.trim()
              ? 'No audit movements match your active search terms or type filter.'
              : 'Any stock intake, batch run, or inventory count adjustment will automatically appear here.'}
          </p>
          {permissions.canAdjustStock && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => onOpenAdjustStock?.()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-xs cursor-pointer active:scale-95"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Make First Stock Adjustment</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* =========================================================================
              MOBILE VIEW: HIGH-CLARITY AUDIT PASSBOOK CARDS (Screens < md)
              ========================================================================= */}
          <div className="md:hidden space-y-3">
            {filteredMovements.map((mov) => {
              const cfg = typeConfig[mov.type] || typeConfig.adjustment;
              const Icon = cfg.icon;
              const timeInfo = formatDate(mov.timestamp);
              const unit = getItemUnit(mov);
              const matched = getMatchedItem(mov);

              const isPositive = cfg.prefix === '+';
              const isNegative = cfg.prefix === '-';

              return (
                <div
                  key={mov.id}
                  className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-2xs space-y-3"
                >
                  {/* Card Header: Timestamp & Action Type Tag */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                      <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                      <span>{timeInfo.date} • {timeInfo.time}</span>
                    </div>

                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${cfg.color}`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{cfg.label}</span>
                    </span>
                  </div>

                  {/* Product Title & Narration */}
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-bold text-sm text-slate-900 leading-snug break-words">
                        {mov.itemName}
                      </h3>
                      {matched?.sku && (
                        <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                          {matched.sku}
                        </span>
                      )}
                    </div>

                    {mov.reason && (
                      <p className="text-xs text-slate-600 font-medium">
                        {mov.reason}
                      </p>
                    )}

                    <div className="flex items-center gap-2 text-[11px] text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        <span>By {mov.performedByName || 'System'}</span>
                      </span>
                      {mov.referenceId && (
                        <span className="font-mono text-slate-500 bg-slate-50 px-1 rounded border border-slate-100">
                          Ref #{mov.referenceId}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 3-Column Passbook Balance Strip */}
                  <div className="grid grid-cols-3 gap-2 bg-slate-50/80 p-2.5 rounded-xl border border-slate-200/70 text-center">
                    {/* Before */}
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        Before
                      </div>
                      <div className="font-mono font-medium text-xs text-slate-600 mt-0.5">
                        {mov.previousQuantity.toFixed(1)}{' '}
                        <span className="text-[9px] text-slate-400">{unit}</span>
                      </div>
                    </div>

                    {/* Delta / Change */}
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        Movement
                      </div>
                      <div
                        className={`font-mono font-black text-xs sm:text-sm mt-0.5 ${
                          isPositive
                            ? 'text-emerald-700'
                            : isNegative
                            ? 'text-rose-700'
                            : 'text-blue-700'
                        }`}
                      >
                        {cfg.prefix}
                        {mov.quantity.toFixed(1)}{' '}
                        <span className="text-[9px] font-semibold">{unit}</span>
                      </div>
                    </div>

                    {/* After / Closing */}
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                        Balance
                      </div>
                      <div className="font-mono font-black text-xs sm:text-sm text-slate-900 mt-0.5">
                        {mov.newQuantity.toFixed(1)}{' '}
                        <span className="text-[9px] font-semibold text-slate-500">{unit}</span>
                      </div>
                    </div>
                  </div>

                  {/* Action Quick Button */}
                  {permissions.canAdjustStock && matched && (
                    <div className="pt-1 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => onOpenAdjustStock?.(matched)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-indigo-700 bg-indigo-50/60 hover:bg-indigo-100 border border-indigo-200 transition cursor-pointer active:scale-95"
                      >
                        <SlidersHorizontal className="w-3 h-3 text-indigo-600" />
                        <span>Adjust This Stock</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* =========================================================================
              DESKTOP VIEW: COMPREHENSIVE AUDIT DATA TABLE (Screens >= md)
              ========================================================================= */}
          <div className="hidden md:block bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/75 border-b border-slate-200 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Date & Time</th>
                    <th className="py-3 px-3">Item Name</th>
                    <th className="py-3 px-3">Action Type</th>
                    <th className="py-3 px-3 text-right">Delta</th>
                    <th className="py-3 px-3 text-right">Before → After</th>
                    <th className="py-3 px-3">Reason / Ref</th>
                    <th className="py-3 px-3">Recorded By</th>
                    {permissions.canAdjustStock && <th className="py-3 px-4 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredMovements.map((mov) => {
                    const cfg = typeConfig[mov.type] || typeConfig.adjustment;
                    const Icon = cfg.icon;
                    const timeInfo = formatDate(mov.timestamp);
                    const unit = getItemUnit(mov);
                    const matched = getMatchedItem(mov);

                    const isPositive = cfg.prefix === '+';
                    const isNegative = cfg.prefix === '-';

                    return (
                      <tr key={mov.id} className="hover:bg-slate-50/60 transition">
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-medium text-slate-800">{timeInfo.date}</div>
                          <div className="text-[11px] text-slate-400">{timeInfo.time}</div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-semibold text-slate-900">{mov.itemName}</div>
                          {matched?.sku && (
                            <div className="font-mono text-[10px] text-slate-400">
                              SKU: {matched.sku}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${cfg.color}`}
                          >
                            <Icon className="w-3 h-3" />
                            <span>{cfg.label}</span>
                          </span>
                        </td>

                        <td className="py-3 px-3 text-right whitespace-nowrap font-mono font-bold">
                          <span
                            className={
                              isPositive
                                ? 'text-emerald-700'
                                : isNegative
                                ? 'text-rose-700'
                                : 'text-blue-700'
                            }
                          >
                            {cfg.prefix}
                            {mov.quantity.toFixed(1)} {unit}
                          </span>
                        </td>

                        <td className="py-3 px-3 text-right whitespace-nowrap font-mono text-[11px] text-slate-500">
                          {mov.previousQuantity.toFixed(1)} →{' '}
                          <strong className="text-slate-900">{mov.newQuantity.toFixed(1)}</strong>{' '}
                          {unit}
                        </td>

                        <td className="py-3 px-3 text-slate-600 max-w-xs truncate">
                          <div>{mov.reason || '—'}</div>
                          {mov.referenceId && (
                            <span className="font-mono text-[10px] text-slate-400">
                              #{mov.referenceId}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                          <span className="font-medium text-slate-800">
                            {mov.performedByName || 'System'}
                          </span>
                        </td>

                        {permissions.canAdjustStock && (
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {matched && (
                              <button
                                type="button"
                                onClick={() => onOpenAdjustStock?.(matched)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition cursor-pointer"
                                title="Adjust stock for this item"
                              >
                                <SlidersHorizontal className="w-3 h-3" />
                                <span>Adjust</span>
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Load More Movements */}
          {hasMoreMovements && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={loadMoreMovements}
                className="px-5 py-2 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition cursor-pointer"
              >
                Load More Movements
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
