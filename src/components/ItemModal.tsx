import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, AlertCircle, ChevronDown, Lock, Camera, Image as ImageIcon, Loader2 } from 'lucide-react';
import { InventoryItem, ItemType } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { formatFirestoreError } from '../firebase/config';
import { resizeProductPhoto } from '../utils/photoResizer';

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
  const { addItem, updateItem, saveItemPhoto, removeItemPhoto, items } = useInventory();
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

  // Photo state
  const [photoThumb, setPhotoThumb] = useState<string | null>(null);
  const [pendingFullPhoto, setPendingFullPhoto] = useState<string | null>(null);
  const [pendingThumbPhoto, setPendingThumbPhoto] = useState<string | null>(null);
  const [isPhotoRemoved, setIsPhotoRemoved] = useState<boolean>(false);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState<boolean>(false);
  const [savingPhotoText, setSavingPhotoText] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

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
        setPhotoThumb(itemToEdit.photoThumb || null);
        setPendingFullPhoto(null);
        setPendingThumbPhoto(null);
        setIsPhotoRemoved(false);
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
        setPhotoThumb(null);
        setPendingFullPhoto(null);
        setPendingThumbPhoto(null);
        setIsPhotoRemoved(false);
      }
      setSavingPhotoText(null);
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

    if (pendingFullPhoto || isPhotoRemoved) {
      setSavingPhotoText('Saving photo...');
    }

    try {
      if (itemToEdit) {
        // Handle photo changes on existing item
        if (isPhotoRemoved) {
          await removeItemPhoto(itemToEdit.id);
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
            photoThumb: null,
            photoUpdatedAt: new Date().toISOString(),
          });
        } else if (pendingFullPhoto && pendingThumbPhoto) {
          await saveItemPhoto(itemToEdit.id, pendingFullPhoto, pendingThumbPhoto);
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
            photoThumb: pendingThumbPhoto,
            photoUpdatedAt: new Date().toISOString(),
          });
        } else {
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
        }
      } else {
        // New item: records initial stock intake and full photo in item_photos
        await addItem(
          {
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
            photoThumb: pendingThumbPhoto || undefined,
            photoUpdatedAt: pendingThumbPhoto ? new Date().toISOString() : undefined,
          },
          pendingFullPhoto || undefined
        );
      }
      onClose();
    } catch (err: any) {
      setError(formatFirestoreError(err, 'Failed to save item.'));
    } finally {
      setIsSubmitting(false);
      setSavingPhotoText(null);
    }
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsProcessingPhoto(true);
    setError(null);
    try {
      const { fullDataUrl, thumbDataUrl } = await resizeProductPhoto(file);
      setPendingFullPhoto(fullDataUrl);
      setPendingThumbPhoto(thumbDataUrl);
      setIsPhotoRemoved(false);
    } catch (err: any) {
      console.error('Error processing product photo:', err);
      setError(err?.message || 'Failed to process selected photo.');
    } finally {
      setIsProcessingPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleRemovePhoto = () => {
    setPhotoThumb(null);
    setPendingFullPhoto(null);
    setPendingThumbPhoto(null);
    setIsPhotoRemoved(true);
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
                ? 'Raw material consumed in BOMs'
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
          {/* Product Photo Section */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Product Photo
              </span>
              {(photoThumb || pendingThumbPhoto) && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="flex items-center gap-1 text-[11px] font-semibold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded-lg border border-rose-200 transition cursor-pointer"
                  title="Remove product photo"
                >
                  <X className="w-3.5 h-3.5 text-rose-600" />
                  <span>Remove</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-3.5">
              {/* Photo Preview Container */}
              <div className="relative w-20 h-20 rounded-xl overflow-hidden shrink-0 border border-slate-200 bg-white flex flex-col items-center justify-center shadow-2xs">
                {pendingThumbPhoto || photoThumb ? (
                  <img
                    src={pendingThumbPhoto || photoThumb || ''}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-center p-1 text-slate-400">
                    <Camera className="w-5 h-5 text-slate-400" />
                    <span className="text-[9px] font-medium text-slate-400 mt-0.5">No photo</span>
                  </div>
                )}

                {/* Red ✕ badge button on top right of photo preview */}
                {(pendingThumbPhoto || photoThumb) && (
                  <button
                    type="button"
                    onClick={handleRemovePhoto}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center shadow-xs cursor-pointer transition active:scale-90"
                    title="Remove photo"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Photo Buttons & Status */}
              <div className="flex-1 space-y-1.5 min-w-0">
                {/* Hidden File Inputs */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={isProcessingPhoto || isSubmitting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 transition cursor-pointer active:scale-95 disabled:opacity-50"
                  >
                    <Camera className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Take Photo</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={isProcessingPhoto || isSubmitting}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-2xs transition cursor-pointer active:scale-95 disabled:opacity-50"
                  >
                    <ImageIcon className="w-3.5 h-3.5 text-slate-500" />
                    <span>Choose from Gallery</span>
                  </button>
                </div>

                {isProcessingPhoto && (
                  <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium pt-0.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Processing photo...</span>
                  </div>
                )}
                {isSubmitting && savingPhotoText && (
                  <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-semibold pt-0.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{savingPhotoText}</span>
                  </div>
                )}
                <p className="text-[10px] text-slate-400">
                  Compressed automatically in browser (&lt;300 KB full, &lt;20 KB thumbnail).
                </p>
              </div>
            </div>
          </div>

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
                className="w-full h-[38px] px-3 text-sm rounded-xl border border-slate-300 bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer appearance-none pr-10"
              >
                <option value="raw_material">Raw Material (Component / Input)</option>
                <option value="semi_finished">Semi Finished (Work in progress)</option>
                <option value="finished_good">Finished Good (Ready for sale)</option>
                <option value="both">Composite (Both input & output)</option>
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-slate-500">
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              {type === 'raw_material' && 'Input material consumed in BOMs or assembly.'}
              {type === 'semi_finished' && 'Work in progress intermediate item produced and used internally.'}
              {type === 'finished_good' && 'Final product ready for sale and dispatch.'}
              {type === 'both' && 'Composite item that can be both an input material and sold directly.'}
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
                placeholder="e.g. Lead Ingot, PLATE 12/12 PV, 12/12 GRAY BLUE"
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
                className="w-full h-[38px] px-3 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
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
            className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer active:scale-95 flex items-center gap-1.5"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{savingPhotoText || 'Saving...'}</span>
              </>
            ) : itemToEdit ? (
              'Save Changes'
            ) : (
              'Create Item'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
