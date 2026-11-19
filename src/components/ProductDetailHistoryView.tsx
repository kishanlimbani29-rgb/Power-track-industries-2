import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Camera,
  Loader2,
  X,
  ChevronDown,
  MoreVertical,
  Search,
  FileSpreadsheet,
  Download,
  Trash2,
  Edit2,
  Clock,
  User,
  MapPin,
  Truck,
  Info,
  Calendar,
  ChevronRight,
  Image as ImageIcon,
  AlertTriangle,
  SlidersHorizontal,
  Package,
} from 'lucide-react';
import { InventoryItem, StockMovement, StockMovementType } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { downloadExcelFile, downloadCSVFile } from '../utils/fileDownload';
import { resizeProductPhoto } from '../utils/photoResizer';
import { formatQty, formatInrAmount, formatDateTime, formatShortDate } from '../utils/numberFormat';
import { canChangeEntry, formatLockReason } from '../utils/changeWindow';
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

type EntryTypeFilter =
  | 'all'
  | 'in'
  | 'out'
  | 'production'
  | 'purchase'
  | 'sales'
  | 'adjustment'
  | 'returns';

type PeriodFilter =
  | 'today'
  | '7d'
  | '30d'
  | 'this_month'
  | 'last_month'
  | 'all'
  | 'custom';

