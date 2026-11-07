import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  Camera,
  CheckCircle2,
  AlertCircle,
  FileText,
  Upload,
  Sparkles,
  RefreshCw,
  Plus,
  Trash2,
  PackageCheck,
  Calendar,
  User,
  Hash,
  AlertTriangle,
  ArrowRight,
  ZoomIn,
  Maximize2,
  ChevronDown,
  ChevronUp,
  MapPin,
  Phone,
  Image as ImageIcon,
} from 'lucide-react';
import { useInventory } from '../../context/InventoryContext';
import { useTrade, SaleLineInput } from '../../context/TradeContext';
import { useAuth } from '../../context/AuthContext';
import { InventoryItem, Sale } from '../../types/inventory';
import { getItemQuantity } from '../../utils/itemResolver';
import { formatINR, calcLine, sumLines } from '../../utils/tradeMath';

export interface PhotoBillItem {
  id: string; // local row id
  originalText: string; // text from slip (e.g. 'WB.30')
  selectedItemId: string; // ID of existing inventory item (MUST be an existing item)
  quantity: number;
  rate: number;
  gstPct: number;
}

interface PhotoBillModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (sale: Sale) => void;
  initialImageUrl?: string;
}

/**
 * Intelligent fuzzy matching to find closest existing inventory items for a given slip text
 */
// Loose product-code match: ignores case, spaces, dots and bracket notes like (3x3).
// "wb. 40z (3x3)" matches "WB.40Z".
const normCode = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]/g, '');

function findSuggestions(queryText: string, inventory: InventoryItem[], limit = 4): InventoryItem[] {
  if (!queryText.trim() || !inventory.length) return inventory.slice(0, limit);

  const clean = queryText.toLowerCase().replace(/[^a-z0-9]/g, '');
  const tokens = queryText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);

  const scored = inventory.map((it) => {
    let score = 0;
    const nameClean = it.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const skuClean = (it.sku || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Exact or direct substring match
    if (nameClean === clean || skuClean === clean) score += 100;
    else if (nameClean.includes(clean) || (skuClean && skuClean.includes(clean))) score += 60;
    else if (clean.includes(nameClean) || (skuClean && clean.includes(skuClean))) score += 50;

    // Token-level matching (e.g., '30', '40', 'wb', '38b20l', 'battery')
    for (const t of tokens) {
      if (t.length > 1) {
        if (nameClean.includes(t)) score += 20;
        if (skuClean.includes(t)) score += 25;
      }
    }

    // Finished goods preference for sales
    if (it.type === 'finished_good') score += 5;
    // In-stock preference
    if (getItemQuantity(it) > 0) score += 3;

    return { item: it, score };
  });

  const matches = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (matches.length > 0) {
    return matches.slice(0, limit).map((s) => s.item);
  }

  // Fallback: first few finished goods or items
  return inventory.slice(0, limit);
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

        // Fill background with white in case of transparent pngs converted to jpeg
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

const BILL_PHOTO_PLACEHOLDER =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="#f1f5f9"/><text x="150" y="105" font-family="sans-serif" font-size="14" fill="#64748b" text-anchor="middle">No bill photo yet - take photo or upload</text></svg>'
  );

