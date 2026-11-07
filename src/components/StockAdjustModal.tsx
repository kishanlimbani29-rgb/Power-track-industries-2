import React, { useState, useEffect, useRef } from 'react';
import { X, ArrowDownRight, ArrowUpRight, Trash2, ClipboardCheck, AlertCircle } from 'lucide-react';
import { InventoryItem, StockMovementType } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { formatFirestoreError } from '../firebase/config';
import { getItemQuantity } from '../utils/itemResolver';

interface StockAdjustModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: InventoryItem | null;
}

export const StockAdjustModal: React.FC<StockAdjustModalProps> = ({ isOpen, onClose, item }) => {
  const { items, quickAdjustStock } = useInventory();
  const { permissions } = useAuth();

  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [type, setType] = useState<StockMovementType>('in');
  const [delta, setDelta] = useState<number | string>(5);
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track initialization so items updates from another phone do not reset selected item or inputs
  const wasOpenRef = useRef<boolean>(false);
  const lastTargetItemIdRef = useRef<string | null | undefined>(undefined);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Initialise ONLY when opening or when the targeted item prop explicitly changes
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    const currentTargetId = item ? item.id : null;
    const isNewOpening = !wasOpenRef.current;
    const isTargetSwitched = lastTargetItemIdRef.current !== currentTargetId;

    if (isNewOpening || isTargetSwitched) {
      wasOpenRef.current = true;
      lastTargetItemIdRef.current = currentTargetId;

      if (item) {
        setSelectedItemId(item.id);
      } else if (items.length > 0 && !selectedItemId) {
        setSelectedItemId(items[0].id);
      }
      setDelta(5);
      setReason('');
      setError(null);
    }
  }, [isOpen, item?.id]);

  if (!isOpen) return null;

  const activeItem = (item && items.find((i) => i.id === item.id)) || items.find((i) => i.id === selectedItemId) || items[0] || null;

  if (!activeItem) return null;

  const currentQty = getItemQuantity(activeItem);
  const numericDelta = delta === '' ? 0 : Math.max(0, Number(delta) || 0);

  let previewNewQty = currentQty;
  let isExceedingStock = false;

  if (type === 'in') {
    previewNewQty = currentQty + numericDelta;
  } else if (type === 'out' || type === 'waste') {
    if (numericDelta > currentQty) {
      isExceedingStock = true;
      previewNewQty = 0;
    } else {
      previewNewQty = currentQty - numericDelta;
    }
  } else if (type === 'adjustment') {
    // Physical audit count
    previewNewQty = numericDelta;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedDelta = delta === '' ? 0 : Number(delta);
    if (isNaN(parsedDelta) || (parsedDelta <= 0 && type !== 'adjustment')) {
      setError('Please provide a valid adjustment amount greater than zero.');
      return;
    }

    // Block Stock Out or Waste larger than stock on hand
    if ((type === 'out' || type === 'waste') && parsedDelta > currentQty) {
      setError(`Only ${currentQty} ${activeItem.unit || 'units'} in stock.`);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const defaultReasons: Record<StockMovementType, string> = {
      in: 'Supplier restock / purchase intake',
      out: 'Direct retail sale / counter usage',
      waste: 'Spoilage, damaged raw material or expired item',
      adjustment: 'Periodic physical inventory count adjustment',
      production_consume: 'Manual consumption',
      production_yield: 'Manual production yield',
    };

    const finalReason = reason.trim() || defaultReasons[type] || 'Stock adjustment';

    try {
      await quickAdjustStock(activeItem.id, Number(parsedDelta), type, finalReason);
      onClose();
    } catch (err: any) {
      setError(formatFirestoreError(err, 'Failed to adjust stock.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-base font-bold text-slate-900">Adjust Stock Level</h2>
            <p className="text-xs text-slate-500">Record a live inventory adjustment and movement log</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close dialog (Esc)"
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Item Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Select Item <span className="text-rose-500">*</span>
            </label>
            {item ? (
              <div className="p-2.5 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="font-bold text-sm text-slate-900">{activeItem.name}</div>
                  <div className="text-[11px] text-slate-500">
                    SKU: {activeItem.sku || 'N/A'} • {activeItem.type.replace('_', ' ')}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs text-slate-500">Current Stock</span>
                  <div className="text-sm font-bold text-slate-900">
                    {currentQty} {activeItem.unit}
                  </div>
                </div>
              </div>
            ) : (
              <select
                value={selectedItemId || activeItem.id}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name} ({it.quantity} {it.unit})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Adjustment Type Tabs */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Adjustment Type</label>
            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200">
              <button
                type="button"
                onClick={() => setType('in')}
                className={`flex flex-col items-center py-2 px-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  type === 'in' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <ArrowDownRight className="w-4 h-4 mb-0.5" />
                <span>Stock In</span>
              </button>
              <button
                type="button"
                onClick={() => setType('out')}
                className={`flex flex-col items-center py-2 px-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  type === 'out' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <ArrowUpRight className="w-4 h-4 mb-0.5" />
                <span>Stock Out</span>
              </button>
              <button
                type="button"
                onClick={() => setType('waste')}
                className={`flex flex-col items-center py-2 px-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  type === 'waste' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <Trash2 className="w-4 h-4 mb-0.5" />
                <span>Waste</span>
              </button>
              <button
                type="button"
                onClick={() => setType('adjustment')}
                className={`flex flex-col items-center py-2 px-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  type === 'adjustment' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-200'
                }`}
              >
                <ClipboardCheck className="w-4 h-4 mb-0.5" />
                <span>Count</span>
              </button>
            </div>
          </div>

          {/* Amount / Count & Balance Preview */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {type === 'adjustment' ? `New Physical Count (${activeItem.unit})` : `Quantity (${activeItem.unit})`}
              </label>
              <input
                type="number"
                step="any"
                min="0"
                required
                value={delta}
                onChange={(e) => {
                  setDelta(e.target.value);
                  if (error) setError(null);
                }}
                className={`w-full px-3 py-2 text-sm rounded-xl border bg-white focus:outline-none font-bold ${
                  isExceedingStock
                    ? 'border-rose-400 bg-rose-50 text-rose-900 focus:ring-2 focus:ring-rose-500'
                    : 'border-slate-300 focus:ring-2 focus:ring-indigo-500'
                }`}
              />
              {isExceedingStock && (
                <p className="mt-1 text-xs text-rose-600 font-bold flex items-center gap-1 animate-in fade-in">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Only {currentQty} {activeItem.unit} in stock</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">New Balance Preview</label>
              <div
                className={`px-3 py-2 text-sm rounded-xl border flex items-center justify-between font-bold ${
                  isExceedingStock
                    ? 'bg-rose-50 border-rose-200 text-rose-700'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}
              >
                <span>{previewNewQty.toFixed(2)}</span>
                <span className="text-xs font-normal text-slate-500">{activeItem.unit}</span>
              </div>
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Reason / Notes</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                type === 'in'
                  ? 'e.g. Weekly restock from supplier'
                  : type === 'out'
                  ? 'e.g. Counter sales, event catering'
                  : type === 'waste'
                  ? 'e.g. Dropped bag, expired shelf life'
                  : 'e.g. Month-end physical audit'
              }
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isExceedingStock}
              className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer active:scale-95"
            >
              {isSubmitting ? 'Saving...' : 'Record Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
