import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  History,
  ArrowDownRight,
  ArrowUpRight,
  CookingPot,
  Sparkles,
  ClipboardCheck,
  Trash2,
  Search,
  Download,
  SlidersHorizontal,
  Edit2,
  Boxes,
  AlertTriangle,
  Clock,
  User,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  Package,
  Layers,
  DollarSign,
  MapPin,
  Truck,
  FileSpreadsheet,
  Lock,
  X,
} from 'lucide-react';
import { InventoryItem, StockMovement, StockMovementType } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { downloadExcelFile, downloadCSVFile } from '../utils/fileDownload';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';

interface ProductDetailHistoryViewProps {
  item: InventoryItem;
  onBack: () => void;
  onOpenAdjustStock: (item: InventoryItem) => void;
  onOpenEditItem: (item: InventoryItem) => void;
  onOpenProduce?: (item?: InventoryItem) => void;
  backLabel?: string;
}

export const ProductDetailHistoryView: React.FC<ProductDetailHistoryViewProps> = ({
  item,
  onBack,
  onOpenAdjustStock,
  onOpenEditItem,
  onOpenProduce,
  backLabel = 'Inventory Master',
}) => {
  const { recipes, deleteItem } = useInventory();
  const { permissions } = useAuth();

  const [rawItemMovements, setRawItemMovements] = useState<StockMovement[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Load that item's own movements (where itemId == the item, sorted in the app so no extra index is needed)
  useEffect(() => {
    if (!item?.id) return;
    const q = query(collection(db, 'movements'), where('itemId', '==', item.id));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: StockMovement[] = [];
        snapshot.forEach((d) => {
          list.push(d.data() as StockMovement);
        });
        setRawItemMovements(list);
      },
      (err) => {
        console.warn('Item movements query error:', err.message);
      }
    );
    return () => unsubscribe();
  }, [item?.id]);

  const blockingRecipes = useMemo(() => {
    return recipes.filter(
      (r) => r.finishedItemId === item.id || r.ingredients.some((ing) => ing.rawItemId === item.id)
    );
  }, [item.id, recipes]);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Swipe Right Gesture to Go Back
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [swipeProgress, setSwipeProgress] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now(),
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.touches.length !== 1) return;
    const deltaX = e.touches[0].clientX - touchStartRef.current.x;
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;

    if (deltaX > 15 && Math.abs(deltaY) < deltaX * 0.7) {
      setSwipeProgress(Math.min(deltaX, 80));
    } else if (deltaX <= 0) {
      setSwipeProgress(0);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touchEnd = e.changedTouches[0];
    const deltaX = touchEnd.clientX - touchStartRef.current.x;
    const deltaY = touchEnd.clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;
    const startX = touchStartRef.current.x;

    touchStartRef.current = null;
    setSwipeProgress(0);

    // 1. Edge swipe: started on the left portion (startX <= 90) and swiped right > 45px
    // 2. Clear horizontal swipe: deltaX > 75px, mostly horizontal, under 600ms
    const isEdgeSwipe = startX <= 90 && deltaX > 45 && Math.abs(deltaY) < 65;
    const isHorizontalSwipe = deltaX > 75 && Math.abs(deltaY) < deltaX * 0.5 && elapsed < 600;

    if (isEdgeSwipe || isHorizontalSwipe) {
      onBack();
    }
  };

  const handleTouchCancel = () => {
    touchStartRef.current = null;
    setSwipeProgress(0);
  };

  const handleDelete = async () => {
    if (blockingRecipes.length > 0) {
      setDeleteError(`Cannot delete item. It is used in ${blockingRecipes.length} recipe(s): ${blockingRecipes.map((r) => r.name).join(', ')}.`);
      return;
    }
    setIsDeleting(true);
    try {
      await deleteItem(item.id);
      onBack();
    } catch (err: any) {
      console.error('Failed to delete item:', err);
      setDeleteError(err?.message || 'Failed to delete item');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Filter movements belonging to this item
  const itemMovements = useMemo(() => {
    return rawItemMovements
      .filter((m) => {
        const matchesId = m.itemId === item.id;
        const matchesName = m.itemName && m.itemName.toLowerCase() === item.name.toLowerCase();
        return matchesId || matchesName;
      })
      .sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return sortOrder === 'desc' ? timeB - timeA : timeA - timeB;
      });
  }, [item, rawItemMovements, sortOrder]);

  // Search & Type filtered list
  const filteredMovements = useMemo(() => {
    return itemMovements.filter((m) => {
      if (typeFilter !== 'all') {
        if (typeFilter === 'in_all') {
          if (m.type !== 'in' && m.type !== 'production_yield') return false;
        } else if (typeFilter === 'out_all') {
          if (m.type !== 'out' && m.type !== 'production_consume') return false;
        } else if (m.type !== typeFilter) {
          return false;
        }
      }

      if (search.trim()) {
        const query = search.toLowerCase();
        const matchesReason = m.reason && m.reason.toLowerCase().includes(query);
        const matchesUser = m.performedByName && m.performedByName.toLowerCase().includes(query);
        const matchesRef = m.referenceId && m.referenceId.toLowerCase().includes(query);
        const matchesType = m.type.toLowerCase().includes(query);
        if (!matchesReason && !matchesUser && !matchesRef && !matchesType) return false;
      }

      return true;
    });
  }, [itemMovements, search, typeFilter]);

  // Aggregate metrics summary for this product
  const metrics = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let totalWaste = 0;
    let totalAdjustments = 0;

    itemMovements.forEach((m) => {
      if (m.type === 'in' || m.type === 'production_yield') {
        totalIn += m.quantity;
      } else if (m.type === 'out' || m.type === 'production_consume') {
        totalOut += m.quantity;
      } else if (m.type === 'waste') {
        totalWaste += m.quantity;
      } else if (m.type === 'adjustment') {
        totalAdjustments += 1;
      }
    });

    const totalStockValue = item.quantity * item.unitCost;
    const marginPct =
      item.sellingPrice > 0
        ? (((item.sellingPrice - item.unitCost) / item.sellingPrice) * 100).toFixed(1)
        : null;

    return {
      totalIn,
      totalOut,
      totalWaste,
      totalAdjustments,
      totalStockValue,
      marginPct,
      count: itemMovements.length,
    };
  }, [itemMovements, item]);

  const isLow = item.quantity <= item.minStock;
  const isOut = item.quantity <= 0;

  const typeConfig: Record<
    StockMovementType,
    { label: string; icon: React.ElementType; color: string; prefix: string }
  > = {
    in: {
      label: 'Restock In',
      icon: ArrowDownRight,
      color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      prefix: '+',
    },
    out: {
      label: 'Stock Out',
      icon: ArrowUpRight,
      color: 'text-amber-700 bg-amber-50 border-amber-200',
      prefix: '-',
    },
    production_consume: {
      label: 'Recipe Consumed',
      icon: CookingPot,
      color: 'text-rose-700 bg-rose-50 border-rose-200',
      prefix: '-',
    },
    production_yield: {
      label: 'Production Yield',
      icon: Sparkles,
      color: 'text-indigo-700 bg-indigo-50 border-indigo-200',
      prefix: '+',
    },
    adjustment: {
      label: 'Audit Count',
      icon: ClipboardCheck,
      color: 'text-blue-700 bg-blue-50 border-blue-200',
      prefix: '±',
    },
    waste: {
      label: 'Waste / Spoilage',
      icon: Trash2,
      color: 'text-red-700 bg-red-50 border-red-200',
      prefix: '-',
    },
  };

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return {
        date: d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        time: d.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        relative: getRelativeTime(d),
      };
    } catch {
      return { date: isoString, time: '', relative: '' };
    }
  };

  const getRelativeTime = (date: Date) => {
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return 'Yesterday';
    if (days < 30) return `${days}d ago`;
    return '';
  };

  // Calculate In Quantity, Out Quantity, and Closing Balance for each movement (Bank Statement Ledger)
  const getEntryInAndOut = (movement: StockMovement) => {
    let inQty: number | null = null;
    let outQty: number | null = null;

    if (movement.type === 'in' || movement.type === 'production_yield') {
      inQty = movement.quantity;
    } else if (
      movement.type === 'out' ||
      movement.type === 'production_consume' ||
      movement.type === 'waste'
    ) {
      outQty = movement.quantity;
    } else if (movement.type === 'adjustment') {
      const diff = movement.newQuantity - movement.previousQuantity;
      if (diff > 0) {
        inQty = diff;
      } else if (diff < 0) {
        outQty = Math.abs(diff);
      } else {
        inQty = 0;
      }
    }

    return { inQty, outQty };
  };

  // Period totals for filtered statement with full mathematical reconciliation
  const { periodTotalIn, periodTotalOut, periodOpening, periodClosing } = useMemo(() => {
    let inSum = 0;
    let outSum = 0;
    filteredMovements.forEach((m) => {
      const { inQty, outQty } = getEntryInAndOut(m);
      if (inQty) inSum += inQty;
      if (outQty) outSum += outQty;
    });

    const closing = Number((item.quantity).toFixed(3));
    const opening = Number((closing - inSum + outSum).toFixed(3));

    return {
      periodTotalIn: inSum,
      periodTotalOut: outSum,
      periodOpening: opening,
      periodClosing: closing,
    };
  }, [filteredMovements, item.quantity]);

  const exportProductExcel = () => {
    const excelRows = filteredMovements.map((m) => {
      const { inQty, outQty } = getEntryInAndOut(m);
      const timeInfo = formatDate(m.timestamp);
      const conf = typeConfig[m.type];
      return {
        'Date': timeInfo.date,
        'Time': timeInfo.time,
        'Item Name': m.itemName,
        'SKU': item.sku || '',
        'Entry Type': conf ? conf.label : m.type,
        'Particulars / Reason': m.reason || '',
        'In Quantity': inQty !== null ? inQty : '',
        'Out Quantity': outQty !== null ? outQty : '',
        'Closing Balance': m.newQuantity,
        'Unit': item.unit,
        'Reference ID': m.referenceId || '',
        'Logged By': m.performedByName || '',
      };
    });

    const safeName = (item.name || 'product').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadExcelFile(
      excelRows,
      `statement_${safeName}_${Date.now()}.xlsx`,
      'Stock Statement'
    );
  };

  const exportProductCSV = () => {
    const headers = [
      'Date',
      'Time',
      'Item Name',
      'SKU',
      'Entry Type',
      'Particulars / Reason',
      'In Quantity',
      'Out Quantity',
      'Closing Quantity',
      'Unit',
      'Reference ID',
      'Logged By',
    ];

    const rows = filteredMovements.map((m) => {
      const { inQty, outQty } = getEntryInAndOut(m);
      const timeInfo = formatDate(m.timestamp);
      const conf = typeConfig[m.type];
      return [
        `"${timeInfo.date}"`,
        `"${timeInfo.time}"`,
        `"${m.itemName.replace(/"/g, '""')}"`,
        item.sku,
        `"${conf ? conf.label : m.type}"`,
        `"${(m.reason || '').replace(/"/g, '""')}"`,
        inQty !== null ? inQty : '',
        outQty !== null ? outQty : '',
        m.newQuantity,
        item.unit,
        `"${(m.referenceId || '').replace(/"/g, '""')}"`,
        `"${(m.performedByName || '').replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    downloadCSVFile(csvContent, `statement_${item.sku || 'item'}_${Date.now()}.csv`);
  };

  const classificationLabel =
    item.type === 'raw_material'
      ? 'Raw Material'
      : item.type === 'semi_finished'
      ? 'Semi-Finished Good'
      : item.type === 'both'
      ? 'Composite Item'
      : 'Finished Good';

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      className="space-y-6 w-full animate-in fade-in duration-150 relative"
    >
      {/* Swipe Back Visual Indicator */}
      {swipeProgress > 20 && (
        <div
          className="fixed left-3 top-1/2 -translate-y-1/2 z-50 bg-slate-900/90 text-white p-3 rounded-full shadow-2xl pointer-events-none transition-transform flex items-center justify-center animate-in fade-in"
          style={{
            transform: `translate(${Math.min(swipeProgress * 0.35, 20)}px, -50%)`,
            opacity: Math.min(swipeProgress / 50, 1),
          }}
        >
          <ArrowLeft className="w-5 h-5 text-white" />
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) setShowDeleteConfirm(false);
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
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Delete Product?</h3>
              {blockingRecipes.length > 0 ? (
                <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1.5 text-xs text-amber-800">
                  <div className="font-semibold flex items-center gap-1.5 text-amber-900">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    Cannot delete this item
                  </div>
                  <p>
                    This item is used in <strong className="font-semibold">{blockingRecipes.length}</strong> recipe(s). Remove or replace it in these recipes before deleting:
                  </p>
                  <ul className="list-disc list-inside font-medium text-amber-900 pl-1">
                    {blockingRecipes.map((r) => (
                      <li key={r.id}>{r.name}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs text-slate-500 mt-1">
                  Are you sure you want to delete <strong className="text-slate-800">{item.name}</strong> ({item.sku})? This will remove the item master record from inventory.
                </p>
              )}
              {deleteError && (
                <p className="mt-2 text-xs text-rose-600 font-medium bg-rose-50 border border-rose-200 rounded-lg p-2">
                  {deleteError}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteError(null);
                }}
                disabled={isDeleting}
                className="flex-1 py-2 text-xs font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting || blockingRecipes.length > 0}
                className="flex-1 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white transition shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isDeleting ? 'Deleting...' : 'Delete Product'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1. Breadcrumb Navigation (hidden on mobile, accessible on desktop) */}
      <div className="hidden sm:flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
          <button
            type="button"
            onClick={onBack}
            className="text-slate-600 font-semibold hover:text-indigo-600 hover:underline transition cursor-pointer flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-slate-500" />
            <span>{backLabel}</span>
          </button>
          <span>/</span>
          <span className="text-slate-700 font-semibold truncate max-w-[200px]">{item.name}</span>
          <span>/</span>
          <span className="text-indigo-600 font-bold">Transaction History</span>
        </div>
      </div>

      {/* 2. Compact Product Hero Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-2xs">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* 1. Item Name */}
            <h1 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight break-words">
              {item.name}
            </h1>

            {/* 2. SKU & Metadata */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500 mt-0.5">
              <span className="font-mono text-slate-800 font-bold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                SKU: {item.sku}
              </span>
              {item.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-400" />
                  <span><strong className="text-slate-700">{item.location}</strong></span>
                </span>
              )}
              {item.supplier && (
                <span className="inline-flex items-center gap-1">
                  <Truck className="w-3 h-3 text-slate-400" />
                  <span><strong className="text-slate-700">{item.supplier}</strong></span>
                </span>
              )}
            </div>

            {/* 3. Items Class & Stock Status Alert */}
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                  item.type === 'raw_material'
                    ? 'bg-amber-50 text-amber-800 border border-amber-200'
                    : item.type === 'semi_finished'
                    ? 'bg-purple-50 text-purple-800 border border-purple-200'
                    : item.type === 'both'
                    ? 'bg-blue-50 text-blue-800 border border-blue-200'
                    : 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                }`}
              >
                {classificationLabel}
              </span>

              {isOut ? (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-300">
                  Out of Stock
                </span>
              ) : isLow ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">
                  <AlertTriangle className="w-3 h-3" />
                  <span>Low Stock Alert</span>
                </span>
              ) : (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Healthy Stock
                </span>
              )}
            </div>
          </div>

          {/* Current Stock Snapshot Block (Compact Right Side) */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 sm:p-3 flex flex-col justify-center text-right shrink-0 min-w-[105px] sm:min-w-[125px]">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              On-Hand
            </div>
            <div className="flex items-baseline justify-end gap-1 mt-0.5">
              <span
                className={`text-xl sm:text-2xl font-black ${
                  isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'
                }`}
              >
                {item.quantity.toFixed(1)}
              </span>
              <span className="text-xs font-bold text-slate-500">{item.unit}</span>
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Min: {item.minStock} {item.unit}
            </div>
          </div>
        </div>

        {item.notes && (
          <p className="text-[11px] text-slate-500 italic bg-slate-50 p-2 rounded-lg border border-slate-100 mt-2">
            "{item.notes}"
          </p>
        )}
      </div>

      {/* 3. Compact Performance & Stock Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-2.5">
        {/* 1. Total Received */}
        <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center justify-between">
            <span>Total Received</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          </div>
          <div className="text-base sm:text-lg font-bold text-emerald-700 mt-1 flex items-baseline gap-1">
            <span>+{metrics.totalIn.toFixed(1)}</span>
            <span className="text-xs font-normal text-slate-500">{item.unit}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">Restocks & Inflow</div>
        </div>

        {/* 2. Total Dispatched */}
        <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-amber-700 uppercase tracking-wider flex items-center justify-between">
            <span>Total Dispatched</span>
            <TrendingDown className="w-3.5 h-3.5 text-amber-600 shrink-0" />
          </div>
          <div className="text-base sm:text-lg font-bold text-amber-700 mt-1 flex items-baseline gap-1">
            <span>-{metrics.totalOut.toFixed(1)}</span>
            <span className="text-xs font-normal text-slate-500">{item.unit}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">Sales & Usage</div>
        </div>

        {/* 3. Shrinkage / Waste */}
        <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center justify-between">
            <span>Shrinkage / Waste</span>
            <Trash2 className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          </div>
          <div className="text-base sm:text-lg font-bold text-rose-600 mt-1 flex items-baseline gap-1">
            <span>{metrics.totalWaste > 0 ? `-${metrics.totalWaste.toFixed(1)}` : '0.0'}</span>
            <span className="text-xs font-normal text-slate-500">{item.unit}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">Spoilage & Loss</div>
        </div>

        {/* 4. On-Hand Stock */}
        <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center justify-between">
            <span>On-Hand Stock</span>
            <Package className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </div>
          <div className="text-base sm:text-lg font-bold text-slate-900 mt-1 flex items-baseline gap-1">
            <span className={isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-slate-900'}>
              {item.quantity.toFixed(1)}
            </span>
            <span className="text-xs font-normal text-slate-500">{item.unit}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
            Min: {item.minStock} {item.unit}
          </div>
        </div>

        {/* 5. Total Asset Value */}
        <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center justify-between">
            <span>Total Asset Value</span>
            <DollarSign className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          </div>
          <div className="text-base sm:text-lg font-bold text-slate-900 mt-1 truncate">
            {permissions.canViewTotalAssetValue ? (
              `₹${metrics.totalStockValue.toFixed(2)}`
            ) : (
              <span className="text-slate-400 font-mono tracking-widest text-sm inline-flex items-center gap-1">
                <Lock className="w-3 h-3 text-slate-400" /> ••••••
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
            {permissions.canViewCostPerUnit ? (
              `@ ₹${item.unitCost.toFixed(2)} / ${item.unit}`
            ) : (
              'Unit cost masked'
            )}
          </div>
        </div>

        {/* 6. Cost Per Unit / Margin */}
        <div className="bg-white p-2.5 sm:p-3 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between">
          <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider flex items-center justify-between">
            <span>{item.sellingPrice > 0 ? 'Retail / Margin' : 'Cost Per Unit'}</span>
            <Boxes className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
          </div>
          <div className="text-base sm:text-lg font-bold text-slate-900 mt-1 truncate">
            {item.sellingPrice > 0 ? (
              `₹${item.sellingPrice.toFixed(2)}`
            ) : permissions.canViewCostPerUnit ? (
              `₹${item.unitCost.toFixed(2)}`
            ) : (
              <span className="text-slate-400 font-mono tracking-widest text-sm inline-flex items-center gap-1">
                <Lock className="w-3 h-3 text-slate-400" /> ••••••
              </span>
            )}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
            {item.sellingPrice > 0 ? (
              permissions.canViewFinances && permissions.canViewCostPerUnit && metrics.marginPct ? (
                <span className="font-semibold text-emerald-600">{metrics.marginPct}% Margin</span>
              ) : permissions.canViewCostPerUnit ? (
                `Cost: ₹${item.unitCost.toFixed(2)}`
              ) : (
                'Cost hidden'
              )
            ) : permissions.canViewCostPerUnit ? (
              `Cost: ₹${item.unitCost.toFixed(2)}`
            ) : (
              'Cost per unit restricted'
            )}
          </div>
        </div>
      </div>

      {/* 4. Action Buttons Bar (Below Total Asset Value & Cost Per Unit) */}
      <div className="flex flex-wrap items-center gap-2">
        {permissions.canAdjustStock && (
          <button
            type="button"
            onClick={() => onOpenAdjustStock(item)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 transition shadow-2xs cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Adjust Stock</span>
          </button>
        )}

        {permissions.canEditItems && (
          <button
            type="button"
            onClick={() => onOpenEditItem(item)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition shadow-2xs cursor-pointer"
          >
            <Edit2 className="w-3.5 h-3.5 text-slate-500" />
            <span>Edit Item</span>
          </button>
        )}

        {permissions.canDeleteItems && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 bg-white hover:bg-rose-50 border border-rose-200 transition shadow-2xs cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        )}

        {permissions.canExportExcel && (
          <button
            type="button"
            onClick={exportProductExcel}
            disabled={filteredMovements.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 transition shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Download stock statement as Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Export Excel</span>
          </button>
        )}
      </div>

      {/* 4. Stock Statement Ledger: Header, Search & Filter Controls */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 sm:p-4 shadow-2xs space-y-3">
        {/* Header Row: Title & Count */}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>Stock Statement</span>
          </h2>
          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
            {filteredMovements.length} transactions
          </span>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {/* Search Input */}
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search particulars, user, batch ID..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            {/* Type Filter */}
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer flex-1 sm:flex-initial"
            >
              <option value="all">All Entries ({itemMovements.length})</option>
              <option value="in_all">Inflow (+ In & Yields)</option>
              <option value="out_all">Outflow (- Out & Consumed)</option>
              <option value="adjustment">Audits / Adjustments</option>
              <option value="waste">Waste / Spoilage</option>
            </select>

            {/* Sort direction */}
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as 'desc' | 'asc')}
              className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer flex-1 sm:flex-initial"
            >
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>

            {/* CSV Statement Export */}
            <button
              type="button"
              onClick={exportProductCSV}
              disabled={filteredMovements.length === 0}
              className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition shadow-2xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* 5. Bank Statement Table (Date, Entry Type, In Quantity, Out Quantity, Closing Quantity) */}
        {filteredMovements.length === 0 ? (
          <div className="p-12 text-center space-y-3 bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
            <Boxes className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-800">
              {itemMovements.length === 0
                ? 'No statement entries recorded yet for this product'
                : 'No transactions match your search filter'}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {itemMovements.length === 0
                ? `Every restock, production run, recipe consumption, or stock audit for ${item.name} will appear on this statement ledger.`
                : 'Try clearing your search query or switching your movement type filter.'}
            </p>
            {itemMovements.length === 0 && permissions.canAdjustStock && (
              <button
                type="button"
                onClick={() => onOpenAdjustStock(item)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 transition shadow-2xs cursor-pointer"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Log First Stock Adjustment</span>
              </button>
            )}
          </div>
        ) : (
          <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-2xs bg-white">
            {/* Desktop Statement Ledger Header */}
            <div className="hidden lg:grid grid-cols-12 gap-3 px-5 py-3.5 bg-slate-900 text-white text-[11px] font-bold uppercase tracking-wider items-center">
              <div className="col-span-2">Date & Time</div>
              <div className="col-span-4">Entry Type & Particulars</div>
              <div className="col-span-2 text-right">In Quantity</div>
              <div className="col-span-2 text-right">Out Quantity</div>
              <div className="col-span-2 text-right">Closing Quantity</div>
            </div>

            {/* Desktop Statement Rows */}
            <div className="hidden lg:block divide-y divide-slate-100">
              {filteredMovements.map((movement, idx) => {
                const conf = typeConfig[movement.type] || {
                  label: movement.type,
                  icon: Package,
                  color: 'text-slate-700 bg-slate-100 border-slate-200',
                  prefix: '',
                };
                const IconComponent = conf.icon;
                const timeInfo = formatDate(movement.timestamp);
                const { inQty, outQty } = getEntryInAndOut(movement);

                return (
                  <div
                    key={movement.id || idx}
                    className="grid grid-cols-12 gap-3 px-5 py-3.5 hover:bg-slate-50/80 transition items-center text-xs"
                  >
                    {/* 1. Date */}
                    <div className="col-span-2">
                      <div className="font-bold text-slate-900">{timeInfo.date}</div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {timeInfo.time}
                      </div>
                      {timeInfo.relative && (
                        <span className="inline-block text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded mt-1">
                          {timeInfo.relative}
                        </span>
                      )}
                    </div>

                    {/* 2. Entry Type & Particulars */}
                    <div className="col-span-4 min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${conf.color}`}
                        >
                          <IconComponent className="w-3 h-3" />
                          <span>{conf.label}</span>
                        </span>

                        {movement.referenceId && (
                          <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                            Ref #{movement.referenceId}
                          </span>
                        )}
                      </div>

                      {/* Particulars / Narration */}
                      <div className="text-xs font-semibold text-slate-800 mt-1 truncate">
                        {movement.reason || 'Inventory stock movement'}
                      </div>

                      {/* User attribution */}
                      {movement.performedByName && (
                        <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>By {movement.performedByName}</span>
                        </div>
                      )}
                    </div>

                    {/* 3. In Quantity (Credit) */}
                    <div className="col-span-2 text-right">
                      {inQty !== null ? (
                        <div className="inline-block bg-emerald-50 text-emerald-800 border border-emerald-200/70 px-2.5 py-1 rounded-lg">
                          <span className="font-mono font-black text-sm">
                            +{inQty.toFixed(1)}
                          </span>{' '}
                          <span className="text-[10px] font-semibold text-emerald-700">
                            {item.unit}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-300 font-mono text-sm">—</span>
                      )}
                    </div>

                    {/* 4. Out Quantity (Debit) */}
                    <div className="col-span-2 text-right">
                      {outQty !== null ? (
                        <div className="inline-block bg-rose-50 text-rose-800 border border-rose-200/70 px-2.5 py-1 rounded-lg">
                          <span className="font-mono font-black text-sm">
                            -{outQty.toFixed(1)}
                          </span>{' '}
                          <span className="text-[10px] font-semibold text-rose-700">
                            {item.unit}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-300 font-mono text-sm">—</span>
                      )}
                    </div>

                    {/* 5. Closing Quantity (Balance) */}
                    <div className="col-span-2 text-right">
                      <div className="font-mono font-black text-slate-900 text-sm">
                        {movement.newQuantity.toFixed(1)}{' '}
                        <span className="text-[10px] font-bold text-slate-500">
                          {item.unit}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                        prev: {movement.previousQuantity.toFixed(1)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Statement Totals Footer */}
            <div className="hidden lg:grid grid-cols-12 gap-3 px-5 py-4 bg-slate-50 border-t-2 border-slate-200 text-xs font-bold text-slate-800 items-center">
              <div className="col-span-4 space-y-1">
                <span className="uppercase tracking-wider font-extrabold text-slate-700 block">
                  Statement Reconciled Summary
                </span>
                <span className="text-[11px] font-normal text-slate-500 block">
                  Opening ({periodOpening.toFixed(1)}) + In ({periodTotalIn.toFixed(1)}) - Out ({periodTotalOut.toFixed(1)}) = {periodClosing.toFixed(1)} {item.unit}
                </span>
              </div>

              <div className="col-span-2 text-right">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Opening Balance
                </div>
                <div className="font-mono font-bold text-slate-700 text-sm">
                  {periodOpening.toFixed(1)}{' '}
                  <span className="text-[10px]">{item.unit}</span>
                </div>
              </div>

              <div className="col-span-2 text-right">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Total In (+)
                </div>
                <div className="font-mono font-black text-emerald-700 text-sm">
                  +{periodTotalIn.toFixed(1)}{' '}
                  <span className="text-[10px]">{item.unit}</span>
                </div>
              </div>

              <div className="col-span-2 text-right">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Total Out (-)
                </div>
                <div className="font-mono font-black text-rose-700 text-sm">
                  -{periodTotalOut.toFixed(1)}{' '}
                  <span className="text-[10px]">{item.unit}</span>
                </div>
              </div>

              <div className="col-span-2 text-right">
                <div className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">
                  Closing Balance (=)
                </div>
                <div className="font-mono font-black text-slate-900 text-base">
                  {periodClosing.toFixed(1)}{' '}
                  <span className="text-[10px]">{item.unit}</span>
                </div>
              </div>
            </div>

            {/* Mobile Responsive Passbook Cards (Screens < lg) */}
            <div className="lg:hidden divide-y divide-slate-100">
              {filteredMovements.map((movement, idx) => {
                const conf = typeConfig[movement.type] || {
                  label: movement.type,
                  icon: Package,
                  color: 'text-slate-700 bg-slate-100 border-slate-200',
                  prefix: '',
                };
                const IconComponent = conf.icon;
                const timeInfo = formatDate(movement.timestamp);
                const { inQty, outQty } = getEntryInAndOut(movement);

                return (
                  <div key={movement.id || idx} className="p-4 space-y-3">
                    {/* Header: Date + Entry Type */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-bold text-slate-900">
                        {timeInfo.date}{' '}
                        <span className="text-[11px] font-normal text-slate-500">
                          • {timeInfo.time}
                        </span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md border ${conf.color}`}
                      >
                        <IconComponent className="w-3 h-3" />
                        <span>{conf.label}</span>
                      </span>
                    </div>

                    {/* Particulars & Narration */}
                    <div>
                      <div className="text-xs font-semibold text-slate-800">
                        {movement.reason || 'Inventory stock movement'}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                        {movement.performedByName && <span>By {movement.performedByName}</span>}
                        {movement.referenceId && (
                          <span className="font-mono">Ref #{movement.referenceId}</span>
                        )}
                      </div>
                    </div>

                    {/* Passbook Ledger 3-Column Strip (In Qty, Out Qty, Closing Qty) */}
                    <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/70 text-center">
                      {/* In */}
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                          In Quantity
                        </div>
                        <div className="font-mono font-bold text-xs mt-0.5 text-emerald-700">
                          {inQty !== null ? `+${inQty.toFixed(1)} ${item.unit}` : '—'}
                        </div>
                      </div>

                      {/* Out */}
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                          Out Quantity
                        </div>
                        <div className="font-mono font-bold text-xs mt-0.5 text-rose-700">
                          {outQty !== null ? `-${outQty.toFixed(1)} ${item.unit}` : '—'}
                        </div>
                      </div>

                      {/* Closing Balance */}
                      <div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                          Closing Balance
                        </div>
                        <div className="font-mono font-extrabold text-xs mt-0.5 text-slate-900">
                          {movement.newQuantity.toFixed(1)} {item.unit}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Mobile Summary Box */}
              <div className="p-3.5 sm:p-4 bg-slate-50 border-t border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Statement Reconciled Summary
                  </div>
                  <span className="text-[10px] font-semibold text-slate-500">
                    {filteredMovements.length} records
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-2xs">
                    <span className="text-[9px] text-slate-400 uppercase font-bold block">
                      Opening Stock
                    </span>
                    <span className="font-mono font-bold text-slate-700 text-xs">
                      {periodOpening.toFixed(1)} {item.unit}
                    </span>
                  </div>

                  <div className="bg-white p-2 rounded-xl border border-emerald-200 bg-emerald-50/30 shadow-2xs">
                    <span className="text-[9px] text-emerald-600 uppercase font-bold block">
                      Total In (+)
                    </span>
                    <span className="font-mono font-extrabold text-emerald-700 text-xs">
                      +{periodTotalIn.toFixed(1)} {item.unit}
                    </span>
                  </div>

                  <div className="bg-white p-2 rounded-xl border border-rose-200 bg-rose-50/30 shadow-2xs">
                    <span className="text-[9px] text-rose-600 uppercase font-bold block">
                      Total Out (-)
                    </span>
                    <span className="font-mono font-extrabold text-rose-700 text-xs">
                      -{periodTotalOut.toFixed(1)} {item.unit}
                    </span>
                  </div>

                  <div className="bg-white p-2 rounded-xl border border-slate-300 bg-slate-100/50 shadow-2xs">
                    <span className="text-[9px] text-slate-600 uppercase font-black block">
                      Closing Balance (=)
                    </span>
                    <span className="font-mono font-black text-slate-900 text-xs sm:text-sm">
                      {periodClosing.toFixed(1)} {item.unit}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] font-mono text-slate-600 bg-white p-2 rounded-lg border border-slate-200/80 text-center">
                  <span className="text-slate-500">Reconciled:</span>{' '}
                  <strong className="text-slate-800">{periodOpening.toFixed(1)}</strong>{' '}
                  <span className="text-emerald-700 font-bold">+ {periodTotalIn.toFixed(1)}</span>{' '}
                  <span className="text-rose-700 font-bold">- {periodTotalOut.toFixed(1)}</span>{' '}
                  ={' '}
                  <strong className="text-indigo-900 font-black">{periodClosing.toFixed(1)} {item.unit}</strong>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
