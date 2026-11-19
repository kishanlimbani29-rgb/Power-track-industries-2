import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  getDocs,
  getDoc,
  runTransaction,
} from 'firebase/firestore';
import { db, testConnection, handleFirestoreError, OperationType } from '../firebase/config';
import {
  InventoryItem,
  Recipe,
  StockMovement,
  ProductionBatch,
  UserProfile,
  StockMovementType,
  DeductedMaterial,
  IngredientRequirement,
  AuditRequest,
} from '../types/inventory';
import { INITIAL_ITEMS, INITIAL_RECIPES } from '../data/seedData';
import { useAuth } from './AuthContext';
import {
  resolveInventoryItem,
  getItemQuantity,
  getAvailableStockForIngredient,
} from '../utils/itemResolver';
import { canChangeEntry } from '../utils/changeWindow';

export interface OptimisticInventoryOpInput {
  id: string;
  itemPatches?: Record<string, Partial<InventoryItem>>;
  addedItems?: InventoryItem[];
  movements?: StockMovement[];
  addedBatches?: ProductionBatch[];
  batchPatches?: Record<string, Partial<ProductionBatch>>;
  auditPatches?: Record<string, Partial<AuditRequest>>;
}

interface InternalOptimisticOp extends OptimisticInventoryOpInput {
  createdAtMs: number;
  committedAtMs?: number;
}

export interface ActionToastState {
  id: number;
  title: string;
  message?: string;
  tone: 'saving' | 'success' | 'error';
}

/**
 * Recursively strips undefined properties from an object/array so Firestore setDoc/updateDoc
 * will never fail with 'Unsupported field value: undefined'.
 */
export function removeUndefinedFields<T>(val: T): T {
  if (val === null || val === undefined) {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => removeUndefinedFields(item)) as unknown as T;
  }
  if (typeof val === 'object' && !(val instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(val)) {
      if (value !== undefined) {
        cleaned[key] = removeUndefinedFields(value);
      }
    }
    return cleaned as T;
  }
  return val;
}

/**
 * Check if the browser / device is currently online.
 * Throws friendly error if offline.
 */
function assertOnline() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('No internet connection — nothing was saved. Please try again.');
  }
}

interface RecipeFeasibility {
  maxBatchesPossible: number;
  maxUnitsPossible: number;
  limitingIngredient?: {
    name: string;
    available: number;
    neededPerBatch: number;
    unit: string;
  };
}

interface InventoryContextType {
  items: InventoryItem[];
  recipes: Recipe[];
  movements: StockMovement[];
  pendingMovements: StockMovement[];
  batches: ProductionBatch[];
  teamMembers: UserProfile[];
  auditRequests: AuditRequest[];
  pendingAuditCount: number;
  isLoading: boolean;
  listenerError: string | null;
  retryListeners: () => void;
  isLiveConnected: boolean;
  lastSyncTime: Date | null;
  syncEventCount: number;

  // Pagination for history
  movementsLimit: number;
  hasMoreMovements: boolean;
  loadMoreMovements: () => void;
  batchesLimit: number;
  hasMoreBatches: boolean;
  loadMoreBatches: () => void;

  // Inventory actions
  addItem: (
    item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>,
    fullPhotoDataUrl?: string
  ) => Promise<string>;
  updateItem: (id: string, updates: Partial<InventoryItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  quickAdjustStock: (
    itemId: string,
    delta: number,
    type: StockMovementType,
    reason: string
  ) => Promise<void>;
  removeManualMovement: (
    movementId: string
  ) => Promise<{ itemName: string; newQuantity: number; unit: string }>;
  getFullItemPhoto: (itemId: string) => Promise<string | null>;
  saveItemPhoto: (itemId: string, fullDataUrl: string, thumbDataUrl: string) => Promise<void>;
  removeItemPhoto: (itemId: string) => Promise<void>;

  // Recipe actions
  addRecipe: (recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateRecipe: (id: string, updates: Partial<Recipe>) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;

  // Production batch execution & voiding
  produceRecipeBatch: (
    recipeId: string,
    batchMultiplier: number,
    notes?: string,
    customIngredients?: Array<{
      rawItemId: string;
      rawItemName?: string;
      quantity: number;
      unit?: string;
    }>,
    customYield?: number,
    customFinishedItemId?: string
  ) => Promise<{ success: boolean; error?: string }>;
  voidBatch: (batchId: string, voidReason: string) => Promise<{ success: boolean; error?: string }>;

  // Calculations & Analytics helpers
  calculateRecipeCost: (recipe: Recipe) => {
    rawCostTotal: number;
    totalBatchCost: number;
    costPerUnit: number;
    sellingPrice: number;
    unitGrossProfit: number;
    marginPercent: number;
  };
  getRecipeFeasibility: (recipe: Recipe) => RecipeFeasibility;
  seedSampleData: () => Promise<void>;
  clearAllStoredItems: () => Promise<void>;

  // Optimistic shared API (for TradeContext & callers) & global status toast
  registerOptimisticOp: (op: OptimisticInventoryOpInput) => void;
  confirmOptimisticOp: (opId: string) => void;
  revertOptimisticOp: (opId: string) => void;
  actionToast: ActionToastState | null;
  showActionToast: (title: string, message?: string, tone?: 'saving' | 'success' | 'error') => void;
  clearActionToast: () => void;

  // Audit Request actions
  submitAuditRequest: (
    data: Omit<AuditRequest, 'id' | 'status' | 'submittedAt' | 'submittedBy' | 'submittedByRole'>
  ) => Promise<string>;
  approveAuditRequest: (
    requestId: string,
    auditNotes?: string
  ) => Promise<{ success: boolean; error?: string }>;
  rejectAuditRequest: (
    requestId: string,
    auditNotes?: string
  ) => Promise<{ success: boolean; error?: string }>;
  deleteAuditRequest: (requestId: string) => Promise<void>;
}

const InventoryContext = createContext<InventoryContextType | undefined>(undefined);

export const InventoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    currentUser,
    profile,
    role,
    permissions,
    realUserName,
    realUserUid,
    teamMembers: authTeamMembers,
  } = useAuth();

  const [rawItems, setRawItems] = useState<InventoryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [rawMovements, setRawMovements] = useState<StockMovement[]>([]);
  const [rawBatches, setRawBatches] = useState<ProductionBatch[]>([]);
  const teamMembers = authTeamMembers;

  // Real-time audit requests queue (no fake demo data, no localStorage source)
  const [rawAuditRequests, setRawAuditRequests] = useState<AuditRequest[]>([]);

