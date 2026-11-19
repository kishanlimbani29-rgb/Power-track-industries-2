import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Package,
  Plus,
  Search,
  UserPlus,
  X,
  ZoomIn,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useInventory } from '../../context/InventoryContext';
import { useTrade, SaleLineInput } from '../../context/TradeContext';
import { InventoryItem, PartyInfo, PaymentMode, Sale } from '../../types/inventory';
import { getItemQuantity } from '../../utils/itemResolver';
import { calcLine, formatINR, round2, sumLines, todayISODate } from '../../utils/tradeMath';
import { canChangeEntry } from '../../utils/changeWindow';
import { CustomerAccount, getCustomerKey } from './customerKhata';

export interface NewSalePageProps {
  editingSale?: Sale | null;
  initialCustomer?: PartyInfo | null;
  customerAccounts: CustomerAccount[];
  startWithPhoto?: boolean;
  onCancel: () => void;
  onSaved: (sale: Sale, meta?: { paidAmount?: number; memoNumber?: string }) => void;
  backHandlerRef?: React.MutableRefObject<(() => void) | null>;
}

interface SaleItemRow {
  id: string;
  originalText: string;
  itemId: string;
  quantity: string;
  rate: string;
  discountPct?: number;
  gstPct?: number;
  fromPhoto: boolean;
}

const PAYMENT_OPTIONS: { id: PaymentMode; label: string }[] = [
  { id: 'cash', label: 'Cash' },
  { id: 'upi', label: 'UPI' },
  { id: 'bank', label: 'Bank' },
  { id: 'cheque', label: 'Cheque' },
];

// Loose product-code match: ignores case, spaces, dots and bracket notes like (3x3).
const normCode = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]/g, '');