export const PhotoBillModal: React.FC<PhotoBillModalProps> = ({
  open,
  onClose,
  onSaved,
  initialImageUrl = '',
}) => {
  const { items } = useInventory();
  const { createSale } = useTrade();
  const { permissions } = useAuth();

  const [imageUrl, setImageUrl] = useState<string>(initialImageUrl);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [memoNumber, setMemoNumber] = useState('');
  const [billDate, setBillDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Mobile layout state
  const [mobileTab, setMobileTab] = useState<'form' | 'photo'>('form');
  const [showInlinePhoto, setShowInlinePhoto] = useState(false);
  const [zoomModalOpen, setZoomModalOpen] = useState(false);

  // Initial bill lines from the photo slip
  const [billItems, setBillItems] = useState<PhotoBillItem[]>([
    { id: 'row-1', originalText: '', selectedItemId: '', quantity: 1, rate: 0, gstPct: 0 },
  ]);

  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start every bill with a clean form (no left-over customer/items from the last bill)
  useEffect(() => {
    if (!open) return;
    setImageUrl(initialImageUrl || '');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerAddress('');
    setMemoNumber('');
    setBillDate(new Date().toISOString().slice(0, 10));
    setBillItems([{ id: 'row-1', originalText: '', selectedItemId: '', quantity: 1, rate: 0, gstPct: 0 }]);
    setNotes('');
    setError(null);
    setIsReading(false);
    setMobileTab('form');
  }, [open, initialImageUrl]);

  // Auto-match exact matches on load or whenever items change
  useEffect(() => {
    if (!items.length) return;

    setBillItems((prev) =>
      prev.map((row) => {
        // If already selected and item still exists, keep it
        if (row.selectedItemId && items.some((it) => it.id === row.selectedItemId)) {
          return row;
        }

        // Try exact match by name or SKU
        const cleanText = row.originalText.trim().toLowerCase();
        if (!cleanText) return row;

        const exact = items.find(
          (it) =>
            it.name.trim().toLowerCase() === cleanText ||
            (it.sku && it.sku.trim().toLowerCase() === cleanText) ||
            (!!normCode(row.originalText) &&
              (normCode(it.name) === normCode(row.originalText) || normCode(it.sku || '') === normCode(row.originalText)))
        );

        if (exact) {
          return {
            ...row,
            selectedItemId: exact.id,
            rate: row.rate > 0 ? row.rate : (exact.sellingPrice || 0),
          };
        }

        return row;
      })
    );
  }, [items]);

  if (!open) return null;

  /**
   * Handle photo chosen or taken: shrink image to max 1600px at 0.8 quality,
   * call server-side Gemini OCR API, and auto-populate form.
   */
  const processBillPhoto = async (file: File) => {
    setIsReading(true);
    setError(null);

    try {
      // 1. Shrink image to max 1600px on the long side, JPEG quality 0.8
      const { dataUrl, base64, mimeType } = await shrinkImage(file, 1600, 0.8);
      setImageUrl(dataUrl);

      // 2. Call server-side Gemini OCR endpoint
      const response = await fetch('/api/ocr-bill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });

      const resData = await response.json();
      if (!response.ok || !resData.success) {
        throw new Error(resData.error || 'Failed to read bill photo from server');
      }

      const ocr = resData.data || {};

      // 3. Fill the PhotoBillModal form with the result
      if (typeof ocr.customerName === 'string' && ocr.customerName.trim()) {
        setCustomerName(ocr.customerName.trim());
      }
      if (typeof ocr.customerPhone === 'string' && ocr.customerPhone.trim()) {
        setCustomerPhone(ocr.customerPhone.trim());
      }
      if (typeof ocr.customerAddress === 'string' && ocr.customerAddress.trim()) {
        setCustomerAddress(ocr.customerAddress.trim());
      }
      if (typeof ocr.memoNumber === 'string' && ocr.memoNumber.trim()) {
        setMemoNumber(ocr.memoNumber.trim());
      }
      if (typeof ocr.billDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ocr.billDate.trim())) {
        setBillDate(ocr.billDate.trim());
      }

      // One row per item: originalText = item name as written, quantity, rate
      // Auto-select inventory product when name or SKU matches exactly
      if (Array.isArray(ocr.items) && ocr.items.length > 0) {
        const newRows: PhotoBillItem[] = ocr.items.map((it: any, idx: number) => {
          const writtenName = String(it?.name || '').trim();
          const cleanWritten = writtenName.toLowerCase();

          // Check exact match by name or SKU
          const exact = items.find(
            (inv) =>
              inv.name.trim().toLowerCase() === cleanWritten ||
              (inv.sku && inv.sku.trim().toLowerCase() === cleanWritten) ||
            (!!normCode(writtenName) &&
              (normCode(inv.name) === normCode(writtenName) || normCode(inv.sku || '') === normCode(writtenName)))
          );

          const qty = Number(it?.quantity) > 0 ? Number(it?.quantity) : 1;
          const rateVal = Number(it?.rate) > 0 ? Number(it?.rate) : (exact?.sellingPrice || 0);

          return {
            id: `ocr-${Date.now()}-${idx}`,
            originalText: writtenName,
            selectedItemId: exact ? exact.id : '',
            quantity: qty,
            rate: rateVal,
            gstPct: 0,
          };
        });

        setBillItems(newRows.length > 0 ? newRows : [{ id: 'row-1', originalText: '', selectedItemId: '', quantity: 1, rate: 0, gstPct: 0 }]);
      }
    } catch (err: any) {
      console.error('OCR Bill reading error:', err);
      setError(err?.message || 'Reading bill failed. Form remains editable for manual entry.');
    } finally {
      setIsReading(false);
    }
  };

  const updateItem = (id: string, patch: Partial<PhotoBillItem>) => {
    setBillItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, ...patch };

        // If selectedItemId changed, optionally update default rate from that item if rate is 0
        if (patch.selectedItemId !== undefined) {
          const it = items.find((i) => i.id === patch.selectedItemId);
          if (it && !updated.rate) {
            updated.rate = it.sellingPrice || 0;
          }
        }
        return updated;
      })
    );
  };

  const removeItem = (id: string) => {
    setBillItems((prev) => prev.filter((item) => item.id !== id));
  };

  const addItemRow = () => {
    const newId = `row-${Date.now()}`;
    setBillItems((prev) => [
      ...prev,
      { id: newId, originalText: '', selectedItemId: '', quantity: 1, rate: 0, gstPct: 0 },
    ]);
  };

  // Evaluate mapping & stock for each row
  const rowStatuses = billItems.map((bi) => {
    const matchedItem = items.find((i) => i.id === bi.selectedItemId);
    const stock = matchedItem ? getItemQuantity(matchedItem) : 0;
    const isMapped = !!matchedItem;
    const isOverStock = isMapped && bi.quantity > stock;
    const suggestions = !isMapped ? findSuggestions(bi.originalText, items) : [];

    return {
      bi,
      matchedItem,
      stock,
      isMapped,
      isOverStock,
      suggestions,
    };
  });

  // Check for duplicates among mapped items
  const mappedIds = billItems.map((b) => b.selectedItemId).filter(Boolean);
  const duplicateIds = mappedIds.filter((id, idx) => mappedIds.indexOf(id) !== idx);
  const hasDuplicates = duplicateIds.length > 0;

  const unmappedRowsCount = rowStatuses.filter((r) => !r.isMapped).length;
  const overStockRowsCount = rowStatuses.filter((r) => r.isOverStock).length;
  const hasInvalidQtyOrRate = billItems.some((b) => !(Number(b.quantity) > 0) || !(Number(b.rate) > 0));

  const canSubmit =
    unmappedRowsCount === 0 &&
    overStockRowsCount === 0 &&
    !hasDuplicates &&
    billItems.length > 0 &&
    !hasInvalidQtyOrRate &&
    !isReading &&
    !busy;

  const totals = sumLines(
    billItems.map((bi) =>
      calcLine({
        quantity: bi.quantity,
        rate: bi.rate,
        discountPct: 0,
        gstPct: bi.gstPct,
      })
    )
  );

  const handleSubmit = async () => {
    if (isReading) return;

    if (!permissions.canCreateSales) {
      setError('Your user role does not have permission to create sales.');
      return;
    }

    if (!customerName.trim()) {
      setError('Please enter the customer name.');
      return;
    }

    if (!billItems.length) {
      setError('Please add at least one item.');
      return;
    }

    if (unmappedRowsCount > 0) {
      setError('All bill items must be mapped to existing products in your inventory.');
      return;
    }

    if (hasDuplicates) {
      setError('The same inventory item cannot be selected on two rows. Combine quantities.');
      return;
    }

    if (overStockRowsCount > 0) {
      setError('One or more items exceed current stock on hand. Adjust quantity or restock.');
      return;
    }

    if (billItems.some((b) => !(Number(b.quantity) > 0) || !(Number(b.rate) > 0))) {
      setError('Enter a quantity and a rate (more than 0) for every item.');
      return;
    }

    setError(null);
    setBusy(true);

    try {
      const saleLines: SaleLineInput[] = billItems.map((bi) => ({
        itemId: bi.selectedItemId,
        quantity: bi.quantity,
        rate: Number(bi.rate) || 0,
        discountPct: 0,
        gstPct: Number(bi.gstPct) || 0,
      }));

      const finalNotes = [
        memoNumber ? `Memo / Bill No: ${memoNumber}` : '',
        billDate ? `Bill Date: ${billDate}` : '',
        notes ? notes : '',
      ]
        .filter(Boolean)
        .join(' • ');

      const sale = await createSale({
        customer: {
          name: customerName.trim(),
          phone: customerPhone.trim() || undefined,
          address: customerAddress.trim() || undefined,
        },
        lines: saleLines,
        notes: finalNotes,
      });

      // Mark this memo as uploaded
      if (memoNumber) {
        try {
          localStorage.setItem(`stodo_memo_${memoNumber}_uploaded`, 'true');
        } catch {}
      }

      onSaved(sale);
      onClose();
    } catch (err: any) {
      console.error('Failed to create sale from photo:', err);
      setError(err?.message || 'Failed to save sale. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Reusable Form Component for both Mobile and Desktop
  const FormFieldsContent = () => (
    <div className="space-y-4">
      {/* Phone Header Action Buttons: "Take Photo" (camera) & "Choose from Gallery" */}
      <div className="lg:hidden space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <label
            className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-98 transition ${
              isReading
                ? 'bg-slate-100 text-slate-400 border-slate-200 pointer-events-none'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600'
            }`}
          >
            <Camera className="w-4 h-4 shrink-0" />
            <span className="truncate">Take Photo</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={isReading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processBillPhoto(f);
                e.target.value = '';
              }}
            />
          </label>

          <label
            className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-98 transition ${
              isReading
                ? 'bg-slate-100 text-slate-400 border-slate-200 pointer-events-none'
                : 'bg-white hover:bg-slate-50 text-slate-800 border-slate-300'
            }`}
          >
            <ImageIcon className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="truncate">Choose from Gallery</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={isReading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processBillPhoto(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {/* Reading Bill Progress Banner */}
        {isReading && (
          <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-950 flex items-center gap-2.5 animate-pulse">
            <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />
            <div className="min-w-0">
              <span className="text-xs font-black text-indigo-950 block">Reading bill...</span>
              <span className="text-[11px] text-indigo-700">Analyzing handwritten slip and extracting line items</span>
            </div>
          </div>
        )}
      </div>

      {/* Desktop Reading Indicator */}
      {isReading && (
        <div className="hidden lg:flex p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-950 items-center gap-2.5 animate-pulse">
          <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />
          <div className="min-w-0">
            <span className="text-xs font-black text-indigo-950 block">Reading bill...</span>
            <span className="text-[11px] text-indigo-700">Analyzing handwritten slip with Gemini AI and auto-filling form</span>
          </div>
        </div>
      )}

      {/* Mobile Quick Photo Reference Strip (Shown only in mobile view on form tab) */}
      <div className="lg:hidden p-3 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-xs">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setZoomModalOpen(true)}
              className="relative w-12 h-12 rounded-xl bg-slate-800 border border-indigo-400/30 overflow-hidden shrink-0 group active:scale-95 transition"
              title="Tap to zoom photo"
            >
              <img src={imageUrl || BILL_PHOTO_PLACEHOLDER} alt="Bill Thumbnail" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                <ZoomIn className="w-4 h-4 text-white" />
              </div>
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] font-extrabold text-amber-300 font-mono">
                  {memoNumber ? `Memo #${memoNumber}` : 'Bill Slip'}
                </span>
                <span className="text-[10px] text-slate-300">• {billDate}</span>
              </div>
              <p className="text-xs font-bold text-white truncate">{customerName || 'No customer name yet'}</p>
              <p className="text-[10px] text-indigo-200/80">{billItems.length} item(s) on slip</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setZoomModalOpen(true)}
              className="px-2.5 py-1.5 rounded-lg bg-indigo-600/40 hover:bg-indigo-600/60 border border-indigo-400/40 text-[11px] font-bold text-white flex items-center gap-1 cursor-pointer active:scale-95 transition"
            >
              <ZoomIn className="w-3.5 h-3.5 text-indigo-300" />
              <span>Zoom</span>
            </button>
            <button
              type="button"
              onClick={() => setShowInlinePhoto(!showInlinePhoto)}
              className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition cursor-pointer"
              title={showInlinePhoto ? 'Hide inline photo' : 'Show inline photo'}
            >
              {showInlinePhoto ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Expandable Inline Photo Viewer on Mobile */}
        {showInlinePhoto && (
          <div className="mt-3 pt-3 border-t border-indigo-500/20 space-y-2 animate-in fade-in">
            <div className="rounded-xl overflow-hidden bg-black/40 border border-indigo-400/20 flex items-center justify-center p-1 max-h-[220px]">
              <img
                src={imageUrl || BILL_PHOTO_PLACEHOLDER}
                alt="Bill Slip"
                onClick={() => setZoomModalOpen(true)}
                className="max-h-[210px] w-auto object-contain rounded-lg cursor-zoom-in"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-indigo-200 flex-wrap gap-2">
              <span>Tap photo to expand fullscreen</span>
              <div className="flex items-center gap-2">
                <label className="text-amber-300 font-bold hover:underline cursor-pointer flex items-center gap-1">
                  <Camera className="w-3 h-3" />
                  Take photo
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    disabled={isReading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) processBillPhoto(f);
                      e.target.value = '';
                    }}
                  />
                </label>
                <label className="text-amber-300 font-bold hover:underline cursor-pointer flex items-center gap-1">
                  <ImageIcon className="w-3 h-3" />
                  Gallery
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={isReading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) processBillPhoto(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Customer & Memo Details Card */}
      <div className="p-3 sm:p-4 rounded-2xl bg-slate-50/70 border border-slate-200/90 space-y-3">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
          <span>Customer & Memo Info</span>
          <span className="font-mono text-indigo-600 font-semibold text-[10px]">
            {isReading ? 'Reading from bill...' : 'Auto-filled from memo'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
              <User className="w-3 h-3 text-indigo-600" />
              Customer (M/s.)
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              className="w-full px-3 py-2 text-xs font-bold text-slate-900 rounded-xl border border-slate-200 focus:outline-indigo-500 bg-white"
              placeholder="Customer Name"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
              <Phone className="w-3 h-3 text-indigo-600" />
              Phone Number
            </label>
            <input
              type="text"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="w-full px-3 py-2 text-xs font-bold text-slate-900 rounded-xl border border-slate-200 focus:outline-indigo-500 bg-white"
              placeholder="Customer Phone"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
              <Hash className="w-3 h-3 text-indigo-600" />
              Memo / Bill No.
            </label>
            <input
              type="text"
              value={memoNumber}
              onChange={(e) => setMemoNumber(e.target.value)}
              className="w-full px-3 py-2 text-xs font-bold text-slate-900 rounded-xl border border-slate-200 focus:outline-indigo-500 bg-white font-mono"
              placeholder="Memo No."
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
              <Calendar className="w-3 h-3 text-indigo-600" />
              Bill Date
            </label>
            <input
              type="date"
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
              className="w-full px-3 py-2 text-xs font-medium text-slate-900 rounded-xl border border-slate-200 focus:outline-indigo-500 bg-white"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
              <MapPin className="w-3 h-3 text-indigo-600" />
              City / Address
            </label>
            <input
              type="text"
              value={customerAddress}
              onChange={(e) => setCustomerAddress(e.target.value)}
              className="w-full px-3 py-2 text-xs text-slate-900 rounded-xl border border-slate-200 focus:outline-indigo-500 bg-white"
              placeholder="Customer address"
            />
          </div>
        </div>
      </div>

      {/* Line Items Section */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <PackageCheck className="w-4 h-4 text-emerald-600" />
            Bill Items ({billItems.length})
          </span>
          <button
            type="button"
            onClick={addItemRow}
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-indigo-600 hover:bg-indigo-50 flex items-center gap-1 cursor-pointer transition active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Row
          </button>
        </div>

        <div className="space-y-3">
          {rowStatuses.map(({ bi, matchedItem, stock, isMapped, isOverStock, suggestions }, index) => {
            const rowCalc = calcLine({
              quantity: bi.quantity,
              rate: bi.rate,
              discountPct: 0,
              gstPct: bi.gstPct,
            });

            return (
              <div
                key={bi.id}
                className={`p-3.5 sm:p-4 rounded-2xl border transition-all ${
                  !isMapped
                    ? 'border-amber-300 bg-amber-50/50 shadow-xs ring-1 ring-amber-300/60'
                    : isOverStock
                    ? 'border-rose-300 bg-rose-50/50'
                    : 'border-slate-200 bg-white shadow-2xs'
                }`}
              >
                {/* Header Row: Slip Text & Actions */}
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-700 text-[11px] font-black flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>
                    <span className="text-xs font-mono font-extrabold px-2 py-0.5 rounded bg-slate-100 text-slate-900 border border-slate-200 shadow-2xs truncate max-w-[200px] sm:max-w-none">
                      Slip: &quot;{bi.originalText || 'Item'}&quot;
                    </span>

                    {isMapped ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        Matched: {matchedItem?.name}
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 border border-amber-200 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 text-amber-600" />
                        Select Product Below
                      </span>
                    )}
                  </div>

                  {billItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(bi.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                      title="Remove row"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Slip Original Text Input if user wants to edit what was written */}
                <div className="mb-2">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5">
                    Written on Bill:
                  </label>
                  <input
                    type="text"
                    value={bi.originalText}
                    onChange={(e) => updateItem(bi.id, { originalText: e.target.value })}
                    className="w-full px-2.5 py-1.5 text-xs font-medium text-slate-800 rounded-lg border border-slate-200 focus:outline-indigo-500 bg-white font-mono"
                    placeholder="e.g. WB.30, WB.40Z"
                  />
                </div>

                {/* Product Selection Dropdown */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    Existing Inventory Product:
                  </label>
                  <select
                    value={bi.selectedItemId}
                    onChange={(e) => updateItem(bi.id, { selectedItemId: e.target.value })}
                    className={`w-full px-3 py-2 text-xs font-bold rounded-xl border focus:outline-indigo-500 bg-white cursor-pointer ${
                      !isMapped
                        ? 'border-amber-400 text-slate-700 bg-amber-50/50 ring-1 ring-amber-300'
                        : 'border-slate-300 text-slate-900'
                    }`}
                  >
                    <option value="">— Choose matching product from inventory —</option>
                    {items.map((it) => {
                      const onHand = getItemQuantity(it);
                      return (
                        <option key={it.id} value={it.id}>
                          {it.name} {it.sku ? `(${it.sku})` : ''} • Stock: {onHand} {it.unit}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Suggested Matches - One-Tap Buttons */}
                {!isMapped && suggestions.length > 0 && (
                  <div className="mt-2.5 p-2.5 rounded-xl bg-white border border-amber-200 shadow-2xs space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-amber-600" />
                      <span>One-Tap Match Suggestions:</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {suggestions.map((sug) => {
                        const sQty = getItemQuantity(sug);
                        return (
                          <button
                            key={sug.id}
                            type="button"
                            onClick={() => updateItem(bi.id, { selectedItemId: sug.id })}
                            className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 transition cursor-pointer flex items-center gap-1.5 active:scale-95 shadow-2xs"
                          >
                            <span>{sug.name}</span>
                            <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-100/80 px-1.5 py-0.2 rounded">
                              {sQty} {sug.unit}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Stock on Hand & Line Total */}
                {isMapped && (
                  <div className="flex items-center justify-between text-[11px] pt-1.5">
                    <span className={`font-semibold ${isOverStock ? 'text-rose-600 font-bold' : 'text-slate-600'}`}>
                      In Stock: <b>{stock} {matchedItem?.unit}</b>
                      {isOverStock && ` (Need ${bi.quantity} — Exceeds stock!)`}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">
                      Line Total: <strong className="text-slate-800">{formatINR(rowCalc.amount)}</strong>
                    </span>
                  </div>
                )}

                {/* Numeric Inputs (Qty, Rate) */}
                <div className="grid grid-cols-2 gap-3 pt-2 mt-2 border-t border-slate-100">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                      Quantity <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      value={bi.quantity}
                      onChange={(e) => updateItem(bi.id, { quantity: Number(e.target.value) || 0 })}
                      className={`w-full px-2.5 py-2 text-xs font-bold rounded-lg border bg-white ${
                        !(Number(bi.quantity) > 0)
                          ? 'border-rose-400 bg-rose-50/30 text-rose-900 focus:outline-rose-500'
                          : 'border-slate-200 text-slate-900 focus:outline-indigo-500'
                      }`}
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">
                      Rate (₹) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={bi.rate}
                      onChange={(e) => updateItem(bi.id, { rate: Number(e.target.value) || 0 })}
                      className={`w-full px-2.5 py-2 text-xs font-bold rounded-lg border bg-white ${
                        !(Number(bi.rate) > 0)
                          ? 'border-rose-400 bg-rose-50/30 text-rose-900 focus:outline-rose-500'
                          : 'border-slate-200 text-slate-900 focus:outline-indigo-500'
                      }`}
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Totals Summary */}
      <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1.5 text-xs">
        <div className="flex justify-between text-slate-600">
          <span>Items Subtotal:</span>
          <span className="font-semibold">{formatINR(totals.subtotal)}</span>
        </div>
        <div className="flex justify-between text-sm font-black text-slate-900 pt-1.5 border-t border-slate-200">
          <span>Invoice Total:</span>
          <span className="text-indigo-600">{formatINR(totals.grandTotal)}</span>
        </div>
        <div className="text-[11px] text-slate-500 pt-0.5">
          Payment Status: <strong className="text-slate-800">Unpaid</strong> (Invoice created for customer review)
        </div>
      </div>

      {/* Validation Alerts */}
      {unmappedRowsCount > 0 && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            Please select an existing product from inventory for all {unmappedRowsCount} unmapped row{unmappedRowsCount > 1 ? 's' : ''} to proceed.
          </span>
        </div>
      )}

      {overStockRowsCount > 0 && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>Quantity exceeds stock on hand for {overStockRowsCount} item{overStockRowsCount > 1 ? 's' : ''}. Please adjust quantity.</span>
        </div>
      )}

      {hasDuplicates && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>The same inventory item cannot be chosen twice. Please combine them into one row.</span>
        </div>
      )}

      {hasInvalidQtyOrRate && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>Every item must have a quantity and rate greater than 0.</span>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );

  // Reusable Photo Preview Content
  const PhotoPreviewContent = () => (
    <div className="space-y-3 flex flex-col justify-between h-full">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-600">
          <span className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-indigo-600" />
            Original Bill Slip Photo
          </span>
          <button
            type="button"
            onClick={() => setZoomModalOpen(true)}
            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
          >
            <Maximize2 className="w-3 h-3" />
            Fullscreen
          </button>
        </div>

        {/* Bill Image Container with Click to Zoom */}
        <div
          onClick={() => setZoomModalOpen(true)}
          className="relative group rounded-2xl border-2 border-slate-200 overflow-hidden bg-white shadow-sm flex items-center justify-center p-2 cursor-zoom-in min-h-[260px] max-h-[380px] lg:max-h-[420px]"
          title="Click to view full size"
        >
          <img src={imageUrl || BILL_PHOTO_PLACEHOLDER} alt="Bill Slip Photo" className="max-h-[360px] w-auto object-contain rounded-xl" />
          <div className="absolute inset-0 bg-slate-900/20 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
            <span className="px-3 py-1.5 rounded-full bg-slate-900/80 text-white text-xs font-bold flex items-center gap-1.5 shadow-md">
              <ZoomIn className="w-3.5 h-3.5" />
              Tap to Enlarge
            </span>
          </div>
        </div>

        {/* Reading progress banner in photo preview tab */}
        {isReading && (
          <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-950 flex items-center gap-2.5 animate-pulse">
            <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin shrink-0" />
            <div className="min-w-0">
              <span className="text-xs font-extrabold text-indigo-950 block">Reading bill...</span>
              <span className="text-[11px] text-indigo-700">Analyzing handwritten slip with Gemini AI</span>
            </div>
          </div>
        )}

        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-1">
          <div className="font-bold flex items-center gap-1.5 text-amber-800">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Existing Inventory Policy</span>
          </div>
          <p className="text-[11px] text-amber-700 leading-relaxed">
            Items sold on bills must be linked to active products already in your Inventory. If the slip name doesn&apos;t match exactly, select the matching product from suggestions.
          </p>
        </div>
      </div>

      <div className="space-y-2 pt-2">
        <div className="grid grid-cols-2 gap-2">
          <label
            className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition shadow-2xs ${
              isReading
                ? 'bg-slate-100 text-slate-400 border-slate-200 pointer-events-none'
                : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
            }`}
          >
            <Camera className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span className="truncate">Take Photo</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={isReading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processBillPhoto(f);
                e.target.value = '';
              }}
            />
          </label>

          <label
            className={`py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition shadow-2xs ${
              isReading
                ? 'bg-slate-100 text-slate-400 border-slate-200 pointer-events-none'
                : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span className="truncate">Choose Gallery</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={isReading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) processBillPhoto(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        {/* In Mobile View, show button to switch to Items tab */}
        <div className="lg:hidden">
          <button
            type="button"
            onClick={() => setMobileTab('form')}
            className="w-full py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer"
          >
            <span>Proceed to Map Items ({billItems.length})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 md:p-6 bg-slate-950/80 backdrop-blur-xs overflow-hidden animate-in fade-in duration-200">
        <div className="bg-white rounded-t-3xl sm:rounded-3xl max-w-5xl w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col h-[94vh] sm:h-auto sm:max-h-[92vh]">
          {/* Top Header */}
          <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shrink-0">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-indigo-600/30 border border-indigo-400/30 p-2 flex items-center justify-center text-indigo-300 shadow-sm shrink-0">
                <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm sm:text-lg font-bold tracking-tight truncate">Confirm Bill from Photo</h2>
                  {isReading ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1 whitespace-nowrap">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Reading bill...
                    </span>
                  ) : unmappedRowsCount === 0 ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
                      All Mapped
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
                      {unmappedRowsCount} Need Matching
                    </span>
                  )}
                </div>
                <p className="text-[11px] sm:text-xs text-indigo-200/80 truncate">
                  {memoNumber ? `Memo #${memoNumber}` : 'New Bill'} • Products must be from existing inventory
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer shrink-0 ml-2"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Mobile View Switcher Tabs (Hidden on lg+) */}
          <div className="lg:hidden flex items-center border-b border-slate-200 bg-slate-100/80 p-1.5 gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setMobileTab('form')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                mobileTab === 'form'
                  ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Bill Items ({billItems.length})</span>
              {unmappedRowsCount > 0 && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
            </button>

            <button
              type="button"
              onClick={() => setMobileTab('photo')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                mobileTab === 'photo'
                  ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Slip Photo</span>
            </button>
          </div>

          {/* DESKTOP BODY (2 Columns: Left Photo, Right Form) */}
          <div className="hidden lg:grid lg:grid-cols-12 gap-0 overflow-y-auto flex-1 divide-x divide-slate-200">
            {/* Left Column: Photo Preview */}
            <div className="lg:col-span-5 p-5 bg-slate-50 overflow-y-auto">
              {PhotoPreviewContent()}
            </div>

            {/* Right Column: Extracted Form */}
            <div className="lg:col-span-7 p-5 space-y-4 overflow-y-auto">
              {FormFieldsContent()}
            </div>
          </div>

          {/* MOBILE BODY (Single responsive scrollable container based on active mobile tab) */}
          <div className="lg:hidden flex-1 overflow-y-auto p-4">
            {mobileTab === 'form' ? FormFieldsContent() : PhotoPreviewContent()}
          </div>

          {/* Modal Footer Actions - Always accessible */}
          <div className="p-3.5 sm:p-5 border-t border-slate-200 bg-white flex flex-col-reverse sm:flex-row items-center justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-bold transition cursor-pointer"
            >
              Cancel
            </button>

            <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
              <div className="text-left sm:text-right">
                <span className="text-[10px] uppercase font-bold text-slate-400 block sm:inline mr-2">Total</span>
                <span className="text-base font-black text-indigo-600">{formatINR(totals.grandTotal)}</span>
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={busy || isReading || !canSubmit}
                className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-white text-xs font-bold shadow-md flex items-center justify-center gap-2 transition ${
                  canSubmit && !isReading && !busy
                    ? 'bg-indigo-600 hover:bg-indigo-500 cursor-pointer active:scale-98'
                    : 'bg-slate-300 cursor-not-allowed'
                }`}
              >
                {busy || isReading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>
                  {isReading
                    ? 'Reading bill...'
                    : unmappedRowsCount > 0
                    ? `Map Products (${unmappedRowsCount} left)`
                    : overStockRowsCount > 0
                    ? 'Fix Stock Quantity'
                    : 'Save Sale & Deduct Stock'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen Photo Zoom Modal / Lightbox */}
      {zoomModalOpen && (
        <div className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-md flex flex-col animate-in fade-in duration-200">
          <div className="p-4 flex items-center justify-between text-white shrink-0">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-bold">
                {memoNumber ? `Memo #${memoNumber}` : 'Bill Slip'} {customerName ? `- ${customerName}` : ''}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setZoomModalOpen(false)}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
            <img
              src={imageUrl || BILL_PHOTO_PLACEHOLDER}
              alt="Full Bill Photo"
              className="max-h-[85vh] max-w-full object-contain rounded-xl shadow-2xl"
            />
          </div>
          <div className="p-3 text-center text-xs text-slate-400 shrink-0">
            {memoNumber ? `Memo #${memoNumber}` : 'Bill'} dated {billDate} • Tap ✕ or anywhere outside to return
          </div>
        </div>
      )}
    </>
  );
};
