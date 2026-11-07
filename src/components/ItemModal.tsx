import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, AlertCircle, ChevronDown, Lock } from 'lucide-react';
import { InventoryItem, ItemType } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { formatFirestoreError } from '../firebase/config';

interface ItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemToEdit?: InventoryItem | null;
  onOpenAdjustStock?: (item: InventoryItem) => void;
}

export const ItemModal: React.FC<ItemModalProps> = ({
  isOpen,
  onClose,
  itemToEdit,
  onOpenAdjustStock,
}) => {
  const { addItem, updateItem, items } = useInventory();
  const { permissions } = useAuth();

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [type, setType] = useState<ItemType>('raw_material');
  const [unit, setUnit] = useState('kg');
  const [quantity, setQuantity] = useState<number | string>(0);
  const [minStock, setMinStock] = useState<number | string>(5);
  const [unitCost, setUnitCost] = useState<number | string>(0);
  const [sellingPrice, setSellingPrice] = useState<number | string>(0);
  const [supplier, setSupplier] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track initialization so updates from another phone DO NOT reset or wipe a half-filled form
  const wasOpenRef = useRef<boolean>(false);
  const initializedItemIdRef = useRef<string | null | undefined>(undefined);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Initialise ONLY when the modal transitions from closed to open, or when itemToEdit identity changes
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    const currentTargetId = itemToEdit ? itemToEdit.id : null;
    const isNewOpening = !wasOpenRef.current;
    const isItemSwitched = initializedItemIdRef.current !== currentTargetId;

    if (isNewOpening || isItemSwitched) {
      wasOpenRef.current = true;
      initializedItemIdRef.current = currentTargetId;

      if (itemToEdit) {
        setName(itemToEdit.name);
        setSku(itemToEdit.sku || '');
        setType(itemToEdit.type);
        setUnit(itemToEdit.unit || 'kg');
        setQuantity(itemToEdit.quantity || 0);
        setMinStock(itemToEdit.minStock || 0);
        setUnitCost(itemToEdit.unitCost || 0);
        setSellingPrice(itemToEdit.sellingPrice || 0);
        setSupplier(itemToEdit.supplier || '');
        setLocation(itemToEdit.location || '');
        setNotes(itemToEdit.notes || '');
      } else {
        setName('');
        const rand = Math.floor(1000 + Math.random() * 9000);
        setSku(`SKU-${rand}`);
        setType('raw_material');
        setUnit('kg');
        setQuantity(10);
        setMinStock(5);
        setUnitCost(2.5);
        setSellingPrice(0);
        setSupplier('');
        setLocation('');
        setNotes('');
      }
      setError(null);
    }
  }, [isOpen, itemToEdit?.id]);

  if (!isOpen) return null;

  // Real-time duplicate detection
  const trimmedName = name.trim();
  const trimmedSku = sku.trim();

  const duplicateNameItem = items.find(
    (i) => i.id !== itemToEdit?.id && i.name.trim().toLowerCase() === trimmedName.toLowerCase()
  );

  const duplicateSkuItem = items.find(
    (i) => i.id !== itemToEdit?.id && trimmedSku && (i.sku || '').trim().toLowerCase() === trimmedSku.toLowerCase()
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Item name is required.');
      return;
    }

    if (!sku.trim()) {
      setError('SKU is required.');
      return;
    }

    if (duplicateNameItem) {
      setError(`Item name "${duplicateNameItem.name}" already exists. Item names must be unique.`);
      return;
    }

    if (duplicateSkuItem) {
      setError(`SKU "${duplicateSkuItem.sku}" is already assigned to "${duplicateSkuItem.name}".`);
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const parsedCost = unitCost === '' ? 0 : Math.max(0, Number(unitCost) || 0);
    const parsedSelling = sellingPrice === '' ? 0 : Math.max(0, Number(sellingPrice) || 0);
    const parsedMinStock = minStock === '' ? 0 : Math.max(0, Number(minStock) || 0);
    const parsedQuantity = quantity === '' ? 0 : Math.max(0, Number(quantity) || 0);

    try {
      if (itemToEdit) {
        // Editing existing item: DO NOT overwrite stock quantity here!
        await updateItem(itemToEdit.id, {
          name: name.trim(),
          sku: sku.trim().toUpperCase(),
          type,
          unit,
          minStock: parsedMinStock,
          unitCost: permissions.canViewCostPerUnit ? parsedCost : itemToEdit.unitCost,
          sellingPrice: parsedSelling,
          supplier: supplier.trim(),
          location: location.trim(),
          notes: notes.trim(),
        });
      } else {
        // New item: records initial stock intake
        await addItem({
          name: name.trim(),
          sku: sku.trim().toUpperCase(),
          type,
          category:
            type === 'raw_material'
              ? 'Raw Materials'
              : type === 'semi_finished'
              ? 'Semi Finished'
              : type === 'finished_good'
              ? 'Finished Goods'
              : 'Composite Items',
          unit,
          quantity: parsedQuantity,
          minStock: parsedMinStock,
          unitCost: parsedCost,
          sellingPrice: parsedSelling,
          supplier: supplier.trim(),
          location: location.trim(),
          notes: notes.trim(),
        });
      }
      onClose();
    } catch (err: any) {
      setError(formatFirestoreError(err, 'Failed to save item.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateSku = () => {
    const prefix =
      type === 'raw_material'
        ? 'RAW'
        : type === 'semi_finished'
        ? 'SMF'
        : type === 'finished_good'
        ? 'FIN'
        : 'ITM';
    const cleanName = name
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 3)
      .toUpperCase();

    const rand = Math.floor(100 + Math.random() * 900);
    setSku(`${prefix}-${cleanName || 'PRD'}-${rand}`);
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-white rounded-2xl max-w-xl w-full shadow-2xl border border-slate-200 flex flex-col max-h-[88vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Pinned Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {itemToEdit ? 'Edit Inventory Item' : 'New Inventory Item'}
            </h2>
            <p className="text-xs text-slate-500">
              {type === 'raw_material'
                ? 'Raw material consumed in recipes'
                : 'Finished good produced and sold'}
            </p>
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
          <div className="mx-5 mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Scrollable Form Body */}
        <form id="item-form" onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Item Type selection */}
          <div>
            <label htmlFor="item-classification-select" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Item Classification <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <select
                id="item-classification-select"
                value={type}
                onChange={(e) => setType(e.target.value as ItemType)}
                className="w-full px-3 py-2.5 text-sm rounded-xl border border-slate-300 bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer appearance-none pr-10"
              >
                <option value="raw_material">Raw Material (Ingredient / Input)</option>
                <option value="semi_finished">Semi Finished (Work in progress)</option>
                <option value="finished_good">Finished Good (Ready for sale)</option>
                <option value="both">Composite (Both input & output)</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {type === 'raw_material' && 'Input ingredient consumed in recipes or assembly.'}
              {type === 'semi_finished' && 'Work in progress intermediate item produced and used internally.'}
              {type === 'finished_good' && 'Final product ready for sale and dispatch.'}
              {type === 'both' && 'Composite item that can be both an ingredient and sold directly.'}
            </p>
          </div>

          {/* Name, SKU & Unit */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Item Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. Organic Bread Flour, Vanilla Latte"
                className={`w-full px-3 py-2 text-sm rounded-xl border focus:outline-none transition ${
                  duplicateNameItem
                    ? 'border-rose-400 bg-rose-50/40 text-rose-900 focus:ring-2 focus:ring-rose-500'
                    : 'border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'
                }`}
              />
              {duplicateNameItem && (
                <p className="mt-1 text-xs text-rose-600 font-medium flex items-center gap-1 animate-in fade-in">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Item name &quot;{duplicateNameItem.name}&quot; already exists.</span>
                </p>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-slate-700">
                  SKU / Code <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={generateSku}
                  className="text-[11px] text-indigo-600 hover:underline flex items-center gap-0.5 cursor-pointer font-medium"
                >
                  <Sparkles className="w-3 h-3" /> Auto
                </button>
              </div>
              <input
                type="text"
                required
                value={sku}
                onChange={(e) => {
                  setSku(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="RAW-FLR-01"
                className={`w-full px-3 py-2 text-sm rounded-xl border uppercase font-mono text-xs focus:outline-none transition ${
                  duplicateSkuItem
                    ? 'border-rose-400 bg-rose-50/40 text-rose-900 focus:ring-2 focus:ring-rose-500'
                    : 'border-slate-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500'
                }`}
              />
              {duplicateSkuItem && (
                <p className="mt-1 text-xs text-rose-600 font-medium flex items-center gap-1 animate-in fade-in">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>SKU already in use by &quot;{duplicateSkuItem.name}&quot;.</span>
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Unit of Measure <span className="text-rose-500">*</span>
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                <option value="kg">kg (Kilograms)</option>
                <option value="g">g (Grams)</option>
                <option value="liters">liters (Liters)</option>
                <option value="ml">ml (Milliliters)</option>
                <option value="pcs">pcs (Pieces / Units)</option>
                <option value="box">box (Boxes)</option>
                <option value="pack">pack (Packs)</option>
                <option value="meters">meters</option>
              </select>
            </div>
          </div>

          {/* Stock Quantities: Read-Only for Existing Items with Adjust Stock Button */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
            {itemToEdit ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-700 flex items-center gap-1">
                      <Lock className="w-3 h-3 text-slate-400" />
                      <span>Current Stock ({unit})</span>
                    </label>
                    <span className="text-[10px] font-semibold text-slate-500 bg-slate-200/70 px-1.5 py-0.5 rounded">
                      Locked / Read-Only
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      readOnly
                      value={quantity}
                      className="flex-1 px-3 py-2 text-sm rounded-xl border border-slate-200 bg-slate-100/90 text-slate-800 font-bold cursor-not-allowed select-none"
                    />
                    {onOpenAdjustStock && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenAdjustStock(itemToEdit);
                        }}
                        className="px-3 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl border border-indigo-200 transition cursor-pointer shrink-0 active:scale-95"
                      >
                        Adjust Stock
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Stock may only change via Adjust Stock, production, or audit approvals so every change is in history.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Min Stock Alert ({unit})
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    System warns when on-hand stock drops below this threshold.
                  </p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Initial Stock ({unit})
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 font-semibold"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Initial intake will be logged in movement history.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Min Stock Alert ({unit})
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Pricing: Unit Cost & Selling Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Cost Per Unit (₹) <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-slate-400 text-sm">₹</span>
                <input
                  type={!permissions.canViewCostPerUnit && itemToEdit ? 'text' : 'number'}
                  step="0.01"
                  min="0"
                  disabled={!permissions.canViewCostPerUnit && !!itemToEdit}
                  value={!permissions.canViewCostPerUnit && itemToEdit ? '••••••' : unitCost}
                  onChange={(e) => setUnitCost(e.target.value)}
                  className={`w-full pl-7 pr-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    !permissions.canViewCostPerUnit && itemToEdit ? 'bg-slate-100 text-slate-400 cursor-not-allowed font-mono' : ''
                  }`}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Selling Price (₹)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-slate-400 text-sm">₹</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>

          {/* Supplier & Location */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Supplier</label>
              <input
                type="text"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="e.g. Grain Supply Co."
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Storage Shelf / Bin</label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Shelf A-3"
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Allergen info, storage requirements, handling instructions..."
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>
        </form>

        {/* Pinned Bottom Actions */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200 rounded-xl transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="item-form"
            disabled={isSubmitting || !!duplicateNameItem || !!duplicateSkuItem}
            className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer active:scale-95"
          >
            {isSubmitting ? 'Saving...' : itemToEdit ? 'Save Changes' : 'Create Item'}
          </button>
        </div>
      </div>
    </div>
  );
};