function findSuggestions(queryText: string, inventory: InventoryItem[], limit = 6): InventoryItem[] {
  if (!queryText.trim() || !inventory.length) return [];

  const clean = queryText.toLowerCase().replace(/[^a-z0-9]/g, '');
  const tokens = queryText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);

  const scored = inventory.map((it) => {
    let score = 0;
    const nameClean = it.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const skuClean = (it.sku || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (nameClean === clean || (skuClean && skuClean === clean)) score += 100;
    else if (nameClean.includes(clean) || (skuClean && skuClean.includes(clean))) score += 60;
    else if ((clean && nameClean && clean.includes(nameClean)) || (skuClean && clean.includes(skuClean)))
      score += 50;

    for (const t of tokens) {
      if (t.length > 1) {
        if (nameClean.includes(t)) score += 20;
        if (skuClean.includes(t)) score += 25;
      }
    }

    if (it.type === 'finished_good') score += 5;
    if (getItemQuantity(it) > 0) score += 3;

    return { item: it, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}

/**
 * Downscale image to max 1600px on the longest side and encode as JPEG at quality 0.8
 */
function shrinkImage(
  file: File,
  maxLongSide = 1600,
  quality = 0.8
): Promise<{ dataUrl: string; base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = (e) => {
      const src = e.target?.result as string;
      if (!src) {
        reject(new Error('No image data found'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image in browser'));
      img.onload = () => {
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;

        if (width > maxLongSide || height > maxLongSide) {
          if (width >= height) {
            height = Math.round((height * maxLongSide) / width);
            width = maxLongSide;
          } else {
            width = Math.round((width * maxLongSide) / height);
            height = maxLongSide;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2D context not available'));
          return;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const mimeType = 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, quality);
        const base64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, '');

        resolve({ dataUrl, base64, mimeType });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

const fmtMoney = (n: number): string => {
  const v = round2(n);
  return formatINR(v, v % 1 !== 0);
};

const makeRowId = () => `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function parseSaleNotesMeta(rawNotes?: string, createdAt?: string) {
  const parts = (rawNotes || '')
    .split(' • ')
    .map((s) => s.trim())
    .filter(Boolean);
  let memoNumber = '';
  let billDate = createdAt ? createdAt.slice(0, 10) : todayISODate();
  let hasBillDateMeta = false;
  const other: string[] = [];
  for (const p of parts) {
    if (p.startsWith('Memo / Bill No:')) {
      memoNumber = p.slice('Memo / Bill No:'.length).trim();
    } else if (p.startsWith('Bill Date:')) {
      const d = p.slice('Bill Date:'.length).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        billDate = d;
        hasBillDateMeta = true;
      }
    } else {
      other.push(p);
    }
  }
  return {
    memoNumber,
    billDate,
    hasBillDateMeta,
    notes: other.join(' • '),
  };
}

export const NewSalePage: React.FC<NewSalePageProps> = ({
  editingSale = null,
  initialCustomer,
  customerAccounts,
  startWithPhoto = false,
  onCancel,
  onSaved,
  backHandlerRef,
}) => {
  const { permissions, role, realUserUid } = useAuth();
  const { items, showActionToast, clearActionToast } = useInventory();
  const {
    customers: partySuggestions,
    customerAdvances,
    createSale,
    editSale,
    recordSalePayment,
    applyCustomerAdvanceToSale,
  } = useTrade();
  const isEditMode = Boolean(editingSale);
  const initialMeta = useMemo(
    () => (editingSale ? parseSaleNotesMeta(editingSale.notes, editingSale.createdAt) : null),
    [editingSale]
  );

  // Photo state
  const [imageUrl, setImageUrl] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [photoStatus, setPhotoStatus] = useState<'none' | 'reading' | 'success' | 'error'>('none');
  const [zoomOpen, setZoomOpen] = useState(false);
  const [photoChooserOpen, setPhotoChooserOpen] = useState(!isEditMode && startWithPhoto);

  // Customer state
  const [customerName, setCustomerName] = useState(
    editingSale ? editingSale.customer.name || '' : initialCustomer?.name || ''
  );
  const [customerPhone, setCustomerPhone] = useState(
    editingSale ? editingSale.customer.phone || '' : initialCustomer?.phone || ''
  );
  const [customerAddress, setCustomerAddress] = useState(
    editingSale ? editingSale.customer.address || '' : initialCustomer?.address || ''
  );
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false);
  const customerBoxRef = useRef<HTMLDivElement>(null);

  // Items state
  const [rows, setRows] = useState<SaleItemRow[]>(() =>
    editingSale
      ? editingSale.lines.map((l, idx) => ({
          id: `edit-${idx}-${l.itemId}`,
          originalText: '',
          itemId: l.itemId,
          quantity: String(l.quantity),
          rate: String(l.rate),
          discountPct: l.discountPct || 0,
          gstPct: l.gstPct || 0,
          fromPhoto: false,
        }))
      : []
  );

  // More details (collapsed by default unless opened or filled by photo)
  const [moreOpen, setMoreOpen] = useState(false);
  const [memoNumber, setMemoNumber] = useState(() => initialMeta?.memoNumber || '');
  const [billDate, setBillDate] = useState(() => initialMeta?.billDate || todayISODate());
  const [billDateTouched, setBillDateTouched] = useState(() => Boolean(initialMeta?.hasBillDateMeta));
  const [vehicleNumber, setVehicleNumber] = useState(() => editingSale?.vehicleNumber || '');
  const [trackingNumber, setTrackingNumber] = useState(() => editingSale?.trackingNumber || '');
  const [notes, setNotes] = useState(() => initialMeta?.notes || '');

  // Bottom bar payment state
  const [receivedNow, setReceivedNow] = useState('');
  const [payMode, setPayMode] = useState<PaymentMode>('cash');
  const [useAdvance, setUseAdvance] = useState(true);

  // Highlight fields auto-filled by photo until manually edited
  const [photoFilled, setPhotoFilled] = useState<Record<string, boolean>>({});

  // Product picker state: either adding new item (`pickerTargetRowId === 'NEW'`) or matching a photo row
  const [pickerTargetRowId, setPickerTargetRowId] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');

  // Submission / discard confirm state
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);

  const clearPhotoFlag = useCallback((key: string) => {
    setPhotoFilled((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // Close customer dropdown on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (
        customerDropdownOpen &&
        customerBoxRef.current &&
        !customerBoxRef.current.contains(e.target as Node)
      ) {
        setCustomerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [customerDropdownOpen]);

  // Combined searchable customer options: rich CustomerAccount entries + any remaining TradeContext party suggestions
  const customerChoices = useMemo(() => {
    const list: {
      key: string;
      name: string;
      phone: string;
      address: string;
      city: string;
      balanceDue: number;
    }[] = customerAccounts.map((acc) => ({
      key: acc.key,
      name: acc.name,
      phone: acc.phone || '',
      address: acc.address || acc.city || '',
      city: acc.city || '',
      balanceDue: acc.balanceDue,
    }));

    const seenNames = new Set(list.map((c) => c.name.trim().toLowerCase()));
    const seenPhones = new Set(
      list.map((c) => c.phone.replace(/\D/g, '').slice(-10)).filter((p) => p.length >= 7)
    );

    for (const p of partySuggestions) {
      const nKey = p.name.trim().toLowerCase();
      const phKey = (p.phone || '').replace(/\D/g, '').slice(-10);
      if (seenNames.has(nKey) || (phKey && seenPhones.has(phKey))) continue;
      list.push({
        key: `party:${nKey}`,
        name: p.name,
        phone: p.phone || '',
        address: p.address || '',
        city: p.address || '',
        balanceDue: 0,
      });
    }

    return list;
  }, [customerAccounts, partySuggestions]);

  const matchingCustomerChoices = useMemo(() => {
    const q = customerName.trim().toLowerCase();
    const filtered = q
      ? customerChoices.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            c.city.toLowerCase().includes(q) ||
            c.phone.toLowerCase().includes(q)
        )
      : customerChoices;
    return filtered.slice(0, 8);
  }, [customerChoices, customerName]);

  // Re-attempt auto-matching if inventory finishes loading after photo OCR
  useEffect(() => {
    if (!items.length) return;
    setRows((prev) =>
      prev.map((row) => {
        if (row.itemId && items.some((i) => i.id === row.itemId)) return row;
        const cleanText = row.originalText.trim().toLowerCase();
        if (!cleanText) return row;

        const exact = items.find(
          (it) =>
            it.name.trim().toLowerCase() === cleanText ||
            (it.sku && it.sku.trim().toLowerCase() === cleanText) ||
            (!!normCode(row.originalText) &&
              (normCode(it.name) === normCode(row.originalText) ||
                normCode(it.sku || '') === normCode(row.originalText)))
        );

        if (!exact) return row;
        const hasRate =
          row.rate.trim() !== '' && Number.isFinite(Number(row.rate)) && Number(row.rate) >= 0;
        return {
          ...row,
          itemId: exact.id,
          rate: hasRate ? row.rate : exact.sellingPrice ? String(exact.sellingPrice) : '',
        };
      })
    );
  }, [items]);

  // Process uploaded / captured bill photo via server OCR
  const processBillPhoto = async (file: File) => {
    setPhotoChooserOpen(false);
    setIsReading(true);
    setPhotoStatus('reading');
    setSubmitError(null);

    try {
      const { dataUrl, base64, mimeType } = await shrinkImage(file, 1600, 0.8);
      setImageUrl(dataUrl);

      const response = await fetch('/api/ocr-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });

      const resData = await response.json();
      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Failed to read bill photo');
      }

      const ocr = resData.data || {};
      const nextFlags: Record<string, boolean> = {};

      if (typeof ocr.customerName === 'string' && ocr.customerName.trim()) {
        setCustomerName(ocr.customerName.trim());
        nextFlags.customerName = true;
      }
      if (typeof ocr.customerPhone === 'string' && ocr.customerPhone.trim()) {
        setCustomerPhone(ocr.customerPhone.trim());
        nextFlags.customerPhone = true;
      }
      if (typeof ocr.customerAddress === 'string' && ocr.customerAddress.trim()) {
        setCustomerAddress(ocr.customerAddress.trim());
        nextFlags.customerAddress = true;
      }
      if (typeof ocr.memoNumber === 'string' && ocr.memoNumber.trim()) {
        setMemoNumber(ocr.memoNumber.trim());
        nextFlags.memoNumber = true;
        setMoreOpen(true);
      }
      if (typeof ocr.billDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ocr.billDate.trim())) {
        setBillDate(ocr.billDate.trim());
        setBillDateTouched(true);
        nextFlags.billDate = true;
        setMoreOpen(true);
      }

      if (Array.isArray(ocr.items) && ocr.items.length > 0) {
        const newRows: SaleItemRow[] = ocr.items.map((it: any, idx: number) => {
          const writtenName = String(it?.name || '').trim();
          const cleanWritten = writtenName.toLowerCase();

          const exact = items.find(
            (inv) =>
              inv.name.trim().toLowerCase() === cleanWritten ||
              (inv.sku && inv.sku.trim().toLowerCase() === cleanWritten) ||
              (!!normCode(writtenName) &&
                (normCode(inv.name) === normCode(writtenName) ||
                  normCode(inv.sku || '') === normCode(writtenName)))
          );

          const qtyVal = Number(it?.quantity) > 0 ? Number(it.quantity) : 1;
          const rawSlipRate = it?.rate;
          const hasExplicitSlipRate =
            rawSlipRate !== undefined &&
            rawSlipRate !== null &&
            String(rawSlipRate).trim() !== '' &&
            Number.isFinite(Number(rawSlipRate)) &&
            Number(rawSlipRate) >= 0;
          const slipRate = hasExplicitSlipRate ? Number(rawSlipRate) : null;
          const rateStr =
            slipRate !== null
              ? String(slipRate)
              : exact?.sellingPrice && exact.sellingPrice > 0
              ? String(exact.sellingPrice)
              : '';
          const rowId = `ocr-${Date.now()}-${idx}`;

          if (exact) nextFlags[`rowItem:${rowId}`] = true;
          nextFlags[`rowQty:${rowId}`] = true;
          if (rateStr !== '') nextFlags[`rowRate:${rowId}`] = true;

          return {
            id: rowId,
            originalText: writtenName,
            itemId: exact ? exact.id : '',
            quantity: String(qtyVal),
            rate: rateStr,
            fromPhoto: true,
          };
        });

        setRows(newRows);
      }

      setPhotoFilled((prev) => ({ ...prev, ...nextFlags }));
      setPhotoStatus('success');
    } catch (err) {
      console.error('OCR Bill reading error:', err);
      setPhotoStatus('error');
    } finally {
      setIsReading(false);
    }
  };

  const originalQtyMap = useMemo(() => {
    const map = new Map<string, number>();
    if (editingSale) {
      for (const l of editingSale.lines) {
        map.set(l.itemId, round2((map.get(l.itemId) || 0) + l.quantity));
      }
    }
    return map;
  }, [editingSale]);

  // Evaluate rows and totals
  const evaluatedRows = useMemo(() => {
    return rows.map((row) => {
      const item = items.find((i) => i.id === row.itemId) || null;
      const qty = Number(row.quantity);
      const hasRateText = row.rate.trim() !== '';
      const rate = Number(row.rate);
      const stock = item ? getItemQuantity(item) : 0;
      const origQty = item ? originalQtyMap.get(item.id) || 0 : 0;
      const availableStock = round2(stock + origQty);
      const returnedForItem = editingSale && item ? Number((editingSale.returnedQty || {})[item.id] || 0) : 0;
      const validQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
      const validRate = hasRateText && Number.isFinite(rate) && rate >= 0 ? rate : 0;
      const calc = calcLine({
        quantity: validQty,
        rate: validRate,
        discountPct: row.discountPct || 0,
        gstPct: row.gstPct || 0,
      });
      const isUnmatched = !item;
      const isOverStock = !!item && validQty > availableStock + 1e-9;
      const missingRate = !!item && !(hasRateText && Number.isFinite(rate) && rate >= 0);
      const missingQty = !!item && !(Number.isFinite(qty) && qty > 0);
      const isFree = !!item && !missingRate && validRate === 0;
      const belowReturned = !!item && returnedForItem > 0 && validQty < returnedForItem - 1e-9;

      return {
        row,
        item,
        stock,
        origQty,
        availableStock,
        returnedForItem,
        qty: validQty,
        rate: validRate,
        amount: calc.amount,
        taxable: calc.taxable,
        isUnmatched,
        isOverStock,
        missingRate,
        missingQty,
        isFree,
        belowReturned,
      };
    });
  }, [rows, items, originalQtyMap, editingSale]);

  const totals = useMemo(() => {
    return sumLines(
      evaluatedRows.filter((e) => e.item).map((e) => ({ amount: e.amount, taxable: e.taxable, gstAmount: 0 }))
    );
  }, [evaluatedRows]);

  const netReceivedOnEdit = useMemo(
    () => (editingSale ? round2((editingSale.amountPaid || 0) - (editingSale.refundedTotal || 0)) : 0),
    [editingSale]
  );

  const newDueOnEdit = useMemo(() => {
    if (!editingSale) return 0;
    return Math.max(0, round2(totals.grandTotal - (editingSale.returnsTotal || 0) - netReceivedOnEdit));
  }, [editingSale, totals.grandTotal, netReceivedOnEdit]);

  const editDiff = useMemo(() => {
    if (!editingSale) return null;
    const oldMap = new Map<string, { name: string; unit: string; qty: number }>();
    for (const l of editingSale.lines) {
      const cur = oldMap.get(l.itemId);
      oldMap.set(l.itemId, {
        name: l.itemName,
        unit: l.unit,
        qty: round2((cur?.qty || 0) + l.quantity),
      });
    }
    const newMap = new Map<string, { name: string; unit: string; qty: number }>();
    for (const e of evaluatedRows) {
      if (!e.item) continue;
      newMap.set(e.item.id, {
        name: e.item.name,
        unit: e.item.unit,
        qty: e.qty,
      });
    }
    const allIds = Array.from(new Set([...oldMap.keys(), ...newMap.keys()]));
    const itemChanges: { itemId: string; name: string; label: string; stockDeltaLabel: string; tone: 'emerald' | 'rose' | 'amber' }[] = [];
    for (const id of allIds) {
      const o = oldMap.get(id);
      const n = newMap.get(id);
      const oldQty = o?.qty || 0;
      const newQty = n?.qty || 0;
      const name = n?.name || o?.name || 'Item';
      if (oldQty === 0 && newQty > 0) {
        itemChanges.push({
          itemId: id,
          name,
          label: `Added × ${newQty}`,
          stockDeltaLabel: `stock −${round2(newQty)}`,
          tone: 'amber',
        });
      } else if (oldQty > 0 && newQty === 0) {
        itemChanges.push({
          itemId: id,
          name,
          label: `Removed (was ${oldQty})`,
          stockDeltaLabel: `stock +${round2(oldQty)}`,
          tone: 'emerald',
        });
      } else if (Math.abs(newQty - oldQty) > 1e-9) {
        const delta = round2(newQty - oldQty);
        itemChanges.push({
          itemId: id,
          name,
          label: `${oldQty} → ${newQty}`,
          stockDeltaLabel: delta > 0 ? `stock −${delta}` : `stock +${Math.abs(delta)}`,
          tone: delta > 0 ? 'amber' : 'emerald',
        });
      }
    }
    return itemChanges;
  }, [editingSale, evaluatedRows]);

  const selectedPartyKey = useMemo(
    () => (customerName.trim() ? getCustomerKey({ name: customerName, phone: customerPhone }) : ''),
    [customerName, customerPhone]
  );

  const partyAdvanceRemaining = useMemo(() => {
    if (!selectedPartyKey) return 0;
    return round2(
      customerAdvances
        .filter((a) => a.partyKey === selectedPartyKey && (a.remaining || 0) > 0.009)
        .reduce((sum, a) => sum + (a.remaining || 0), 0)
    );
  }, [customerAdvances, selectedPartyKey]);

  const targetDueForAdvance = isEditMode ? newDueOnEdit : totals.grandTotal;
  const advanceToApply =
    useAdvance && partyAdvanceRemaining > 0.009 && targetDueForAdvance > 0.009
      ? round2(Math.min(partyAdvanceRemaining, targetDueForAdvance))
      : 0;

  const receivedNum = useMemo(() => {
    const n = Number(receivedNow);
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  }, [receivedNow]);

  const maxReceivableNow = Math.max(0, round2(totals.grandTotal - advanceToApply));
  const receivedOverTotal = !isEditMode && receivedNum > maxReceivableNow + 0.009 && totals.grandTotal > 0;

  // Determine exact validation message / button label
  const validationState = useMemo(() => {
    if (isReading) {
      return { valid: false, label: 'Reading bill…' };
    }
    if (!customerName.trim()) {
      return { valid: false, label: 'Enter customer name' };
    }
    if (evaluatedRows.length === 0) {
      return { valid: false, label: 'Add an item' };
    }
    const unmatchedCount = evaluatedRows.filter((e) => e.isUnmatched).length;
    if (unmatchedCount > 0) {
      return {
        valid: false,
        label: `Match ${unmatchedCount} ${unmatchedCount === 1 ? 'item' : 'items'} from the photo`,
      };
    }
    const missingQtyRow = evaluatedRows.find((e) => e.missingQty);
    if (missingQtyRow) {
      return {
        valid: false,
        label: `Enter quantity for ${missingQtyRow.item?.name || 'item'} to save`,
      };
    }
    const missingRateRow = evaluatedRows.find((e) => e.missingRate);
    if (missingRateRow) {
      return {
        valid: false,
        label: `Enter rate for ${missingRateRow.item?.name || 'item'} to save`,
      };
    }
    const belowRetRow = evaluatedRows.find((e) => e.belowReturned);
    if (belowRetRow) {
      return {
        valid: false,
        label: `${belowRetRow.item?.name || 'Item'}: min ${belowRetRow.returnedForItem} (returned)`,
      };
    }
    if (editingSale) {
      for (const [retItemId, retVal] of Object.entries(editingSale.returnedQty || {})) {
        const rq = Number(retVal) || 0;
        if (rq > 0 && !evaluatedRows.some((e) => e.item?.id === retItemId)) {
          const retName = editingSale.lines.find((l) => l.itemId === retItemId)?.itemName || 'Item';
          return { valid: false, label: `Keep ${retName} (${rq} returned)` };
        }
      }
    }
    const overStockRow = evaluatedRows.find((e) => e.isOverStock);
    if (overStockRow) {
      return {
        valid: false,
        label: isEditMode
          ? `Only ${overStockRow.availableStock} of ${overStockRow.item?.name || 'item'} available`
          : `Only ${overStockRow.stock} of ${overStockRow.item?.name || 'item'} in stock`,
      };
    }
    if (editingSale && totals.grandTotal < netReceivedOnEdit - 0.009) {
      return {
        valid: false,
        label: `New total is less than amount already received (${fmtMoney(netReceivedOnEdit)})`,
      };
    }
    if (!isEditMode && receivedOverTotal) {
      return {
        valid: false,
        label: advanceToApply > 0 ? 'Received + advance exceeds total' : 'Received amount exceeds total',
      };
    }
    if (!isEditMode && receivedNum > 0 && totals.grandTotal <= 0) {
      return { valid: false, label: 'Received amount exceeds total' };
    }
    return { valid: true, label: isEditMode ? 'Save Changes' : 'Save Sale & Take Stock Off' };
  }, [
    isReading,
    customerName,
    evaluatedRows,
    editingSale,
    isEditMode,
    totals.grandTotal,
    netReceivedOnEdit,
    receivedOverTotal,
    receivedNum,
    advanceToApply,
  ]);

  // Dirty detection for "Discard this sale?"
  const isDirty = useMemo(() => {
    if (editingSale && initialMeta) {
      const origSig = editingSale.lines.map((l) => `${l.itemId}:${l.quantity}:${l.rate}`).join('|');
      const curSig = rows.map((r) => `${r.itemId}:${Number(r.quantity) || 0}:${Number(r.rate) || 0}`).join('|');
      return (
        origSig !== curSig ||
        customerName.trim() !== (editingSale.customer.name || '').trim() ||
        customerPhone.trim() !== (editingSale.customer.phone || '').trim() ||
        customerAddress.trim() !== (editingSale.customer.address || '').trim() ||
        memoNumber.trim() !== initialMeta.memoNumber ||
        billDate !== initialMeta.billDate ||
        vehicleNumber.trim() !== (editingSale.vehicleNumber || '').trim() ||
        trackingNumber.trim() !== (editingSale.trackingNumber || '').trim() ||
        notes.trim() !== initialMeta.notes
      );
    }
    const initialName = initialCustomer?.name || '';
    const initialPhone = initialCustomer?.phone || '';
    const initialAddr = initialCustomer?.address || '';
    return (
      Boolean(imageUrl) ||
      rows.length > 0 ||
      customerName !== initialName ||
      customerPhone !== initialPhone ||
      customerAddress !== initialAddr ||
      memoNumber.trim() !== '' ||
      vehicleNumber.trim() !== '' ||
      trackingNumber.trim() !== '' ||
      notes.trim() !== '' ||
      receivedNow.trim() !== ''
    );
  }, [
    editingSale,
    initialMeta,
    imageUrl,
    rows,
    customerName,
    customerPhone,
    customerAddress,
    initialCustomer,
    memoNumber,
    billDate,
    vehicleNumber,
    trackingNumber,
    notes,
    receivedNow,
  ]);

  const handleRequestCancel = useCallback(() => {
    if (busy) return;
    if (isDirty) {
      setDiscardDialogOpen(true);
    } else {
      onCancel();
    }
  }, [busy, isDirty, onCancel]);

  useEffect(() => {
    if (backHandlerRef) {
      backHandlerRef.current = handleRequestCancel;
      return () => {
        backHandlerRef.current = null;
      };
    }
  }, [backHandlerRef, handleRequestCancel]);

  // Row mutations
  const updateRow = (rowId: string, patch: Partial<SaleItemRow>) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)));
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  // Product picker helpers
  const pickerTargetRow = useMemo(
    () => (pickerTargetRowId && pickerTargetRowId !== 'NEW' ? rows.find((r) => r.id === pickerTargetRowId) || null : null),
    [pickerTargetRowId, rows]
  );

  const usedElsewhereIds = useMemo(() => {
    return new Set(
      rows
        .filter((r) => r.id !== pickerTargetRowId && r.itemId)
        .map((r) => r.itemId)
    );
  }, [rows, pickerTargetRowId]);

  const pickerResults = useMemo(() => {
    const available = items.filter((it) => !usedElsewhereIds.has(it.id));
    const sorted = [...available].sort((a, b) => {
      const fa = a.type === 'finished_good' ? 0 : 1;
      const fb = b.type === 'finished_good' ? 0 : 1;
      return fa - fb || a.name.localeCompare(b.name);
    });

    const q = pickerSearch.trim().toLowerCase();
    if (q) {
      return sorted.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          (it.sku || '').toLowerCase().includes(q) ||
          (it.category || '').toLowerCase().includes(q)
      );
    }

    if (pickerTargetRow?.originalText) {
      const smart = findSuggestions(pickerTargetRow.originalText, available, 6);
      const smartIds = new Set(smart.map((s) => s.id));
      return [...smart, ...sorted.filter((it) => !smartIds.has(it.id))];
    }

    return sorted;
  }, [items, usedElsewhereIds, pickerSearch, pickerTargetRow]);

  const handlePickProduct = (it: InventoryItem) => {
    if (pickerTargetRowId === 'NEW') {
      const newId = makeRowId();
      setRows((prev) => [
        ...prev,
        {
          id: newId,
          originalText: '',
          itemId: it.id,
          quantity: '1',
          rate: it.sellingPrice && it.sellingPrice > 0 ? String(it.sellingPrice) : '',
          fromPhoto: false,
        },
      ]);
    } else if (pickerTargetRowId) {
      const existing = rows.find((r) => r.id === pickerTargetRowId);
      const hasRate =
        existing &&
        existing.rate.trim() !== '' &&
        Number.isFinite(Number(existing.rate)) &&
        Number(existing.rate) >= 0;
      const nextRate = hasRate
        ? existing!.rate
        : it.sellingPrice && it.sellingPrice > 0
        ? String(it.sellingPrice)
        : '';
      updateRow(pickerTargetRowId, {
        itemId: it.id,
        rate: nextRate,
      });
      clearPhotoFlag(`rowItem:${pickerTargetRowId}`);
    }
    setPickerTargetRowId(null);
    setPickerSearch('');
  };

  // Submit handler preserving all existing createSale + editSale + recordSalePayment + memo rules
  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!validationState.valid || busy) return;

    if (isEditMode && !permissions.canEditSales) {
      setSubmitError('Your user role does not have permission to edit sales.');
      return;
    }
    if (editingSale) {
      const check = canChangeEntry(
        {
          createdByUid: editingSale.createdBy,
          createdByName: editingSale.createdByName,
          createdAt: editingSale.createdAt,
        },
        realUserUid,
        permissions,
        role
      );
      if (!check.allowed) {
        setSubmitError(check.reason || 'Locked: cannot edit this bill.');
        return;
      }
    }
    if (!isEditMode && !permissions.canCreateSales) {
      setSubmitError('Your user role does not have permission to create sales.');
      return;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSubmitError('No internet connection — nothing was saved. Please try again.');
      return;
    }

    setSubmitError(null);
    setBusy(true);

    const lines: SaleLineInput[] = evaluatedRows.map((eRow) => ({
      itemId: eRow.row.itemId,
      quantity: eRow.qty,
      rate: eRow.rate,
      discountPct: eRow.row.discountPct || 0,
      gstPct: eRow.row.gstPct || 0,
    }));

    const includeBillDate = isEditMode
      ? Boolean(initialMeta?.hasBillDateMeta || billDateTouched)
      : Boolean(memoNumber.trim()) ||
        billDateTouched ||
        Boolean(imageUrl) ||
        billDate !== todayISODate();

    const combinedNotes = [
      memoNumber.trim() ? `Memo / Bill No: ${memoNumber.trim()}` : '',
      includeBillDate && billDate ? `Bill Date: ${billDate}` : '',
      notes.trim() ? notes.trim() : '',
    ]
      .filter(Boolean)
      .join(' • ');

    const custTrimmed = customerName.trim();
    const shouldApplyAdv = useAdvance && partyAdvanceRemaining > 0.009 && Boolean(selectedPartyKey);
    const partyKeyForAdv = selectedPartyKey;
    const payDate = billDate || todayISODate();

    if (editingSale) {
      showActionToast('Saving…', `Updating ${editingSale.invoiceNumber}`, 'saving');
      const editPromise = editSale(editingSale.id, {
        customer: {
          name: custTrimmed,
          phone: customerPhone.trim() || undefined,
          address: customerAddress.trim() || undefined,
        },
        lines,
        vehicleNumber: vehicleNumber.trim() || undefined,
        trackingNumber: trackingNumber.trim() || undefined,
        notes: combinedNotes || undefined,
      });

      setBusy(false);
      onSaved(editingSale);

      editPromise
        .then(async (updated) => {
          let advApplied = 0;
          if (shouldApplyAdv && partyKeyForAdv) {
            try {
              advApplied = await applyCustomerAdvanceToSale(updated.id, partyKeyForAdv, payDate);
            } catch (advErr: any) {
              showActionToast(
                `Sale ${updated.invoiceNumber} updated, advance failed`,
                advErr?.message || 'Please apply advance manually.',
                'error'
              );
              return;
            }
          }
          showActionToast(
            `Sale ${updated.invoiceNumber} updated`,
            advApplied > 0
              ? `Stock corrected · Advance ${fmtMoney(advApplied)} applied.`
              : 'Stock and balance corrected.',
            'success'
          );
        })
        .catch((err: any) => {
          clearActionToast();
          showActionToast('Could not update sale', err?.message || 'The sale could not be updated.', 'error');
        });
      return;
    }

    const memoTrimmed = memoNumber.trim();
    const payAmt = receivedNum;
    const mode = payMode;

    let capturedDraft: Sale | null = null;
    const salePromise = createSale(
      {
        customer: {
          name: custTrimmed,
          phone: customerPhone.trim() || undefined,
          address: customerAddress.trim() || undefined,
        },
        lines,
        vehicleNumber: vehicleNumber.trim() || undefined,
        trackingNumber: trackingNumber.trim() || undefined,
        notes: combinedNotes || undefined,
      },
      (draft) => {
        capturedDraft = draft;
      }
    );

    const draftSale = capturedDraft as Sale | null;
    if (!draftSale) {
      try {
        await salePromise;
      } catch (err: any) {
        setSubmitError(err?.message || 'The sale could not be saved.');
      } finally {
        setBusy(false);
      }
      return;
    }

    if (memoTrimmed) {
      try {
        localStorage.setItem(`stodo_memo_${memoTrimmed}_uploaded`, 'true');
      } catch {
        // ignore storage quota failures
      }
    }

    showActionToast('Saving…', `${draftSale.invoiceNumber} · ${custTrimmed}`, 'saving');
    setBusy(false);
    onSaved(draftSale, {
      paidAmount: round2(payAmt + advanceToApply),
      memoNumber: memoTrimmed || undefined,
    });

    salePromise
      .then(async (savedSale) => {
        let advApplied = 0;
        if (shouldApplyAdv && partyKeyForAdv) {
          try {
            advApplied = await applyCustomerAdvanceToSale(savedSale.id, partyKeyForAdv, payDate);
          } catch (advErr: any) {
            console.error('Sale created, advance apply failed:', advErr);
            showActionToast(
              `Sale ${savedSale.invoiceNumber} saved, advance failed`,
              advErr?.message || 'Please apply advance manually.',
              'error'
            );
            return;
          }
        }
        if (payAmt > 0 && permissions.canRecordPayments) {
          try {
            await recordSalePayment(savedSale.id, {
              amount: payAmt,
              date: payDate,
              mode,
              note: '',
            });
          } catch (payErr: any) {
            console.error('Sale created, payment recording failed:', payErr);
            showActionToast(
              `Sale ${savedSale.invoiceNumber} saved, payment failed`,
              payErr?.message || 'Please record payment from invoice details.',
              'error'
            );
            return;
          }
        }
        const paidParts: string[] = [];
        if (advApplied > 0) paidParts.push(`Advance ${fmtMoney(advApplied)}`);
        if (payAmt > 0) paidParts.push(`Received ${fmtMoney(payAmt)}`);
        const paidMsg = paidParts.length > 0 ? ` · ${paidParts.join(' + ')}` : '';
        showActionToast(
          `Sale ${savedSale.invoiceNumber} saved`,
          `Stock taken off for ${savedSale.lines.length} item(s)${paidMsg}.`,
          'success'
        );
      })
      .catch((err: any) => {
        clearActionToast();
        showActionToast('Could not save sale', err?.message || 'The sale could not be saved.', 'error');
      });
  };

  // Build photo banner caption
  const photoReadCaption = useMemo(() => {
    const parts = ['✓ Read from bill photo'];
    if (memoNumber.trim()) parts.push(`Memo ${memoNumber.trim()}`);
    if (billDate) parts.push(billDate);
    return parts.join(' · ');
  }, [memoNumber, billDate]);

  return (
    <div className="max-w-3xl mx-auto pb-48">
      {/* Sticky Top Header */}
      <div
        style={{ top: 'calc(4rem + env(safe-area-inset-top))' }}
        className="sticky z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 mb-4 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 flex items-center justify-between gap-3"
      >
        <button
          type="button"
          onClick={handleRequestCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 cursor-pointer disabled:opacity-50 shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Cancel</span>
        </button>
        <h1 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight truncate">
          {editingSale ? `Edit ${editingSale.invoiceNumber}` : 'New Sale'}
        </h1>
        <div className="w-16 shrink-0" aria-hidden />
      </div>

      <form id="new-sale-form" onSubmit={handleSave} className="space-y-4">
        {editingSale && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900">
            ✎ Editing a saved bill · stock and balance will be corrected on save
          </div>
        )}

        {/* 1. PHOTO BAR (top, create mode only) */}
        {!isEditMode && (
        <div>
          {photoStatus === 'reading' ? (
            <div className="rounded-2xl border-2 border-purple-300 bg-purple-50/80 p-3.5 flex items-center gap-3">
              {imageUrl ? (
                <button
                  type="button"
                  onClick={() => setZoomOpen(true)}
                  className="relative w-12 h-12 rounded-xl overflow-hidden border border-purple-200 shrink-0 cursor-pointer group"
                >
                  <img src={imageUrl} alt="Bill preview" className="w-full h-full object-cover" />
                  <span className="absolute inset-0 bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <ZoomIn className="w-4 h-4 text-white" />
                  </span>
                </button>
              ) : (
                <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                  <Camera className="w-5 h-5 text-purple-600" />
                </div>
              )}
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Loader2 className="w-4 h-4 text-purple-600 animate-spin shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-bold text-purple-900">Reading bill…</div>
                  <div className="text-[11px] text-purple-700">
                    You can start typing customer or items below while we read it.
                  </div>
                </div>
              </div>
            </div>
          ) : photoStatus === 'success' && imageUrl ? (
            <div className="rounded-2xl border border-emerald-300 bg-emerald-50/80 p-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setZoomOpen(true)}
                title="Tap to zoom bill photo"
                className="relative w-12 h-12 rounded-xl overflow-hidden border border-emerald-300 bg-white shrink-0 cursor-pointer group"
              >
                <img src={imageUrl} alt="Uploaded bill photo" className="w-full h-full object-cover" />
                <span className="absolute bottom-0.5 right-0.5 bg-slate-900/75 text-white rounded p-0.5">
                  <ZoomIn className="w-2.5 h-2.5" />
                </span>
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-xs sm:text-sm font-bold text-emerald-900 break-words">
                  {photoReadCaption}
                </div>
                <div className="text-[11px] text-emerald-700 mt-0.5">
                  Tap thumbnail to zoom · Green fields were read from photo
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPhotoChooserOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-100 text-xs font-bold text-emerald-800 shrink-0 cursor-pointer transition"
              >
                Retake
              </button>
            </div>
          ) : photoStatus === 'error' ? (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 flex items-center gap-3">
              {imageUrl && (
                <button
                  type="button"
                  onClick={() => setZoomOpen(true)}
                  title="Tap to zoom bill photo"
                  className="relative w-12 h-12 rounded-xl overflow-hidden border border-amber-300 bg-white shrink-0 cursor-pointer"
                >
                  <img src={imageUrl} alt="Uploaded bill photo" className="w-full h-full object-cover" />
                  <span className="absolute bottom-0.5 right-0.5 bg-slate-900/75 text-white rounded p-0.5">
                    <ZoomIn className="w-2.5 h-2.5" />
                  </span>
                </button>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs sm:text-sm font-bold text-amber-900 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Couldn&apos;t read the photo — please type the details</span>
                </div>
                {imageUrl && (
                  <div className="text-[11px] text-amber-700 mt-0.5">
                    Your photo is saved above — tap thumbnail to zoom and read from it.
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPhotoChooserOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 hover:bg-amber-100 text-xs font-bold text-amber-900 shrink-0 cursor-pointer transition"
              >
                Retake
              </button>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-dashed border-purple-300 bg-purple-50/50 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-bold text-purple-950">
                  📷 Fill from bill photo — Take or choose a photo, we read it for you
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <label className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold cursor-pointer transition shadow-2xs active:scale-98">
                  <Camera className="w-3.5 h-3.5 shrink-0" />
                  <span>Camera</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) processBillPhoto(f);
                      e.target.value = '';
                    }}
                  />
                </label>
                <label className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-purple-200 text-purple-800 text-xs font-bold cursor-pointer transition shadow-2xs active:scale-98">
                  <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>Gallery</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) processBillPhoto(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          )}
        </div>
        )}

        {/* 2. CUSTOMER */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 shadow-2xs">
          <div className="relative" ref={customerBoxRef}>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Customer *
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={customerName}
                onFocus={() => setCustomerDropdownOpen(true)}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setCustomerDropdownOpen(true);
                  clearPhotoFlag('customerName');
                }}
                placeholder="Search customer or type new name…"
                className={`w-full pl-9 pr-8 py-2.5 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900 font-medium transition ${
                  photoFilled.customerName
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-white border-slate-300'
                }`}
              />
              {customerName && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomerName('');
                    clearPhotoFlag('customerName');
                    setCustomerDropdownOpen(true);
                  }}
                  aria-label="Clear customer"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Customer Search Dropdown */}
            {customerDropdownOpen && (
              <div className="absolute left-0 right-0 mt-1.5 bg-white rounded-2xl shadow-xl border border-slate-200 z-30 max-h-64 overflow-y-auto divide-y divide-slate-100">
                {matchingCustomerChoices.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      setCustomerName(c.name);
                      if (c.phone) {
                        setCustomerPhone(c.phone);
                        clearPhotoFlag('customerPhone');
                      }
                      if (c.address) {
                        setCustomerAddress(c.address);
                        clearPhotoFlag('customerAddress');
                      }
                      clearPhotoFlag('customerName');
                      setCustomerDropdownOpen(false);
                    }}
                    className="w-full px-3.5 py-2.5 text-left hover:bg-purple-50/70 flex items-center justify-between gap-2 cursor-pointer transition"
                  >
                    <div className="min-w-0">
                      <div className="text-xs sm:text-sm font-bold text-slate-900 truncate">{c.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {[c.city || c.address, c.phone].filter(Boolean).join(' · ') || 'Past customer'}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      {c.balanceDue > 0.009 ? (
                        <span className="text-xs font-bold font-mono text-rose-600">
                          Due {fmtMoney(c.balanceDue)}
                        </span>
                      ) : c.balanceDue < -0.009 ? (
                        <span className="text-xs font-bold font-mono text-emerald-700">
                          Advance {fmtMoney(-c.balanceDue)}
                        </span>
                      ) : (
                        <span className="text-[11px] font-semibold text-emerald-700">₹0 due</span>
                      )}
                    </div>
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    clearPhotoFlag('customerName');
                    setCustomerDropdownOpen(false);
                  }}
                  className="w-full px-3.5 py-2.5 text-left bg-slate-50/80 hover:bg-purple-50 text-purple-700 text-xs font-bold flex items-center gap-2 cursor-pointer transition"
                >
                  <UserPlus className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {customerName.trim() ? `＋ New customer "${customerName.trim()}"` : '＋ New customer'}
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Phone (optional)
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => {
                  setCustomerPhone(e.target.value);
                  clearPhotoFlag('customerPhone');
                }}
                placeholder="Mobile no."
                className={`w-full px-3 py-2 text-xs sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900 transition ${
                  photoFilled.customerPhone
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-white border-slate-300'
                }`}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                City / address (optional)
              </label>
              <input
                type="text"
                value={customerAddress}
                onChange={(e) => {
                  setCustomerAddress(e.target.value);
                  clearPhotoFlag('customerAddress');
                }}
                placeholder="City / address"
                className={`w-full px-3 py-2 text-xs sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900 transition ${
                  photoFilled.customerAddress
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-white border-slate-300'
                }`}
              />
            </div>
          </div>

          {customerName.trim() && partyAdvanceRemaining > 0.009 && (
            <label className="flex items-center justify-between gap-2.5 p-3 rounded-xl bg-emerald-50 border border-emerald-300 cursor-pointer select-none">
              <div className="flex items-center gap-2.5 min-w-0">
                <input
                  type="checkbox"
                  checked={useAdvance}
                  onChange={(e) => setUseAdvance(e.target.checked)}
                  className="w-4 h-4 rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500 shrink-0"
                />
                <span className="text-xs sm:text-sm font-bold text-emerald-900 leading-snug">
                  Advance available {fmtMoney(partyAdvanceRemaining)} — use on this bill
                </span>
              </div>
              {advanceToApply > 0.009 && (
                <span className="text-xs font-mono font-bold text-emerald-700 shrink-0">
                  −{fmtMoney(advanceToApply)}
                </span>
              )}
            </label>
          )}
        </div>

        {/* 3. ITEMS (compact table, fits phone width) */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="px-3.5 py-2.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              ITEMS ({rows.length})
            </h2>
            {rows.some((r) => !r.itemId) && (
              <span className="text-[11px] font-semibold text-amber-700">
                Tap &quot;match a product&quot; to link slip lines
              </span>
            )}
          </div>

          <table className="w-full table-fixed text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <th className="py-2 pl-3 pr-1">Item</th>
                <th className="py-2 px-1 text-right w-[56px] sm:w-[68px]">Qty</th>
                <th className="py-2 px-1 text-right w-[68px] sm:w-[82px]">Rate</th>
                <th className="py-2 px-1 text-right w-[68px] sm:w-[86px]">Amount</th>
                <th className="py-2 pr-2 w-[30px]" aria-label="Remove" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {evaluatedRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-xs text-slate-400 px-4">
                    No items added yet. Tap &quot;＋ Add item&quot; below.
                  </td>
                </tr>
              ) : (
                evaluatedRows.map((eRow) => {
                  const {
                    row,
                    item,
                    stock,
                    availableStock,
                    returnedForItem,
                    amount,
                    isUnmatched,
                    isOverStock,
                    missingRate,
                    isFree,
                    belowReturned,
                  } = eRow;
                  const rowHighlight = isUnmatched
                    ? 'bg-amber-50/40'
                    : isOverStock || belowReturned
                    ? 'bg-rose-50/40'
                    : '';

                  return (
                    <tr key={row.id} className={rowHighlight}>
                      {/* ITEM: name + stock N + amber problem prompt */}
                      <td className="py-2.5 pl-3 pr-1 align-top">
                        {item ? (
                          <button
                            type="button"
                            onClick={() => {
                              setPickerSearch('');
                              setPickerTargetRowId(row.id);
                            }}
                            className={`text-left w-full rounded-lg px-1.5 py-0.5 -mx-1.5 transition cursor-pointer ${
                              photoFilled[`rowItem:${row.id}`]
                                ? 'bg-emerald-50 border border-emerald-300'
                                : 'hover:bg-slate-50'
                            }`}
                          >
                            <div className="text-xs sm:text-sm font-semibold text-slate-900 leading-snug break-words">
                              <span>{item.name}</span>
                              {isFree && (
                                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase bg-emerald-100 text-emerald-700 border border-emerald-200 align-middle">
                                  FREE
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5">
                              stock {stock}
                              {returnedForItem > 0 ? ` · ${returnedForItem} returned` : ''}
                            </div>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setPickerSearch('');
                              setPickerTargetRowId(row.id);
                            }}
                            className="text-left w-full cursor-pointer group"
                          >
                            <div className="text-xs sm:text-sm font-semibold text-slate-900 leading-snug break-words">
                              {row.originalText || 'Unmatched slip item'}
                            </div>
                            <div className="text-[11px] font-bold text-amber-700 group-hover:underline mt-0.5">
                              match a product
                            </div>
                          </button>
                        )}

                        {!isUnmatched && belowReturned && (
                          <div className="text-[10px] sm:text-[11px] font-bold text-rose-600 mt-0.5">
                            min {returnedForItem} (already returned)
                          </div>
                        )}
                        {!isUnmatched && !belowReturned && isOverStock && (
                          <div className="text-[10px] sm:text-[11px] font-bold text-amber-700 mt-0.5">
                            {isEditMode ? `only ${availableStock} available` : `only ${stock} in stock`}
                          </div>
                        )}
                        {!isUnmatched && missingRate && (
                          <div className="text-[10px] sm:text-[11px] font-bold text-amber-700 mt-0.5">
                            {row.fromPhoto ? 'enter rate (not on slip)' : 'enter rate'}
                          </div>
                        )}
                      </td>

                      {/* QTY */}
                      <td className="py-2 px-1 align-top text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={row.quantity}
                          onChange={(e) => {
                            updateRow(row.id, { quantity: e.target.value });
                            clearPhotoFlag(`rowQty:${row.id}`);
                          }}
                          className={`w-full px-1.5 py-1.5 text-right text-xs font-semibold rounded-lg border tabular-nums focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                            belowReturned
                              ? 'border-rose-400 bg-rose-50 text-rose-900'
                              : isOverStock || !(Number(row.quantity) > 0)
                              ? 'border-amber-400 bg-amber-50 text-amber-900'
                              : photoFilled[`rowQty:${row.id}`]
                              ? 'border-emerald-300 bg-emerald-50 text-slate-900'
                              : 'border-slate-300 bg-white text-slate-900'
                          }`}
                        />
                      </td>

                      {/* RATE */}
                      <td className="py-2 px-1 align-top text-right">
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={row.rate}
                          placeholder="0"
                          onChange={(e) => {
                            updateRow(row.id, { rate: e.target.value });
                            clearPhotoFlag(`rowRate:${row.id}`);
                          }}
                          className={`w-full px-1.5 py-1.5 text-right text-xs font-semibold rounded-lg border tabular-nums focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                            missingRate
                              ? 'border-amber-400 bg-amber-50 text-amber-900'
                              : photoFilled[`rowRate:${row.id}`]
                              ? 'border-emerald-300 bg-emerald-50 text-slate-900'
                              : 'border-slate-300 bg-white text-slate-900'
                          }`}
                        />
                      </td>

                      {/* AMOUNT */}
                      <td className="py-2.5 px-1 align-top text-right font-mono font-bold text-xs text-slate-900 tabular-nums truncate">
                        {isFree ? (
                          <span className="text-emerald-700">₹0</span>
                        ) : amount > 0 ? (
                          fmtMoney(amount)
                        ) : (
                          '₹0'
                        )}
                      </td>

                      {/* REMOVE */}
                      <td className="py-2 pr-2 align-top text-right">
                        <button
                          type="button"
                          disabled={returnedForItem > 0}
                          onClick={() => removeRow(row.id)}
                          aria-label="Remove item"
                          title={
                            returnedForItem > 0
                              ? `Can't remove — ${returnedForItem} already returned`
                              : 'Remove item'
                          }
                          className="p-1 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <button
            type="button"
            onClick={() => {
              setPickerSearch('');
              setPickerTargetRowId('NEW');
            }}
            className="w-full py-3 px-3.5 border-t border-slate-200 bg-slate-50/50 hover:bg-purple-50/60 text-purple-700 font-semibold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add item</span>
          </button>
        </div>

        {/* 4. MORE DETAILS (collapsed link) */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
          <button
            type="button"
            onClick={() => setMoreOpen((prev) => !prev)}
            className="w-full px-4 py-3 text-left flex items-center justify-between text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              {moreOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-500" />
              )}
              <span>Memo no., date, vehicle, notes (optional)</span>
            </span>
            {(memoNumber || vehicleNumber || trackingNumber || notes) && (
              <span className="text-[11px] font-bold text-purple-600">Filled</span>
            )}
          </button>

          {moreOpen && (
            <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Memo / bill no.
                  </label>
                  <input
                    type="text"
                    value={memoNumber}
                    onChange={(e) => {
                      setMemoNumber(e.target.value);
                      clearPhotoFlag('memoNumber');
                    }}
                    placeholder="e.g. 1110"
                    className={`w-full px-3 py-2 text-xs sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900 ${
                      photoFilled.memoNumber
                        ? 'bg-emerald-50 border-emerald-300'
                        : 'bg-white border-slate-300'
                    }`}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Bill date
                  </label>
                  <input
                    type="date"
                    value={billDate}
                    onChange={(e) => {
                      setBillDate(e.target.value);
                      setBillDateTouched(true);
                      clearPhotoFlag('billDate');
                    }}
                    className={`w-full px-3 py-2 text-xs sm:text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900 ${
                      photoFilled.billDate
                        ? 'bg-emerald-50 border-emerald-300'
                        : 'bg-white border-slate-300'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Vehicle no.
                  </label>
                  <input
                    type="text"
                    value={vehicleNumber}
                    onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                    placeholder="GJ-03-..."
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Tracking no.
                  </label>
                  <input
                    type="text"
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    placeholder="LR / docket"
                    className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any special terms or remarks"
                  className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-900"
                />
              </div>
            </div>
          )}
        </div>

        {/* 5. CHANGES ON SAVE (edit mode only) */}
        {editingSale && (
          <div className="bg-white rounded-2xl border border-slate-200 p-3.5 space-y-2 shadow-2xs">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Changes on save
            </div>
            {editDiff && editDiff.length > 0 ? (
              <div className="space-y-1 text-xs">
                {editDiff.map((c) => (
                  <div key={c.itemId} className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 truncate">{c.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-slate-600">
                      {c.label}{' '}
                      <b className={c.tone === 'emerald' ? 'text-emerald-700' : 'text-amber-700'}>
                        ({c.stockDeltaLabel})
                      </b>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500">No item quantity changes</div>
            )}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500">Total</span>
              <span className="font-mono font-bold text-slate-900">
                {fmtMoney(editingSale.grandTotal)} → {fmtMoney(totals.grandTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">New due</span>
              <span
                className={`font-mono font-bold ${
                  newDueOnEdit > 0.009 ? 'text-rose-600' : 'text-emerald-700'
                }`}
              >
                {fmtMoney(newDueOnEdit)}
              </span>
            </div>
            {totals.grandTotal < netReceivedOnEdit - 0.009 && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700">
                New total is less than amount already received ({fmtMoney(netReceivedOnEdit)})
              </div>
            )}
          </div>
        )}

        {submitError && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{submitError}</span>
          </div>
        )}
      </form>

      {/* 6. STICKY BOTTOM BAR */}
      <div
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        className="fixed bottom-0 left-0 right-0 lg:left-64 z-30 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 py-3 shadow-lg"
      >
        <div className="max-w-3xl mx-auto space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              {isEditMode ? 'New Total' : 'Total'}
            </span>
            <div className="text-right">
              <span className="text-lg sm:text-xl font-black font-mono tabular-nums text-slate-900">
                {fmtMoney(totals.grandTotal)}
              </span>
              {editingSale && (
                <span className="ml-2 text-xs font-semibold text-slate-500">
                  Due {fmtMoney(newDueOnEdit)}
                </span>
              )}
            </div>
          </div>

          {!isEditMode && permissions.canRecordPayments && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 flex-1 min-w-[140px]">
                <label className="text-[11px] font-bold text-slate-600 shrink-0">Received now</label>
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                    ₹
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={receivedNow}
                    onChange={(e) => setReceivedNow(e.target.value)}
                    placeholder="0"
                    className={`w-full pl-6 pr-2 py-1.5 text-xs sm:text-sm font-bold font-mono tabular-nums rounded-xl border focus:outline-none focus:ring-2 focus:ring-purple-500 ${
                      receivedOverTotal
                        ? 'border-rose-400 bg-rose-50 text-rose-700'
                        : 'border-slate-300 bg-white text-slate-900'
                    }`}
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-1 shrink-0">
                {PAYMENT_OPTIONS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPayMode(m.id)}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                      payMode === m.id
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            form="new-sale-form"
            disabled={!validationState.valid || busy}
            className="w-full py-3 px-4 rounded-xl text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 transition shadow-sm cursor-pointer active:scale-99 disabled:bg-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{busy ? 'Saving…' : validationState.label}</span>
          </button>
        </div>
      </div>

      {/* Product Picker Modal (for "+ Add item" or matching a photo row) */}
      {pickerTargetRowId !== null && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setPickerTargetRowId(null)}
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 flex flex-col max-h-[82vh] overflow-hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-slate-900 truncate">
                  {pickerTargetRow?.originalText
                    ? `Match "${pickerTargetRow.originalText}"`
                    : 'Choose product'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {pickerTargetRow?.originalText
                    ? 'Best matches shown first'
                    : 'Search by product name or SKU'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerTargetRowId(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                aria-label="Close product picker"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 border-b border-slate-100 shrink-0">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  autoFocus
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Search name or SKU…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {pickerResults.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">No matching items found.</div>
              ) : (
                pickerResults.map((it) => {
                  const stock = getItemQuantity(it);
                  const isCurrent = pickerTargetRow?.itemId === it.id;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => handlePickProduct(it)}
                      className={`w-full px-4 py-2.5 text-left flex items-center gap-3 hover:bg-purple-50/70 transition cursor-pointer ${
                        isCurrent ? 'bg-purple-50' : ''
                      }`}
                    >
                      {it.photoThumb ? (
                        <img
                          src={it.photoThumb}
                          alt={it.name}
                          className="w-10 h-10 rounded-xl object-cover border border-slate-200 shrink-0 bg-white"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 shrink-0">
                          <Package className="w-4 h-4" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="text-xs sm:text-sm font-semibold text-slate-900 truncate">
                          {it.name}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-2">
                          {it.sku && <span className="font-mono">{it.sku}</span>}
                          <span>
                            stock{' '}
                            <b className={stock <= 0 ? 'text-rose-600' : 'text-slate-700'}>
                              {stock} {it.unit}
                            </b>
                          </span>
                          {it.sellingPrice && it.sellingPrice > 0 ? (
                            <span className="font-mono text-slate-600">{fmtMoney(it.sellingPrice)}</span>
                          ) : null}
                        </div>
                      </div>

                      {isCurrent && <Check className="w-4 h-4 text-purple-600 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photo Source Chooser Modal (opened automatically when tapped "📷 Bill" / "Upload Bill Photo" or "Retake") */}
      {photoChooserOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setPhotoChooserOpen(false)}
        >
          <div
            className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl border border-slate-200 space-y-3"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">Fill from bill photo</h3>
              <button
                type="button"
                onClick={() => setPhotoChooserOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Take or choose a photo of the handwritten bill and we&apos;ll read customer &amp; items automatically.
            </p>
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <label className="py-3 px-4 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition shadow-xs">
                <Camera className="w-4 h-4" />
                <span>Camera</span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) processBillPhoto(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className="py-3 px-4 rounded-xl bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition shadow-xs">
                <ImageIcon className="w-4 h-4 text-purple-600" />
                <span>Gallery</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) processBillPhoto(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={() => setPhotoChooserOpen(false)}
              className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Type manually instead
            </button>
          </div>
        </div>
      )}

      {/* Fullscreen Photo Zoom Modal */}
      {zoomOpen && imageUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-sm flex flex-col"
          onClick={() => setZoomOpen(false)}
        >
          <div
            className="p-4 flex items-center justify-between text-white shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-bold truncate">
              {memoNumber ? `Memo ${memoNumber}` : 'Bill photo'}
              {customerName ? ` · ${customerName}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setZoomOpen(false)}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer transition"
              aria-label="Close zoom"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
            <img
              src={imageUrl}
              alt="Bill photo fullscreen"
              className="max-h-[85vh] max-w-full object-contain rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* Discard Confirmation Dialog */}
      {discardDialogOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/70 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-sm w-full p-5 shadow-2xl space-y-3">
            <h3 className="text-base font-bold text-slate-900">
              {isEditMode ? 'Discard changes?' : 'Discard this sale?'}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">
              {isEditMode
                ? 'Your unsaved edits to this bill will be lost.'
                : 'The details you entered on this sale will be lost.'}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDiscardDialogOpen(false)}
                className="px-4 py-2 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl cursor-pointer hover:bg-slate-50"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={() => {
                  setDiscardDialogOpen(false);
                  onCancel();
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl cursor-pointer"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