export const ProductDetailHistoryView: React.FC<ProductDetailHistoryViewProps> = ({
  item,
  onBack,
  onOpenAdjustStock,
  onOpenEditItem,
  backLabel = 'Inventory',
}) => {
  const { permissions, role, realUserUid } = useAuth();
  const { deleteItem, getFullItemPhoto, saveItemPhoto, removeItemPhoto, recipes, pendingMovements } = useInventory();
  const { removeManualMovement, showActionToast } = useInventory();
  const [removeTarget, setRemoveTarget] = useState<StockMovement | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  // Only manual Adjust-stock entries (no batch / sale / purchase / audit reference) can be removed,
  // and only by Inventory Full roles.
  const canRemoveManualEntry = (mv: StockMovement): boolean =>
    Boolean(
      permissions.canDeleteItems &&
        permissions.canAdjustStock &&
        !(mv as any).pending &&
        ['in', 'out', 'waste', 'adjustment'].includes(mv.type) &&
        !(mv.referenceId && String(mv.referenceId).trim())
    );

  // Raw movements for this item loaded from Firestore
  const [rawItemMovements, setRawItemMovements] = useState<StockMovement[]>([]);

  // Filter states
  const [typeFilter, setTypeFilter] = useState<EntryTypeFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('30d');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchBar, setShowSearchBar] = useState(false);

  // Pagination (load 50 at a time)
  const [displayLimit, setDisplayLimit] = useState(50);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Modal / Drawer states
  const [isPhotoViewerOpen, setIsPhotoViewerOpen] = useState(false);
  const [fullPhotoUrl, setFullPhotoUrl] = useState<string | null>(null);
  const [isLoadingFullPhoto, setIsLoadingFullPhoto] = useState(false);
  const [showPhotoActionSheet, setShowPhotoActionSheet] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showItemDetailsSheet, setShowItemDetailsSheet] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showCustomDateModal, setShowCustomDateModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  // Load item's movements in real time
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

  // Click outside to close action menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target as Node)) {
        setShowActionMenu(false);
      }
    };
    if (showActionMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showActionMenu]);

  // Mobile Back Button: Close open sheets/viewers first before navigating back
  const anyModalOpen =
    isPhotoViewerOpen ||
    showItemDetailsSheet ||
    showActionMenu ||
    showDeleteConfirm ||
    showPhotoActionSheet ||
    showCustomDateModal;

  const closeAllModals = useCallback(() => {
    setIsPhotoViewerOpen(false);
    setShowItemDetailsSheet(false);
    setShowActionMenu(false);
    setShowDeleteConfirm(false);
    setShowPhotoActionSheet(false);
    setShowCustomDateModal(false);
  }, []);

  useEffect(() => {
    if (anyModalOpen) {
      window.history.pushState({ modalOpen: true }, '');
    }
  }, [anyModalOpen]);

  useEffect(() => {
    const handlePopState = () => {
      if (anyModalOpen) {
        closeAllModals();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [anyModalOpen, closeAllModals]);

  // Close photo viewer on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeAllModals();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeAllModals]);

  // Recipes blocking deletion
  const blockingRecipes = useMemo(() => {
    return recipes.filter(
      (r) => r.finishedItemId === item.id || r.ingredients.some((ing) => ing.rawItemId === item.id)
    );
  }, [item.id, recipes]);

  // Merge optimistic pending movements for this item with Firestore snapshot movements (dedupe by id)
  const mergedItemMovements = useMemo(() => {
    const pendingForItem = pendingMovements.filter((m) => m.itemId === item.id);
    if (pendingForItem.length === 0) return rawItemMovements;
    const byId = new Map<string, StockMovement>();
    for (const m of rawItemMovements) {
      byId.set(m.id, m);
    }
    for (const pm of pendingForItem) {
      if (!byId.has(pm.id)) {
        byId.set(pm.id, pm);
      }
    }
    return Array.from(byId.values());
  }, [rawItemMovements, pendingMovements, item.id]);

  // Sort chronologically (oldest first) to compute opening balances accurately
  const sortedMovementsAsc = useMemo(() => {
    return [...mergedItemMovements].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [mergedItemMovements]);

  // Date range boundaries for periodFilter
  const periodRange = useMemo(() => {
    const now = new Date();
    let start: Date | null = null;
    let end: Date | null = null;

    if (periodFilter === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (periodFilter === '7d') {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      end = now;
    } else if (periodFilter === '30d') {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      end = now;
    } else if (periodFilter === 'this_month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      end = now;
    } else if (periodFilter === 'last_month') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (periodFilter === 'custom') {
      if (customStartDate) {
        start = new Date(customStartDate + 'T00:00:00');
      }
      if (customEndDate) {
        end = new Date(customEndDate + 'T23:59:59');
      }
    }
    return { start, end };
  }, [periodFilter, customStartDate, customEndDate]);

  // Helpers to calculate IN/OUT for a single movement
  const getEntryInAndOut = (m: StockMovement) => {
    let inQty: number | null = null;
    let outQty: number | null = null;

    if (m.type === 'in' || m.type === 'production_yield') {
      inQty = m.quantity;
    } else if (m.type === 'out' || m.type === 'production_consume' || m.type === 'waste') {
      outQty = m.quantity;
    } else if (m.type === 'adjustment') {
      const diff = m.newQuantity - m.previousQuantity;
      if (diff > 0) inQty = diff;
      else if (diff < 0) outQty = Math.abs(diff);
      else inQty = 0;
    }
    return { inQty, outQty };
  };

  // Filtered movements based on Period, Entry Type, and Search query
  const { filteredMovementsDesc, periodOpening, periodTotalIn, periodTotalOut, periodClosing } =
    useMemo(() => {
      const { start, end } = periodRange;

      // Calculate opening balance prior to period start
      let opening = 0;
      let hasPrior = false;
      for (const m of sortedMovementsAsc) {
        const time = new Date(m.timestamp);
        if (start && time < start) {
          opening = m.newQuantity;
          hasPrior = true;
        } else {
          break;
        }
      }
      if (!hasPrior && sortedMovementsAsc.length > 0 && start) {
        // If the earliest movement is already after start, opening is its previousQuantity
        if (new Date(sortedMovementsAsc[0].timestamp) >= start) {
          opening = sortedMovementsAsc[0].previousQuantity;
        }
      }

      // Filter entries within period
      const inPeriod = sortedMovementsAsc.filter((m) => {
        const time = new Date(m.timestamp);
        if (start && time < start) return false;
        if (end && time > end) return false;
        return true;
      });

      let totalIn = 0;
      let totalOut = 0;
      inPeriod.forEach((m) => {
        const { inQty, outQty } = getEntryInAndOut(m);
        if (inQty) totalIn += inQty;
        if (outQty) totalOut += outQty;
      });

      const closing =
        inPeriod.length > 0 ? inPeriod[inPeriod.length - 1].newQuantity : opening;

      // Now apply type and search filter to displayed list
      const matched = inPeriod.filter((m) => {
        // Type filter
        if (typeFilter === 'in') {
          if (m.type !== 'in' && m.type !== 'production_yield') return false;
        } else if (typeFilter === 'out') {
          if (m.type !== 'out' && m.type !== 'production_consume' && m.type !== 'waste')
            return false;
        } else if (typeFilter === 'production') {
          if (m.type !== 'production_yield' && m.type !== 'production_consume') return false;
        } else if (typeFilter === 'purchase') {
          const isPO =
            m.referenceId?.startsWith('PO-') ||
            (m.reason || '').toLowerCase().includes('purchase') ||
            (m.reason || '').toLowerCase().includes('supplier');
          if (!isPO) return false;
        } else if (typeFilter === 'sales') {
          const isSale =
            m.referenceId?.startsWith('INV-') ||
            (m.reason || '').toLowerCase().includes('sale') ||
            (m.reason || '').toLowerCase().includes('customer');
          if (!isSale) return false;
        } else if (typeFilter === 'adjustment') {
          if (m.type !== 'adjustment') return false;
        } else if (typeFilter === 'returns') {
          const isRet =
            m.referenceId?.startsWith('SR-') ||
            m.referenceId?.startsWith('PR-') ||
            (m.reason || '').toLowerCase().includes('return');
          if (!isRet) return false;
        }

        // Search filter
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchReason = (m.reason || '').toLowerCase().includes(q);
          const matchRef = (m.referenceId || '').toLowerCase().includes(q);
          const matchUser = (m.performedByName || '').toLowerCase().includes(q);
          if (!matchReason && !matchRef && !matchUser) return false;
        }

        return true;
      });

      // Newest first for ledger display
      matched.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      return {
        filteredMovementsDesc: matched,
        periodOpening: Number(opening.toFixed(3)),
        periodTotalIn: Number(totalIn.toFixed(3)),
        periodTotalOut: Number(totalOut.toFixed(3)),
        periodClosing: Number(closing.toFixed(3)),
      };
    }, [sortedMovementsAsc, periodRange, typeFilter, searchQuery]);

  // Group displayed movements by day (newest day first)
  interface DayGroup {
    dateKey: string;
    dateLabel: string;
    totalIn: number;
    totalOut: number;
    closingBal: number;
    entries: StockMovement[];
  }

  const dayGroups = useMemo(() => {
    const groups: DayGroup[] = [];
    const map = new Map<string, StockMovement[]>();

    const paged = filteredMovementsDesc.slice(0, displayLimit);

    paged.forEach((m) => {
      const d = new Date(m.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate()
      ).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    });

    map.forEach((entries, key) => {
      let dayIn = 0;
      let dayOut = 0;
      entries.forEach((m) => {
        const { inQty, outQty } = getEntryInAndOut(m);
        if (inQty) dayIn += inQty;
        if (outQty) dayOut += outQty;
      });

      // Format date label e.g. "OCT 27"
      const d = new Date(key + 'T00:00:00');
      const dateLabel = formatShortDate(d).toUpperCase();

      // First entry in newest-first list is the latest transaction of that day
      const closingBal = entries[0]?.newQuantity ?? 0;

      groups.push({
        dateKey: key,
        dateLabel,
        totalIn: Number(dayIn.toFixed(2)),
        totalOut: Number(dayOut.toFixed(2)),
        closingBal: Number(closingBal.toFixed(2)),
        entries,
      });
    });

    return groups;
  }, [filteredMovementsDesc, displayLimit]);

  // Aggregate Lifetime metrics for Item Details bottom sheet
  const lifetimeMetrics = useMemo(() => {
    let totalIn = 0;
    let totalOut = 0;
    let totalWaste = 0;

    mergedItemMovements.forEach((m) => {
      if (m.type === 'in' || m.type === 'production_yield') totalIn += m.quantity;
      else if (m.type === 'out' || m.type === 'production_consume') totalOut += m.quantity;
      else if (m.type === 'waste') totalWaste += m.quantity;
    });

    return {
      totalIn: Number(totalIn.toFixed(2)),
      totalOut: Number(totalOut.toFixed(2)),
      totalWaste: Number(totalWaste.toFixed(2)),
      assetValuation: item.quantity * item.unitCost,
    };
  }, [mergedItemMovements, item]);

  // Check mathematical reconciliation: OPENING + IN - OUT == CLOSING
  const mathBalanceExpected = Number((periodOpening + periodTotalIn - periodTotalOut).toFixed(2));
  const isMathReconciled =
    Math.abs(mathBalanceExpected - periodClosing) < 0.01 || periodFilter === 'all';

  // Item status
  const isOut = item.quantity <= 0;
  const isLow = item.quantity <= item.minStock;

  const classificationLabel =
    item.type === 'raw_material'
      ? 'Raw Material'
      : item.type === 'semi_finished'
      ? 'Semi-Finished'
      : item.type === 'non_stock'
      ? 'Non-Stock'
      : item.type === 'both'
      ? 'Composite Item'
      : 'Finished Goods';

  // 12-hour time format: { time: "12:16", ampm: "PM" }
  const formatLedgerTime = (dateInput: string | Date): { time: string; ampm: string } => {
    const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(d.getTime())) return { time: '', ampm: '' };
    let hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? '0' + minutes : String(minutes);
    return { time: `${hours}:${minutesStr}`, ampm };
  };

  // 12-hour time format with AM/PM (e.g. 7:52 PM) for exports & tooltips
  const format12HourTime = (dateInput: string | Date): string => {
    const { time, ampm } = formatLedgerTime(dateInput);
    return time ? `${time} ${ampm}` : '';
  };

  // Display-only mapping for legacy saved names containing "Kitchen"
  const formatDisplayActor = (raw?: string): string => {
    const text = (raw || '').trim();
    if (!text) return 'System user';
    if (/kitchen/i.test(text)) return 'Production Staff';
    return text;
  };

  // Clean reason for concise 2nd line of detail:
  // Hides internal IDs: "[Req #...]", "#xdsekce...", "VOID Batch #...", "Batch #..."
  // Preserves useful context like "12/12 GRAY BLUE · audit request", "Batch voided · material restored: testing"
  const cleanDetailReason = (rawReason?: string, ref?: string): string => {
    let text = (rawReason || '').trim();
    if (!text) return '';

    const isAudit = /audit approved/i.test(text) || /audit request/i.test(text);
    const isVoid = /void/i.test(text);

    // 1. Remove bracketed request IDs like [Req #...], (Req #...)
    text = text.replace(/\[\s*Req\s*#?[^\]]+\]/gi, '');
    text = text.replace(/\(\s*Req\s*#?[^)]+\)/gi, '');

    // 2. Remove "VOID Batch #<id>", "Batch #<id>", "batch_<id>"
    text = text.replace(/VOID\s+Batch\s*#?[a-zA-Z0-9_-]+/gi, '');
    text = text.replace(/Batch\s*#?[a-zA-Z0-9_-]+/gi, '');
    text = text.replace(/batch_[a-zA-Z0-9_-]+/gi, '');

    // 3. Remove raw hash IDs like #xdsekce... or #a1b2c3d4...
    text = text.replace(/#[a-zA-Z0-9_-]{5,}/g, '');

    // 4. Strip verbose prefixes
    const prefixes = [
      /^audit approved production consume:\s*/i,
      /^audit approved production yield:\s*/i,
      /^audit approved production intake:\s*/i,
      /^audit approved production waste:\s*/i,
      /^audit approved stock intake:\s*/i,
      /^audit approved stock out:\s*/i,
      /^audit approved adjustment:\s*/i,
      /^audit approved:\s*/i,
      /^production consume:\s*/i,
      /^production yield:\s*/i,
      /^consumed for:\s*/i,
      /^produced from:\s*/i,
      /^stock adjustment:\s*/i,
      /^adjustment:\s*/i,
      /^direct stock intake:\s*/i,
      /^stock intake:\s*/i,
      /^stock out:\s*/i,
      /^intake:\s*/i,
      /^deduction:\s*/i,
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const p of prefixes) {
        if (p.test(text)) {
          text = text.replace(p, '').trim();
          changed = true;
        }
      }
    }

    // Clean up empty parentheses, brackets, leading/trailing punctuation
    text = text.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');
    text = text.replace(/^[:\-\s·]+|[:\-\s·]+$/g, '').trim();
    text = text.replace(/\s{2,}/g, ' ');

    // Format voided transactions
    if (isVoid && !text.toLowerCase().startsWith('batch voided')) {
      text = text ? `Batch voided · ${text}` : 'Batch voided · material restored';
    }

    // Format audit transactions
    if (isAudit && !/audit/i.test(text)) {
      text = text ? `${text} · audit request` : 'Audit request';
    }

    return text;
  };

  // Format Movement Details line 1 and line 2
  const getMovementDetailLines = (m: StockMovement) => {
    const ref = m.referenceId || '';
    const cleaned = cleanDetailReason(m.reason, ref);

    if (ref.startsWith('INV-') || m.reason?.toLowerCase().includes('sale')) {
      return {
        line1: ref ? `Sale ${ref}` : 'Sale Invoice',
        line2: cleaned || 'Customer order dispatched',
      };
    }
    if (ref.startsWith('SR-') || m.reason?.toLowerCase().includes('sales return')) {
      return {
        line1: ref ? `Sales Return ${ref}` : 'Sales Return',
        line2: cleaned || 'Goods returned by customer',
      };
    }
    if (ref.startsWith('PO-') || m.reason?.toLowerCase().includes('purchase')) {
      return {
        line1: ref ? `Purchase ${ref}` : 'Purchase / Restock',
        line2: cleaned || 'Supplier restock',
      };
    }
    if (ref.startsWith('PR-') || m.reason?.toLowerCase().includes('purchase return')) {
      return {
        line1: ref ? `Purchase Return ${ref}` : 'Purchase Return',
        line2: cleaned || 'Debit note to vendor',
      };
    }
    if (m.reason?.toLowerCase().includes('void')) {
      return {
        line1: 'Batch Voided',
        line2: cleaned || 'Batch voided · material restored',
      };
    }
    if (m.type === 'production_consume') {
      return {
        line1: 'Production Use',
        line2: cleaned || 'Consumed in assembly',
      };
    }
    if (m.type === 'production_yield') {
      return {
        line1: 'Production Yield',
        line2: cleaned || 'Produced from BOM',
      };
    }
    if (m.type === 'adjustment') {
      return {
        line1: 'Stock Adjustment',
        line2: cleaned || 'Audit physical count',
      };
    }
    if (m.type === 'waste') {
      return {
        line1: 'Scrap / Damage',
        line2: cleaned || 'Scrap or damaged material',
      };
    }
    if (m.type === 'in') {
      return {
        line1: 'Stock Intake',
        line2: cleaned || 'Direct intake',
      };
    }
    return {
      line1: 'Stock Out',
      line2: cleaned || 'Direct deduction',
    };
  };

  // Photo handlers
  const handleOpenPhotoViewer = async () => {
    if (!item.photoThumb && !fullPhotoUrl) return;
    setIsPhotoViewerOpen(true);
    if (!fullPhotoUrl) {
      setIsLoadingFullPhoto(true);
      try {
        const full = await getFullItemPhoto(item.id);
        if (full) setFullPhotoUrl(full);
      } catch (err) {
        console.warn('Failed to load full item photo:', err);
      } finally {
        setIsLoadingFullPhoto(false);
      }
    }
  };

  const handlePhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingPhoto(true);
    setPhotoError(null);
    try {
      const { fullDataUrl, thumbDataUrl } = await resizeProductPhoto(file);
      await saveItemPhoto(item.id, fullDataUrl, thumbDataUrl);
      setFullPhotoUrl(fullDataUrl);
      setShowPhotoActionSheet(false);
    } catch (err: any) {
      console.error('Failed to save photo:', err);
      setPhotoError(err?.message || 'Failed to save photo.');
    } finally {
      setIsUploadingPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleRemovePhoto = async () => {
    setIsUploadingPhoto(true);
    setPhotoError(null);
    try {
      await removeItemPhoto(item.id);
      setFullPhotoUrl(null);
      setShowPhotoActionSheet(false);
    } catch (err: any) {
      console.error('Failed to remove photo:', err);
      setPhotoError(err?.message || 'Failed to remove photo.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleDelete = async () => {
    if (blockingRecipes.length > 0) {
      setDeleteError(
        `Cannot delete item. It is used in ${blockingRecipes.length} BOM(s): ${blockingRecipes
          .map((r) => r.name)
          .join(', ')}.`
      );
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

  // Excel & CSV Exports
  const exportProductExcel = () => {
    const rows = filteredMovementsDesc.map((m) => {
      const { inQty, outQty } = getEntryInAndOut(m);
      const detail = getMovementDetailLines(m);
      const d = new Date(m.timestamp);
      return {
        Date: d.toLocaleDateString(),
        Time: format12HourTime(d),
        Type: detail.line1,
        Detail: detail.line2,
        'In Qty': inQty !== null ? inQty : '',
        'Out Qty': outQty !== null ? outQty : '',
        'Balance After': m.newQuantity,
        Unit: item.unit,
        'Reference ID': m.referenceId || '',
        'Done By': m.performedByName || m.performedBy || '',
      };
    });
    const safeName = (item.name || 'product').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadExcelFile(rows, `ledger_${safeName}_${Date.now()}.xlsx`, 'Ledger Statement');
    setShowActionMenu(false);
  };

  const exportProductCSV = () => {
    const headers = [
      'Date',
      'Time',
      'Type',
      'Detail',
      'In Qty',
      'Out Qty',
      'Balance After',
      'Unit',
      'Reference ID',
      'Done By',
    ];
    const escapeCsv = (val: any) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const csvRows = filteredMovementsDesc.map((m) => {
      const { inQty, outQty } = getEntryInAndOut(m);
      const detail = getMovementDetailLines(m);
      const d = new Date(m.timestamp);
      return [
        escapeCsv(d.toLocaleDateString()),
        escapeCsv(format12HourTime(d)),
        escapeCsv(detail.line1),
        escapeCsv(detail.line2),
        escapeCsv(inQty !== null ? inQty : ''),
        escapeCsv(outQty !== null ? outQty : ''),
        escapeCsv(m.newQuantity),
        escapeCsv(item.unit),
        escapeCsv(m.referenceId || ''),
        escapeCsv(m.performedByName || m.performedBy || ''),
      ].join(',');
    });
    const csvContent = [headers.map(escapeCsv).join(','), ...csvRows].join('\n');
    const safeName = (item.name || 'product').replace(/[^a-zA-Z0-9_-]/g, '_');
    downloadCSVFile(csvContent, `ledger_${safeName}_${Date.now()}.csv`);
    setShowActionMenu(false);
  };

  return (
    <div className="w-full max-w-4xl mx-auto pb-16 animate-in fade-in duration-150">
      {/* Hidden file inputs for photo capture and gallery */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handlePhotoSelected}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoSelected}
      />

      {/* Top Breadcrumb Navigation */}
      <div className="px-3 sm:px-4 pt-1 pb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-600 hover:text-indigo-600 transition cursor-pointer py-1 whitespace-nowrap shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="truncate max-w-[220px]">{backLabel}</span>
        </button>
      </div>

      {/* =========================================================================
          STICKY COMPACT ITEM HEADER (Sticks below 64px app top bar)
      ========================================================================= */}
      <div
        style={{ top: 'calc(4rem + env(safe-area-inset-top))' }}
        className="sticky z-20 bg-white border-b border-slate-200 shadow-2xs"
      >
        {/* Compact Header Strip: 56px high (photo 44px) */}
        <div className="h-[56px] px-3 sm:px-4 flex items-center justify-between gap-3 bg-white">
          {/* Left: 44x44 photo + Name + Category · SKU */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {/* 44x44 rounded photo */}
            <div className="relative w-[44px] h-[44px] rounded-lg overflow-hidden shrink-0 border border-slate-200 bg-slate-100 flex items-center justify-center select-none shadow-2xs">
              {item.photoThumb ? (
                <button
                  type="button"
                  onClick={handleOpenPhotoViewer}
                  className="w-full h-full cursor-zoom-in block"
                  title="Tap to zoom full photo"
                >
                  <img
                    src={item.photoThumb}
                    alt={item.name}
                    className="w-full h-full object-cover transition hover:scale-105"
                  />
                </button>
              ) : (
                <div
                  onClick={() => {
                    if (permissions.canEditItems) setShowPhotoActionSheet(true);
                  }}
                  className={`w-full h-full flex items-center justify-center text-slate-400 ${
                    permissions.canEditItems ? 'cursor-pointer hover:bg-slate-200/60' : ''
                  }`}
                  title={permissions.canEditItems ? 'Add photo' : undefined}
                >
                  <Camera className="w-5 h-5 text-slate-400" />
                </div>
              )}

              {/* Small round camera badge for editors */}
              {permissions.canEditItems && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPhotoActionSheet(true);
                  }}
                  disabled={isUploadingPhoto}
                  className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-slate-900/90 hover:bg-slate-950 text-white flex items-center justify-center shadow-xs border border-white cursor-pointer transition active:scale-90"
                  title="Change photo"
                >
                  {isUploadingPhoto ? (
                    <Loader2 className="w-2.5 h-2.5 animate-spin text-white" />
                  ) : (
                    <Camera className="w-2.5 h-2.5 text-white" />
                  )}
                </button>
              )}
            </div>

            {/* Title & Metadata */}
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-extrabold text-slate-900 tracking-tight truncate leading-tight">
                {item.name}
              </h1>
              <div className="text-[11px] text-slate-500 truncate mt-0.5 font-medium leading-none">
                <span>{classificationLabel}</span>
                <span className="mx-1 text-slate-300">·</span>
                <span className="font-mono text-slate-600 font-semibold">{item.sku}</span>
              </div>
            </div>
          </div>

          {/* Right: On Hand Stock Monospace Number with Status Color */}
          <div className="text-right shrink-0">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">
              On Hand
            </div>
            <div
              className={`text-base font-black font-mono tracking-tight leading-tight mt-0.5 ${
                isOut ? 'text-rose-600' : isLow ? 'text-amber-600' : 'text-emerald-600'
              }`}
            >
              {formatQty(item.quantity, item.unit)}{' '}
              <span className="text-[11px] font-semibold text-slate-500">{item.unit}</span>
            </div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          FILTER / ACTION ROW & TABLE COLUMN HEADERS (Scrolls normally with list)
      ========================================================================= */}
      <div className="bg-white border-b border-slate-200">
        {/* 2. Action Row */}
        <div className="py-1.5 px-3 sm:px-4 flex items-center gap-1.5 border-b border-slate-100 bg-white">
          {/* 1. All Entries Filter Dropdown */}
          <div className="relative flex-1 min-w-0">
            <select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value as EntryTypeFilter);
                setDisplayLimit(50);
              }}
              className="w-full h-[38px] appearance-none pl-2.5 pr-6 text-sm font-semibold rounded-lg bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-2xs truncate"
            >
              <option value="all">All</option>
              <option value="in">In</option>
              <option value="out">Out</option>
              <option value="production">Production</option>
              <option value="purchase">Purchase</option>
              <option value="sales">Sales</option>
              <option value="adjustment">Adjust</option>
              <option value="returns">Returns</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* 2. Period Filter Dropdown */}
          <div className="relative flex-1 min-w-0">
            <select
              value={periodFilter}
              onChange={(e) => {
                const val = e.target.value as PeriodFilter;
                if (val === 'custom') {
                  setShowCustomDateModal(true);
                }
                setPeriodFilter(val);
                setDisplayLimit(50);
              }}
              className="w-full h-[38px] appearance-none pl-2.5 pr-6 text-sm font-semibold rounded-lg bg-white border border-slate-300 text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-2xs truncate"
            >
              <option value="today">Today</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="all">All time</option>
              <option value="custom">
                {customStartDate && customEndDate ? `${customStartDate} → ${customEndDate}` : 'Custom'}
              </option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          {/* 3. ± Adjust button */}
          {permissions.canAdjustStock && (
            <button
              type="button"
              onClick={() => onOpenAdjustStock(item)}
              className="h-[38px] px-2.5 sm:px-3 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white shrink-0 flex items-center justify-center gap-1 shadow-2xs cursor-pointer whitespace-nowrap active:scale-95 transition"
              title="Adjust physical stock quantity"
            >
              <span>± Adjust</span>
            </button>
          )}

          {/* 4. ⋮ Menu Button */}
          <div className="relative shrink-0" ref={actionMenuRef}>
            <button
              type="button"
              onClick={() => setShowActionMenu((v) => !v)}
              className="h-[38px] w-[38px] flex items-center justify-center rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 transition cursor-pointer shadow-2xs active:scale-95 shrink-0"
              title="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {/* Dropdown Menu */}
            {showActionMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-40 animate-in fade-in zoom-in-95 duration-100">
                {/* Item Details */}
                <button
                  type="button"
                  onClick={() => {
                    setShowActionMenu(false);
                    setShowItemDetailsSheet(true);
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer"
                >
                  <Info className="w-4 h-4 text-indigo-600" />
                  <span>Item Details</span>
                </button>

                {/* Search toggle */}
                <button
                  type="button"
                  onClick={() => {
                    setShowActionMenu(false);
                    setShowSearchBar((v) => !v);
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer"
                >
                  <Search className="w-4 h-4 text-slate-500" />
                  <span>{showSearchBar ? 'Hide Search' : 'Search Entries'}</span>
                </button>

                {/* Change Photo */}
                {permissions.canEditItems && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowActionMenu(false);
                      setShowPhotoActionSheet(true);
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer"
                  >
                    <Camera className="w-4 h-4 text-slate-500" />
                    <span>Change Photo</span>
                  </button>
                )}

                {/* Edit Item */}
                {permissions.canEditItems && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowActionMenu(false);
                      onOpenEditItem(item);
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer"
                  >
                    <Edit2 className="w-4 h-4 text-slate-500" />
                    <span>Edit Item</span>
                  </button>
                )}

                {/* Exports */}
                {permissions.canExportExcel && (
                  <>
                    <div className="h-px bg-slate-100 my-1" />
                    <button
                      type="button"
                      onClick={exportProductExcel}
                      className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                      <span>Export Excel (.xlsx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={exportProductCSV}
                      className="w-full px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-sky-600" />
                      <span>Export CSV (.csv)</span>
                    </button>
                  </>
                )}

                {/* Delete Item */}
                {permissions.canDeleteItems && (
                  <>
                    <div className="h-px bg-slate-100 my-1" />
                    <button
                      type="button"
                      onClick={() => {
                        setShowActionMenu(false);
                        setShowDeleteConfirm(true);
                      }}
                      className="w-full px-3.5 py-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4 text-rose-500" />
                      <span>Delete Item</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Quick search input if toggled */}
        {showSearchBar && (
          <div className="px-3 sm:px-4 pb-2 relative w-full bg-white">
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter detail, reference, or user..."
              className="w-full h-[32px] pl-8 pr-7 text-xs rounded-lg border border-indigo-300 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 shadow-2xs"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-5 top-1/2 -translate-y-1/2 pointer-events-none" />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* 3. Table Column Header: 28px high */}
        <div className="h-[28px] px-3 sm:px-4 flex items-center text-[10px] font-extrabold uppercase tracking-wider text-slate-500 bg-slate-50 select-none">
          <div className="w-[52px] sm:w-[64px] shrink-0">Time</div>
          <div className="flex-1 min-w-0 pr-1.5 sm:pr-2">Detail</div>
          <div className="w-[62px] shrink-0 text-right text-slate-600 sm:hidden">Qty</div>
          <div className="hidden sm:block w-[56px] shrink-0 text-right text-emerald-700">In</div>
          <div className="hidden sm:block w-[56px] shrink-0 text-right text-rose-700">Out</div>
          <div className="w-[54px] sm:w-[64px] shrink-0 text-right text-slate-700">Bal</div>
        </div>
      </div>

      {/* =========================================================================
          3. LEDGER TABLE (Content)
      ========================================================================= */}
      <div className="bg-white border-b border-slate-200">

        {/* Ledger Entries List */}
        {dayGroups.length === 0 ? (
          <div className="py-16 text-center text-slate-400 space-y-2">
            <Clock className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-xs font-semibold text-slate-600">No stock movements in this period.</p>
            <p className="text-[11px] text-slate-400">
              Try switching the period filter to &quot;All time&quot; or selecting a different entry type.
            </p>
          </div>
        ) : (
          <div>
            {dayGroups.map((group) => (
              <div key={group.dateKey} className="border-b border-slate-100 last:border-b-0">
                {/* Day Subtotal Header Row */}
                <div className="bg-slate-50/90 px-3 sm:px-4 py-1.5 border-t border-b border-slate-200/70 flex items-center text-[11px] font-bold text-slate-600 select-none">
                  <div className="flex-1 min-w-0 pr-1.5 sm:pr-2 flex items-center gap-1.5">
                    <span className="font-extrabold text-slate-800 text-[11px]">{group.dateLabel}</span>
                    <span className="text-[10px] font-medium text-slate-400">
                      · {group.entries.length} {group.entries.length === 1 ? 'entry' : 'entries'}
                    </span>
                  </div>

                  {/* Mobile merged QTY subtotal */}
                  <div className="w-[62px] shrink-0 text-right font-mono tabular-nums text-[11px] font-bold leading-tight sm:hidden">
                    {group.totalIn > 0 && (
                      <div className="text-emerald-700">+{formatQty(group.totalIn, item.unit)}</div>
                    )}
                    {group.totalOut > 0 && (
                      <div className="text-rose-700">−{formatQty(group.totalOut, item.unit)}</div>
                    )}
                  </div>

                  {/* Desktop IN column: 56px */}
                  <div className="hidden sm:block w-[56px] shrink-0 text-right font-mono tabular-nums text-xs font-bold text-emerald-700">
                    {group.totalIn > 0 ? `+${formatQty(group.totalIn, item.unit)}` : ''}
                  </div>

                  {/* Desktop OUT column: 56px */}
                  <div className="hidden sm:block w-[56px] shrink-0 text-right font-mono tabular-nums text-xs font-bold text-rose-700">
                    {group.totalOut > 0 ? `−${formatQty(group.totalOut, item.unit)}` : ''}
                  </div>

                  {/* BAL column */}
                  <div className="w-[54px] sm:w-[64px] shrink-0 text-right font-mono tabular-nums text-xs font-extrabold text-slate-800">
                    {formatQty(group.closingBal, item.unit)}
                  </div>
                </div>

                {/* Day's Entries */}
                <div className="divide-y divide-slate-100">
                  {group.entries.filter((m) => !removedIds.includes(m.id)).map((m) => {
                    const { inQty, outQty } = getEntryInAndOut(m);
                    const detail = getMovementDetailLines(m);
                    const isExpanded = expandedRowId === m.id;
                    const d = new Date(m.timestamp);
                    const ledgerTime = formatLedgerTime(d);

                    return (
                      <div key={m.id} className="transition">
                        {/* Compact Table Row */}
                        <div
                          onClick={() => setExpandedRowId((curr) => (curr === m.id ? null : m.id))}
                          className={`flex items-center px-3 sm:px-4 py-2 hover:bg-slate-50 transition cursor-pointer select-none ${
                            isExpanded ? 'bg-indigo-50/30' : ''
                          }`}
                        >
                          {/* TIME: compact single-line on phones, 2-line on desktop */}
                          <div className="w-[52px] sm:w-[64px] shrink-0 leading-tight">
                            <div className="sm:hidden font-mono text-[10px] font-semibold text-slate-600 whitespace-nowrap tracking-tighter">
                              {format12HourTime(d)}
                            </div>
                            <div className="hidden sm:block font-mono text-[11px] font-semibold text-slate-700 leading-tight">
                              {ledgerTime.time}
                            </div>
                            <div className="hidden sm:block text-[9px] text-slate-400 font-medium leading-tight">
                              {ledgerTime.ampm}
                            </div>
                          </div>

                          {/* DETAIL: flex-1 */}
                          <div className="flex-1 min-w-0 pr-1.5 sm:pr-2">
                            <div className="text-xs font-bold text-slate-900 line-clamp-2 break-words leading-tight flex items-center gap-1.5 flex-wrap">
                              <span>{detail.line1}</span>
                              {m.pending && (
                                <span className="text-[10px] font-medium text-slate-400">
                                  Saving…
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-slate-500 leading-snug mt-0.5 line-clamp-2 break-words">
                              {detail.line2}
                            </div>
                          </div>

                          {/* Mobile merged QTY column */}
                          <div className="w-[62px] shrink-0 text-right font-mono tabular-nums text-xs font-bold sm:hidden">
                            {inQty !== null && inQty > 0 ? (
                              <span className="text-emerald-700">+{formatQty(inQty, item.unit)}</span>
                            ) : outQty !== null && outQty > 0 ? (
                              <span className="text-rose-700">−{formatQty(outQty, item.unit)}</span>
                            ) : inQty === 0 ? (
                              <span className="text-slate-400">0</span>
                            ) : null}
                          </div>

                          {/* Desktop IN: 56px */}
                          <div className="hidden sm:block w-[56px] shrink-0 text-right font-mono tabular-nums text-xs font-bold text-emerald-700">
                            {inQty !== null && inQty > 0 ? `+${formatQty(inQty, item.unit)}` : ''}
                          </div>

                          {/* Desktop OUT: 56px */}
                          <div className="hidden sm:block w-[56px] shrink-0 text-right font-mono tabular-nums text-xs font-bold text-rose-700">
                            {outQty !== null && outQty > 0 ? `−${formatQty(outQty, item.unit)}` : ''}
                          </div>

                          {/* BAL */}
                          <div className="w-[54px] sm:w-[64px] shrink-0 text-right font-mono tabular-nums text-xs font-semibold text-slate-800">
                            {formatQty(m.newQuantity, item.unit)}
                          </div>
                        </div>

                        {/* Expandable Details Drawer */}
                        {isExpanded && (
                          <div className="bg-slate-50/90 px-4 py-3 border-t border-dashed border-slate-200 text-xs space-y-2 animate-in fade-in duration-100">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600">
                              <div>
                                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                  Full Particulars / Reason
                                </span>
                                <span className="font-semibold text-slate-800 break-words">
                                  {m.reason || 'None provided'}
                                </span>
                              </div>

                              {m.referenceId && (
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                    Reference ID
                                  </span>
                                  <span className="font-mono font-bold text-indigo-700">
                                    {m.referenceId}
                                  </span>
                                </div>
                              )}

                              <div>
                                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                  Logged By
                                </span>
                                <span className="font-medium text-slate-800">
                                  {formatDisplayActor(m.performedByName || m.performedBy)}
                                </span>
                              </div>

                              <div>
                                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                  Timestamp
                                </span>
                                <span className="font-mono text-slate-600">
                                  {formatDateTime(m.timestamp)}
                                </span>
                              </div>

                              <div>
                                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                                  Stock Transition
                                </span>
                                <span className="font-mono text-slate-700">
                                  {formatQty(m.previousQuantity, item.unit)} {item.unit} →{' '}
                                  <strong className="text-slate-900">{formatQty(m.newQuantity, item.unit)} {item.unit}</strong>
                                </span>
                              </div>
                            </div>
                            {canRemoveManualEntry(m) && (() => {
                              const changeCheck = canChangeEntry(
                                {
                                  createdByUid: m.performedBy,
                                  createdByName: m.performedByName,
                                  createdAt: m.timestamp,
                                },
                                realUserUid,
                                permissions,
                                role
                              );
                              if (!changeCheck.allowed) {
                                return (
                                  <div className="mt-2 py-1.5 px-2.5 rounded-lg bg-slate-100 text-[11px] text-slate-500 text-center">
                                    {formatLockReason(changeCheck.reason)}
                                  </div>
                                );
                              }
                              return (
                                <div className="mt-2 space-y-1">
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setRemoveError(null); setRemoveTarget(m); }}
                                    className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Remove entry
                                  </button>
                                  {role !== 'admin' && changeCheck.timeLeftLabel && (
                                    <div className="text-[11px] text-slate-400 text-center">
                                      Can change for {changeCheck.timeLeftLabel} more
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Load More Button */}
            {filteredMovementsDesc.length > displayLimit && (
              <div className="p-3 text-center bg-slate-50 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setDisplayLimit((prev) => prev + 50)}
                  className="px-4 py-2 text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-white border border-slate-200 rounded-xl shadow-2xs hover:bg-slate-50 transition cursor-pointer"
                >
                  Load More ({displayLimit} of {filteredMovementsDesc.length} entries shown)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          4. PERIOD SUMMARY (Dark Bar at Bottom of Table)
      ========================================================================= */}
      <div
        className={`mt-4 mx-3 sm:mx-0 p-3 rounded-xl border text-xs flex flex-wrap items-center justify-between gap-2 shadow-sm ${
          isMathReconciled
            ? 'bg-slate-900 text-white border-slate-800'
            : 'bg-amber-950 text-amber-100 border-amber-800'
        }`}
      >
        <div className="flex items-center gap-2 flex-wrap font-mono text-[11px] sm:text-xs">
          <span className="text-slate-400 uppercase tracking-wider text-[9px] font-bold">
            Period Summary:
          </span>
          <span>
            OPENING <strong className="text-slate-200">{formatQty(periodOpening, item.unit)}</strong>
          </span>
          <span className="text-slate-500">+</span>
          <span>
            IN <strong className="text-emerald-400">+{formatQty(periodTotalIn, item.unit)}</strong>
          </span>
          <span className="text-slate-500">−</span>
          <span>
            OUT <strong className="text-rose-400">−{formatQty(periodTotalOut, item.unit)}</strong>
          </span>
          <span className="text-slate-500">=</span>
          <span>
            CLOSING <strong className="text-white font-extrabold">{formatQty(periodClosing, item.unit)}</strong>
          </span>
          <span className="text-[10px] text-slate-400 font-sans font-medium">{item.unit}</span>
        </div>

        {!isMathReconciled && (
          <div className="flex items-center gap-1 text-[11px] text-amber-300 font-semibold animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>Check entries</span>
          </div>
        )}
      </div>

      {/* =========================================================================
          5. ITEM DETAILS (Bottom Sheet / Modal)
      ========================================================================= */}
      {showItemDetailsSheet && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowItemDetailsSheet(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-150"
        >
          <div
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
            className="bg-white rounded-t-3xl sm:rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5 shadow-2xl border border-slate-200 space-y-4 animate-in slide-in-from-bottom sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-150"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-extrabold text-slate-900 truncate">{item.name}</h3>
                  <p className="text-[10px] font-mono text-slate-500">SKU: {item.sku}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowItemDetailsSheet(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Comprehensive Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              {/* On-hand */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <div className="text-[10px] font-bold text-slate-500 uppercase">On-Hand Stock</div>
                <div className="text-base font-black font-mono text-slate-900 mt-0.5">
                  {formatQty(item.quantity, item.unit)} {item.unit}
                </div>
              </div>

              {/* Min stock */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Min Stock Alert</div>
                <div className="text-base font-black font-mono text-slate-700 mt-0.5">
                  {formatQty(item.minStock, item.unit)} {item.unit}
                </div>
              </div>

              {/* Classification */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Classification</div>
                <div className="text-xs font-bold text-indigo-700 mt-1 truncate">
                  {classificationLabel}
                </div>
              </div>

              {/* Total Received */}
              <div className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-200/70">
                <div className="text-[10px] font-bold text-emerald-800 uppercase">Total Received</div>
                <div className="text-sm font-black font-mono text-emerald-700 mt-0.5">
                  +{formatQty(lifetimeMetrics.totalIn, item.unit)} {item.unit}
                </div>
              </div>

              {/* Total Dispatched / Used */}
              <div className="p-2.5 rounded-xl bg-rose-50/60 border border-rose-200/70">
                <div className="text-[10px] font-bold text-rose-800 uppercase">Total Used / Sold</div>
                <div className="text-sm font-black font-mono text-rose-700 mt-0.5">
                  −{formatQty(lifetimeMetrics.totalOut, item.unit)} {item.unit}
                </div>
              </div>

              {/* Scrap / Damage */}
              <div className="p-2.5 rounded-xl bg-amber-50/60 border border-amber-200/70">
                <div className="text-[10px] font-bold text-amber-800 uppercase">Scrap / Damage</div>
                <div className="text-sm font-black font-mono text-amber-700 mt-0.5">
                  {formatQty(lifetimeMetrics.totalWaste, item.unit)} {item.unit}
                </div>
              </div>

              {/* Cost per unit */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Cost Per Unit</div>
                <div className="text-xs font-bold text-slate-800 mt-0.5">
                  {permissions.canViewCostPerUnit
                    ? item.unitCost > 0
                      ? formatInrAmount(item.unitCost, 2)
                      : <span className="text-slate-400 font-normal">Cost not set</span>
                    : '[Restricted]'}
                </div>
              </div>

              {/* Selling Price */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Selling Price</div>
                <div className="text-xs font-bold text-slate-800 mt-0.5">
                  {formatInrAmount(item.sellingPrice || 0, 2)}
                </div>
              </div>

              {/* Asset Valuation */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70">
                <div className="text-[10px] font-bold text-slate-500 uppercase">Asset Value</div>
                <div className="text-xs font-bold text-slate-800 mt-0.5">
                  {permissions.canViewTotalAssetValue
                    ? formatInrAmount(lifetimeMetrics.assetValuation, 2)
                    : '[Restricted]'}
                </div>
              </div>
            </div>

            {/* Additional item metadata */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5 text-slate-600">
              {item.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    Location: <strong>{item.location}</strong>
                  </span>
                </div>
              )}
              {item.supplier && (
                <div className="flex items-center gap-2">
                  <Truck className="w-3.5 h-3.5 text-slate-400" />
                  <span>
                    Supplier: <strong>{item.supplier}</strong>
                  </span>
                </div>
              )}
              {item.notes && (
                <div className="pt-1 text-[11px] text-slate-500 italic">
                  &quot;{item.notes}&quot;
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowItemDetailsSheet(false)}
                className="w-full sm:w-auto px-5 py-2 rounded-xl text-xs font-bold bg-slate-900 text-white hover:bg-slate-800 transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          CUSTOM DATE RANGE MODAL
      ========================================================================= */}
      {showCustomDateModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowCustomDateModal(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-xs w-full p-5 shadow-2xl border border-slate-200 space-y-3 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Custom Date Range</h3>
              <button
                type="button"
                onClick={() => setShowCustomDateModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setCustomStartDate('');
                  setCustomEndDate('');
                  setPeriodFilter('30d');
                  setShowCustomDateModal(false);
                }}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => setShowCustomDateModal(false)}
                className="px-4 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 cursor-pointer shadow-xs"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          FULL-SCREEN PHOTO ZOOM MODAL
      ========================================================================= */}
      {isPhotoViewerOpen && (
        <div
          onClick={() => setIsPhotoViewerOpen(false)}
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-5 animate-in fade-in duration-200 select-none"
        >
          {/* Top Bar */}
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between text-white z-10 pointer-events-auto" style={{ top: 'calc(1rem + env(safe-area-inset-top))' }}>
            <div className="min-w-0 pr-4">
              <h3 className="font-bold text-sm sm:text-base truncate">{item.name}</h3>
              <p className="text-xs text-slate-300 font-mono">SKU: {item.sku}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsPhotoViewerOpen(false)}
              className="p-2 rounded-full bg-white/20 hover:bg-white/30 text-white transition cursor-pointer"
              title="Close image viewer (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Centered Image */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-4xl max-h-[85vh] w-full flex items-center justify-center relative select-none"
          >
            {fullPhotoUrl ? (
              <img
                src={fullPhotoUrl}
                alt={item.name}
                className="max-w-full max-h-[82vh] object-contain rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200"
              />
            ) : item.photoThumb ? (
              <div className="relative flex items-center justify-center">
                <img
                  src={item.photoThumb}
                  alt={item.name}
                  className="max-w-full max-h-[82vh] object-contain rounded-2xl blur-xs scale-98 transition duration-300"
                />
                {isLoadingFullPhoto && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-2xl">
                    <Loader2 className="w-8 h-8 animate-spin text-white" />
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-slate-400 p-8">
                <Camera className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No photo available</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          PHOTO ACTION SHEET / MODAL
      ========================================================================= */}
      {showPhotoActionSheet && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isUploadingPhoto) setShowPhotoActionSheet(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-xs w-full p-5 shadow-2xl border border-slate-200 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Product Photo</h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[200px]">{item.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPhotoActionSheet(false)}
                disabled={isUploadingPhoto}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isUploadingPhoto ? (
              <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
                <Loader2 className="w-7 h-7 text-indigo-600 animate-spin" />
                <span className="text-xs font-semibold text-slate-700">Saving photo...</span>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/80 transition cursor-pointer"
                >
                  <Camera className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>Take Photo with Camera</span>
                </button>

                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold bg-white text-slate-700 hover:bg-slate-50 border border-slate-200 transition cursor-pointer shadow-2xs"
                >
                  <ImageIcon className="w-4 h-4 text-slate-500 shrink-0" />
                  <span>Choose from Gallery</span>
                </button>

                {item.photoThumb && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 border border-rose-200 transition cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4 text-rose-500 shrink-0" />
                    <span>Remove Current Photo</span>
                  </button>
                )}
              </div>
            )}

            {photoError && (
              <p className="text-xs text-rose-600 font-medium bg-rose-50 border border-rose-200 rounded-lg p-2">
                {photoError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* REMOVE MANUAL STOCK ENTRY CONFIRMATION */}
      {removeTarget && (() => {
        const undo = removeTarget.type === 'in'
          ? -Math.abs(Number(removeTarget.quantity) || 0)
          : removeTarget.type === 'adjustment'
          ? (Number(removeTarget.previousQuantity) || 0) - (Number(removeTarget.newQuantity) || 0)
          : Math.abs(Number(removeTarget.quantity) || 0);
        const onHand = Number(item.quantity) || 0;
        const after = Math.round((onHand + undo) * 1000) / 1000;
        const label = getMovementDetailLines(removeTarget).line1;
        return (
          <div
            onClick={(e) => { if (e.target === e.currentTarget && !isRemoving) { setRemoveTarget(null); setRemoveError(null); } }}
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4"
          >
            <div
              style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
              className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-2xl p-5 shadow-2xl border border-slate-200 space-y-3"
            >
              <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto sm:hidden" />
              <div>
                <h3 className="text-base font-extrabold text-slate-900">Remove this entry?</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {label} · {undo <= 0 ? '+' : '−'}{formatQty(Math.abs(undo), item.unit)} {item.unit} · {formatDateTime(removeTarget.timestamp)}
                </p>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-slate-800">
                <div className="font-bold">{item.name}</div>
                <div>
                  On hand: <b>{formatQty(onHand, item.unit)}</b> → <b className={after < 0 ? 'text-rose-700' : 'text-rose-600'}>{formatQty(after, item.unit)} {item.unit}</b> ({undo >= 0 ? '+' : '−'}{formatQty(Math.abs(undo), item.unit)})
                </div>
              </div>
              {after < 0 ? (
                <p className="text-xs font-semibold text-rose-700">Cannot remove: stock would go below zero (some of this stock was already used).</p>
              ) : (
                <p className="text-xs text-slate-500">This entry will be deleted from history. This cannot be undone.</p>
              )}
              {removeError && (
                <p className="text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-2">{removeError}</p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={() => { setRemoveTarget(null); setRemoveError(null); }}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRemoving || after < 0}
                  onClick={async () => {
                    setIsRemoving(true);
                    setRemoveError(null);
                    try {
                      const res = await removeManualMovement(removeTarget.id);
                      setRemovedIds((prev) => [...prev, removeTarget.id]);
                      setExpandedRowId(null);
                      setRemoveTarget(null);
                      showActionToast('Entry removed', `${res.itemName} back to ${formatQty(res.newQuantity, res.unit)} ${res.unit}`, 'success');
                    } catch (err: any) {
                      setRemoveError(err?.message || 'Could not remove this entry.');
                    } finally {
                      setIsRemoving(false);
                    }
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {isRemoving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Remove
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* =========================================================================
          DELETE CONFIRMATION MODAL
      ========================================================================= */}
      {showDeleteConfirm && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) setShowDeleteConfirm(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-150 space-y-3">
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
                    Used in <strong className="font-semibold">{blockingRecipes.length}</strong> BOM(s):{' '}
                    {blockingRecipes.map((r) => r.name).join(', ')}.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-slate-500 mt-1">
                  Are you sure you want to delete <strong className="text-slate-800">{item.name}</strong> ({item.sku})? This removes the item master and its photo.
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
                className="flex-1 py-2 text-xs font-bold rounded-xl bg-rose-600 hover:bg-rose-700 text-white transition shadow-xs cursor-pointer disabled:opacity-40"
              >
                {isDeleting ? 'Deleting...' : 'Delete Product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