  // In-memory optimistic overrides layer (pending items, movements, batches, audit patches)
  const [optimisticOps, setOptimisticOps] = useState<InternalOptimisticOp[]>([]);
  const opTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Global floating status toast (survives modal close / navigation)
  const [actionToast, setActionToast] = useState<ActionToastState | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearActionToast = useCallback(() => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setActionToast(null);
  }, []);

  const showActionToast = useCallback(
    (title: string, message?: string, tone: 'saving' | 'success' | 'error' = 'success') => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      setActionToast({ id: Date.now() + Math.random(), title, message, tone });
      const duration = tone === 'saving' ? 12000 : tone === 'error' ? 5500 : 3000;
      toastTimerRef.current = setTimeout(() => {
        setActionToast(null);
      }, duration);
    },
    []
  );

  const registerOptimisticOp = useCallback((op: OptimisticInventoryOpInput) => {
    setOptimisticOps((prev) => [...prev, { ...op, createdAtMs: Date.now() }]);
  }, []);

  const revertOptimisticOp = useCallback((opId: string) => {
    const existingTimer = opTimersRef.current.get(opId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      opTimersRef.current.delete(opId);
    }
    setOptimisticOps((prev) => prev.filter((o) => o.id !== opId));
  }, []);

  const confirmOptimisticOp = useCallback((opId: string) => {
    setOptimisticOps((prev) =>
      prev.map((o) => (o.id === opId ? { ...o, committedAtMs: Date.now() } : o))
    );
    const existingTimer = opTimersRef.current.get(opId);
    if (existingTimer) clearTimeout(existingTimer);
    // Fallback removal so committed ops never linger even if snapshot is unchanged or filtered out
    const timer = setTimeout(() => {
      opTimersRef.current.delete(opId);
      setOptimisticOps((prev) => prev.filter((o) => o.id !== opId));
    }, 1500);
    opTimersRef.current.set(opId, timer);
  }, []);

  useEffect(() => {
    return () => {
      opTimersRef.current.forEach((t) => clearTimeout(t));
      opTimersRef.current.clear();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Automatically prune committed ops as soon as real Firestore snapshots reflect them
  useEffect(() => {
    if (optimisticOps.length === 0) return;
    const rawItemMap = new Map(rawItems.map((i) => [i.id, i]));
    const rawMovIds = new Set(rawMovements.map((m) => m.id));
    const rawBatchMap = new Map(rawBatches.map((b) => [b.id, b]));
    const rawAuditMap = new Map(rawAuditRequests.map((r) => [r.id, r]));

    const toRemove: string[] = [];
    for (const op of optimisticOps) {
      if (!op.committedAtMs) continue;

      const itemsCaughtUp =
        (!op.addedItems || op.addedItems.every((ai) => rawItemMap.has(ai.id))) &&
        (!op.itemPatches ||
          Object.entries(op.itemPatches).every(([itemId, patch]) => {
            const raw = rawItemMap.get(itemId);
            if (!raw) return true;
            return !patch.updatedAt || (raw.updatedAt && raw.updatedAt >= patch.updatedAt);
          }));

      const movsCaughtUp =
        !op.movements || op.movements.every((m) => rawMovIds.has(m.id));

      const batchesCaughtUp =
        (!op.addedBatches || op.addedBatches.every((b) => rawBatchMap.has(b.id))) &&
        (!op.batchPatches ||
          Object.entries(op.batchPatches).every(([batchId, patch]) => {
            const raw = rawBatchMap.get(batchId);
            if (!raw) return true;
            return !patch.isVoid || Boolean(raw.isVoid);
          }));

      const auditsCaughtUp =
        !op.auditPatches ||
        Object.entries(op.auditPatches).every(([reqId, patch]) => {
          const raw = rawAuditMap.get(reqId);
          if (!raw) return true;
          return !patch.status || raw.status === patch.status;
        });

      if (itemsCaughtUp && movsCaughtUp && batchesCaughtUp && auditsCaughtUp) {
        toRemove.push(op.id);
      }
    }

    if (toRemove.length > 0) {
      toRemove.forEach((id) => {
        const t = opTimersRef.current.get(id);
        if (t) {
          clearTimeout(t);
          opTimersRef.current.delete(id);
        }
      });
      const removeSet = new Set(toRemove);
      setOptimisticOps((prev) => prev.filter((o) => !removeSet.has(o.id)));
    }
  }, [optimisticOps, rawItems, rawMovements, rawBatches, rawAuditRequests]);

  // Merged view of items (snapshot + optimistic quantity/field patches + optimistic added items)
  const items = useMemo(() => {
    if (optimisticOps.length === 0) return rawItems;
    const byId = new Map<string, InventoryItem>();
    for (const item of rawItems) {
      byId.set(item.id, item);
    }
    for (const op of optimisticOps) {
      if (op.addedItems) {
        for (const added of op.addedItems) {
          if (!byId.has(added.id)) {
            byId.set(added.id, added);
          }
        }
      }
      if (op.itemPatches) {
        for (const [itemId, patch] of Object.entries(op.itemPatches)) {
          const cur = byId.get(itemId);
          if (cur) {
            byId.set(itemId, { ...cur, ...patch });
          }
        }
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rawItems, optimisticOps]);

  // Pending movements from optimistic ops (pending: true until transaction commits, then pending: false while awaiting snapshot)
  const pendingMovements = useMemo(() => {
    if (optimisticOps.length === 0) return [] as StockMovement[];
    const list: StockMovement[] = [];
    for (let i = optimisticOps.length - 1; i >= 0; i--) {
      const op = optimisticOps[i];
      if (!op.movements) continue;
      for (const m of op.movements) {
        list.push({
          ...m,
          pending: !op.committedAtMs,
        });
      }
    }
    return list;
  }, [optimisticOps]);

  // Merged movements (pending + snapshot, deduped by id; snapshot takes precedence once arrived)
  const movements = useMemo(() => {
    if (pendingMovements.length === 0) return rawMovements;
    const rawIds = new Set(rawMovements.map((m) => m.id));
    const dedupedPending = pendingMovements.filter((m) => !rawIds.has(m.id));
    if (dedupedPending.length === 0) return rawMovements;
    return [...dedupedPending, ...rawMovements].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [pendingMovements, rawMovements]);

  // Merged batches (added + snapshot deduped by id, with void patches applied)
  const batches = useMemo(() => {
    if (optimisticOps.length === 0) return rawBatches;
    const byId = new Map<string, ProductionBatch>();
    for (const b of rawBatches) {
      byId.set(b.id, b);
    }
    for (const op of optimisticOps) {
      if (op.addedBatches) {
        for (const b of op.addedBatches) {
          if (!byId.has(b.id)) {
            byId.set(b.id, b);
          }
        }
      }
      if (op.batchPatches) {
        for (const [batchId, patch] of Object.entries(op.batchPatches)) {
          const cur = byId.get(batchId);
          if (cur) {
            byId.set(batchId, { ...cur, ...patch });
          }
        }
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [rawBatches, optimisticOps]);

  // Merged auditRequests (snapshot + optimistic status/audit patches)
  const auditRequests = useMemo(() => {
    if (optimisticOps.length === 0) return rawAuditRequests;
    const patchMap = new Map<string, Partial<AuditRequest>>();
    for (const op of optimisticOps) {
      if (!op.auditPatches) continue;
      for (const [reqId, patch] of Object.entries(op.auditPatches)) {
        patchMap.set(reqId, { ...(patchMap.get(reqId) || {}), ...patch });
      }
    }
    if (patchMap.size === 0) return rawAuditRequests;
    return rawAuditRequests.map((r) => {
      const p = patchMap.get(r.id);
      return p ? { ...r, ...p } : r;
    });
  }, [rawAuditRequests, optimisticOps]);

  // Synchronous refs so sequential optimistic calls read the latest optimistic values
  const itemsRef = useRef<InventoryItem[]>(items);
  itemsRef.current = items;
  const batchesRef = useRef<ProductionBatch[]>(batches);
  batchesRef.current = batches;
  const auditRequestsRef = useRef<AuditRequest[]>(auditRequests);
  auditRequestsRef.current = auditRequests;

  // Limits for pagination
  const [movementsLimit, setMovementsLimit] = useState(100);
  const [hasMoreMovements, setHasMoreMovements] = useState(false);
  const [batchesLimit, setBatchesLimit] = useState(50);
  const [hasMoreBatches, setHasMoreBatches] = useState(false);

  const pendingAuditCount = useMemo(() => {
    return auditRequests.filter((r) => r.status === 'pending').length;
  }, [auditRequests]);

  const [isLoading, setIsLoading] = useState(true);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [syncEventCount, setSyncEventCount] = useState(0);

  // Monitor network connection status
  useEffect(() => {
    testConnection().then((connected) => {
      setIsLiveConnected(connected);
    });

    const handleOnline = () => setIsLiveConnected(true);
    const handleOffline = () => setIsLiveConnected(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const triggerSyncIndicator = useCallback(() => {
    setLastSyncTime(new Date());
    setIsLiveConnected(true);
    setSyncEventCount((prev) => prev + 1);
  }, []);

  const loadMoreMovements = useCallback(() => {
    setMovementsLimit((prev) => prev + 100);
  }, []);

  const loadMoreBatches = useCallback(() => {
    setBatchesLimit((prev) => prev + 50);
  }, []);

  const [listenerError, setListenerError] = useState<string | null>(null);
  const [listenerRetryCount, setListenerRetryCount] = useState(0);

  const retryListeners = useCallback(() => {
    setListenerError(null);
    setIsLoading(true);
    setListenerRetryCount((prev) => prev + 1);
  }, []);

  const isProfileActiveUser = Boolean(
    currentUser && profile && profile.status === 'active'
  );

  const handleListenerError = useCallback((error: any, collectionName: string) => {
    console.warn(`${collectionName} listener error:`, error?.message || error);
    setIsLoading(false);
    const isPermissionDenied =
      error?.code === 'permission-denied' ||
      (error?.message && error.message.includes('Missing or insufficient permissions'));
    if (isPermissionDenied) {
      setListenerError("Can't load inventory – you may not have access. Tap to retry");
    }
  }, []);

  // Split Firestore Listeners (each collection in its own useEffect so Load More never restarts unrelated listeners)

  // 1. Items listener
  useEffect(() => {
    if (!isProfileActiveUser) {
      if (profile && profile.status !== 'active') {
        setIsLoading(false);
      }
      return;
    }

    setListenerError(null);
    let initialLoadDone = false;
    const unsub = onSnapshot(
      collection(db, 'items'),
      (snapshot) => {
        setListenerError(null);
        const list: InventoryItem[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as InventoryItem);
        });
        setRawItems(list.sort((a, b) => a.name.localeCompare(b.name)));
        triggerSyncIndicator();
        if (!initialLoadDone) {
          initialLoadDone = true;
          setIsLoading(false);
        }
      },
      (error) => handleListenerError(error, 'Items')
    );

    return () => unsub();
  }, [isProfileActiveUser, profile?.status, listenerRetryCount, triggerSyncIndicator, handleListenerError]);

  // 2. Recipes listener
  useEffect(() => {
    if (!isProfileActiveUser) return;
    const unsub = onSnapshot(
      collection(db, 'recipes'),
      (snapshot) => {
        const list: Recipe[] = [];
        snapshot.forEach((docSnap) => {
          const rec = docSnap.data() as Recipe;
          if (rec.id !== 'rec-1') {
            list.push(rec);
          }
        });
        setRecipes(list.sort((a, b) => a.name.localeCompare(b.name)));
        triggerSyncIndicator();
      },
      (error) => handleListenerError(error, 'Recipes')
    );
    return () => unsub();
  }, [isProfileActiveUser, listenerRetryCount, triggerSyncIndicator, handleListenerError]);

  // 3. Stock Movements listener (only re-subscribes when movementsLimit changes)
  useEffect(() => {
    if (!isProfileActiveUser) return;
    const movementsQuery = query(
      collection(db, 'movements'),
      orderBy('timestamp', 'desc'),
      limit(movementsLimit)
    );
    const unsub = onSnapshot(
      movementsQuery,
      (snapshot) => {
        const list: StockMovement[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as StockMovement);
        });
        setRawMovements(list);
        setHasMoreMovements(list.length >= movementsLimit);
        triggerSyncIndicator();
      },
      (error) => handleListenerError(error, 'Movements')
    );
    return () => unsub();
  }, [isProfileActiveUser, movementsLimit, listenerRetryCount, triggerSyncIndicator, handleListenerError]);

  // 4. Production Batches listener (only re-subscribes when batchesLimit changes)
  useEffect(() => {
    if (!isProfileActiveUser) return;
    const batchesQuery = query(
      collection(db, 'batches'),
      orderBy('timestamp', 'desc'),
      limit(batchesLimit)
    );
    const unsub = onSnapshot(
      batchesQuery,
      (snapshot) => {
        const list: ProductionBatch[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as ProductionBatch);
        });
        setRawBatches(list);
        setHasMoreBatches(list.length >= batchesLimit);
        triggerSyncIndicator();
      },
      (error) => handleListenerError(error, 'Batches')
    );
    return () => unsub();
  }, [isProfileActiveUser, batchesLimit, listenerRetryCount, triggerSyncIndicator, handleListenerError]);

  // 5. Audit Requests listener
  useEffect(() => {
    if (!isProfileActiveUser) return;
    const auditQuery = query(
      collection(db, 'audit_requests'),
      orderBy('submittedAt', 'desc')
    );
    const unsub = onSnapshot(
      auditQuery,
      (snapshot) => {
        const list: AuditRequest[] = [];
        snapshot.forEach((docSnap) => {
          list.push(docSnap.data() as AuditRequest);
        });
        setRawAuditRequests(list);
        triggerSyncIndicator();
      },
      (error) => handleListenerError(error, 'Audit requests')
    );
    return () => unsub();
  }, [isProfileActiveUser, listenerRetryCount, triggerSyncIndicator, handleListenerError]);

  // =========================================================================
  // INVENTORY ITEMS ACTIONS
  // =========================================================================

  const addItem = async (
    itemData: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>,
    fullPhotoDataUrl?: string
  ): Promise<string> => {
    assertOnline();
    if (!permissions.canEditItems) {
      throw new Error('Your user role does not have permission to add new items.');
    }

    const trimmedName = itemData.name.trim();
    const trimmedSku = (itemData.sku || '').trim();

    if (!trimmedName) {
      throw new Error('Item name is required.');
    }

    const duplicateName = items.find(
      (i) => i.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicateName) {
      throw new Error(`An item named "${duplicateName.name}" already exists. Item names must be unique.`);
    }

    if (trimmedSku) {
      const duplicateSku = items.find(
        (i) => (i.sku || '').trim().toLowerCase() === trimmedSku.toLowerCase()
      );
      if (duplicateSku) {
        throw new Error(`SKU "${duplicateSku.sku}" is already assigned to "${duplicateSku.name}". SKU codes must be unique.`);
      }
    }

    const itemRef = doc(collection(db, 'items'));
    const id = itemRef.id;
    const now = new Date().toISOString();
    const initialQty = Number(itemData.quantity) || 0;

    const newItem: InventoryItem = {
      ...itemData,
      quantity: initialQty,
      name: trimmedName,
      sku: trimmedSku,
      id,
      createdAt: now,
      updatedAt: now,
      lastUpdatedBy: realUserName,
    };

    try {
      await runTransaction(db, async (transaction) => {
        transaction.set(itemRef, newItem);

        if (initialQty > 0) {
          const movRef = doc(collection(db, 'movements'));
          const mov: StockMovement = {
            id: movRef.id,
            itemId: id,
            itemName: newItem.name,
            type: 'in',
            quantity: initialQty,
            previousQuantity: 0,
            newQuantity: initialQty,
            reason: 'Initial stock intake',
            performedBy: realUserUid,
            performedByName: realUserName,
            timestamp: now,
          };
          transaction.set(movRef, mov);
        }
      });

      // Save full photo in item_photos/{id} collection if provided
      if (fullPhotoDataUrl) {
        try {
          await setDoc(doc(db, 'item_photos', id), {
            dataUrl: fullPhotoDataUrl,
            updatedAt: now,
            updatedBy: realUserName,
          });
        } catch (photoErr) {
          console.warn('Failed to save full photo in item_photos:', photoErr);
        }
      }

      return id;
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(error, OperationType.CREATE, `items/${id}`);
    }
  };

  const updateItem = async (id: string, updates: Partial<InventoryItem>) => {
    assertOnline();
    if (!permissions.canEditItems) {
      throw new Error('Your user role does not have permission to modify item master data.');
    }

    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim();
      if (!trimmedName) {
        throw new Error('Item name cannot be empty.');
      }
      const duplicateName = items.find(
        (i) => i.id !== id && i.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (duplicateName) {
        throw new Error(`An item named "${duplicateName.name}" already exists. Item names must be unique.`);
      }
      updates.name = trimmedName;
    }

    if (updates.sku !== undefined) {
      const trimmedSku = updates.sku.trim();
      if (trimmedSku) {
        const duplicateSku = items.find(
          (i) => i.id !== id && (i.sku || '').trim().toLowerCase() === trimmedSku.toLowerCase()
        );
        if (duplicateSku) {
          throw new Error(`SKU "${duplicateSku.sku}" is already assigned to "${duplicateSku.name}". SKU codes must be unique.`);
        }
      }
      updates.sku = trimmedSku;
    }

    // Never allow direct manual overwrite of quantity in updateItem (must go through quickAdjustStock)
    const { quantity, ...allowedUpdates } = updates;

    const now = new Date().toISOString();
    const finalUpdates = {
      ...allowedUpdates,
      updatedAt: now,
      lastUpdatedBy: realUserName,
    };

    try {
      await updateDoc(doc(db, 'items', id), removeUndefinedFields(finalUpdates));
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(error, OperationType.UPDATE, `items/${id}`);
    }
  };

  const deleteItem = async (id: string) => {
    assertOnline();
    if (!permissions.canDeleteItems) {
      throw new Error('Your user role does not have permission to delete inventory items.');
    }

    // Block deleting an item that is used in ANY recipe (either output product or raw material ingredient)
    const dependentRecipes = recipes.filter(
      (r) => r.finishedItemId === id || r.ingredients.some((ing) => ing.rawItemId === id)
    );
    if (dependentRecipes.length > 0) {
      const names = dependentRecipes.map((r) => `"${r.name}"`).join(', ');
      throw new Error(
        `Cannot delete item: It is used in ${dependentRecipes.length} BOM(s) (${names}). Remove or update these BOMs first.`
      );
    }

    try {
      await deleteDoc(doc(db, 'items', id));
      // Delete corresponding full photo document
      try {
        await deleteDoc(doc(db, 'item_photos', id));
      } catch (photoErr) {
        console.warn('item_photos document deletion error (may not exist):', photoErr);
      }
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(error, OperationType.DELETE, `items/${id}`);
    }
  };

  /**
   * Product Photo Helpers
   * 1. Full photo stored in item_photos/{itemId} (loaded on demand for zoom)
   * 2. Thumbnail stored on item itself (items/{id}.photoThumb)
   */
  const getFullItemPhoto = async (itemId: string): Promise<string | null> => {
    try {
      const snap = await getDoc(doc(db, 'item_photos', itemId));
      if (snap.exists()) {
        const data = snap.data();
        return (data?.dataUrl as string) || null;
      }
      return null;
    } catch (err) {
      console.warn('Error fetching full item photo from item_photos:', err);
      return null;
    }
  };

  const saveItemPhoto = async (itemId: string, fullDataUrl: string, thumbDataUrl: string): Promise<void> => {
    assertOnline();
    if (!permissions.canEditItems) {
      throw new Error('Your user role does not have permission to modify product photos.');
    }
    const now = new Date().toISOString();
    try {
      // 1. Save full photo document in item_photos/{itemId}
      await setDoc(doc(db, 'item_photos', itemId), {
        dataUrl: fullDataUrl,
        updatedAt: now,
        updatedBy: realUserName,
      });

      // 2. Save thumbnail on item itself
      await updateDoc(doc(db, 'items', itemId), {
        photoThumb: thumbDataUrl,
        photoUpdatedAt: now,
        updatedAt: now,
        lastUpdatedBy: realUserName,
      });
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(error, OperationType.WRITE, `item_photos/${itemId}`);
    }
  };

  const removeItemPhoto = async (itemId: string): Promise<void> => {
    assertOnline();
    if (!permissions.canEditItems) {
      throw new Error('Your user role does not have permission to remove product photos.');
    }
    const now = new Date().toISOString();
    try {
      // 1. Delete full photo doc if exists
      try {
        await deleteDoc(doc(db, 'item_photos', itemId));
      } catch (e) {
        console.warn('item_photos delete error (may not exist):', e);
      }

      // 2. Clear photoThumb and update photoUpdatedAt on item
      await updateDoc(doc(db, 'items', itemId), {
        photoThumb: null,
        photoUpdatedAt: now,
        updatedAt: now,
        lastUpdatedBy: realUserName,
      });
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(error, OperationType.UPDATE, `items/${itemId}`);
    }
  };

  /**
   * Quick Adjust Stock: Optimistic local update + transactional read-modify-write
   * preventing race conditions and blocking negative balances on out/waste.
   */
  const quickAdjustStock = async (
    itemId: string,
    delta: number,
    type: StockMovementType,
    reason: string
  ) => {
    assertOnline();
    if (!permissions.canAdjustStock) {
      throw new Error('Your user role is not authorized to adjust stock levels.');
    }

    const localItem = itemsRef.current.find((i) => i.id === itemId);
    if (!localItem) {
      throw new Error('Item not found in inventory database.');
    }

    const itemRef = doc(db, 'items', itemId);
    const movRef = doc(collection(db, 'movements'));
    const now = new Date().toISOString();
    const parsedDelta = Math.abs(Number(delta) || 0);
    const localPrevQty = getItemQuantity(localItem);
    let localNewQty = localPrevQty;

    if (type === 'in' || type === 'production_yield') {
      localNewQty = localPrevQty + parsedDelta;
    } else if (type === 'out' || type === 'production_consume' || type === 'waste') {
      if (parsedDelta > localPrevQty) {
        throw new Error(`Only ${localPrevQty} ${localItem.unit || 'units'} in stock.`);
      }
      localNewQty = localPrevQty - parsedDelta;
    } else if (type === 'adjustment') {
      localNewQty = Math.max(0, Number(delta) || 0);
    }

    const opId = `adj_${movRef.id}`;
    const optimisticMovement: StockMovement = {
      id: movRef.id,
      itemId,
      itemName: localItem.name,
      type,
      quantity: Math.abs(localNewQty - localPrevQty),
      previousQuantity: localPrevQty,
      newQuantity: localNewQty,
      reason,
      performedBy: realUserUid,
      performedByName: realUserName,
      timestamp: now,
      pending: true,
    };

    registerOptimisticOp({
      id: opId,
      itemPatches: {
        [itemId]: {
          quantity: localNewQty,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        },
      },
      movements: [optimisticMovement],
    });

    try {
      await runTransaction(db, async (transaction) => {
        const itemSnap = await transaction.get(itemRef);
        if (!itemSnap.exists()) {
          throw new Error('Item not found in inventory database.');
        }

        const currentItem = itemSnap.data() as InventoryItem;
        const previousQuantity = getItemQuantity(currentItem);
        let newQuantity = previousQuantity;

        if (type === 'in' || type === 'production_yield') {
          newQuantity = previousQuantity + parsedDelta;
        } else if (type === 'out' || type === 'production_consume' || type === 'waste') {
          if (parsedDelta > previousQuantity) {
            throw new Error(`Only ${previousQuantity} ${currentItem.unit || 'units'} in stock.`);
          }
          newQuantity = previousQuantity - parsedDelta;
        } else if (type === 'adjustment') {
          // Absolute physical count
          newQuantity = Math.max(0, Number(delta) || 0);
        }

        const quantityChanged = Math.abs(newQuantity - previousQuantity);

        const movement: StockMovement = {
          id: movRef.id,
          itemId,
          itemName: currentItem.name,
          type,
          quantity: quantityChanged,
          previousQuantity,
          newQuantity,
          reason,
          performedBy: realUserUid,
          performedByName: realUserName,
          timestamp: now,
        };

        transaction.update(itemRef, {
          quantity: newQuantity,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        });

        transaction.set(movRef, movement);
      });
      confirmOptimisticOp(opId);
    } catch (error: any) {
      revertOptimisticOp(opId);
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      throw error;
    }
  };

  /**
   * Remove a wrong MANUAL stock entry (Adjust stock: in / out / waste / adjustment
   * with no batch, sale, purchase or audit reference). Undoes its effect on the
   * item quantity and deletes the movement. Inventory Full roles only.
   */
  const removeManualMovement = async (
    movementId: string
  ): Promise<{ itemName: string; newQuantity: number; unit: string }> => {
    assertOnline();
    if (!permissions.canDeleteItems || !permissions.canAdjustStock) {
      throw new Error('Only users with full inventory rights can remove stock entries.');
    }

    const movRef = doc(db, 'movements', movementId);
    const now = new Date().toISOString();
    const opId = `rm_${movementId}`;
    let result = { itemName: '', newQuantity: 0, unit: 'units' };

    try {
      const movSnap = await getDoc(movRef);
      if (!movSnap.exists()) {
        throw new Error('This entry no longer exists.');
      }
      const mov = movSnap.data() as StockMovement;
      const manualTypes: StockMovementType[] = ['in', 'out', 'waste', 'adjustment'];
      if (!manualTypes.includes(mov.type) || (mov.referenceId && String(mov.referenceId).trim())) {
        throw new Error('Only manual stock entries can be removed. Use Void / Cancel for batches, sales and purchases.');
      }
      const changeCheck = canChangeEntry(
        {
          createdByUid: mov.performedBy,
          createdByName: mov.performedByName,
          createdAt: mov.timestamp,
        },
        realUserUid,
        permissions,
        role
      );
      if (!changeCheck.allowed) {
        throw new Error(changeCheck.reason || 'Locked: cannot remove this stock entry.');
      }

      const itemRef = doc(db, 'items', mov.itemId);
      const qty = Math.abs(Number(mov.quantity) || 0);
      const undoDelta =
        mov.type === 'in'
          ? -qty
          : mov.type === 'adjustment'
          ? (Number(mov.previousQuantity) || 0) - (Number(mov.newQuantity) || 0)
          : qty;

      const localItem = itemsRef.current.find((i) => i.id === mov.itemId);
      if (localItem) {
        const localNew = getItemQuantity(localItem) + undoDelta;
        if (localNew >= 0) {
          registerOptimisticOp({
            id: opId,
            itemPatches: {
              [mov.itemId]: { quantity: localNew, updatedAt: now, lastUpdatedBy: realUserName },
            },
          });
        }
      }

      await runTransaction(db, async (transaction) => {
        const itemSnap = await transaction.get(itemRef);
        if (!itemSnap.exists()) {
          throw new Error('Item not found in inventory database.');
        }
        const currentItem = itemSnap.data() as InventoryItem;
        const currentQty = getItemQuantity(currentItem);
        const newQuantity = Math.round((currentQty + undoDelta) * 1000) / 1000;
        if (newQuantity < 0) {
          throw new Error(
            `Cannot remove: ${currentItem.name} would go below zero (some of this stock was already used).`
          );
        }
        transaction.update(itemRef, {
          quantity: newQuantity,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        });
        transaction.delete(movRef);
        result = { itemName: currentItem.name, newQuantity, unit: currentItem.unit || 'units' };
      });
      confirmOptimisticOp(opId);
      return result;
    } catch (error: any) {
      revertOptimisticOp(opId);
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was removed. Please try again.');
      }
      throw error;
    }
  };

  // =========================================================================
  // RECIPES (BILL OF MATERIALS) ACTIONS
  // =========================================================================

  const addRecipe = async (recipeData: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
    assertOnline();
    if (!permissions.canEditRecipes) {
      throw new Error('Your user role does not have permission to create BOMs.');
    }

    // Validate: Output product cannot be one of its own materials
    if (recipeData.ingredients.some((ing) => ing.rawItemId === recipeData.finishedItemId)) {
      throw new Error('The target output product cannot be one of its own materials.');
    }

    // Validate: No duplicate materials
    const seenItemIds = new Set<string>();
    for (const ing of recipeData.ingredients) {
      if (seenItemIds.has(ing.rawItemId)) {
        throw new Error(`Duplicate material: "${ing.rawItemName || 'Item'}" cannot be added twice.`);
      }
      seenItemIds.add(ing.rawItemId);
    }

    const recRef = doc(collection(db, 'recipes'));
    const id = recRef.id;
    const now = new Date().toISOString();
    const newRecipe: Recipe = {
      ...recipeData,
      id,
      createdAt: now,
      updatedAt: now,
      createdBy: realUserName,
    };

    try {
      await setDoc(recRef, newRecipe);
      return id;
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(error, OperationType.CREATE, `recipes/${id}`);
    }
  };

  const updateRecipe = async (id: string, updates: Partial<Recipe>) => {
    assertOnline();
    if (!permissions.canEditRecipes) {
      throw new Error('Only Managers and Admins can update BOMs.');
    }

    if (updates.ingredients) {
      const targetFinishedId = updates.finishedItemId || recipes.find((r) => r.id === id)?.finishedItemId;
      if (updates.ingredients.some((ing) => ing.rawItemId === targetFinishedId)) {
        throw new Error('The target output product cannot be one of its own materials.');
      }

      const seenItemIds = new Set<string>();
      for (const ing of updates.ingredients) {
        if (seenItemIds.has(ing.rawItemId)) {
          throw new Error(`Duplicate material: "${ing.rawItemName || 'Item'}" cannot be added twice.`);
        }
        seenItemIds.add(ing.rawItemId);
      }
    }

    const now = new Date().toISOString();
    const finalUpdates = {
      ...updates,
      updatedAt: now,
    };

    try {
      await updateDoc(doc(db, 'recipes', id), removeUndefinedFields(finalUpdates));
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(error, OperationType.UPDATE, `recipes/${id}`);
    }
  };

  const deleteRecipe = async (id: string) => {
    assertOnline();
    if (!permissions.canDeleteRecipes) {
      throw new Error('Only Managers and Admins can delete BOMs.');
    }

    try {
      await deleteDoc(doc(db, 'recipes', id));
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(error, OperationType.DELETE, `recipes/${id}`);
    }
  };

  // Recipe cost & feasibility calculations
  const calculateRecipeCost = useCallback(
    (recipe: Recipe) => {
      let rawCostTotal = 0;
      recipe.ingredients.forEach((ing) => {
        const item = resolveInventoryItem(items, ing);
        const costPerUnit = item ? (Number(item.unitCost) || 0) : 0;
        rawCostTotal += (Number(ing.quantity) || 0) * costPerUnit;
      });

      const totalBatchCost = rawCostTotal + (Number(recipe.laborCost) || 0);
      const yieldQty = Number(recipe.yieldQuantity) > 0 ? Number(recipe.yieldQuantity) : 1;
      const costPerUnit = totalBatchCost / yieldQty;

      const finishedItem = resolveInventoryItem(items, {
        id: recipe.finishedItemId,
        name: recipe.finishedItemName,
      });
      const sellingPrice = finishedItem ? (Number(finishedItem.sellingPrice) || 0) : 0;
      const unitGrossProfit = sellingPrice - costPerUnit;
      const marginPercent = sellingPrice > 0 ? (unitGrossProfit / sellingPrice) * 100 : 0;

      return {
        rawCostTotal,
        totalBatchCost,
        costPerUnit,
        sellingPrice,
        unitGrossProfit,
        marginPercent,
      };
    },
    [items]
  );

  const getRecipeFeasibility = useCallback(
    (recipe: Recipe): RecipeFeasibility => {
      if (!recipe.ingredients || recipe.ingredients.length === 0) {
        return { maxBatchesPossible: 0, maxUnitsPossible: 0 };
      }

      // Group required ingredients by rawItemId first
      const materialTotals = new Map<string, { rawItemId: string; rawItemName: string; quantity: number; unit: string }>();
      for (const ing of recipe.ingredients) {
        const existing = materialTotals.get(ing.rawItemId);
        if (existing) {
          existing.quantity += Number(ing.quantity) || 0;
        } else {
          materialTotals.set(ing.rawItemId, {
            rawItemId: ing.rawItemId,
            rawItemName: ing.rawItemName,
            quantity: Number(ing.quantity) || 0,
            unit: ing.unit,
          });
        }
      }

      let maxBatches = Infinity;
      let limiting: RecipeFeasibility['limitingIngredient'] = undefined;

      for (const ing of materialTotals.values()) {
        const { item, totalAvailable } = getAvailableStockForIngredient(items, ing);
        const neededPerBatch = Number(ing.quantity) || 0;

        if (!item) {
          return {
            maxBatchesPossible: 0,
            maxUnitsPossible: 0,
            limitingIngredient: {
              name: `${ing.rawItemName || 'Material'} (Missing material — edit BOM)`,
              available: 0,
              neededPerBatch,
              unit: ing.unit || '',
            },
          };
        }

        if (neededPerBatch <= 0) continue;

        const possibleForThisIng = Math.floor(totalAvailable / neededPerBatch);
        if (possibleForThisIng < maxBatches) {
          maxBatches = possibleForThisIng;
          limiting = {
            name: item.name || 'Material',
            available: totalAvailable,
            neededPerBatch,
            unit: item.unit || ing.unit || 'kg',
          };
        }
      }

      if (maxBatches === Infinity) maxBatches = 0;

      return {
        maxBatchesPossible: Math.max(0, maxBatches),
        maxUnitsPossible: Math.max(0, maxBatches * (Number(recipe.yieldQuantity) || 1)),
        limitingIngredient: limiting,
      };
    },
    [items]
  );

  // =========================================================================
  // PRODUCTION EXECUTION (TRANSACTIONAL)
  // =========================================================================

  const produceRecipeBatch = async (
    recipeId: string,
    batchMultiplier: number,
    notes?: string,
    customIngredients?: Array<{
      rawItemId: string;
      rawItemName?: string;
      quantity: number;
      unit?: string;
    }>,
    customYield?: number,
    customFinishedItemId?: string
  ): Promise<{ success: boolean; error?: string }> => {
    assertOnline();
    if (!permissions.canProduceBatch) {
      return { success: false, error: 'Your role does not have rights to record production batches.' };
    }

    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return { success: false, error: 'BOM not found' };

    const targetFinishedItemId = customFinishedItemId || recipe.finishedItemId;
    if (batchMultiplier <= 0) {
      return { success: false, error: 'Batch multiplier must be greater than zero' };
    }

    // 1. Raw ingredients list to deduct
    const rawListToUse =
      customIngredients && customIngredients.length > 0
        ? customIngredients
        : recipe.ingredients.map((ing) => ({
            rawItemId: ing.rawItemId,
            rawItemName: ing.rawItemName,
            quantity: (Number(ing.quantity) || 0) * batchMultiplier,
            unit: ing.unit,
          }));

    // 2. Sum quantities per material first
    const materialTotals = new Map<string, { rawItemId: string; rawItemName: string; quantity: number; unit: string }>();
    for (const mat of rawListToUse) {
      const existing = materialTotals.get(mat.rawItemId);
      if (existing) {
        existing.quantity += Number(mat.quantity) || 0;
      } else {
        materialTotals.set(mat.rawItemId, {
          rawItemId: mat.rawItemId,
          rawItemName: mat.rawItemName || '',
          quantity: Number(mat.quantity) || 0,
          unit: mat.unit || '',
        });
      }
    }
    const aggregatedIngredients = Array.from(materialTotals.values());

    // Pre-check local inventory availability and missing items before optimistic update
    const currentItemsSnapshot = itemsRef.current;
    const localFinished = currentItemsSnapshot.find((i) => i.id === targetFinishedItemId);
    if (!localFinished) {
      return { success: false, error: 'Target finished product not found in inventory catalog.' };
    }

    const localRawList: Array<{ item: InventoryItem; needed: number; unit: string }> = [];
    for (const mat of aggregatedIngredients) {
      const rawItem = currentItemsSnapshot.find((i) => i.id === mat.rawItemId);
      if (!rawItem) {
        return { success: false, error: 'Missing material — edit BOM' };
      }
      const currentQty = getItemQuantity(rawItem);
      const neededQty = Number(mat.quantity) || 0;
      if (currentQty < neededQty) {
        return {
          success: false,
          error: `Insufficient stock for "${rawItem.name}": needs ${neededQty.toFixed(2)} ${mat.unit || rawItem.unit}, but only ${currentQty.toFixed(2)} in stock.`,
        };
      }
      localRawList.push({ item: rawItem, needed: neededQty, unit: mat.unit || rawItem.unit });
    }

    const batchRef = doc(collection(db, 'batches'));
    const batchId = batchRef.id;
    const now = new Date().toISOString();
    const movYieldRef = doc(collection(db, 'movements'));
    const movConsumeRefMap = new Map<string, ReturnType<typeof doc>>();
    aggregatedIngredients.forEach((mat) => {
      movConsumeRefMap.set(mat.rawItemId, doc(collection(db, 'movements')));
    });

    // Build optimistic records
    const localYieldProduced =
      Number(customYield) > 0
        ? Number(customYield)
        : (Number(recipe.yieldQuantity) || 1) * batchMultiplier;
    let localRawCost = 0;
    const localDeducted: DeductedMaterial[] = localRawList.map(({ item, needed, unit }) => {
      const unitCost = Number(item.unitCost) || 0;
      localRawCost += needed * unitCost;
      return {
        rawItemId: item.id,
        rawItemName: item.name,
        quantity: needed,
        unit,
        unitCost,
      };
    });
    const localBatchRecord: ProductionBatch = {
      id: batchId,
      recipeId: recipe.id,
      recipeName: recipe.name,
      finishedItemId: localFinished.id,
      finishedItemName: localFinished.name,
      batchMultiplier,
      quantityProduced: localYieldProduced,
      totalBatchCost: localRawCost + (Number(recipe.laborCost) || 0) * batchMultiplier,
      rawMaterialsDeducted: localDeducted,
      notes: notes || `Produced ${localYieldProduced} ${localFinished.unit} via ${recipe.name}`,
      performedBy: realUserUid,
      performedByName: realUserName,
      timestamp: now,
    };

    const optItemPatches: Record<string, Partial<InventoryItem>> = {};
    const optMovements: StockMovement[] = [];

    const prevLocalFinQty = getItemQuantity(localFinished);
    const newLocalFinQty = prevLocalFinQty + localYieldProduced;
    optItemPatches[localFinished.id] = {
      quantity: newLocalFinQty,
      updatedAt: now,
      lastUpdatedBy: realUserName,
    };
    optMovements.push({
      id: movYieldRef.id,
      itemId: localFinished.id,
      itemName: localFinished.name,
      type: 'production_yield',
      quantity: localYieldProduced,
      previousQuantity: prevLocalFinQty,
      newQuantity: newLocalFinQty,
      reason: `Production yield: ${recipe.name} (${batchMultiplier}x batch)`,
      referenceId: batchId,
      performedBy: realUserUid,
      performedByName: realUserName,
      timestamp: now,
      pending: true,
    });

    localRawList.forEach(({ item, needed }) => {
      const prevQty = optItemPatches[item.id]?.quantity !== undefined
        ? Number(optItemPatches[item.id].quantity)
        : getItemQuantity(item);
      const nextQty = prevQty - needed;
      optItemPatches[item.id] = {
        quantity: nextQty,
        updatedAt: now,
        lastUpdatedBy: realUserName,
      };
      const consumeRef = movConsumeRefMap.get(item.id)!;
      optMovements.push({
        id: consumeRef.id,
        itemId: item.id,
        itemName: item.name,
        type: 'production_consume',
        quantity: needed,
        previousQuantity: prevQty,
        newQuantity: nextQty,
        reason: `Consumed for: ${recipe.name} (${batchMultiplier}x batch)`,
        referenceId: batchId,
        performedBy: realUserUid,
        performedByName: realUserName,
        timestamp: now,
        pending: true,
      });
    });

    const opId = `prod_${batchId}`;
    registerOptimisticOp({
      id: opId,
      itemPatches: optItemPatches,
      movements: optMovements,
      addedBatches: [localBatchRecord],
    });

    try {
      await runTransaction(db, async (transaction) => {
        // --- READ PHASE FIRST ---
        const finishedRef = doc(db, 'items', targetFinishedItemId);
        const finishedSnap = await transaction.get(finishedRef);
        if (!finishedSnap.exists()) {
          throw new Error('Target finished product not found in inventory catalog.');
        }
        const finishedItem = finishedSnap.data() as InventoryItem;

        const rawSnaps: Array<{
          ref: any;
          item: InventoryItem;
          needed: number;
          unit: string;
        }> = [];

        for (const mat of aggregatedIngredients) {
          const rawRef = doc(db, 'items', mat.rawItemId);
          const rawSnap = await transaction.get(rawRef);
          if (!rawSnap.exists()) {
            throw new Error('Missing material — edit BOM');
          }
          const rawItem = rawSnap.data() as InventoryItem;
          const currentQty = getItemQuantity(rawItem);
          const neededQty = Number(mat.quantity) || 0;

          if (currentQty < neededQty) {
            throw new Error(
              `Insufficient stock for "${rawItem.name}": needs ${neededQty.toFixed(2)} ${mat.unit || rawItem.unit}, but only ${currentQty.toFixed(2)} in stock.`
            );
          }

          rawSnaps.push({
            ref: rawRef,
            item: rawItem,
            needed: neededQty,
            unit: mat.unit || rawItem.unit,
          });
        }

        // --- CALCULATION & WRITE PHASE ---
        const totalYieldProduced =
          Number(customYield) > 0
            ? Number(customYield)
            : (Number(recipe.yieldQuantity) || 1) * batchMultiplier;

        let rawCostTotal = 0;
        const deductedSummary: DeductedMaterial[] = [];

        rawSnaps.forEach(({ item, needed, unit }) => {
          const unitCost = Number(item.unitCost) || 0;
          rawCostTotal += needed * unitCost;
          deductedSummary.push({
            rawItemId: item.id,
            rawItemName: item.name,
            quantity: needed,
            unit,
            unitCost,
          });
        });

        const totalBatchCost = rawCostTotal + (Number(recipe.laborCost) || 0) * batchMultiplier;

        const newBatchRecord: ProductionBatch = {
          id: batchId,
          recipeId: recipe.id,
          recipeName: recipe.name,
          finishedItemId: finishedItem.id,
          finishedItemName: finishedItem.name,
          batchMultiplier,
          quantityProduced: totalYieldProduced,
          totalBatchCost,
          rawMaterialsDeducted: deductedSummary,
          notes: notes || `Produced ${totalYieldProduced} ${finishedItem.unit} via ${recipe.name}`,
          performedBy: realUserUid,
          performedByName: realUserName,
          timestamp: now,
        };

        // 1. Update finished good
        const prevFinQty = getItemQuantity(finishedItem);
        const newFinQty = prevFinQty + totalYieldProduced;
        transaction.update(finishedRef, {
          quantity: newFinQty,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        });

        // 2. Yield movement
        const movYield: StockMovement = {
          id: movYieldRef.id,
          itemId: finishedItem.id,
          itemName: finishedItem.name,
          type: 'production_yield',
          quantity: totalYieldProduced,
          previousQuantity: prevFinQty,
          newQuantity: newFinQty,
          reason: `Production yield: ${recipe.name} (${batchMultiplier}x batch)`,
          referenceId: batchId,
          performedBy: realUserUid,
          performedByName: realUserName,
          timestamp: now,
        };
        transaction.set(movYieldRef, movYield);

        // 3. Deduct raw materials and write movements
        rawSnaps.forEach(({ ref, item, needed }) => {
          const prevRawQty = getItemQuantity(item);
          const newRawQty = prevRawQty - needed;

          transaction.update(ref, {
            quantity: newRawQty,
            updatedAt: now,
            lastUpdatedBy: realUserName,
          });

          const movConsumeRef = movConsumeRefMap.get(item.id) || doc(collection(db, 'movements'));
          const movConsume: StockMovement = {
            id: movConsumeRef.id,
            itemId: item.id,
            itemName: item.name,
            type: 'production_consume',
            quantity: needed,
            previousQuantity: prevRawQty,
            newQuantity: newRawQty,
            reason: `Consumed for: ${recipe.name} (${batchMultiplier}x batch)`,
            referenceId: batchId,
            performedBy: realUserUid,
            performedByName: realUserName,
            timestamp: now,
          };
          transaction.set(movConsumeRef, movConsume);
        });

        // 4. Record batch
        transaction.set(batchRef, newBatchRecord);
      });

      confirmOptimisticOp(opId);
      return { success: true };
    } catch (err: any) {
      revertOptimisticOp(opId);
      if (err?.message?.includes('offline') || err?.message?.includes('network')) {
        return { success: false, error: 'No internet connection — nothing was saved. Please try again.' };
      }
      return { success: false, error: err?.message || 'Production execution failed.' };
    }
  };

  /**
   * VOID BATCH: Manager/Admin only.
   * Reverses finished good stock and restores deducted raw materials with reversing movements.
   * Marks the batch VOID with audit info.
   */
  const voidBatch = async (batchId: string, voidReason: string): Promise<{ success: boolean; error?: string }> => {
    assertOnline();
    if (role !== 'admin' && role !== 'manager') {
      return { success: false, error: 'Only Managers and Administrators have authority to void batch runs.' };
    }
    if (!voidReason.trim()) {
      return { success: false, error: 'A reason for voiding this batch run is required.' };
    }

    const localBatch = batchesRef.current.find((b) => b.id === batchId);
    if (!localBatch) {
      return { success: false, error: 'Batch record not found.' };
    }
    if (localBatch.isVoid) {
      return { success: false, error: 'This batch run has already been voided.' };
    }
    const changeCheck = canChangeEntry(
      {
        createdByUid: localBatch.performedBy,
        createdByName: localBatch.performedByName,
        createdAt: localBatch.timestamp,
      },
      realUserUid,
      permissions,
      role
    );
    if (!changeCheck.allowed) {
      return { success: false, error: changeCheck.reason || 'Locked: cannot void this batch.' };
    }

    const currentItemsSnapshot = itemsRef.current;
    const localFinItem = currentItemsSnapshot.find((i) => i.id === localBatch.finishedItemId);
    if (!localFinItem) {
      return {
        success: false,
        error: `Finished product "${localBatch.finishedItemName}" no longer exists in inventory.`,
      };
    }
    const localCurrentFinQty = getItemQuantity(localFinItem);
    const localQtyToReverse = Number(localBatch.quantityProduced) || 0;
    if (localCurrentFinQty < localQtyToReverse) {
      return {
        success: false,
        error: `Cannot void batch: Finished product "${localFinItem.name}" has only ${localCurrentFinQty} in stock, but batch produced ${localQtyToReverse}.`,
      };
    }

    const batchRef = doc(db, 'batches', batchId);
    const now = new Date().toISOString();
    const trimmedReason = voidReason.trim();
    const movFinVoidRef = doc(collection(db, 'movements'));
    const movRawVoidRefs = (localBatch.rawMaterialsDeducted || []).map(() =>
      doc(collection(db, 'movements'))
    );

    const optItemPatches: Record<string, Partial<InventoryItem>> = {};
    const optMovements: StockMovement[] = [];

    const newLocalFinQty = localCurrentFinQty - localQtyToReverse;
    optItemPatches[localFinItem.id] = {
      quantity: newLocalFinQty,
      updatedAt: now,
      lastUpdatedBy: realUserName,
    };
    optMovements.push({
      id: movFinVoidRef.id,
      itemId: localFinItem.id,
      itemName: localFinItem.name,
      type: 'out',
      quantity: localQtyToReverse,
      previousQuantity: localCurrentFinQty,
      newQuantity: newLocalFinQty,
      reason: `VOID Batch #${batchId}: ${trimmedReason}`,
      referenceId: batchId,
      performedBy: realUserUid,
      performedByName: realUserName,
      timestamp: now,
      pending: true,
    });

    (localBatch.rawMaterialsDeducted || []).forEach((deducted, idx) => {
      const rawItem = currentItemsSnapshot.find((i) => i.id === deducted.rawItemId);
      if (!rawItem) return;
      const restoreQty = Number(deducted.quantity) || 0;
      const prevRaw =
        optItemPatches[rawItem.id]?.quantity !== undefined
          ? Number(optItemPatches[rawItem.id].quantity)
          : getItemQuantity(rawItem);
      const nextRaw = prevRaw + restoreQty;
      optItemPatches[rawItem.id] = {
        quantity: nextRaw,
        updatedAt: now,
        lastUpdatedBy: realUserName,
      };
      optMovements.push({
        id: movRawVoidRefs[idx].id,
        itemId: rawItem.id,
        itemName: rawItem.name,
        type: 'in',
        quantity: restoreQty,
        previousQuantity: prevRaw,
        newQuantity: nextRaw,
        reason: `VOID Batch #${batchId} Material Restored: ${trimmedReason}`,
        referenceId: batchId,
        performedBy: realUserUid,
        performedByName: realUserName,
        timestamp: now,
        pending: true,
      });
    });

    const opId = `void_${batchId}_${Date.now()}`;
    registerOptimisticOp({
      id: opId,
      itemPatches: optItemPatches,
      movements: optMovements,
      batchPatches: {
        [batchId]: {
          isVoid: true,
          voidedAt: now,
          voidedBy: realUserUid,
          voidedByName: realUserName,
          voidReason: trimmedReason,
        },
      },
    });

    try {
      await runTransaction(db, async (transaction) => {
        const batchSnap = await transaction.get(batchRef);
        if (!batchSnap.exists()) {
          throw new Error('Batch record not found.');
        }

        const batchData = batchSnap.data() as ProductionBatch;
        if (batchData.isVoid) {
          throw new Error('This batch run has already been voided.');
        }
        const txCheck = canChangeEntry(
          {
            createdByUid: batchData.performedBy,
            createdByName: batchData.performedByName,
            createdAt: batchData.timestamp,
          },
          realUserUid,
          permissions,
          role
        );
        if (!txCheck.allowed) {
          throw new Error(txCheck.reason || 'Locked: cannot void this batch.');
        }

        // 1. Read finished item
        const finRef = doc(db, 'items', batchData.finishedItemId);
        const finSnap = await transaction.get(finRef);
        if (!finSnap.exists()) {
          throw new Error(`Finished product "${batchData.finishedItemName}" no longer exists in inventory.`);
        }
        const finItem = finSnap.data() as InventoryItem;
        const currentFinQty = getItemQuantity(finItem);
        const qtyToReverse = Number(batchData.quantityProduced) || 0;

        if (currentFinQty < qtyToReverse) {
          throw new Error(
            `Cannot void batch: Finished product "${finItem.name}" has only ${currentFinQty} in stock, but batch produced ${qtyToReverse}.`
          );
        }

        // 2. Read each raw material to restore
        const rawRestoreSnaps: Array<{ ref: any; item: InventoryItem; restoreQty: number; idx: number }> = [];
        const deductedList = batchData.rawMaterialsDeducted || [];
        for (let i = 0; i < deductedList.length; i++) {
          const deducted = deductedList[i];
          const rawRef = doc(db, 'items', deducted.rawItemId);
          const rawSnap = await transaction.get(rawRef);
          if (rawSnap.exists()) {
            rawRestoreSnaps.push({
              ref: rawRef,
              item: rawSnap.data() as InventoryItem,
              restoreQty: Number(deducted.quantity) || 0,
              idx: i,
            });
          }
        }

        // 3. Reverse finished goods stock
        const newFinQty = currentFinQty - qtyToReverse;
        transaction.update(finRef, {
          quantity: newFinQty,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        });

        const movFinVoid: StockMovement = {
          id: movFinVoidRef.id,
          itemId: finItem.id,
          itemName: finItem.name,
          type: 'out',
          quantity: qtyToReverse,
          previousQuantity: currentFinQty,
          newQuantity: newFinQty,
          reason: `VOID Batch #${batchId}: ${trimmedReason}`,
          referenceId: batchId,
          performedBy: realUserUid,
          performedByName: realUserName,
          timestamp: now,
        };
        transaction.set(movFinVoidRef, movFinVoid);

        // 4. Restore each raw material
        rawRestoreSnaps.forEach(({ ref, item, restoreQty, idx }) => {
          const currentRawQty = getItemQuantity(item);
          const newRawQty = currentRawQty + restoreQty;

          transaction.update(ref, {
            quantity: newRawQty,
            updatedAt: now,
            lastUpdatedBy: realUserName,
          });

          const movRawVoidRef = movRawVoidRefs[idx] || doc(collection(db, 'movements'));
          const movRawVoid: StockMovement = {
            id: movRawVoidRef.id,
            itemId: item.id,
            itemName: item.name,
            type: 'in',
            quantity: restoreQty,
            previousQuantity: currentRawQty,
            newQuantity: newRawQty,
            reason: `VOID Batch #${batchId} Material Restored: ${trimmedReason}`,
            referenceId: batchId,
            performedBy: realUserUid,
            performedByName: realUserName,
            timestamp: now,
          };
          transaction.set(movRawVoidRef, movRawVoid);
        });

        // 5. Update batch record as VOID
        transaction.update(batchRef, {
          isVoid: true,
          voidedAt: now,
          voidedBy: realUserUid,
          voidedByName: realUserName,
          voidReason: trimmedReason,
        });
      });

      confirmOptimisticOp(opId);
      return { success: true };
    } catch (err: any) {
      revertOptimisticOp(opId);
      if (err?.message?.includes('offline') || err?.message?.includes('network')) {
        return { success: false, error: 'No internet connection — nothing was saved. Please try again.' };
      }
      return { success: false, error: err?.message || 'Failed to void batch run.' };
    }
  };

  // Seed sample data helper
  const seedSampleData = async () => {
    assertOnline();
    try {
      for (const item of INITIAL_ITEMS) {
        await setDoc(doc(db, 'items', item.id), item);
      }
      for (const rec of INITIAL_RECIPES) {
        await setDoc(doc(db, 'recipes', rec.id), rec);
      }
      triggerSyncIndicator();
    } catch (err) {
      console.error('Seeding sample data failed:', err);
    }
  };

  const clearAllStoredItems = async () => {
    assertOnline();
    try {
      const snap = await getDocs(collection(db, 'items'));
      for (const d of snap.docs) {
        await deleteDoc(d.ref);
      }
      triggerSyncIndicator();
    } catch (err) {
      console.warn('Error clearing stored items:', err);
    }
  };

  // =========================================================================
  // AUDIT REQUESTS & GOVERNANCE WORKFLOW (TRANSACTIONAL)
  // =========================================================================

  const submitAuditRequest = async (
    data: Omit<AuditRequest, 'id' | 'status' | 'submittedAt' | 'submittedBy' | 'submittedByRole'>
  ): Promise<string> => {
    assertOnline();
    if (!permissions.canSubmitAuditRequests) {
      throw new Error('Your user role does not have permission to submit audit requests.');
    }

    const reqRef = doc(collection(db, 'audit_requests'));
    const id = reqRef.id;
    const now = new Date().toISOString();

    const newRequest: AuditRequest = {
      ...data,
      id,
      status: 'pending',
      submittedBy: realUserName,
      submittedByRole: role,
      submittedAt: now,
    };

    try {
      await setDoc(reqRef, removeUndefinedFields(newRequest));
      triggerSyncIndicator();
      return id;
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(error, OperationType.CREATE, `audit_requests/${id}`);
    }
  };

  const approveAuditRequest = async (
    requestId: string,
    auditNotes?: string
  ): Promise<{ success: boolean; error?: string }> => {
    assertOnline();
    if (!permissions.canAuditRequests) {
      return { success: false, error: 'Only Managers and Admins have rights to audit and approve requests.' };
    }

    const localReq = auditRequestsRef.current.find((r) => r.id === requestId);
    if (!localReq) {
      return { success: false, error: 'Audit request not found.' };
    }
    if (localReq.status !== 'pending') {
      return { success: false, error: `This request has already been ${localReq.status} by another user.` };
    }

    const reqRef = doc(db, 'audit_requests', requestId);
    const now = new Date().toISOString();
    const currentItemsSnapshot = itemsRef.current;

    // Pre-allocate Firestore IDs & compute optimistic overlay
    const opId = `audit_app_${requestId}_${Date.now()}`;
    const optItemPatches: Record<string, Partial<InventoryItem>> = {};
    const optAddedItems: InventoryItem[] = [];
    const optMovements: StockMovement[] = [];
    const optAddedBatches: ProductionBatch[] = [];

    let prodBatchRef: ReturnType<typeof doc> | null = null;
    let prodYieldMovRef: ReturnType<typeof doc> | null = null;
    const prodConsumeRefMap = new Map<string, ReturnType<typeof doc>>();
    let dispatchMovRef: ReturnType<typeof doc> | null = null;
    let rawInItemRef: ReturnType<typeof doc> | null = null;
    let rawInMovRef: ReturnType<typeof doc> | null = null;
    const generatedNewSku = `RAW-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    if (localReq.type === 'production') {
      if (!localReq.recipeId) {
        return { success: false, error: 'Production request is missing BOM information.' };
      }
      const recipe = recipes.find((r) => r.id === localReq.recipeId);
      if (!recipe) return { success: false, error: 'Associated production BOM was not found.' };

      const batchMultiplier = Number(localReq.batchMultiplier) > 0 ? Number(localReq.batchMultiplier) : 1;
      const targetFinishedId = localReq.finishedItemId || recipe.finishedItemId;
      const localFinished = currentItemsSnapshot.find((i) => i.id === targetFinishedId);
      if (!localFinished) {
        return { success: false, error: 'Target finished item does not exist in inventory catalog.' };
      }

      const rawMaterialsToUse =
        localReq.materialsNeeded && localReq.materialsNeeded.length > 0
          ? localReq.materialsNeeded
          : recipe.ingredients.map((ing) => ({
              rawItemId: ing.rawItemId,
              rawItemName: ing.rawItemName,
              quantity: (Number(ing.quantity) || 0) * batchMultiplier,
              unit: ing.unit,
            }));

      const materialTotals = new Map<string, { rawItemId: string; rawItemName: string; quantity: number; unit: string }>();
      for (const mat of rawMaterialsToUse) {
        const existing = materialTotals.get(mat.rawItemId);
        if (existing) existing.quantity += Number(mat.quantity) || 0;
        else {
          materialTotals.set(mat.rawItemId, {
            rawItemId: mat.rawItemId,
            rawItemName: mat.rawItemName || '',
            quantity: Number(mat.quantity) || 0,
            unit: mat.unit || '',
          });
        }
      }
      const aggregated = Array.from(materialTotals.values());

      const localRawList: Array<{ item: InventoryItem; needed: number; unit: string }> = [];
      for (const mat of aggregated) {
        const rawItem = currentItemsSnapshot.find((i) => i.id === mat.rawItemId);
        if (!rawItem) return { success: false, error: 'Missing material — edit BOM' };
        const currentQty = getItemQuantity(rawItem);
        const neededQty = Number(mat.quantity) || 0;
        if (currentQty < neededQty) {
          return {
            success: false,
            error: `Audit failed - insufficient stock for "${rawItem.name}": requires ${neededQty.toFixed(2)} ${mat.unit || rawItem.unit}, but only ${currentQty.toFixed(2)} available.`,
          };
        }
        localRawList.push({ item: rawItem, needed: neededQty, unit: mat.unit || rawItem.unit });
      }

      prodBatchRef = doc(collection(db, 'batches'));
      prodYieldMovRef = doc(collection(db, 'movements'));
      aggregated.forEach((mat) => {
        prodConsumeRefMap.set(mat.rawItemId, doc(collection(db, 'movements')));
      });

      const totalYieldProduced =
        Number(localReq.expectedYield) > 0
          ? Number(localReq.expectedYield)
          : (Number(recipe.yieldQuantity) || 1) * batchMultiplier;

      let rawCostTotal = 0;
      const deductedSummary: DeductedMaterial[] = localRawList.map(({ item, needed, unit }) => {
        const unitCost = Number(item.unitCost) || 0;
        rawCostTotal += needed * unitCost;
        return {
          rawItemId: item.id,
          rawItemName: item.name,
          quantity: needed,
          unit,
          unitCost,
        };
      });

      optAddedBatches.push({
        id: prodBatchRef.id,
        recipeId: recipe.id,
        recipeName: recipe.name,
        finishedItemId: localFinished.id,
        finishedItemName: localFinished.name,
        batchMultiplier,
        quantityProduced: totalYieldProduced,
        totalBatchCost: rawCostTotal + (Number(recipe.laborCost) || 0) * batchMultiplier,
        rawMaterialsDeducted: deductedSummary,
        notes: `Audited & Approved: ${localReq.notes || ''} (Auditor: ${realUserName})`,
        performedBy: realUserUid,
        performedByName: `${localReq.submittedBy} (Audited by ${realUserName})`,
        timestamp: now,
      });

      const prevFinQty = getItemQuantity(localFinished);
      const newFinQty = prevFinQty + totalYieldProduced;
      optItemPatches[localFinished.id] = {
        quantity: newFinQty,
        updatedAt: now,
        lastUpdatedBy: realUserName,
      };
      optMovements.push({
        id: prodYieldMovRef.id,
        itemId: localFinished.id,
        itemName: localFinished.name,
        type: 'production_yield',
        quantity: totalYieldProduced,
        previousQuantity: prevFinQty,
        newQuantity: newFinQty,
        reason: `Audit Approved Production: ${recipe.name} (${batchMultiplier}x) [Req #${localReq.id}]`,
        referenceId: localReq.id,
        performedBy: realUserUid,
        performedByName: realUserName,
        timestamp: now,
        pending: true,
      });

      localRawList.forEach(({ item, needed }) => {
        const prevRawQty =
          optItemPatches[item.id]?.quantity !== undefined
            ? Number(optItemPatches[item.id].quantity)
            : getItemQuantity(item);
        const newRawQty = prevRawQty - needed;
        optItemPatches[item.id] = {
          quantity: newRawQty,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        };
        const mRef = prodConsumeRefMap.get(item.id)!;
        optMovements.push({
          id: mRef.id,
          itemId: item.id,
          itemName: item.name,
          type: 'production_consume',
          quantity: needed,
          previousQuantity: prevRawQty,
          newQuantity: newRawQty,
          reason: `Audit Approved Production Consume: ${recipe.name} [Req #${localReq.id}]`,
          referenceId: localReq.id,
          performedBy: realUserUid,
          performedByName: realUserName,
          timestamp: now,
          pending: true,
        });
      });
    } else if (localReq.type === 'dispatch') {
      if (!localReq.dispatchItemId) {
        return { success: false, error: 'Dispatched product item ID is missing.' };
      }
      const item = currentItemsSnapshot.find((i) => i.id === localReq.dispatchItemId);
      if (!item) {
        return { success: false, error: 'Dispatched product not found in inventory catalog.' };
      }
      const qtyToDispatch = Number(localReq.dispatchQuantity) || 0;
      if (qtyToDispatch <= 0) {
        return { success: false, error: 'Dispatch quantity must be greater than zero.' };
      }
      const currentQty = getItemQuantity(item);
      if (currentQty < qtyToDispatch) {
        return {
          success: false,
          error: `Only ${currentQty} ${item.unit || 'units'} in stock to dispatch (requested: ${qtyToDispatch}).`,
        };
      }
      dispatchMovRef = doc(collection(db, 'movements'));
      const newQty = currentQty - qtyToDispatch;
      optItemPatches[item.id] = {
        quantity: newQty,
        updatedAt: now,
        lastUpdatedBy: realUserName,
      };
      optMovements.push({
        id: dispatchMovRef.id,
        itemId: item.id,
        itemName: item.name,
        type: 'out',
        quantity: qtyToDispatch,
        previousQuantity: currentQty,
        newQuantity: newQty,
        reason: `Audit Approved Dispatch: ${localReq.customerOrDestination || 'Order dispatch'} [Req #${localReq.id}]`,
        referenceId: localReq.id,
        performedBy: realUserUid,
        performedByName: realUserName,
        timestamp: now,
        pending: true,
      });
    } else if (localReq.type === 'raw_material_in') {
      const qtyIn = Number(localReq.rawQuantity) || 0;
      if (qtyIn <= 0) {
        return { success: false, error: 'Received quantity must be greater than zero.' };
      }
      rawInItemRef = localReq.rawItemId ? doc(db, 'items', localReq.rawItemId) : doc(collection(db, 'items'));
      rawInMovRef = doc(collection(db, 'movements'));
      const existing = localReq.rawItemId
        ? currentItemsSnapshot.find((i) => i.id === localReq.rawItemId)
        : undefined;
      let prevQty = 0;
      let itemName = localReq.rawItemName || 'New Raw Material';
      if (existing) {
        prevQty = getItemQuantity(existing);
        itemName = existing.name;
        optItemPatches[existing.id] = {
          quantity: prevQty + qtyIn,
          unitCost: Number(localReq.unitPurchaseCost) > 0 ? Number(localReq.unitPurchaseCost) : existing.unitCost,
          location: localReq.shelfLocation ? localReq.shelfLocation : existing.location,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        };
      } else {
        optAddedItems.push({
          id: rawInItemRef.id,
          name: itemName,
          sku: generatedNewSku,
          type: 'raw_material',
          category: 'Raw Materials',
          unit: localReq.rawUnit || 'kg',
          quantity: qtyIn,
          minStock: 10,
          unitCost: Number(localReq.unitPurchaseCost) > 0 ? Number(localReq.unitPurchaseCost) : 1.0,
          sellingPrice: 0,
          supplier: localReq.supplierName || 'General Supplier',
          location: localReq.shelfLocation || 'Staging / Receiving',
          createdAt: now,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        });
      }
      optMovements.push({
        id: rawInMovRef.id,
        itemId: rawInItemRef.id,
        itemName,
        type: 'in',
        quantity: qtyIn,
        previousQuantity: prevQty,
        newQuantity: prevQty + qtyIn,
        reason: `Audit Approved Stock In: ${localReq.supplierName || 'Supplier shipment'} [Req #${localReq.id}]`,
        referenceId: localReq.id,
        performedBy: realUserUid,
        performedByName: realUserName,
        timestamp: now,
        pending: true,
      });
    }

    const defaultAuditNote =
      localReq.type === 'production'
        ? 'Approved and taken into account.'
        : localReq.type === 'dispatch'
        ? 'Approved and stock dispatched.'
        : 'Approved and inventory stock updated.';

    registerOptimisticOp({
      id: opId,
      itemPatches: Object.keys(optItemPatches).length ? optItemPatches : undefined,
      addedItems: optAddedItems.length ? optAddedItems : undefined,
      movements: optMovements.length ? optMovements : undefined,
      addedBatches: optAddedBatches.length ? optAddedBatches : undefined,
      auditPatches: {
        [requestId]: {
          status: 'approved',
          auditedBy: realUserName,
          auditedAt: now,
          auditNotes: auditNotes || defaultAuditNote,
        },
      },
    });

    try {
      await runTransaction(db, async (transaction) => {
        // --- READ REQUEST FIRST ---
        const reqSnap = await transaction.get(reqRef);
        if (!reqSnap.exists()) {
          throw new Error('Audit request not found.');
        }

        const req = reqSnap.data() as AuditRequest;
        if (req.status !== 'pending') {
          throw new Error(`This request has already been ${req.status} by another user.`);
        }

        // =====================================================================
        // PRODUCTION APPROVAL
        // =====================================================================
        if (req.type === 'production') {
          if (!req.recipeId) {
            throw new Error('Production request is missing BOM information.');
          }

          const recipe = recipes.find((r) => r.id === req.recipeId);
          if (!recipe) throw new Error('Associated production BOM was not found.');

          const batchMultiplier = Number(req.batchMultiplier) > 0 ? Number(req.batchMultiplier) : 1;
          const targetFinishedId = req.finishedItemId || recipe.finishedItemId;

          // 1. Read finished item
          const finRef = doc(db, 'items', targetFinishedId);
          const finSnap = await transaction.get(finRef);
          if (!finSnap.exists()) {
            throw new Error('Target finished item does not exist in inventory catalog.');
          }
          const finishedItem = finSnap.data() as InventoryItem;

          // 2. Sum quantities per material first
          const rawMaterialsToUse =
            req.materialsNeeded && req.materialsNeeded.length > 0
              ? req.materialsNeeded
              : recipe.ingredients.map((ing) => ({
                  rawItemId: ing.rawItemId,
                  rawItemName: ing.rawItemName,
                  quantity: (Number(ing.quantity) || 0) * batchMultiplier,
                  unit: ing.unit,
                }));

          const materialTotals = new Map<string, { rawItemId: string; rawItemName: string; quantity: number; unit: string }>();
          for (const mat of rawMaterialsToUse) {
            const existing = materialTotals.get(mat.rawItemId);
            if (existing) {
              existing.quantity += Number(mat.quantity) || 0;
            } else {
              materialTotals.set(mat.rawItemId, {
                rawItemId: mat.rawItemId,
                rawItemName: mat.rawItemName || '',
                quantity: Number(mat.quantity) || 0,
                unit: mat.unit || '',
              });
            }
          }
          const aggregated = Array.from(materialTotals.values());

          // 3. Read each raw material and verify stock
          const rawSnaps: Array<{ ref: any; item: InventoryItem; needed: number; unit: string }> = [];
          for (const mat of aggregated) {
            const rawRef = doc(db, 'items', mat.rawItemId);
            const rawSnap = await transaction.get(rawRef);
            if (!rawSnap.exists()) {
              throw new Error('Missing material — edit BOM');
            }
            const rawItem = rawSnap.data() as InventoryItem;
            const currentQty = getItemQuantity(rawItem);
            const neededQty = Number(mat.quantity) || 0;

            if (currentQty < neededQty) {
              throw new Error(
                `Audit failed - insufficient stock for "${rawItem.name}": requires ${neededQty.toFixed(2)} ${mat.unit || rawItem.unit}, but only ${currentQty.toFixed(2)} available.`
              );
            }

            rawSnaps.push({ ref: rawRef, item: rawItem, needed: neededQty, unit: mat.unit || rawItem.unit });
          }

          // 4. Calculate batch yield & costs
          const totalYieldProduced =
            Number(req.expectedYield) > 0
              ? Number(req.expectedYield)
              : (Number(recipe.yieldQuantity) || 1) * batchMultiplier;

          const batchRef = prodBatchRef || doc(collection(db, 'batches'));
          const batchId = batchRef.id;

          let rawCostTotal = 0;
          const deductedSummary: DeductedMaterial[] = [];
          rawSnaps.forEach(({ item, needed, unit }) => {
            const unitCost = Number(item.unitCost) || 0;
            rawCostTotal += needed * unitCost;
            deductedSummary.push({
              rawItemId: item.id,
              rawItemName: item.name,
              quantity: needed,
              unit,
              unitCost,
            });
          });

          const totalBatchCost = rawCostTotal + (Number(recipe.laborCost) || 0) * batchMultiplier;

          const newBatchRecord: ProductionBatch = {
            id: batchId,
            recipeId: recipe.id,
            recipeName: recipe.name,
            finishedItemId: finishedItem.id,
            finishedItemName: finishedItem.name,
            batchMultiplier,
            quantityProduced: totalYieldProduced,
            totalBatchCost,
            rawMaterialsDeducted: deductedSummary,
            notes: `Audited & Approved: ${req.notes || ''} (Auditor: ${realUserName})`,
            performedBy: realUserUid,
            performedByName: `${req.submittedBy} (Audited by ${realUserName})`,
            timestamp: now,
          };

          // 5. Update finished good
          const prevFinQty = getItemQuantity(finishedItem);
          const newFinQty = prevFinQty + totalYieldProduced;
          transaction.update(finRef, {
            quantity: newFinQty,
            updatedAt: now,
            lastUpdatedBy: realUserName,
          });

          const movYieldRef = prodYieldMovRef || doc(collection(db, 'movements'));
          const movYield: StockMovement = {
            id: movYieldRef.id,
            itemId: finishedItem.id,
            itemName: finishedItem.name,
            type: 'production_yield',
            quantity: totalYieldProduced,
            previousQuantity: prevFinQty,
            newQuantity: newFinQty,
            reason: `Audit Approved Production: ${recipe.name} (${batchMultiplier}x) [Req #${req.id}]`,
            referenceId: req.id,
            performedBy: realUserUid,
            performedByName: realUserName,
            timestamp: now,
          };
          transaction.set(movYieldRef, movYield);

          // 6. Deduct raw materials
          rawSnaps.forEach(({ ref, item, needed }) => {
            const prevRawQty = getItemQuantity(item);
            const newRawQty = prevRawQty - needed;
            transaction.update(ref, {
              quantity: newRawQty,
              updatedAt: now,
              lastUpdatedBy: realUserName,
            });

            const movConsumeRef = prodConsumeRefMap.get(item.id) || doc(collection(db, 'movements'));
            const movConsume: StockMovement = {
              id: movConsumeRef.id,
              itemId: item.id,
              itemName: item.name,
              type: 'production_consume',
              quantity: needed,
              previousQuantity: prevRawQty,
              newQuantity: newRawQty,
              reason: `Audit Approved Production Consume: ${recipe.name} [Req #${req.id}]`,
              referenceId: req.id,
              performedBy: realUserUid,
              performedByName: realUserName,
              timestamp: now,
            };
            transaction.set(movConsumeRef, movConsume);
          });

          // 7. Write batch and update request
          transaction.set(batchRef, newBatchRecord);
          transaction.update(reqRef, {
            status: 'approved',
            auditedBy: realUserName,
            auditedAt: now,
            auditNotes: auditNotes || 'Approved and taken into account.',
          });

        // =====================================================================
        // DISPATCH APPROVAL
        // =====================================================================
        } else if (req.type === 'dispatch') {
          if (!req.dispatchItemId) {
            throw new Error('Dispatched product item ID is missing.');
          }

          const itemRef = doc(db, 'items', req.dispatchItemId);
          const itemSnap = await transaction.get(itemRef);
          if (!itemSnap.exists()) {
            throw new Error('Dispatched product not found in inventory catalog.');
          }

          const item = itemSnap.data() as InventoryItem;
          const qtyToDispatch = Number(req.dispatchQuantity) || 0;
          if (qtyToDispatch <= 0) {
            throw new Error('Dispatch quantity must be greater than zero.');
          }

          const currentQty = getItemQuantity(item);
          if (currentQty < qtyToDispatch) {
            throw new Error(
              `Only ${currentQty} ${item.unit || 'units'} in stock to dispatch (requested: ${qtyToDispatch}).`
            );
          }

          const newQty = currentQty - qtyToDispatch;
          transaction.update(itemRef, {
            quantity: newQty,
            updatedAt: now,
            lastUpdatedBy: realUserName,
          });

          const movRef = dispatchMovRef || doc(collection(db, 'movements'));
          const movement: StockMovement = {
            id: movRef.id,
            itemId: item.id,
            itemName: item.name,
            type: 'out',
            quantity: qtyToDispatch,
            previousQuantity: currentQty,
            newQuantity: newQty,
            reason: `Audit Approved Dispatch: ${req.customerOrDestination || 'Order dispatch'} [Req #${req.id}]`,
            referenceId: req.id,
            performedBy: realUserUid,
            performedByName: realUserName,
            timestamp: now,
          };
          transaction.set(movRef, movement);

          transaction.update(reqRef, {
            status: 'approved',
            auditedBy: realUserName,
            auditedAt: now,
            auditNotes: auditNotes || 'Approved and stock dispatched.',
          });

        // =====================================================================
        // RAW MATERIAL IN APPROVAL
        // =====================================================================
        } else if (req.type === 'raw_material_in') {
          const qtyIn = Number(req.rawQuantity) || 0;
          if (qtyIn <= 0) {
            throw new Error('Received quantity must be greater than zero.');
          }

          const itemRef = rawInItemRef || (req.rawItemId ? doc(db, 'items', req.rawItemId) : doc(collection(db, 'items')));
          const itemSnap = await transaction.get(itemRef);
          let prevQty = 0;
          let itemName = req.rawItemName || 'New Raw Material';

          if (itemSnap.exists()) {
            const existingItem = itemSnap.data() as InventoryItem;
            prevQty = getItemQuantity(existingItem);
            itemName = existingItem.name;
            const newQty = prevQty + qtyIn;

            transaction.update(itemRef, {
              quantity: newQty,
              unitCost: Number(req.unitPurchaseCost) > 0 ? Number(req.unitPurchaseCost) : existingItem.unitCost,
              location: req.shelfLocation ? req.shelfLocation : existingItem.location,
              updatedAt: now,
              lastUpdatedBy: realUserName,
            });
          } else {
            const newItem: InventoryItem = {
              id: itemRef.id,
              name: itemName,
              sku: generatedNewSku,
              type: 'raw_material',
              category: 'Raw Materials',
              unit: req.rawUnit || 'kg',
              quantity: qtyIn,
              minStock: 10,
              unitCost: Number(req.unitPurchaseCost) > 0 ? Number(req.unitPurchaseCost) : 1.0,
              sellingPrice: 0,
              supplier: req.supplierName || 'General Supplier',
              location: req.shelfLocation || 'Staging / Receiving',
              createdAt: now,
              updatedAt: now,
              lastUpdatedBy: realUserName,
            };
            transaction.set(itemRef, newItem);
          }

          const movRef = rawInMovRef || doc(collection(db, 'movements'));
          const movement: StockMovement = {
            id: movRef.id,
            itemId: itemRef.id,
            itemName,
            type: 'in',
            quantity: qtyIn,
            previousQuantity: prevQty,
            newQuantity: prevQty + qtyIn,
            reason: `Audit Approved Stock In: ${req.supplierName || 'Supplier shipment'} [Req #${req.id}]`,
            referenceId: req.id,
            performedBy: realUserUid,
            performedByName: realUserName,
            timestamp: now,
          };
          transaction.set(movRef, movement);

          transaction.update(reqRef, {
            status: 'approved',
            auditedBy: realUserName,
            auditedAt: now,
            auditNotes: auditNotes || 'Approved and inventory stock updated.',
          });
        }
      });

      confirmOptimisticOp(opId);
      triggerSyncIndicator();
      return { success: true };
    } catch (err: any) {
      revertOptimisticOp(opId);
      if (err?.message?.includes('offline') || err?.message?.includes('network')) {
        return { success: false, error: 'No internet connection — nothing was saved. Please try again.' };
      }
      return { success: false, error: err?.message || 'Audit approval transaction failed.' };
    }
  };

  const rejectAuditRequest = async (
    requestId: string,
    auditNotes?: string
  ): Promise<{ success: boolean; error?: string }> => {
    assertOnline();
    if (!permissions.canAuditRequests) {
      return { success: false, error: 'Only Managers and Admins have rights to reject audit requests.' };
    }

    const localReq = auditRequestsRef.current.find((r) => r.id === requestId);
    if (!localReq) {
      return { success: false, error: 'Audit request not found.' };
    }
    if (localReq.status !== 'pending') {
      return { success: false, error: `This request has already been ${localReq.status} by another user.` };
    }

    const reqRef = doc(db, 'audit_requests', requestId);
    const now = new Date().toISOString();
    const opId = `audit_rej_${requestId}_${Date.now()}`;

    registerOptimisticOp({
      id: opId,
      auditPatches: {
        [requestId]: {
          status: 'rejected',
          auditedBy: realUserName,
          auditedAt: now,
          auditNotes: auditNotes || 'Rejected during audit review.',
        },
      },
    });

    try {
      await runTransaction(db, async (transaction) => {
        const reqSnap = await transaction.get(reqRef);
        if (!reqSnap.exists()) {
          throw new Error('Audit request not found.');
        }

        const req = reqSnap.data() as AuditRequest;
        if (req.status !== 'pending') {
          throw new Error(`This request has already been ${req.status} by another user.`);
        }

        transaction.update(reqRef, {
          status: 'rejected',
          auditedBy: realUserName,
          auditedAt: now,
          auditNotes: auditNotes || 'Rejected during audit review.',
        });
      });

      confirmOptimisticOp(opId);
      triggerSyncIndicator();
      return { success: true };
    } catch (err: any) {
      revertOptimisticOp(opId);
      if (err?.message?.includes('offline') || err?.message?.includes('network')) {
        return { success: false, error: 'No internet connection — nothing was saved. Please try again.' };
      }
      return { success: false, error: err?.message || 'Rejection transaction failed.' };
    }
  };

  const deleteAuditRequest = async (requestId: string): Promise<void> => {
    assertOnline();
    if (!permissions.canAuditRequests) {
      throw new Error('Only Managers and Admins have rights to delete audit request records.');
    }

    try {
      await deleteDoc(doc(db, 'audit_requests', requestId));
      triggerSyncIndicator();
    } catch (err: any) {
      if (err?.message?.includes('offline') || err?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(err, OperationType.DELETE, `audit_requests/${requestId}`);
    }
  };

  return (
    <InventoryContext.Provider
      value={{
        items,
        recipes,
        movements,
        pendingMovements,
        batches,
        teamMembers,
        auditRequests,
        pendingAuditCount,
        isLoading,
        listenerError,
        retryListeners,
        isLiveConnected,
        lastSyncTime,
        syncEventCount,
        movementsLimit,
        hasMoreMovements,
        loadMoreMovements,
        batchesLimit,
        hasMoreBatches,
        loadMoreBatches,
        addItem,
        updateItem,
        deleteItem,
        quickAdjustStock,
      removeManualMovement,
        getFullItemPhoto,
        saveItemPhoto,
        removeItemPhoto,
        addRecipe,
        updateRecipe,
        deleteRecipe,
        produceRecipeBatch,
        voidBatch,
        calculateRecipeCost,
        getRecipeFeasibility,
        seedSampleData,
        clearAllStoredItems,
        registerOptimisticOp,
        confirmOptimisticOp,
        revertOptimisticOp,
        actionToast,
        showActionToast,
        clearActionToast,
        submitAuditRequest,
        approveAuditRequest,
        rejectAuditRequest,
        deleteAuditRequest,
      }}
    >
      {children}
    </InventoryContext.Provider>
  );
};

export const useInventory = () => {
  const context = useContext(InventoryContext);
  if (!context) {
    throw new Error('useInventory must be used within an InventoryProvider');
  }
  return context;
};
