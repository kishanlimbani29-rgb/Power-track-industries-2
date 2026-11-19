import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  History,
  Search,
  ArrowDownRight,
  ArrowUpRight,
  Trash2,
  ClipboardCheck,
  ClipboardList,
  Sparkles,
  SlidersHorizontal,
  X,
  ChevronRight,
  ChevronDown,
  FileSpreadsheet,
} from 'lucide-react';
import { StockMovement, StockMovementType, InventoryItem } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { downloadExcelFile, downloadCSVFile } from '../utils/fileDownload';
import { formatQty, formatDate as formatSharedDate, formatShortDate, formatDateTime, formatTime12h } from '../utils/numberFormat';

interface MovementsViewProps {
  onOpenAdjustStock?: (item?: InventoryItem) => void;
}

type PeriodId = 'today' | '7d' | '30d' | 'all';
type LedgerTab = 'all_entries' | 'by_item';

const PERIOD_LABELS: Record<PeriodId, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  all: 'All',
};

const toLocalDayKey = (iso?: string): string => {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const shiftDayKey = (daysOffset: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const getPeriodStartMs = (period: PeriodId): number | null => {
  if (period === 'all') return null;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  if (period === 'today') return start.getTime();
  if (period === '7d') {
    start.setDate(start.getDate() - 6);
    return start.getTime();
  }
  start.setDate(start.getDate() - 29);
  return start.getTime();
};

const formatDayHeaderLabel = (dayKey: string, todayKey: string, yesterdayKey: string): string => {
  if (dayKey === todayKey) return 'TODAY';
  if (dayKey === yesterdayKey) return 'YESTERDAY';
  const d = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dayKey.toUpperCase();
  return formatShortDate(d, true).toUpperCase();
};

const formatQtyClean = (n: number, unit?: string): string => {
  return formatQty(n, unit);
};

export const MovementsView: React.FC<MovementsViewProps> = ({ onOpenAdjustStock }) => {
  const { movements, items, hasMoreMovements, loadMoreMovements } = useInventory();
  const { permissions } = useAuth();

  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [period, setPeriod] = useState<PeriodId>('7d');
  const [activeTab, setActiveTab] = useState<LedgerTab>('all_entries');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [detailMovement, setDetailMovement] = useState<StockMovement | null>(null);

  const exportMenuRef = useRef<HTMLDivElement>(null);
  const sheetHistoryPushedRef = useRef(false);

  // Close Excel dropdown when clicking outside
  useEffect(() => {
    if (!isExportMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isExportMenuOpen]);

  // Phone back button support for bottom sheet
  useEffect(() => {
    if (detailMovement) {
      if (!sheetHistoryPushedRef.current) {
        sheetHistoryPushedRef.current = true;
        window.history.pushState({ movementSheet: detailMovement.id }, '');
      }
      const handlePopState = () => {
        sheetHistoryPushedRef.current = false;
        setDetailMovement(null);
      };
      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    } else if (sheetHistoryPushedRef.current) {
      sheetHistoryPushedRef.current = false;
      if (window.history.state?.movementSheet) {
        window.history.back();
      }
    }
  }, [detailMovement]);

  const closeDetailSheet = () => {
    if (sheetHistoryPushedRef.current && window.history.state?.movementSheet) {
      window.history.back();
    } else {
      setDetailMovement(null);
    }
  };

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

  const todayKey = toLocalDayKey();
  const yesterdayKey = shiftDayKey(-1);

  // Step 1: Filter by period
  const periodMovements = useMemo(() => {
    const startMs = getPeriodStartMs(period);
    return movements
      .filter((mov) => {
        if (startMs === null) return true;
        const ts = new Date(mov.timestamp).getTime();
        if (Number.isNaN(ts)) return false;
        return ts >= startMs;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [movements, period]);

  // Step 2: Filter by search (used by both All entries & By item)
  const periodAndSearchMovements = useMemo(() => {
    if (!search.trim()) return periodMovements;
    const query = search.toLowerCase().trim();
    return periodMovements.filter((mov) => {
      const matched = itemMap.get(mov.itemId) || itemMap.get(mov.itemName.toLowerCase());
      return (
        mov.itemName.toLowerCase().includes(query) ||
        (mov.reason && mov.reason.toLowerCase().includes(query)) ||
        (mov.performedByName && mov.performedByName.toLowerCase().includes(query)) ||
        (mov.referenceId && mov.referenceId.toLowerCase().includes(query)) ||
        (matched?.sku && matched.sku.toLowerCase().includes(query))
      );
    });
  }, [periodMovements, search, itemMap]);

  // Step 3: Filter by selectedType for All entries
  const filteredMovements = useMemo(() => {
    if (selectedType === 'all') return periodAndSearchMovements;
    return periodAndSearchMovements.filter((mov) => {
      if (selectedType === 'in_all') {
        return mov.type === 'in' || mov.type === 'production_yield';
      }
      if (selectedType === 'out_all') {
        return mov.type === 'out' || mov.type === 'production_consume' || mov.type === 'waste';
      }
      return mov.type === selectedType;
    });
  }, [periodAndSearchMovements, selectedType]);

  // Group filteredMovements by day (newest first)
  const dayGroups = useMemo(() => {
    const groups: {
      dayKey: string;
      label: string;
      inCount: number;
      outCount: number;
      countAdj: number;
      items: StockMovement[];
    }[] = [];
    const byKey = new Map<string, (typeof groups)[number]>();

    for (const mov of filteredMovements) {
      const dk = toLocalDayKey(mov.timestamp);
      let grp = byKey.get(dk);
      if (!grp) {
        grp = {
          dayKey: dk,
          label: formatDayHeaderLabel(dk, todayKey, yesterdayKey),
          inCount: 0,
          outCount: 0,
          countAdj: 0,
          items: [],
        };
        byKey.set(dk, grp);
        groups.push(grp);
      }
      grp.items.push(mov);
      if (mov.type === 'in' || mov.type === 'production_yield') {
        grp.inCount += 1;
      } else if (mov.type === 'out' || mov.type === 'production_consume' || mov.type === 'waste') {
        grp.outCount += 1;
      } else if (mov.type === 'adjustment') {
        grp.countAdj += 1;
      }
    }

    return groups;
  }, [filteredMovements, todayKey, yesterdayKey]);

  // Summary counts for filteredMovements (dark bottom bar)
  const filteredSummaryCounts = useMemo(() => {
    let inCount = 0;
    let outCount = 0;
    let adjCount = 0;
    for (const m of filteredMovements) {
      if (m.type === 'in' || m.type === 'production_yield') inCount += 1;
      else if (m.type === 'out' || m.type === 'production_consume' || m.type === 'waste') outCount += 1;
      else if (m.type === 'adjustment') adjCount += 1;
    }
    return { total: filteredMovements.length, inCount, outCount, adjCount };
  }, [filteredMovements]);

  // By-item aggregation for selected period + search
  const byItemRows = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        itemName: string;
        unit: string;
        inTotal: number;
        outTotal: number;
        currentStock: number | null;
      }
    >();

    for (const mov of periodAndSearchMovements) {
      const matched = itemMap.get(mov.itemId) || itemMap.get(mov.itemName.toLowerCase());
      const key = matched ? matched.id : mov.itemId || mov.itemName.toLowerCase();
      const unit = matched?.unit || 'units';

      let row = map.get(key);
      if (!row) {
        row = {
          key,
          itemName: matched?.name || mov.itemName,
          unit,
          inTotal: 0,
          outTotal: 0,
          currentStock: matched ? matched.quantity : null,
        };
        map.set(key, row);
      }

      if (mov.type === 'in' || mov.type === 'production_yield') {
        row.inTotal += mov.quantity;
      } else if (mov.type === 'out' || mov.type === 'production_consume' || mov.type === 'waste') {
        row.outTotal += mov.quantity;
      } else if (mov.type === 'adjustment') {
        const delta = mov.newQuantity - mov.previousQuantity;
        if (delta > 0) row.inTotal += delta;
        else if (delta < 0) row.outTotal += Math.abs(delta);
      }
    }

    return Array.from(map.values()).sort(
      (a, b) => b.inTotal + b.outTotal - (a.inTotal + a.outTotal)
    );
  }, [periodAndSearchMovements, itemMap]);

  const typeConfig: Record<
    StockMovementType,
    { label: string; icon: React.ElementType; color: string; prefix: string; iconCircle: string }
  > = {
    in: {
      label: 'Restock In',
      icon: ArrowDownRight,
      color: 'bg-emerald-50 text-emerald-800 border-emerald-300',
      prefix: '+',
      iconCircle: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    },
    out: {
      label: 'Stock Out',
      icon: ArrowUpRight,
      color: 'bg-amber-50 text-amber-800 border-amber-300',
      prefix: '-',
      iconCircle: 'bg-amber-50 text-amber-600 border-amber-200',
    },
    production_consume: {
      label: 'BOM Consume',
      icon: ClipboardList,
      color: 'bg-rose-50 text-rose-800 border-rose-300',
      prefix: '-',
      iconCircle: 'bg-rose-50 text-rose-600 border-rose-200',
    },
    production_yield: {
      label: 'BOM Yield',
      icon: Sparkles,
      color: 'bg-indigo-50 text-indigo-800 border-indigo-300',
      prefix: '+',
      iconCircle: 'bg-indigo-50 text-indigo-600 border-indigo-200',
    },
    adjustment: {
      label: 'Audit Count',
      icon: ClipboardCheck,
      color: 'bg-blue-50 text-blue-800 border-blue-300',
      prefix: '±',
      iconCircle: 'bg-indigo-50 text-indigo-600 border-indigo-200',
    },
    waste: {
      label: 'Scrap / Damage',
      icon: Trash2,
      color: 'bg-red-50 text-red-800 border-red-300',
      prefix: '-',
      iconCircle: 'bg-red-50 text-red-600 border-red-200',
    },
  };

  // Filter chips with live counts (using existing selectedType values)
  const filterOptions = useMemo(() => {
    return [
      { id: 'all', label: 'All', count: periodAndSearchMovements.length },
      {
        id: 'in_all',
        label: 'In',
        count: periodAndSearchMovements.filter(
          (m) => m.type === 'in' || m.type === 'production_yield'
        ).length,
      },
      {
        id: 'out_all',
        label: 'Out',
        count: periodAndSearchMovements.filter(
          (m) => m.type === 'out' || m.type === 'production_consume' || m.type === 'waste'
        ).length,
      },
      {
        id: 'production_yield',
        label: 'Made',
        count: periodAndSearchMovements.filter((m) => m.type === 'production_yield').length,
      },
      {
        id: 'production_consume',
        label: 'Used',
        count: periodAndSearchMovements.filter((m) => m.type === 'production_consume').length,
      },
      {
        id: 'adjustment',
        label: 'Counts',
        count: periodAndSearchMovements.filter((m) => m.type === 'adjustment').length,
      },
      {
        id: 'waste',
        label: 'Scrap',
        count: periodAndSearchMovements.filter((m) => m.type === 'waste').length,
      },
    ];
  }, [periodAndSearchMovements]);

  const exportExcel = () => {
    const excelRows = filteredMovements.map((m) => {
      const conf = typeConfig[m.type];
      const d = new Date(m.timestamp);
      return {
        Date: d.toLocaleDateString(),
        Time: d.toLocaleTimeString(),
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
    return {
      date: formatSharedDate(iso),
      time: formatTime12h(iso),
    };
  };

  const getMovementSignedDisplay = (mov: StockMovement) => {
    const unit = getItemUnit(mov);
    if (mov.type === 'in' || mov.type === 'production_yield') {
      return {
        text: `+${formatQtyClean(mov.quantity, unit)} ${unit}`,
        colorClass: 'text-emerald-600',
      };
    }
    if (mov.type === 'out' || mov.type === 'production_consume' || mov.type === 'waste') {
      return {
        text: `−${formatQtyClean(mov.quantity, unit)} ${unit}`,
        colorClass: 'text-rose-600',
      };
    }
    // adjustment: use real direction (newQuantity - previousQuantity)
    const delta = mov.newQuantity - mov.previousQuantity;
    const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
    return {
      text: `${sign}${formatQtyClean(Math.abs(delta), unit)} ${unit}`,
      colorClass: 'text-indigo-600',
    };
  };

  const detailMatchedItem = detailMovement ? getMatchedItem(detailMovement) : undefined;
  const detailCfg = detailMovement ? typeConfig[detailMovement.type] || typeConfig.adjustment : null;
  const detailSigned = detailMovement ? getMovementSignedDisplay(detailMovement) : null;
  const detailTime = detailMovement ? formatDate(detailMovement.timestamp) : null;

  return (
    <div className="space-y-3.5 pb-12 max-w-[900px] mx-auto w-full overflow-x-clip">
      {/* B1. HEADER: one compact row */}
      <div className="flex items-center justify-end sm:justify-between gap-2">
        <h1 className="hidden sm:block text-xl sm:text-2xl font-bold text-slate-900 tracking-tight truncate">
          Stock Movements
        </h1>

        <div className="flex items-center gap-2 shrink-0">
          {permissions.canExportExcel && (
            <div className="relative" ref={exportMenuRef}>
              <button
                type="button"
                onClick={() => setIsExportMenuOpen((prev) => !prev)}
                disabled={filteredMovements.length === 0}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-bold border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-800 transition shadow-2xs cursor-pointer active:scale-95 disabled:opacity-40"
                title="Export movements"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span>Excel</span>
                <ChevronDown className="w-3 h-3 text-emerald-700 shrink-0" />
              </button>

              {isExportMenuOpen && (
                <div className="absolute right-0 mt-1.5 w-36 bg-white rounded-xl border border-slate-200 shadow-lg py-1 z-30">
                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      exportExcel();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsExportMenuOpen(false);
                      exportCSV();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    CSV (.csv)
                  </button>
                </div>
              )}
            </div>
          )}

          {permissions.canAdjustStock && (
            <button
              type="button"
              onClick={() => onOpenAdjustStock?.()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-xs cursor-pointer active:scale-95"
              title="Record a stock adjustment"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
              <span>Adjust</span>
            </button>
          )}
        </div>
      </div>

      {/* B2. SEARCH + PERIOD: one row */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 h-[38px] flex items-center gap-2 px-3 rounded-xl bg-white border border-slate-200 shadow-2xs">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Item, person, batch…"
            className="flex-1 min-w-0 bg-transparent text-xs outline-none text-slate-900 placeholder:text-slate-400"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodId)}
          aria-label="Filter period"
          className="h-[38px] px-2.5 rounded-xl bg-white border border-slate-200 text-sm font-bold text-slate-700 shadow-2xs outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer shrink-0"
        >
          <option value="today">Today</option>
          <option value="7d">7 days</option>
          <option value="30d">30 days</option>
          <option value="all">All</option>
        </select>
      </div>

      {/* B3. TWO TABS: "All entries" | "By item" */}
      <div className="grid grid-cols-2 p-1 bg-slate-100 rounded-xl border border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('all_entries')}
          className={`py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === 'all_entries'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          All entries
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('by_item')}
          className={`py-2 px-3 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeTab === 'by_item'
              ? 'bg-white text-slate-900 shadow-2xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          By item
        </button>
      </div>

      {/* ===================================================================== */}
      {/* B4. ALL ENTRIES TAB                                                   */}
      {/* ===================================================================== */}
      {activeTab === 'all_entries' && (
        <div className="space-y-3">
          {/* ONE horizontal scroll row of chips with right fade */}
          <div className="relative">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 pr-6">
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
                      selectedType === opt.id
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {opt.count}
                  </span>
                </button>
              ))}
            </div>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-slate-50 to-transparent"
            />
          </div>

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
              <div className="space-y-3">
                {dayGroups.map((grp) => (
                  <div
                    key={grp.dayKey}
                    className="bg-white rounded-2xl border border-slate-200 overflow-x-clip shadow-2xs"
                  >
                    {/* Sticky Day Header */}
                    <div
                      style={{ top: 'calc(4rem + env(safe-area-inset-top))' }}
                      className="sticky z-10 px-3.5 py-2 rounded-t-2xl bg-slate-100/95 backdrop-blur-xs border-b border-slate-200 flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="font-bold tracking-wide text-slate-700 truncate">
                        {grp.label} · {grp.items.length}{' '}
                        {grp.items.length === 1 ? 'entry' : 'entries'}
                      </span>

                      <span className="font-semibold flex items-center gap-1.5 shrink-0">
                        {grp.inCount > 0 && (
                          <span className="text-emerald-600">{grp.inCount} in</span>
                        )}
                        {grp.inCount > 0 && (grp.outCount > 0 || grp.countAdj > 0) && (
                          <span className="text-slate-400">·</span>
                        )}
                        {grp.outCount > 0 && (
                          <span className="text-rose-600">{grp.outCount} out</span>
                        )}
                        {grp.outCount > 0 && grp.countAdj > 0 && (
                          <span className="text-slate-400">·</span>
                        )}
                        {grp.countAdj > 0 && (
                          <span className="text-indigo-600">
                            {grp.countAdj} {grp.countAdj === 1 ? 'count' : 'counts'}
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Compact Rows (same on mobile and desktop) */}
                    <div className="divide-y divide-slate-100 rounded-b-2xl overflow-hidden">
                      {grp.items.map((mov) => {
                        const cfg = typeConfig[mov.type] || typeConfig.adjustment;
                        const Icon = cfg.icon;
                        const timeInfo = formatDate(mov.timestamp);
                        const signed = getMovementSignedDisplay(mov);
                        const detailNote = mov.reason || mov.referenceId;

                        return (
                          <button
                            key={mov.id}
                            type="button"
                            onClick={() => setDetailMovement(mov)}
                            className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50/80 active:bg-slate-100/70 transition flex items-center justify-between gap-2.5 cursor-pointer"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <span
                                className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 ${cfg.iconCircle}`}
                              >
                                <Icon className="w-3.5 h-3.5" />
                              </span>

                              <div className="min-w-0 flex-1">
                                <div className="text-xs sm:text-sm font-bold text-slate-900 line-clamp-2 break-words">
                                  {mov.itemName}
                                </div>
                                <div className="text-[11px] text-slate-500 line-clamp-2 break-words mt-0.5">
                                  {mov.performedByName || 'System'}
                                  {detailNote ? ` · ${detailNote}` : ''} · {timeInfo.time}
                                </div>
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div
                                className={`font-mono tabular-nums text-sm font-extrabold ${signed.colorClass}`}
                              >
                                {signed.text}
                              </div>
                              <div className="font-mono tabular-nums text-[10px] text-slate-400">
                                {formatQtyClean(mov.previousQuantity, getItemUnit(mov))} →{' '}
                                {formatQtyClean(mov.newQuantity, getItemUnit(mov))}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Load More Movements */}
              {hasMoreMovements && (
                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={loadMoreMovements}
                    className="px-5 py-2 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition cursor-pointer"
                  >
                    Load More Movements
                  </button>
                </div>
              )}

              {/* Slim dark summary bar under the list */}
              <div className="bg-slate-900 text-slate-100 rounded-2xl px-4 py-2.5 text-xs font-semibold flex items-center justify-center flex-wrap gap-x-2 gap-y-1 font-mono tabular-nums">
                <span>
                  {PERIOD_LABELS[period]} {filteredSummaryCounts.total}
                </span>
                <span className="text-slate-500">·</span>
                <span className="text-emerald-400">In {filteredSummaryCounts.inCount}</span>
                <span className="text-slate-500">·</span>
                <span className="text-rose-400">Out {filteredSummaryCounts.outCount}</span>
                <span className="text-slate-500">·</span>
                <span className="text-indigo-300">Counts {filteredSummaryCounts.adjCount}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* B5. BY ITEM TAB                                                       */}
      {/* ===================================================================== */}
      {activeTab === 'by_item' && (
        <div className="space-y-3">
          {byItemRows.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center space-y-3 shadow-2xs">
              <History className="w-12 h-12 text-slate-300 mx-auto" />
              <h3 className="text-sm font-bold text-slate-800">No stock movements found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {search.trim()
                  ? 'No audit movements match your active search terms or period filter.'
                  : 'Any stock intake, batch run, or inventory count adjustment will automatically appear here.'}
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
              <table className="w-full text-left border-collapse table-fixed">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-2.5 pl-3.5 pr-2">Item</th>
                    <th className="py-2.5 px-1.5 text-right w-16">In</th>
                    <th className="py-2.5 px-1.5 text-right w-16">Out</th>
                    <th className="py-2.5 pl-1.5 pr-3.5 text-right w-20">Now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {byItemRows.map((row) => (
                    <tr
                      key={row.key}
                      onClick={() => {
                        setSearch(row.itemName);
                        setSelectedType('all');
                        setActiveTab('all_entries');
                      }}
                      className="hover:bg-slate-50/80 active:bg-slate-100/70 transition cursor-pointer"
                    >
                      <td className="py-2.5 pl-3.5 pr-2 min-w-0">
                        <div className="font-bold text-slate-900 line-clamp-2 break-words">{row.itemName}</div>
                        <div className="text-[10px] text-slate-400">{row.unit}</div>
                      </td>
                      <td className="py-2.5 px-1.5 text-right font-mono tabular-nums font-semibold text-emerald-600">
                        {row.inTotal > 0 ? `+${formatQtyClean(row.inTotal, row.unit)}` : '—'}
                      </td>
                      <td className="py-2.5 px-1.5 text-right font-mono tabular-nums font-semibold text-rose-600">
                        {row.outTotal > 0 ? `−${formatQtyClean(row.outTotal, row.unit)}` : '—'}
                      </td>
                      <td className="py-2.5 pl-1.5 pr-3 text-right font-mono tabular-nums font-bold text-slate-900">
                        <span className="inline-flex items-center justify-end gap-0.5">
                          <span>
                            {row.currentStock !== null ? formatQtyClean(row.currentStock, row.unit) : '—'}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-center text-[11px] text-slate-400">Based on loaded entries</p>

          {hasMoreMovements && (
            <div className="text-center">
              <button
                type="button"
                onClick={loadMoreMovements}
                className="px-5 py-2 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 transition cursor-pointer"
              >
                Load More Movements
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* B4 DETAIL BOTTOM SHEET                                                */}
      {/* ===================================================================== */}
      {detailMovement && detailCfg && detailSigned && detailTime && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={closeDetailSheet}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-2xl border border-slate-200 shadow-2xl p-5 space-y-4 overscroll-contain max-h-[85vh] overflow-y-auto"
          >
            <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto sm:hidden" />

            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${detailCfg.iconCircle}`}
                >
                  <detailCfg.icon className="w-4 h-4" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-500">{detailCfg.label}</div>
                  <h3 className="text-base font-bold text-slate-900 truncate">
                    {detailMovement.itemName}
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={closeDetailSheet}
                aria-label="Close details"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Quantity</span>
                <span className={`font-mono tabular-nums text-base font-black ${detailSigned.colorClass}`}>
                  {detailSigned.text}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Previous → New</span>
                <span className="font-mono tabular-nums font-bold text-slate-800">
                  {formatQtyClean(detailMovement.previousQuantity, getItemUnit(detailMovement))} →{' '}
                  {formatQtyClean(detailMovement.newQuantity, getItemUnit(detailMovement))} {getItemUnit(detailMovement)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Date &amp; Time</span>
                <span className="font-medium text-slate-800">
                  {formatDateTime(detailMovement.timestamp)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">Recorded By</span>
                <span className="font-medium text-slate-800">
                  {detailMovement.performedByName || 'System'}
                </span>
              </div>
              {detailMovement.reason && (
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-slate-500 block mb-0.5">Reason</span>
                  <span className="font-medium text-slate-800 break-words">
                    {detailMovement.reason}
                  </span>
                </div>
              )}
              {detailMovement.referenceId && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-500">Reference</span>
                  <span className="font-mono text-slate-700">{detailMovement.referenceId}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={closeDetailSheet}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
              >
                Close
              </button>
              {permissions.canAdjustStock && detailMatchedItem && (
                <button
                  type="button"
                  onClick={() => {
                    const target = detailMatchedItem;
                    sheetHistoryPushedRef.current = false;
                    setDetailMovement(null);
                    onOpenAdjustStock?.(target);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition cursor-pointer"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Adjust stock</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
