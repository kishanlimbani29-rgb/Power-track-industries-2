import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
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
  addItem: (item: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateItem: (id: string, updates: Partial<InventoryItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  quickAdjustStock: (
    itemId: string,
    delta: number,
    type: StockMovementType,
    reason: string
  ) => Promise<void>;

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

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [batches, setBatches] = useState<ProductionBatch[]>([]);
  const teamMembers = authTeamMembers;

  // Real-time audit requests queue (no fake demo data, no localStorage source)
  const [auditRequests, setAuditRequests] = useState<AuditRequest[]>([]);

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

  // Real-time Firestore Listeners: only start after user's profile has loaded with status 'active'
  useEffect(() => {
    const isProfileActiveUser = Boolean(
      currentUser && profile && profile.status === 'active'
    );

    if (!isProfileActiveUser) {
      if (profile && profile.status !== 'active') {
        setIsLoading(false);
      }
      return;
    }

    setListenerError(null);
    const unsubs: (() => void)[] = [];
    let initialLoadDone = false;

    const handleListenerError = (error: any, collectionName: string) => {
      console.warn(`${collectionName} listener error:`, error?.message || error);
      setIsLoading(false);
      const isPermissionDenied =
        error?.code === 'permission-denied' ||
        (error?.message && error.message.includes('Missing or insufficient permissions'));
      if (isPermissionDenied) {
        setListenerError("Can't load inventory – you may not have access. Tap to retry");
      }
    };

    try {
      // 1. Items listener
      const itemsQuery = collection(db, 'items');
      const unsubItems = onSnapshot(
        itemsQuery,
        (snapshot) => {
          setListenerError(null);
          const list: InventoryItem[] = [];
          snapshot.forEach((docSnap) => {
            list.push(docSnap.data() as InventoryItem);
          });
          setItems(list.sort((a, b) => a.name.localeCompare(b.name)));
          triggerSyncIndicator();
          if (!initialLoadDone) {
            initialLoadDone = true;
            setIsLoading(false);
          }
        },
        (error) => handleListenerError(error, 'Items')
      );
      unsubs.push(unsubItems);

      // 2. Recipes listener
      const recipesQuery = collection(db, 'recipes');
      const unsubRecipes = onSnapshot(
        recipesQuery,
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
      unsubs.push(unsubRecipes);

      // 3. Stock Movements (Ordered newest first with dynamic limit)
      const movementsQuery = query(
        collection(db, 'movements'),
        orderBy('timestamp', 'desc'),
        limit(movementsLimit)
      );
      const unsubMovements = onSnapshot(
        movementsQuery,
        (snapshot) => {
          const list: StockMovement[] = [];
          snapshot.forEach((docSnap) => {
            list.push(docSnap.data() as StockMovement);
          });
          setMovements(list);
          setHasMoreMovements(list.length >= movementsLimit);
          triggerSyncIndicator();
        },
        (error) => handleListenerError(error, 'Movements')
      );
      unsubs.push(unsubMovements);

      // 4. Batches log (Ordered newest first with dynamic limit)
      const batchesQuery = query(
        collection(db, 'batches'),
        orderBy('timestamp', 'desc'),
        limit(batchesLimit)
      );
      const unsubBatches = onSnapshot(
        batchesQuery,
        (snapshot) => {
          const list: ProductionBatch[] = [];
          snapshot.forEach((docSnap) => {
            list.push(docSnap.data() as ProductionBatch);
          });
          setBatches(list);
          setHasMoreBatches(list.length >= batchesLimit);
          triggerSyncIndicator();
        },
        (error) => handleListenerError(error, 'Batches')
      );
      unsubs.push(unsubBatches);

      // 5. Audit Requests log (Real-time sync between phones, newest first)
      const auditQuery = query(
        collection(db, 'audit_requests'),
        orderBy('submittedAt', 'desc')
      );
      const unsubAudit = onSnapshot(
        auditQuery,
        (snapshot) => {
          const list: AuditRequest[] = [];
          snapshot.forEach((docSnap) => {
            list.push(docSnap.data() as AuditRequest);
          });
          setAuditRequests(list);
          triggerSyncIndicator();
        },
        (error) => handleListenerError(error, 'Audit requests')
      );
      unsubs.push(unsubAudit);

    } catch (err) {
      console.error('Error attaching Firestore listeners:', err);
      setIsLoading(false);
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [
    currentUser,
    profile?.status,
    profile?.role,
    role,
    movementsLimit,
    batchesLimit,
    listenerRetryCount,
    triggerSyncIndicator,
  ]);

  // =========================================================================
  // INVENTORY ITEMS ACTIONS
  // =========================================================================

  const addItem = async (itemData: Omit<InventoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> => {
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
        `Cannot delete item: It is used in ${dependentRecipes.length} recipe(s) (${names}). Remove or update these recipes first.`
      );
    }

    try {
      await deleteDoc(doc(db, 'items', id));
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
      }
      handleFirestoreError(error, OperationType.DELETE, `items/${id}`);
    }
  };

  /**
   * Quick Adjust Stock: Transactional read-modify-write preventing race conditions
   * and blocking negative balances on out/waste.
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

    const itemRef = doc(db, 'items', itemId);
    const movRef = doc(collection(db, 'movements'));
    const now = new Date().toISOString();

    try {
      await runTransaction(db, async (transaction) => {
        const itemSnap = await transaction.get(itemRef);
        if (!itemSnap.exists()) {
          throw new Error('Item not found in inventory database.');
        }

        const currentItem = itemSnap.data() as InventoryItem;
        const previousQuantity = getItemQuantity(currentItem);
        const parsedDelta = Math.abs(Number(delta) || 0);
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
    } catch (error: any) {
      if (error?.message?.includes('offline') || error?.message?.includes('network')) {
        throw new Error('No internet connection — nothing was saved. Please try again.');
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
      throw new Error('Your user role does not have permission to create recipes.');
    }

    // Validate: Output product cannot be one of its own ingredients
    if (recipeData.ingredients.some((ing) => ing.rawItemId === recipeData.finishedItemId)) {
      throw new Error('The target output product cannot be one of its own ingredients.');
    }

    // Validate: No duplicate ingredients
    const seenItemIds = new Set<string>();
    for (const ing of recipeData.ingredients) {
      if (seenItemIds.has(ing.rawItemId)) {
        throw new Error(`Duplicate ingredient: "${ing.rawItemName || 'Item'}" cannot be added twice.`);
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
      throw new Error('Only Managers and Admins can update recipes.');
    }

    if (updates.ingredients) {
      const targetFinishedId = updates.finishedItemId || recipes.find((r) => r.id === id)?.finishedItemId;
      if (updates.ingredients.some((ing) => ing.rawItemId === targetFinishedId)) {
        throw new Error('The target output product cannot be one of its own ingredients.');
      }

      const seenItemIds = new Set<string>();
      for (const ing of updates.ingredients) {
        if (seenItemIds.has(ing.rawItemId)) {
          throw new Error(`Duplicate ingredient: "${ing.rawItemName || 'Item'}" cannot be added twice.`);
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
      throw new Error('Only Managers and Admins can delete recipes.');
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
              name: `${ing.rawItemName || 'Material'} (Missing material — edit recipe)`,
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
    if (!recipe) return { success: false, error: 'Recipe not found' };

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

    // Check for missing ingredients before opening transaction
    for (const mat of aggregatedIngredients) {
      const existsInState = items.some((i) => i.id === mat.rawItemId);
      if (!existsInState) {
        return { success: false, error: 'Missing material — edit recipe' };
      }
    }

    const batchRef = doc(collection(db, 'batches'));
    const batchId = batchRef.id;
    const now = new Date().toISOString();

    try {
      await runTransaction(db, async (transaction) => {
        // --- READ PHASE FIRST ---
        // Read target finished good doc
        const finishedRef = doc(db, 'items', targetFinishedItemId);
        const finishedSnap = await transaction.get(finishedRef);
        if (!finishedSnap.exists()) {
          throw new Error('Target finished product not found in inventory catalog.');
        }
        const finishedItem = finishedSnap.data() as InventoryItem;

        // Read each aggregated ingredient doc
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
            throw new Error('Missing material — edit recipe');
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
        const movYieldRef = doc(collection(db, 'movements'));
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
        rawSnaps.forEach(({ ref, item, needed, unit }) => {
          const prevRawQty = getItemQuantity(item);
          const newRawQty = prevRawQty - needed;

          transaction.update(ref, {
            quantity: newRawQty,
            updatedAt: now,
            lastUpdatedBy: realUserName,
          });

          const movConsumeRef = doc(collection(db, 'movements'));
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

      return { success: true };
    } catch (err: any) {
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

    const batchRef = doc(db, 'batches', batchId);
    const now = new Date().toISOString();

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
        const rawRestoreSnaps: Array<{ ref: any; item: InventoryItem; restoreQty: number }> = [];
        for (const deducted of batchData.rawMaterialsDeducted || []) {
          const rawRef = doc(db, 'items', deducted.rawItemId);
          const rawSnap = await transaction.get(rawRef);
          if (rawSnap.exists()) {
            rawRestoreSnaps.push({
              ref: rawRef,
              item: rawSnap.data() as InventoryItem,
              restoreQty: Number(deducted.quantity) || 0,
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

        const movFinVoidRef = doc(collection(db, 'movements'));
        const movFinVoid: StockMovement = {
          id: movFinVoidRef.id,
          itemId: finItem.id,
          itemName: finItem.name,
          type: 'out',
          quantity: qtyToReverse,
          previousQuantity: currentFinQty,
          newQuantity: newFinQty,
          reason: `VOID Batch #${batchId}: ${voidReason.trim()}`,
          referenceId: batchId,
          performedBy: realUserUid,
          performedByName: realUserName,
          timestamp: now,
        };
        transaction.set(movFinVoidRef, movFinVoid);

        // 4. Restore each raw material
        rawRestoreSnaps.forEach(({ ref, item, restoreQty }) => {
          const currentRawQty = getItemQuantity(item);
          const newRawQty = currentRawQty + restoreQty;

          transaction.update(ref, {
            quantity: newRawQty,
            updatedAt: now,
            lastUpdatedBy: realUserName,
          });

          const movRawVoidRef = doc(collection(db, 'movements'));
          const movRawVoid: StockMovement = {
            id: movRawVoidRef.id,
            itemId: item.id,
            itemName: item.name,
            type: 'in',
            quantity: restoreQty,
            previousQuantity: currentRawQty,
            newQuantity: newRawQty,
            reason: `VOID Batch #${batchId} Material Restored: ${voidReason.trim()}`,
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
          voidReason: voidReason.trim(),
        });
      });

      return { success: true };
    } catch (err: any) {
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

    const reqRef = doc(db, 'audit_requests', requestId);
    const now = new Date().toISOString();

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
            throw new Error('Production request is missing recipe information.');
          }

          const recipe = recipes.find((r) => r.id === req.recipeId);
          if (!recipe) throw new Error('Associated production recipe was not found.');

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
              throw new Error('Missing material — edit recipe');
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

          const batchRef = doc(collection(db, 'batches'));
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

          const movYieldRef = doc(collection(db, 'movements'));
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
          rawSnaps.forEach(({ ref, item, needed, unit }) => {
            const prevRawQty = getItemQuantity(item);
            const newRawQty = prevRawQty - needed;
            transaction.update(ref, {
              quantity: newRawQty,
              updatedAt: now,
              lastUpdatedBy: realUserName,
            });

            const movConsumeRef = doc(collection(db, 'movements'));
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

          const movRef = doc(collection(db, 'movements'));
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

          let itemRef = req.rawItemId ? doc(db, 'items', req.rawItemId) : doc(collection(db, 'items'));
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
              sku: `RAW-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
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

          const movRef = doc(collection(db, 'movements'));
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

      triggerSyncIndicator();
      return { success: true };
    } catch (err: any) {
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

    const reqRef = doc(db, 'audit_requests', requestId);
    const now = new Date().toISOString();

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

      triggerSyncIndicator();
      return { success: true };
    } catch (err: any) {
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
        addRecipe,
        updateRecipe,
        deleteRecipe,
        produceRecipeBatch,
        voidBatch,
        calculateRecipeCost,
        getRecipeFeasibility,
        seedSampleData,
        clearAllStoredItems,
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
