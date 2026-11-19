import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  deleteField,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  DocumentReference,
  DocumentSnapshot,
  Transaction,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from './AuthContext';
import { useInventory, removeUndefinedFields } from './InventoryContext';
import { getItemQuantity } from '../utils/itemResolver';
import { canChangeEntry } from '../utils/changeWindow';
import {
  BatteryCheck,
  CustomerAdvance,
  CustomerAdvanceUse,
  InventoryItem,
  PartyInfo,
  PaymentEntry,
  PaymentMode,
  Purchase,
  PurchaseLine,
  PurchaseReceipt,
  PurchaseReturn,
  ReturnStatus,
  Sale,
  SaleLine,
  SalesReturn,
  SalesReturnCondition,
  StockMovement,
  TradeReturnLine,
} from '../types/inventory';
import { getCustomerKey } from '../components/trade/customerKhata';
import {
  calcLine,
  docNumber,
  formatINR,
  moneyPosition,
  newId,
  round2,
  sumLines,
  todayISODate,
  weightedAverageCost,
} from '../utils/tradeMath';

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------
export interface SaleLineInput {
  itemId: string;
  quantity: number;
  rate: number;
  discountPct?: number;
  gstPct?: number;
}
export interface NewSaleInput {
  customer: PartyInfo;
  lines: SaleLineInput[];
  vehicleNumber?: string;
  trackingNumber?: string;
  notes?: string;
}
export interface PurchaseLineInput {
  itemId: string;
  quantity: number;
  rate: number;
  gstPct?: number;
}
export interface NewPurchaseInput {
  supplier: PartyInfo;
  lines: PurchaseLineInput[];
  expectedDate?: string;
  notes?: string;
}
export interface QtyLineInput {
  itemId: string;
  quantity: number;
}
export interface PaymentInput {
  amount: number;
  date: string;
  mode: PaymentMode;
  note?: string;
}

export interface PartySuggestion extends PartyInfo {
  key: string;
}

export interface CreateBatteryCheckInput {
  partyName: string;
  partyPhone?: string;
  itemId: string;
  quantity: number;
  serial?: string;
  problem: string;
  receivedAt: string;
}

export interface ResolveBatteryCheckInput {
  outcome: 'ok_returned' | 'replaced' | 'repaired_returned' | 'taken_back';
  resultNote?: string;
}

interface TradeContextType {
  sales: Sale[];
  salesReturns: SalesReturn[];
  batteryChecks: BatteryCheck[];
  customerAdvances: CustomerAdvance[];
  purchases: Purchase[];
  purchaseReturns: PurchaseReturn[];
  hasMoreSales: boolean;
  hasMorePurchases: boolean;
  loadMoreSales: () => void;
  loadMorePurchases: () => void;
  openSalesCount: number;
  openPurchaseCount: number;
  customers: PartySuggestion[];
  suppliers: PartySuggestion[];
  tradeError: string | null;

  createSale: (input: NewSaleInput, onOptimistic?: (draft: Sale) => void) => Promise<Sale>;
  editSale: (saleId: string, input: NewSaleInput) => Promise<Sale>;
  deleteSale: (saleId: string, reason?: string) => Promise<void>;
  cancelSale: (saleId: string, reason: string) => Promise<void>;
  recordSalePayment: (saleId: string, p: PaymentInput) => Promise<void>;
  editSalePayment: (saleId: string, paymentId: string, p: PaymentInput) => Promise<void>;
  deleteSalePayment: (saleId: string, paymentId: string) => Promise<void>;
  recordSaleRefund: (saleId: string, p: PaymentInput) => Promise<void>;
  createCustomerAdvance: (input: {
    partyKey: string;
    partyName: string;
    partyPhone?: string;
    amount: number;
    mode: PaymentMode;
    date: string;
    note?: string;
  }) => Promise<CustomerAdvance>;
  editCustomerAdvance: (advanceId: string, p: PaymentInput) => Promise<void>;
  deleteCustomerAdvance: (advanceId: string) => Promise<void>;
  applyCustomerAdvanceToSale: (saleId: string, partyKey: string, date: string) => Promise<number>;
  createSalesReturn: (
    saleId: string,
    input: { lines: QtyLineInput[]; reason: string; condition: SalesReturnCondition; date: string; notes?: string }
  ) => Promise<SalesReturn>;
  editSalesReturn: (
    returnId: string,
    input: { lines: QtyLineInput[]; reason: string; condition: SalesReturnCondition; date: string; notes?: string }
  ) => Promise<SalesReturn>;
  deleteSalesReturn: (returnId: string, reason?: string) => Promise<void>;
  createBatteryCheck: (input: CreateBatteryCheckInput) => Promise<BatteryCheck>;
  resolveBatteryCheck: (checkId: string, input: ResolveBatteryCheckInput) => Promise<BatteryCheck>;

  createPurchase: (input: NewPurchaseInput) => Promise<Purchase>;
  editPurchase: (purchaseId: string, input: NewPurchaseInput) => Promise<Purchase>;
  deletePurchase: (purchaseId: string, reason?: string) => Promise<void>;
  cancelPurchase: (purchaseId: string, reason: string) => Promise<void>;
  receivePurchase: (
    purchaseId: string,
    input: { lines: QtyLineInput[]; billNumber?: string; billDate?: string }
  ) => Promise<void>;
  recordPurchasePayment: (purchaseId: string, p: PaymentInput) => Promise<void>;
  recordPurchaseRefund: (purchaseId: string, p: PaymentInput) => Promise<void>;
  createPurchaseReturn: (
    purchaseId: string,
    input: { lines: QtyLineInput[]; reason: string; vehicleNumber?: string; date: string; notes?: string }
  ) => Promise<PurchaseReturn>;
  editPurchaseReturn: (
    returnId: string,
    input: { lines: QtyLineInput[]; reason: string; vehicleNumber?: string; date: string; notes?: string }
  ) => Promise<PurchaseReturn>;
  deletePurchaseReturn: (returnId: string, reason?: string) => Promise<void>;
}

const TradeContext = createContext<TradeContextType | undefined>(undefined);

interface OptimisticTradeOpInput {
  id: string;
  addedSales?: Sale[];
  salePatches?: Record<string, Partial<Sale>>;
  deletedSaleIds?: string[];
  addedSalesReturns?: SalesReturn[];
  salesReturnPatches?: Record<string, Partial<SalesReturn>>;
  deletedSalesReturnIds?: string[];
  addedBatteryChecks?: BatteryCheck[];
  batteryCheckPatches?: Record<string, Partial<BatteryCheck>>;
  deletedBatteryCheckIds?: string[];
  addedAdvances?: CustomerAdvance[];
  advancePatches?: Record<string, Partial<CustomerAdvance>>;
  deletedAdvanceIds?: string[];
  addedPurchases?: Purchase[];
  purchasePatches?: Record<string, Partial<Purchase>>;
  deletedPurchaseIds?: string[];
  addedPurchaseReturns?: PurchaseReturn[];
  purchaseReturnPatches?: Record<string, Partial<PurchaseReturn>>;
  deletedPurchaseReturnIds?: string[];
}

interface InternalOptimisticTradeOp extends OptimisticTradeOpInput {
  createdAtMs: number;
  committedAtMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function assertOnline() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('No internet connection — nothing was saved. Please try again.');
  }
}

function friendly(err: any, fallback: string): Error {
  const msg: string = err?.message || String(err || '');
  if (/offline|network|unavailable/i.test(msg)) {
    return new Error('No internet connection — nothing was saved. Please try again.');
  }
  if (/permission|insufficient/i.test(msg)) {
    return new Error('You do not have permission to do this. Ask the Admin to check your role switches.');
  }
  return new Error(msg || fallback);
}

const returnStatusFor = (lines: { itemId: string; quantity: number }[], returned: Record<string, number>): ReturnStatus => {
  const totalReturned = Object.values(returned).reduce((a, b) => a + (Number(b) || 0), 0);
  if (totalReturned <= 0) return 'none';
  const all = lines.every((l) => (returned[l.itemId] || 0) >= l.quantity - 1e-9);
  return all ? 'fully_returned' : 'partly_returned';
};

function guessNextDocNumber(prefix: string, list: Array<Record<string, any>>, field: string): string {
  const year = String(new Date().getFullYear()).slice(-2);
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let maxN = 0;
  for (const row of list) {
    const val = String(row?.[field] || '');
    const m = val.match(re);
    if (m) {
      const n = Number(m[1]);
      if (n > maxN) maxN = n;
    }
  }
  return docNumber(prefix, maxN + 1);
}

/** Reads (or prepares) a yearly counter. Must be called BEFORE any write in the transaction. */
async function readCounter(tx: Transaction, name: string) {
  const ref = doc(db, 'counters', `${name}_${new Date().getFullYear()}`);
  const snap = await tx.get(ref);
  const current = snap.exists() ? Number((snap.data() as any).value) || 0 : 0;
  return { ref, next: current + 1, exists: snap.exists() };
}
function writeCounter(tx: Transaction, c: { ref: DocumentReference; next: number; exists: boolean }) {
  const now = new Date().toISOString();
  if (c.exists) tx.update(c.ref, { value: c.next, updatedAt: now });
  else tx.set(c.ref, { value: 1, updatedAt: now });
}

/** Reads every distinct item (all reads first — Firestore requires reads before writes). */
async function readItems(tx: Transaction, itemIds: string[]) {
  const map = new Map<string, { ref: DocumentReference; snap: DocumentSnapshot; item: InventoryItem | null }>();
  for (const id of Array.from(new Set(itemIds))) {
    const ref = doc(db, 'items', id);
    const snap = await tx.get(ref);
    map.set(id, { ref, snap, item: snap.exists() ? (snap.data() as InventoryItem) : null });
  }
  return map;
}

function ensureUniqueLines(lines: { itemId: string }[]) {
  const seen = new Set<string>();
  for (const l of lines) {
    if (!l.itemId) throw new Error('Choose an item on every row.');
    if (seen.has(l.itemId)) throw new Error('The same item is on two rows. Put the full quantity on one row.');
    seen.add(l.itemId);
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export const TradeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, profile, permissions, realUserName, realUserUid, role } = useAuth();
  const { items, registerOptimisticOp, confirmOptimisticOp, revertOptimisticOp } = useInventory();

  const [rawSales, setRawSales] = useState<Sale[]>([]);
  const [rawSalesReturns, setRawSalesReturns] = useState<SalesReturn[]>([]);
  const [rawBatteryChecks, setRawBatteryChecks] = useState<BatteryCheck[]>([]);
  const [rawCustomerAdvances, setRawCustomerAdvances] = useState<CustomerAdvance[]>([]);
  const [rawPurchases, setRawPurchases] = useState<Purchase[]>([]);
  const [rawPurchaseReturns, setRawPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [optimisticTradeOps, setOptimisticTradeOps] = useState<InternalOptimisticTradeOp[]>([]);
  const tradeOpTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [salesLimit, setSalesLimit] = useState(100);
  const [purchasesLimit, setPurchasesLimit] = useState(100);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const canSeeSales = permissions.canViewSalesOption;
  const canSeePurchases = permissions.canViewPurchaseOption || permissions.canReceivePurchase;
  const active = Boolean(currentUser && profile && profile.status === 'active');

  const registerTradeOp = useCallback((op: OptimisticTradeOpInput) => {
    setOptimisticTradeOps((prev) => [...prev, { ...op, createdAtMs: Date.now() }]);
  }, []);

  const revertTradeOp = useCallback((opId: string) => {
    const t = tradeOpTimersRef.current.get(opId);
    if (t) {
      clearTimeout(t);
      tradeOpTimersRef.current.delete(opId);
    }
    setOptimisticTradeOps((prev) => prev.filter((o) => o.id !== opId));
  }, []);

  const confirmTradeOp = useCallback((opId: string, override?: Partial<OptimisticTradeOpInput>) => {
    setOptimisticTradeOps((prev) =>
      prev.map((o) => (o.id === opId ? { ...o, ...(override || {}), committedAtMs: Date.now() } : o))
    );
    const existing = tradeOpTimersRef.current.get(opId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      tradeOpTimersRef.current.delete(opId);
      setOptimisticTradeOps((prev) => prev.filter((o) => o.id !== opId));
    }, 1500);
    tradeOpTimersRef.current.set(opId, timer);
  }, []);

  useEffect(() => {
    return () => {
      tradeOpTimersRef.current.forEach((t) => clearTimeout(t));
      tradeOpTimersRef.current.clear();
    };
  }, []);

  // Prune committed trade ops once Firestore snapshots reflect them
  useEffect(() => {
    if (optimisticTradeOps.length === 0) return;
    const rawSaleMap = new Map(rawSales.map((s) => [s.id, s]));
    const rawSrMap = new Map(rawSalesReturns.map((r) => [r.id, r]));
    const rawBcMap = new Map(rawBatteryChecks.map((b) => [b.id, b]));
    const rawAdvMap = new Map(rawCustomerAdvances.map((a) => [a.id, a]));
    const rawPoMap = new Map(rawPurchases.map((p) => [p.id, p]));
    const rawPrMap = new Map(rawPurchaseReturns.map((r) => [r.id, r]));

    const toRemove: string[] = [];
    for (const op of optimisticTradeOps) {
      if (!op.committedAtMs) continue;

      const salesOk =
        (!op.addedSales || op.addedSales.every((s) => rawSaleMap.has(s.id))) &&
        (!op.deletedSaleIds || op.deletedSaleIds.every((id) => !rawSaleMap.has(id))) &&
        (!op.salePatches ||
          Object.entries(op.salePatches).every(([id, patch]) => {
            const raw = rawSaleMap.get(id);
            if (!raw) return true;
            return !patch.updatedAt || (raw.updatedAt && raw.updatedAt >= patch.updatedAt);
          }));

      const srOk =
        (!op.addedSalesReturns || op.addedSalesReturns.every((r) => rawSrMap.has(r.id))) &&
        (!op.deletedSalesReturnIds || op.deletedSalesReturnIds.every((id) => !rawSrMap.has(id))) &&
        (!op.salesReturnPatches ||
          Object.entries(op.salesReturnPatches).every(([id, patch]) => {
            const raw = rawSrMap.get(id);
            if (!raw) return true;
            return (
              (patch.total === undefined || Math.abs((raw.total || 0) - patch.total) < 0.01) &&
              (patch.reason === undefined || raw.reason === patch.reason) &&
              (patch.date === undefined || raw.date === patch.date)
            );
          }));

      const bcOk =
        (!op.addedBatteryChecks || op.addedBatteryChecks.every((b) => rawBcMap.has(b.id))) &&
        (!op.deletedBatteryCheckIds || op.deletedBatteryCheckIds.every((id) => !rawBcMap.has(id))) &&
        (!op.batteryCheckPatches ||
          Object.entries(op.batteryCheckPatches).every(([id, patch]) => {
            const raw = rawBcMap.get(id);
            if (!raw) return true;
            return !patch.status || raw.status === patch.status;
          }));

      const advOk =
        (!op.addedAdvances || op.addedAdvances.every((a) => rawAdvMap.has(a.id))) &&
        (!op.deletedAdvanceIds || op.deletedAdvanceIds.every((id) => !rawAdvMap.has(id))) &&
        (!op.advancePatches ||
          Object.entries(op.advancePatches).every(([id, patch]) => {
            const raw = rawAdvMap.get(id);
            if (!raw) return true;
            return (
              (patch.amount === undefined || Math.abs((raw.amount || 0) - patch.amount) < 0.01) &&
              (patch.remaining === undefined || Math.abs((raw.remaining || 0) - patch.remaining) < 0.01) &&
              (patch.date === undefined || raw.date === patch.date) &&
              (patch.mode === undefined || raw.mode === patch.mode)
            );
          }));

      const poOk =
        (!op.addedPurchases || op.addedPurchases.every((p) => rawPoMap.has(p.id))) &&
        (!op.deletedPurchaseIds || op.deletedPurchaseIds.every((id) => !rawPoMap.has(id))) &&
        (!op.purchasePatches ||
          Object.entries(op.purchasePatches).every(([id, patch]) => {
            const raw = rawPoMap.get(id);
            if (!raw) return true;
            return !patch.updatedAt || (raw.updatedAt && raw.updatedAt >= patch.updatedAt);
          }));

      const prOk =
        (!op.addedPurchaseReturns || op.addedPurchaseReturns.every((r) => rawPrMap.has(r.id))) &&
        (!op.deletedPurchaseReturnIds || op.deletedPurchaseReturnIds.every((id) => !rawPrMap.has(id))) &&
        (!op.purchaseReturnPatches ||
          Object.entries(op.purchaseReturnPatches).every(([id, patch]) => {
            const raw = rawPrMap.get(id);
            if (!raw) return true;
            return (
              (patch.total === undefined || Math.abs((raw.total || 0) - patch.total) < 0.01) &&
              (patch.reason === undefined || raw.reason === patch.reason) &&
              (patch.date === undefined || raw.date === patch.date)
            );
          }));

      if (salesOk && srOk && bcOk && advOk && poOk && prOk) {
        toRemove.push(op.id);
      }
    }

    if (toRemove.length > 0) {
      toRemove.forEach((id) => {
        const t = tradeOpTimersRef.current.get(id);
        if (t) {
          clearTimeout(t);
          tradeOpTimersRef.current.delete(id);
        }
      });
      const removeSet = new Set(toRemove);
      setOptimisticTradeOps((prev) => prev.filter((o) => !removeSet.has(o.id)));
    }
  }, [optimisticTradeOps, rawSales, rawSalesReturns, rawBatteryChecks, rawCustomerAdvances, rawPurchases, rawPurchaseReturns]);

  // Split Firestore listeners (each collection has its own useEffect so pagination doesn't restart unrelated listeners)
  useEffect(() => {
    if (!active || !canSeeSales) {
      setRawSales([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(salesLimit)),
      (snap) => {
        const list: Sale[] = [];
        snap.forEach((d) => list.push(d.data() as Sale));
        setRawSales(list);
        setTradeError(null);
      },
      (e: any) => {
        console.warn('Sales listener error:', e?.message || e);
        setTradeError("Can't load sales – you may not have access.");
      }
    );
    return () => unsub();
  }, [active, canSeeSales, salesLimit, role]);

  useEffect(() => {
    if (!active || !canSeeSales) {
      setRawSalesReturns([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'sales_returns'), orderBy('createdAt', 'desc'), limit(300)),
      (snap) => {
        const list: SalesReturn[] = [];
        snap.forEach((d) => list.push(d.data() as SalesReturn));
        setRawSalesReturns(list);
      },
      (e: any) => {
        console.warn('Sales returns listener error:', e?.message || e);
        setTradeError("Can't load sales returns – you may not have access.");
      }
    );
    return () => unsub();
  }, [active, canSeeSales, role]);

  useEffect(() => {
    if (!active || !canSeeSales) {
      setRawBatteryChecks([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'battery_checks'), orderBy('receivedAt', 'desc'), limit(300)),
      (snap) => {
        const list: BatteryCheck[] = [];
        snap.forEach((d) => list.push(d.data() as BatteryCheck));
        setRawBatteryChecks(list);
      },
      (e: any) => {
        console.warn('Battery checks listener error:', e?.message || e);
      }
    );
    return () => unsub();
  }, [active, canSeeSales, role]);

  useEffect(() => {
    if (!active || !canSeeSales) {
      setRawCustomerAdvances([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'customer_advances'), orderBy('createdAt', 'desc'), limit(300)),
      (snap) => {
        const list: CustomerAdvance[] = [];
        snap.forEach((d) => list.push(d.data() as CustomerAdvance));
        setRawCustomerAdvances(list);
      },
      (e: any) => {
        console.warn('Customer advances listener error:', e?.message || e);
      }
    );
    return () => unsub();
  }, [active, canSeeSales, role]);

  useEffect(() => {
    if (!active || !canSeePurchases) {
      setRawPurchases([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'purchases'), orderBy('createdAt', 'desc'), limit(purchasesLimit)),
      (snap) => {
        const list: Purchase[] = [];
        snap.forEach((d) => list.push(d.data() as Purchase));
        setRawPurchases(list);
        setTradeError(null);
      },
      (e: any) => {
        console.warn('Purchases listener error:', e?.message || e);
        setTradeError("Can't load purchases – you may not have access.");
      }
    );
    return () => unsub();
  }, [active, canSeePurchases, purchasesLimit, role]);

  useEffect(() => {
    if (!active || !canSeePurchases || !permissions.canViewPurchaseOption) {
      setRawPurchaseReturns([]);
      return;
    }
    const unsub = onSnapshot(
      query(collection(db, 'purchase_returns'), orderBy('createdAt', 'desc'), limit(300)),
      (snap) => {
        const list: PurchaseReturn[] = [];
        snap.forEach((d) => list.push(d.data() as PurchaseReturn));
        setRawPurchaseReturns(list);
      },
      (e: any) => {
        console.warn('Purchase returns listener error:', e?.message || e);
        setTradeError("Can't load purchase returns – you may not have access.");
      }
    );
    return () => unsub();
  }, [active, canSeePurchases, permissions.canViewPurchaseOption, role]);

  // Merged optimistic lists
  const sales = useMemo(() => {
    if (optimisticTradeOps.length === 0) return rawSales;
    const byId = new Map<string, Sale>();
    for (const s of rawSales) byId.set(s.id, s);
    for (const op of optimisticTradeOps) {
      if (op.addedSales) {
        for (const s of op.addedSales) {
          if (!byId.has(s.id)) byId.set(s.id, s);
        }
      }
      if (op.salePatches) {
        for (const [id, patch] of Object.entries(op.salePatches)) {
          const cur = byId.get(id);
          if (cur) byId.set(id, { ...cur, ...patch });
        }
      }
      if (op.deletedSaleIds) {
        for (const id of op.deletedSaleIds) byId.delete(id);
      }
    }
    return Array.from(byId.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [rawSales, optimisticTradeOps]);

  const salesReturns = useMemo(() => {
    if (optimisticTradeOps.length === 0) return rawSalesReturns;
    const byId = new Map<string, SalesReturn>();
    for (const r of rawSalesReturns) byId.set(r.id, r);
    for (const op of optimisticTradeOps) {
      if (op.addedSalesReturns) {
        for (const r of op.addedSalesReturns) {
          if (!byId.has(r.id)) byId.set(r.id, r);
        }
      }
      if (op.salesReturnPatches) {
        for (const [id, patch] of Object.entries(op.salesReturnPatches)) {
          const cur = byId.get(id);
          if (cur) byId.set(id, { ...cur, ...patch });
        }
      }
      if (op.deletedSalesReturnIds) {
        for (const id of op.deletedSalesReturnIds) byId.delete(id);
      }
    }
    return Array.from(byId.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [rawSalesReturns, optimisticTradeOps]);

  const purchases = useMemo(() => {
    if (optimisticTradeOps.length === 0) return rawPurchases;
    const byId = new Map<string, Purchase>();
    for (const p of rawPurchases) byId.set(p.id, p);
    for (const op of optimisticTradeOps) {
      if (op.addedPurchases) {
        for (const p of op.addedPurchases) {
          if (!byId.has(p.id)) byId.set(p.id, p);
        }
      }
      if (op.purchasePatches) {
        for (const [id, patch] of Object.entries(op.purchasePatches)) {
          const cur = byId.get(id);
          if (cur) byId.set(id, { ...cur, ...patch });
        }
      }
      if (op.deletedPurchaseIds) {
        for (const id of op.deletedPurchaseIds) byId.delete(id);
      }
    }
    return Array.from(byId.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [rawPurchases, optimisticTradeOps]);

  const purchaseReturns = useMemo(() => {
    if (optimisticTradeOps.length === 0) return rawPurchaseReturns;
    const byId = new Map<string, PurchaseReturn>();
    for (const r of rawPurchaseReturns) byId.set(r.id, r);
    for (const op of optimisticTradeOps) {
      if (op.addedPurchaseReturns) {
        for (const r of op.addedPurchaseReturns) {
          if (!byId.has(r.id)) byId.set(r.id, r);
        }
      }
      if (op.purchaseReturnPatches) {
        for (const [id, patch] of Object.entries(op.purchaseReturnPatches)) {
          const cur = byId.get(id);
          if (cur) byId.set(id, { ...cur, ...patch });
        }
      }
      if (op.deletedPurchaseReturnIds) {
        for (const id of op.deletedPurchaseReturnIds) byId.delete(id);
      }
    }
    return Array.from(byId.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [rawPurchaseReturns, optimisticTradeOps]);

  const batteryChecks = useMemo(() => {
    if (optimisticTradeOps.length === 0) return rawBatteryChecks;
    const byId = new Map<string, BatteryCheck>();
    for (const b of rawBatteryChecks) byId.set(b.id, b);
    for (const op of optimisticTradeOps) {
      if (op.addedBatteryChecks) {
        for (const b of op.addedBatteryChecks) {
          if (!byId.has(b.id)) byId.set(b.id, b);
        }
      }
      if (op.batteryCheckPatches) {
        for (const [id, patch] of Object.entries(op.batteryCheckPatches)) {
          const cur = byId.get(id);
          if (cur) byId.set(id, { ...cur, ...patch });
        }
      }
      if (op.deletedBatteryCheckIds) {
        for (const id of op.deletedBatteryCheckIds) byId.delete(id);
      }
    }
    return Array.from(byId.values()).sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }, [rawBatteryChecks, optimisticTradeOps]);

  const customerAdvances = useMemo(() => {
    if (optimisticTradeOps.length === 0) return rawCustomerAdvances;
    const byId = new Map<string, CustomerAdvance>();
    for (const a of rawCustomerAdvances) byId.set(a.id, a);
    for (const op of optimisticTradeOps) {
      if (op.addedAdvances) {
        for (const a of op.addedAdvances) {
          if (!byId.has(a.id)) byId.set(a.id, a);
        }
      }
      if (op.advancePatches) {
        for (const [id, patch] of Object.entries(op.advancePatches)) {
          const cur = byId.get(id);
          if (cur) byId.set(id, { ...cur, ...patch });
        }
      }
      if (op.deletedAdvanceIds) {
        for (const id of op.deletedAdvanceIds) byId.delete(id);
      }
    }
    return Array.from(byId.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [rawCustomerAdvances, optimisticTradeOps]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const salesRef = useRef(sales);
  salesRef.current = sales;
  const salesReturnsRef = useRef(salesReturns);
  salesReturnsRef.current = salesReturns;
  const batteryChecksRef = useRef(batteryChecks);
  batteryChecksRef.current = batteryChecks;
  const customerAdvancesRef = useRef(customerAdvances);
  customerAdvancesRef.current = customerAdvances;
  const purchasesRef = useRef(purchases);
  purchasesRef.current = purchases;
  const purchaseReturnsRef = useRef(purchaseReturns);
  purchaseReturnsRef.current = purchaseReturns;

  const loadMoreSales = useCallback(() => setSalesLimit((n) => n + 100), []);
  const loadMorePurchases = useCallback(() => setPurchasesLimit((n) => n + 100), []);

  const openSalesCount = 0;
  const openPurchaseCount = useMemo(
    () => purchases.filter((p) => p.status === 'ordered' || p.status === 'partly_received').length,
    [purchases]
  );

  const buildParties = (list: { party: PartyInfo }[]) => {
    const map = new Map<string, PartySuggestion>();
    for (const { party } of list) {
      const key = (party?.name || '').trim().toLowerCase();
      if (!key || map.has(key)) continue; // lists are newest first → keep latest details
      map.set(key, { ...party, key });
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  };
  const customers = useMemo(() => buildParties(sales.map((s) => ({ party: s.customer }))), [sales]);
  const suppliers = useMemo(() => buildParties(purchases.map((p) => ({ party: p.supplier }))), [purchases]);

  const itemName = (id: string) => itemsRef.current.find((i) => i.id === id)?.name || 'Item';

  const movement = (
    tx: Transaction,
    item: InventoryItem,
    type: 'in' | 'out',
    qty: number,
    prev: number,
    next: number,
    reason: string,
    referenceId: string,
    now: string,
    preRef?: DocumentReference
  ) => {
    const ref = preRef || doc(collection(db, 'movements'));
    const m: StockMovement = {
      id: ref.id,
      itemId: item.id,
      itemName: item.name,
      type,
      quantity: qty,
      previousQuantity: prev,
      newQuantity: next,
      reason,
      referenceId,
      performedBy: realUserUid,
      performedByName: realUserName,
      timestamp: now,
    };
    tx.set(ref, m);
  };

  const payment = (p: PaymentInput, now: string): PaymentEntry =>
    removeUndefinedFields({
      id: newId(),
      amount: round2(p.amount),
      date: p.date,
      mode: p.mode,
      note: p.note?.trim() || undefined,
      recordedBy: realUserUid,
      recordedByName: realUserName,
      recordedAt: now,
    });

  // =========================================================================
  // SALES
  // =========================================================================
  const createSale = async (input: NewSaleInput, onOptimistic?: (draft: Sale) => void): Promise<Sale> => {
    assertOnline();
    if (!permissions.canCreateSales) throw new Error('Your role is not allowed to create sales.');
    const customerName = input.customer.name?.trim();
    if (!customerName) throw new Error('Customer name is required.');
    if (!input.lines.length) throw new Error('Add at least one item.');
    ensureUniqueLines(input.lines);
    for (const l of input.lines) {
      if (!(Number(l.quantity) > 0)) throw new Error(`Quantity for ${itemName(l.itemId)} must be more than 0.`);
      if (Number(l.rate) < 0) throw new Error(`Rate for ${itemName(l.itemId)} can't be negative.`);
    }

    const saleRef = doc(collection(db, 'sales'));
    const now = new Date().toISOString();
    const estimatedInv = guessNextDocNumber('INV', salesRef.current, 'invoiceNumber');

    // Local stock & item validation + optimistic draft construction
    const movRefs = new Map<string, DocumentReference>();
    const optItemPatches: Record<string, Partial<InventoryItem>> = {};
    const optMovements: StockMovement[] = [];
    const optLines: SaleLine[] = input.lines.map((l) => {
      const it = itemsRef.current.find((i) => i.id === l.itemId);
      if (!it) throw new Error(`${itemName(l.itemId)} was not found in inventory.`);
      const onHand = getItemQuantity(it);
      if (Number(l.quantity) > onHand) {
        throw new Error(`Only ${onHand} ${it.unit} of ${it.name} in stock.`);
      }
      const next = round2(onHand - Number(l.quantity));
      const mRef = doc(collection(db, 'movements'));
      movRefs.set(it.id, mRef);
      optItemPatches[it.id] = {
        quantity: next,
        updatedAt: now,
        lastUpdatedBy: realUserName,
      };
      optMovements.push({
        id: mRef.id,
        itemId: it.id,
        itemName: it.name,
        type: 'out',
        quantity: Number(l.quantity),
        previousQuantity: onHand,
        newQuantity: next,
        reason: `Sale ${estimatedInv} to ${customerName}`,
        referenceId: saleRef.id,
        performedBy: realUserUid,
        performedByName: realUserName,
        timestamp: now,
      });
      const calc = calcLine(l);
      return removeUndefinedFields({
        itemId: it.id,
        itemName: it.name,
        sku: it.sku || undefined,
        unit: it.unit,
        quantity: Number(l.quantity),
        rate: round2(l.rate),
        discountPct: Number(l.discountPct) || 0,
        gstPct: Number(l.gstPct) || 0,
        ...calc,
        costPrice: round2(it.unitCost || 0),
      });
    });

    const optTotals = sumLines(optLines);
    const draftSale: Sale = removeUndefinedFields({
      id: saleRef.id,
      invoiceNumber: estimatedInv,
      status: 'delivered',
      customer: removeUndefinedFields({
        name: customerName,
        phone: input.customer.phone?.trim() || undefined,
        gstin: input.customer.gstin?.trim().toUpperCase() || undefined,
        address: input.customer.address?.trim() || undefined,
      }),
      lines: optLines,
      ...optTotals,
      vehicleNumber: input.vehicleNumber?.trim() || undefined,
      trackingNumber: input.trackingNumber?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      payments: [],
      amountPaid: 0,
      refunds: [],
      refundedTotal: 0,
      returnedQty: {},
      returnsTotal: 0,
      returnStatus: 'none',
      paymentStatus: optTotals.grandTotal > 0 ? 'unpaid' : 'paid',
      createdBy: realUserUid,
      createdByName: realUserName,
      createdAt: now,
      updatedAt: now,
      deliveredAt: now,
    });

    const opId = `createSale-${saleRef.id}-${Date.now()}`;
    registerTradeOp({ id: opId, addedSales: [draftSale] });
    registerOptimisticOp({ id: opId, itemPatches: optItemPatches, movements: optMovements });
    if (onOptimistic) onOptimistic(draftSale);

    try {
      const savedSale = await runTransaction(db, async (tx) => {
        // ---- reads
        const counter = await readCounter(tx, 'sales');
        const itemMap = await readItems(tx, input.lines.map((l) => l.itemId));
        const invoiceNumber = docNumber('INV', counter.next);

        const lines: SaleLine[] = input.lines.map((l) => {
          const entry = itemMap.get(l.itemId)!;
          if (!entry.item) throw new Error(`${itemName(l.itemId)} was not found in inventory.`);
          const onHand = getItemQuantity(entry.item);
          if (Number(l.quantity) > onHand) {
            throw new Error(`Only ${onHand} ${entry.item.unit} of ${entry.item.name} in stock.`);
          }
          const calc = calcLine(l);
          return removeUndefinedFields({
            itemId: entry.item.id,
            itemName: entry.item.name,
            sku: entry.item.sku || undefined,
            unit: entry.item.unit,
            quantity: Number(l.quantity),
            rate: round2(l.rate),
            discountPct: Number(l.discountPct) || 0,
            gstPct: Number(l.gstPct) || 0,
            ...calc,
            costPrice: round2(entry.item.unitCost || 0),
          });
        });
        const totals = sumLines(lines);

        // ---- writes
        writeCounter(tx, counter);
        for (const line of lines) {
          const entry = itemMap.get(line.itemId)!;
          const prev = getItemQuantity(entry.item!);
          const next = round2(prev - line.quantity);
          tx.update(entry.ref, {
            quantity: next,
            updatedAt: now,
            lastUpdatedBy: realUserName,
            lastMovementType: 'out',
            lastMovementReason: `Sale ${invoiceNumber} to ${customerName}`,
          });
          movement(
            tx,
            entry.item!,
            'out',
            line.quantity,
            prev,
            next,
            `Sale ${invoiceNumber} to ${customerName}`,
            saleRef.id,
            now,
            movRefs.get(line.itemId)
          );
        }
        const sale: Sale = removeUndefinedFields({
          id: saleRef.id,
          invoiceNumber,
          status: 'delivered',
          customer: removeUndefinedFields({
            name: customerName,
            phone: input.customer.phone?.trim() || undefined,
            gstin: input.customer.gstin?.trim().toUpperCase() || undefined,
            address: input.customer.address?.trim() || undefined,
          }),
          lines,
          ...totals,
          vehicleNumber: input.vehicleNumber?.trim() || undefined,
          trackingNumber: input.trackingNumber?.trim() || undefined,
          notes: input.notes?.trim() || undefined,
          payments: [],
          amountPaid: 0,
          refunds: [],
          refundedTotal: 0,
          returnedQty: {},
          returnsTotal: 0,
          returnStatus: 'none',
          paymentStatus: totals.grandTotal > 0 ? 'unpaid' : 'paid',
          createdBy: realUserUid,
          createdByName: realUserName,
          createdAt: now,
          updatedAt: now,
          deliveredAt: now,
        });
        tx.set(saleRef, sale);
        return sale;
      });
      confirmTradeOp(opId, { addedSales: [savedSale] });
      confirmOptimisticOp(opId);
      return savedSale;
    } catch (err) {
      revertTradeOp(opId);
      revertOptimisticOp(opId);
      throw friendly(err, 'The sale could not be saved.');
    }
  };

  const cancelSale = async (saleId: string, reason: string) => {
    assertOnline();
    if (!permissions.canCreateSales) throw new Error('Your role is not allowed to cancel sales.');
    const localSale = salesRef.current.find((s) => s.id === saleId);
    const now = new Date().toISOString();
    const movRefs = new Map<string, DocumentReference>();
    let opId: string | null = null;

    if (localSale) {
      if (localSale.status === 'cancelled') throw new Error('This sale is already cancelled.');
      const changeCheck = canChangeEntry(
        {
          createdByUid: localSale.createdBy,
          createdByName: localSale.createdByName,
          createdAt: localSale.createdAt,
        },
        realUserUid,
        permissions,
        role
      );
      if (!changeCheck.allowed) throw new Error(changeCheck.reason || 'Locked: cannot cancel this sale.');
      if ((localSale.amountPaid || 0) > 0) throw new Error('A payment is recorded on this sale, so it can’t be cancelled. Use Return instead.');
      if ((localSale.returnsTotal || 0) > 0) throw new Error('This sale has returns, so it can’t be cancelled.');

      const itemPatches: Record<string, Partial<InventoryItem>> = {};
      const movs: StockMovement[] = [];
      for (const line of localSale.lines) {
        const it = itemsRef.current.find((i) => i.id === line.itemId);
        if (!it) continue;
        const prev = getItemQuantity(it);
        const nextQty = round2(prev + line.quantity);
        const mRef = doc(collection(db, 'movements'));
        movRefs.set(line.itemId, mRef);
        itemPatches[it.id] = {
          quantity: nextQty,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        };
        movs.push({
          id: mRef.id,
          itemId: it.id,
          itemName: it.name,
          type: 'in',
          quantity: line.quantity,
          previousQuantity: prev,
          newQuantity: nextQty,
          reason: `Cancelled sale ${localSale.invoiceNumber}: ${reason || 'Cancelled'}`,
          referenceId: localSale.id,
          performedBy: realUserUid,
          performedByName: realUserName,
          timestamp: now,
        });
      }
      opId = `cancelSale-${saleId}-${Date.now()}`;
      registerTradeOp({
        id: opId,
        salePatches: {
          [saleId]: {
            status: 'cancelled',
            cancelledAt: now,
            cancelledBy: realUserName,
            cancelReason: reason?.trim() || 'Cancelled',
            paymentStatus: 'paid',
            updatedAt: now,
          },
        },
      });
      registerOptimisticOp({ id: opId, itemPatches, movements: movs });
    }

    const ref = doc(db, 'sales', saleId);
    try {
      await runTransaction(db, async (tx) => {
        // ---- reads
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        if (sale.status === 'cancelled') throw new Error('This sale is already cancelled.');
        const txCheck = canChangeEntry(
          {
            createdByUid: sale.createdBy,
            createdByName: sale.createdByName,
            createdAt: sale.createdAt,
          },
          realUserUid,
          permissions,
          role
        );
        if (!txCheck.allowed) throw new Error(txCheck.reason || 'Locked: cannot cancel this sale.');
        if ((sale.amountPaid || 0) > 0) throw new Error('A payment is recorded on this sale, so it can’t be cancelled. Use Return instead.');
        if ((sale.returnsTotal || 0) > 0) throw new Error('This sale has returns, so it can’t be cancelled.');
        const itemMap = await readItems(tx, sale.lines.map((l) => l.itemId));
        // ---- writes
        for (const line of sale.lines) {
          const entry = itemMap.get(line.itemId)!;
          if (!entry.item) continue; // item deleted meanwhile: nothing to put back
          const prev = getItemQuantity(entry.item);
          const nextQty = round2(prev + line.quantity);
          tx.update(entry.ref, {
            quantity: nextQty,
            updatedAt: now,
            lastUpdatedBy: realUserName,
            lastMovementType: 'in',
            lastMovementReason: `Cancelled sale ${sale.invoiceNumber}`,
          });
          movement(
            tx,
            entry.item,
            'in',
            line.quantity,
            prev,
            nextQty,
            `Cancelled sale ${sale.invoiceNumber}: ${reason || 'Cancelled'}`,
            sale.id,
            now,
            movRefs.get(line.itemId)
          );
        }
        tx.update(ref, {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: realUserName,
          cancelReason: reason?.trim() || 'Cancelled',
          paymentStatus: 'paid',
          updatedAt: now,
        });
      });
      if (opId) {
        confirmTradeOp(opId);
        confirmOptimisticOp(opId);
      }
    } catch (err) {
      if (opId) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
      }
      throw friendly(err, 'The sale could not be cancelled.');
    }
  };

  const editSale = async (saleId: string, input: NewSaleInput): Promise<Sale> => {
    assertOnline();
    if (!permissions.canEditSales) throw new Error('Your role is not allowed to edit sales.');
    const customerName = input.customer.name?.trim();
    if (!customerName) throw new Error('Customer name is required.');
    if (!input.lines.length) throw new Error('Add at least one item.');
    ensureUniqueLines(input.lines);
    for (const l of input.lines) {
      if (!(Number(l.quantity) > 0)) throw new Error(`Quantity for ${itemName(l.itemId)} must be more than 0.`);
      if (Number(l.rate) < 0) throw new Error(`Rate for ${itemName(l.itemId)} can't be negative.`);
    }

    const saleRef = doc(db, 'sales', saleId);
    const now = new Date().toISOString();
    const localOld = salesRef.current.find((s) => s.id === saleId);
    const movRefs = new Map<string, DocumentReference>();
    let opId: string | null = null;

    if (localOld) {
      if (localOld.status === 'cancelled') throw new Error('Cancelled sales cannot be edited.');
      const changeCheck = canChangeEntry(
        {
          createdByUid: localOld.createdBy,
          createdByName: localOld.createdByName,
          createdAt: localOld.createdAt,
        },
        realUserUid,
        permissions,
        role
      );
      if (!changeCheck.allowed) throw new Error(changeCheck.reason || 'Locked: cannot edit this sale.');
      const allItemIds = Array.from(new Set([...localOld.lines.map((l) => l.itemId), ...input.lines.map((l) => l.itemId)]));
      const oldQtyMap = new Map<string, number>();
      for (const l of localOld.lines) oldQtyMap.set(l.itemId, (oldQtyMap.get(l.itemId) || 0) + l.quantity);
      const newQtyMap = new Map<string, number>();
      for (const l of input.lines) newQtyMap.set(l.itemId, (newQtyMap.get(l.itemId) || 0) + Number(l.quantity));

      for (const [itemId, retQty] of Object.entries(localOld.returnedQty || {})) {
        const rq = Number(retQty) || 0;
        if (rq > 0) {
          const newQty = newQtyMap.get(itemId) || 0;
          if (newQty < rq - 1e-9) {
            throw new Error(`${itemName(itemId)}: quantity can't be less than already returned (${rq}).`);
          }
        }
      }

      for (const [itemId, newQty] of newQtyMap.entries()) {
        const oldQty = oldQtyMap.get(itemId) || 0;
        const delta = newQty - oldQty;
        if (delta > 0) {
          const it = itemsRef.current.find((i) => i.id === itemId);
          if (!it) throw new Error(`Item ${itemName(itemId)} was not found in inventory.`);
          const onHand = getItemQuantity(it);
          if (delta > onHand) {
            throw new Error(`Only ${onHand} ${it.unit} of ${it.name} available (need ${delta} more).`);
          }
        }
      }

      const optLines: SaleLine[] = input.lines.map((l) => {
        const it = itemsRef.current.find((i) => i.id === l.itemId)!;
        const calc = calcLine(l);
        return removeUndefinedFields({
          itemId: it.id,
          itemName: it.name,
          sku: it.sku || undefined,
          unit: it.unit,
          quantity: Number(l.quantity),
          rate: round2(l.rate),
          discountPct: Number(l.discountPct) || 0,
          gstPct: Number(l.gstPct) || 0,
          ...calc,
          costPrice: round2(it.unitCost || 0),
        });
      });
      const optTotals = sumLines(optLines);
      const netReceived = round2((localOld.amountPaid || 0) - (localOld.refundedTotal || 0));
      if (optTotals.grandTotal < netReceived - 0.009) {
        throw new Error(
          `New total is less than amount already received (${formatINR(netReceived, netReceived % 1 !== 0)})`
        );
      }

      const itemPatches: Record<string, Partial<InventoryItem>> = {};
      const movs: StockMovement[] = [];
      for (const itemId of allItemIds) {
        const it = itemsRef.current.find((i) => i.id === itemId);
        if (!it) continue;
        const delta = (newQtyMap.get(itemId) || 0) - (oldQtyMap.get(itemId) || 0);
        if (Math.abs(delta) > 1e-9) {
          const prev = getItemQuantity(it);
          const next = round2(prev - delta);
          const mRef = doc(collection(db, 'movements'));
          movRefs.set(itemId, mRef);
          itemPatches[it.id] = {
            quantity: next,
            updatedAt: now,
            lastUpdatedBy: realUserName,
          };
          movs.push({
            id: mRef.id,
            itemId: it.id,
            itemName: it.name,
            type: delta > 0 ? 'out' : 'in',
            quantity: Math.abs(delta),
            previousQuantity: prev,
            newQuantity: next,
            reason: `Edited sale ${localOld.invoiceNumber} to ${customerName}`,
            referenceId: saleRef.id,
            performedBy: realUserUid,
            performedByName: realUserName,
            timestamp: now,
          });
        }
      }

      const optSale: Sale = removeUndefinedFields({
        ...localOld,
        customer: removeUndefinedFields({
          name: customerName,
          phone: input.customer.phone?.trim() || undefined,
          gstin: input.customer.gstin?.trim().toUpperCase() || undefined,
          address: input.customer.address?.trim() || undefined,
        }),
        lines: optLines,
        subtotal: optTotals.subtotal,
        gstTotal: optTotals.gstTotal,
        grandTotal: optTotals.grandTotal,
        vehicleNumber: input.vehicleNumber?.trim() || undefined,
        trackingNumber: input.trackingNumber?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        updatedAt: now,
      });
      optSale.paymentStatus = moneyPosition(optSale).status;

      opId = `editSale-${saleId}-${Date.now()}`;
      registerTradeOp({ id: opId, salePatches: { [saleId]: optSale } });
      registerOptimisticOp({ id: opId, itemPatches, movements: movs });
    }

    try {
      const updated = await runTransaction(db, async (tx) => {
        const snap = await tx.get(saleRef);
        if (!snap.exists()) throw new Error('Sale not found.');
        const oldSale = snap.data() as Sale;
        if (oldSale.status === 'cancelled') throw new Error('Cancelled sales cannot be edited.');
        const txCheck = canChangeEntry(
          {
            createdByUid: oldSale.createdBy,
            createdByName: oldSale.createdByName,
            createdAt: oldSale.createdAt,
          },
          realUserUid,
          permissions,
          role
        );
        if (!txCheck.allowed) throw new Error(txCheck.reason || 'Locked: cannot edit this sale.');

        const allItemIds = Array.from(new Set([
          ...oldSale.lines.map((l) => l.itemId),
          ...input.lines.map((l) => l.itemId),
        ]));
        const itemMap = await readItems(tx, allItemIds);

        const oldQtyMap = new Map<string, number>();
        for (const l of oldSale.lines) {
          oldQtyMap.set(l.itemId, (oldQtyMap.get(l.itemId) || 0) + l.quantity);
        }

        const newQtyMap = new Map<string, number>();
        for (const l of input.lines) {
          newQtyMap.set(l.itemId, (newQtyMap.get(l.itemId) || 0) + Number(l.quantity));
        }

        for (const [itemId, retQty] of Object.entries(oldSale.returnedQty || {})) {
          const rq = Number(retQty) || 0;
          if (rq > 0) {
            const newQty = newQtyMap.get(itemId) || 0;
            if (newQty < rq - 1e-9) {
              throw new Error(`${itemName(itemId)}: quantity can't be less than already returned (${rq}).`);
            }
          }
        }

        for (const [itemId, newQty] of newQtyMap.entries()) {
          const oldQty = oldQtyMap.get(itemId) || 0;
          const delta = newQty - oldQty;
          if (delta > 0) {
            const entry = itemMap.get(itemId);
            if (!entry || !entry.item) throw new Error(`Item ${itemName(itemId)} was not found in inventory.`);
            const onHand = getItemQuantity(entry.item);
            if (delta > onHand) {
              throw new Error(`Only ${onHand} ${entry.item.unit} of ${entry.item.name} available (need ${delta} more).`);
            }
          }
        }

        const lines: SaleLine[] = input.lines.map((l) => {
          const entry = itemMap.get(l.itemId)!;
          if (!entry.item) throw new Error(`${itemName(l.itemId)} was not found in inventory.`);
          const calc = calcLine(l);
          return removeUndefinedFields({
            itemId: entry.item.id,
            itemName: entry.item.name,
            sku: entry.item.sku || undefined,
            unit: entry.item.unit,
            quantity: Number(l.quantity),
            rate: round2(l.rate),
            discountPct: Number(l.discountPct) || 0,
            gstPct: Number(l.gstPct) || 0,
            ...calc,
            costPrice: round2(entry.item.unitCost || 0),
          });
        });
        const totals = sumLines(lines);
        const netReceived = round2((oldSale.amountPaid || 0) - (oldSale.refundedTotal || 0));
        if (totals.grandTotal < netReceived - 0.009) {
          throw new Error(
            `New total is less than amount already received (${formatINR(netReceived, netReceived % 1 !== 0)})`
          );
        }

        for (const itemId of allItemIds) {
          const entry = itemMap.get(itemId);
          if (!entry || !entry.item) continue;
          const oldQty = oldQtyMap.get(itemId) || 0;
          const newQty = newQtyMap.get(itemId) || 0;
          const delta = newQty - oldQty;
          if (Math.abs(delta) > 1e-9) {
            const prev = getItemQuantity(entry.item);
            const next = round2(prev - delta);
            tx.update(entry.ref, {
              quantity: next,
              updatedAt: now,
              lastUpdatedBy: realUserName,
              lastMovementType: delta > 0 ? 'out' : 'in',
              lastMovementReason: `Edited sale ${oldSale.invoiceNumber}`,
            });
            movement(
              tx,
              entry.item,
              delta > 0 ? 'out' : 'in',
              Math.abs(delta),
              prev,
              next,
              `Edited sale ${oldSale.invoiceNumber} to ${customerName}`,
              saleRef.id,
              now,
              movRefs.get(itemId)
            );
          }
        }

        const updatedSale: Sale = removeUndefinedFields({
          ...oldSale,
          customer: removeUndefinedFields({
            name: customerName,
            phone: input.customer.phone?.trim() || undefined,
            gstin: input.customer.gstin?.trim().toUpperCase() || undefined,
            address: input.customer.address?.trim() || undefined,
          }),
          lines,
          subtotal: totals.subtotal,
          gstTotal: totals.gstTotal,
          grandTotal: totals.grandTotal,
          vehicleNumber: input.vehicleNumber?.trim() || undefined,
          trackingNumber: input.trackingNumber?.trim() || undefined,
          notes: input.notes?.trim() || undefined,
          updatedAt: now,
        });

        updatedSale.paymentStatus = moneyPosition(updatedSale).status;

        tx.update(saleRef, {
          customer: updatedSale.customer,
          lines: updatedSale.lines,
          subtotal: updatedSale.subtotal,
          gstTotal: updatedSale.gstTotal,
          grandTotal: updatedSale.grandTotal,
          vehicleNumber: updatedSale.vehicleNumber || null,
          trackingNumber: updatedSale.trackingNumber || null,
          notes: updatedSale.notes || null,
          paymentStatus: updatedSale.paymentStatus,
          updatedAt: now,
        });

        return updatedSale;
      });
      if (opId) {
        confirmTradeOp(opId, { salePatches: { [saleId]: updated } });
        confirmOptimisticOp(opId);
      }
      return updated;
    } catch (err) {
      if (opId) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
      }
      throw friendly(err, 'The sale could not be edited.');
    }
  };

  const deleteSale = async (saleId: string, reason?: string) => {
    assertOnline();
    if (!permissions.canDeleteSales) throw new Error('Your role is not allowed to delete sales.');
    const localSale = salesRef.current.find((s) => s.id === saleId);
    const now = new Date().toISOString();
    const movRefs = new Map<string, DocumentReference>();
    let opId: string | null = null;

    if (localSale) {
      const changeCheck = canChangeEntry(
        {
          createdByUid: localSale.createdBy,
          createdByName: localSale.createdByName,
          createdAt: localSale.createdAt,
        },
        realUserUid,
        permissions,
        role
      );
      if (!changeCheck.allowed) throw new Error(changeCheck.reason || 'Locked: cannot delete this sale.');
      if ((localSale.amountPaid || 0) > 0 || (localSale.returnsTotal || 0) > 0 || Object.values(localSale.returnedQty || {}).some((q) => Number(q) > 0)) {
        throw new Error('This sale has payments or returns, so it cannot be deleted. Cancel it instead so the record stays.');
      }
      const itemPatches: Record<string, Partial<InventoryItem>> = {};
      const movs: StockMovement[] = [];
      if (localSale.status !== 'cancelled') {
        for (const line of localSale.lines) {
          const it = itemsRef.current.find((i) => i.id === line.itemId);
          if (!it) continue;
          const prev = getItemQuantity(it);
          const returned = (localSale.returnedQty || {})[line.itemId] || 0;
          const toRestore = Math.max(0, line.quantity - returned);
          if (toRestore > 0) {
            const next = round2(prev + toRestore);
            const mRef = doc(collection(db, 'movements'));
            movRefs.set(line.itemId, mRef);
            itemPatches[it.id] = {
              quantity: next,
              updatedAt: now,
              lastUpdatedBy: realUserName,
            };
            movs.push({
              id: mRef.id,
              itemId: it.id,
              itemName: it.name,
              type: 'in',
              quantity: toRestore,
              previousQuantity: prev,
              newQuantity: next,
              reason: `Deleted sale ${localSale.invoiceNumber}: stock restored`,
              referenceId: localSale.id,
              performedBy: realUserUid,
              performedByName: realUserName,
              timestamp: now,
            });
          }
        }
      }
      opId = `deleteSale-${saleId}-${Date.now()}`;
      registerTradeOp({ id: opId, deletedSaleIds: [saleId] });
      registerOptimisticOp({ id: opId, itemPatches, movements: movs });
    }

    const ref = doc(db, 'sales', saleId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        const txCheck = canChangeEntry(
          {
            createdByUid: sale.createdBy,
            createdByName: sale.createdByName,
            createdAt: sale.createdAt,
          },
          realUserUid,
          permissions,
          role
        );
        if (!txCheck.allowed) throw new Error(txCheck.reason || 'Locked: cannot delete this sale.');
        if ((sale.amountPaid || 0) > 0 || (sale.returnsTotal || 0) > 0 || Object.values(sale.returnedQty || {}).some((q) => Number(q) > 0)) {
          throw new Error('This sale has payments or returns, so it cannot be deleted. Cancel it instead so the record stays.');
        }

        if (sale.status !== 'cancelled') {
          const itemMap = await readItems(tx, sale.lines.map((l) => l.itemId));
          for (const line of sale.lines) {
            const entry = itemMap.get(line.itemId);
            if (!entry || !entry.item) continue;
            const prev = getItemQuantity(entry.item);
            const returned = (sale.returnedQty || {})[line.itemId] || 0;
            const toRestore = Math.max(0, line.quantity - returned);
            if (toRestore > 0) {
              const next = round2(prev + toRestore);
              tx.update(entry.ref, {
                quantity: next,
                updatedAt: now,
                lastUpdatedBy: realUserName,
                lastMovementType: 'in',
                lastMovementReason: `Deleted sale ${sale.invoiceNumber} (${reason || 'Stock restored'})`,
              });
              movement(
                tx,
                entry.item,
                'in',
                toRestore,
                prev,
                next,
                `Deleted sale ${sale.invoiceNumber}: stock restored`,
                sale.id,
                now,
                movRefs.get(line.itemId)
              );
            }
          }
        }

        tx.delete(ref);
      });
      if (opId) {
        confirmTradeOp(opId);
        confirmOptimisticOp(opId);
      }
    } catch (err) {
      if (opId) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
      }
      throw friendly(err, 'The sale could not be deleted.');
    }
  };

  const recordSaleMoney = async (saleId: string, p: PaymentInput, kind: 'payment' | 'refund') => {
    assertOnline();
    if (!permissions.canRecordPayments) throw new Error('Your role is not allowed to record payments.');
    if (!(Number(p.amount) > 0)) throw new Error('Enter an amount more than 0.');
    const now = new Date().toISOString();
    const payEntry = payment(p, now);
    const localSale = salesRef.current.find((s) => s.id === saleId);
    let opId: string | null = null;

    if (localSale) {
      if (localSale.status === 'cancelled') throw new Error('This sale is cancelled.');
      const pos = moneyPosition(localSale);
      if (kind === 'payment') {
        if (p.amount > pos.balance + 0.009) throw new Error(`Only ${pos.balance.toFixed(2)} is due on this sale.`);
        const payments = [...(localSale.payments || []), payEntry];
        const amountPaid = round2((localSale.amountPaid || 0) + p.amount);
        opId = `salePay-${saleId}-${Date.now()}`;
        registerTradeOp({
          id: opId,
          salePatches: {
            [saleId]: {
              payments,
              amountPaid,
              paymentStatus: moneyPosition({ ...localSale, amountPaid }).status,
              updatedAt: now,
            },
          },
        });
      } else {
        const due = -pos.balance;
        if (p.amount > due + 0.009) throw new Error(`Only ${Math.max(0, due).toFixed(2)} refund is due on this sale.`);
        const refunds = [...(localSale.refunds || []), payEntry];
        const refundedTotal = round2((localSale.refundedTotal || 0) + p.amount);
        opId = `saleRefund-${saleId}-${Date.now()}`;
        registerTradeOp({
          id: opId,
          salePatches: {
            [saleId]: {
              refunds,
              refundedTotal,
              paymentStatus: moneyPosition({ ...localSale, refundedTotal }).status,
              updatedAt: now,
            },
          },
        });
      }
    }

    const ref = doc(db, 'sales', saleId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        if (sale.status === 'cancelled') throw new Error('This sale is cancelled.');
        const pos = moneyPosition(sale);
        if (kind === 'payment') {
          if (p.amount > pos.balance + 0.009) throw new Error(`Only ${pos.balance.toFixed(2)} is due on this sale.`);
          const payments = [...(sale.payments || []), payEntry];
          const amountPaid = round2((sale.amountPaid || 0) + p.amount);
          tx.update(ref, {
            payments,
            amountPaid,
            paymentStatus: moneyPosition({ ...sale, amountPaid }).status,
            updatedAt: now,
          });
        } else {
          const due = -pos.balance;
          if (p.amount > due + 0.009) throw new Error(`Only ${Math.max(0, due).toFixed(2)} refund is due on this sale.`);
          const refunds = [...(sale.refunds || []), payEntry];
          const refundedTotal = round2((sale.refundedTotal || 0) + p.amount);
          tx.update(ref, {
            refunds,
            refundedTotal,
            paymentStatus: moneyPosition({ ...sale, refundedTotal }).status,
            updatedAt: now,
          });
        }
      });
      if (opId) confirmTradeOp(opId);
    } catch (err) {
      if (opId) revertTradeOp(opId);
      throw friendly(err, 'The payment could not be saved.');
    }
  };

  const editSalePayment: TradeContextType['editSalePayment'] = async (saleId, paymentId, p) => {
    assertOnline();
    if (!permissions.canEditPayments) throw new Error('Your role is not allowed to edit payments.');
    const newAmount = round2(p.amount);
    if (!(newAmount > 0)) throw new Error('Enter an amount more than 0.');
    const now = new Date().toISOString();
    const localSale = salesRef.current.find((s) => s.id === saleId);
    let opId: string | null = null;

    const cleanMoneyStr = (n: number) => formatINR(round2(n), round2(n) % 1 !== 0);

    if (localSale) {
      if (localSale.status === 'cancelled') throw new Error('This sale is cancelled.');
      const oldPay = (localSale.payments || []).find((x) => x.id === paymentId);
      if (!oldPay) throw new Error('Payment entry not found.');
      const changeCheck = canChangeEntry(
        {
          createdByUid: oldPay.recordedBy || localSale.createdBy,
          createdByName: oldPay.recordedByName || localSale.createdByName,
          createdAt: oldPay.recordedAt || oldPay.date || localSale.createdAt,
        },
        realUserUid,
        permissions,
        role
      );
      if (!changeCheck.allowed) throw new Error(changeCheck.reason || 'Locked: cannot edit this payment.');
      const pos = moneyPosition(localSale);
      const maxAllowed = Math.max(0, round2(pos.balance + oldPay.amount));
      if (newAmount > maxAllowed + 0.009) {
        throw new Error(`Max ${cleanMoneyStr(maxAllowed)} for ${localSale.invoiceNumber}`);
      }
      const nextPayments = (localSale.payments || []).map((x) =>
        x.id === paymentId
          ? removeUndefinedFields({
              ...x,
              amount: newAmount,
              date: p.date,
              mode: p.mode,
              note: p.note?.trim() || undefined,
            })
          : x
      );
      const nextAmountPaid = round2(nextPayments.reduce((a, x) => a + (x.amount || 0), 0));
      const advancePatches: Record<string, Partial<CustomerAdvance>> = {};
      if (oldPay.mode === 'advance' && oldPay.advanceId) {
        const adv = customerAdvancesRef.current.find((a) => a.id === oldPay.advanceId);
        if (adv) {
          const delta = round2(newAmount - oldPay.amount);
          if (delta > (adv.remaining || 0) + 0.009) {
            throw new Error(`Only ${cleanMoneyStr(adv.remaining || 0)} left on that advance`);
          }
          const nextRemaining = Math.max(0, round2((adv.remaining || 0) - delta));
          let updatedOne = false;
          const nextUses = (adv.uses || []).map((u) => {
            if (!updatedOne && u.saleId === saleId && Math.abs(u.amount - oldPay.amount) < 0.01) {
              updatedOne = true;
              return { ...u, amount: newAmount, date: p.date };
            }
            return u;
          });
          advancePatches[adv.id] = { remaining: nextRemaining, uses: nextUses };
        }
      }
      opId = `editPay-${saleId}-${paymentId}-${Date.now()}`;
      registerTradeOp({
        id: opId,
        salePatches: {
          [saleId]: {
            payments: nextPayments,
            amountPaid: nextAmountPaid,
            paymentStatus: moneyPosition({ ...localSale, amountPaid: nextAmountPaid }).status,
            updatedAt: now,
          },
        },
        advancePatches,
      });
    }

    const saleRef = doc(db, 'sales', saleId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(saleRef);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        if (sale.status === 'cancelled') throw new Error('This sale is cancelled.');
        const oldPay = (sale.payments || []).find((x) => x.id === paymentId);
        if (!oldPay) throw new Error('Payment entry not found.');
        const txCheck = canChangeEntry(
          {
            createdByUid: oldPay.recordedBy || sale.createdBy,
            createdByName: oldPay.recordedByName || sale.createdByName,
            createdAt: oldPay.recordedAt || oldPay.date || sale.createdAt,
          },
          realUserUid,
          permissions,
          role
        );
        if (!txCheck.allowed) throw new Error(txCheck.reason || 'Locked: cannot edit this payment.');

        const pos = moneyPosition(sale);
        const maxAllowed = Math.max(0, round2(pos.balance + oldPay.amount));
        if (newAmount > maxAllowed + 0.009) {
          throw new Error(`Max ${cleanMoneyStr(maxAllowed)} for ${sale.invoiceNumber}`);
        }

        let advSnap: DocumentSnapshot | null = null;
        const advRef = oldPay.mode === 'advance' && oldPay.advanceId ? doc(db, 'customer_advances', oldPay.advanceId) : null;
        if (advRef) {
          advSnap = await tx.get(advRef);
        }

        const nextPayments = (sale.payments || []).map((x) =>
          x.id === paymentId
            ? removeUndefinedFields({
                ...x,
                amount: newAmount,
                date: p.date,
                mode: p.mode,
                note: p.note?.trim() || undefined,
              })
            : x
        );
        const nextAmountPaid = round2(nextPayments.reduce((a, x) => a + (x.amount || 0), 0));

        if (advRef && advSnap && advSnap.exists()) {
          const adv = advSnap.data() as CustomerAdvance;
          const delta = round2(newAmount - oldPay.amount);
          if (delta > (adv.remaining || 0) + 0.009) {
            throw new Error(`Only ${cleanMoneyStr(adv.remaining || 0)} left on that advance`);
          }
          const nextRemaining = Math.max(0, round2((adv.remaining || 0) - delta));
          let updatedOne = false;
          const nextUses = (adv.uses || []).map((u) => {
            if (!updatedOne && u.saleId === saleId && Math.abs(u.amount - oldPay.amount) < 0.01) {
              updatedOne = true;
              return { ...u, amount: newAmount, date: p.date };
            }
            return u;
          });
          tx.update(advRef, { remaining: nextRemaining, uses: nextUses });
        }

        tx.update(saleRef, {
          payments: nextPayments,
          amountPaid: nextAmountPaid,
          paymentStatus: moneyPosition({ ...sale, amountPaid: nextAmountPaid }).status,
          updatedAt: now,
        });
      });
      if (opId) confirmTradeOp(opId);
    } catch (err) {
      if (opId) revertTradeOp(opId);
      throw friendly(err, 'The payment could not be updated.');
    }
  };

  const deleteSalePayment: TradeContextType['deleteSalePayment'] = async (saleId, paymentId) => {
    assertOnline();
    if (!permissions.canDeletePayments) throw new Error('Your role is not allowed to remove payments.');
    const now = new Date().toISOString();
    const localSale = salesRef.current.find((s) => s.id === saleId);
    let opId: string | null = null;

    if (localSale) {
      const oldPay = (localSale.payments || []).find((x) => x.id === paymentId);
      if (!oldPay) throw new Error('Payment entry not found.');
      const changeCheck = canChangeEntry(
        {
          createdByUid: oldPay.recordedBy || localSale.createdBy,
          createdByName: oldPay.recordedByName || localSale.createdByName,
          createdAt: oldPay.recordedAt || oldPay.date || localSale.createdAt,
        },
        realUserUid,
        permissions,
        role
      );
      if (!changeCheck.allowed) throw new Error(changeCheck.reason || 'Locked: cannot remove this payment.');
      const nextPayments = (localSale.payments || []).filter((x) => x.id !== paymentId);
      const nextAmountPaid = round2(nextPayments.reduce((a, x) => a + (x.amount || 0), 0));
      const advancePatches: Record<string, Partial<CustomerAdvance>> = {};
      if (oldPay.mode === 'advance' && oldPay.advanceId) {
        const adv = customerAdvancesRef.current.find((a) => a.id === oldPay.advanceId);
        if (adv) {
          let removedOne = false;
          const nextUses = (adv.uses || []).filter((u) => {
            if (!removedOne && u.saleId === saleId && Math.abs(u.amount - oldPay.amount) < 0.01) {
              removedOne = true;
              return false;
            }
            return true;
          });
          const nextRemaining = Math.min(adv.amount, round2((adv.remaining || 0) + oldPay.amount));
          advancePatches[adv.id] = { remaining: nextRemaining, uses: nextUses };
        }
      }
      opId = `delPay-${saleId}-${paymentId}-${Date.now()}`;
      registerTradeOp({
        id: opId,
        salePatches: {
          [saleId]: {
            payments: nextPayments,
            amountPaid: nextAmountPaid,
            paymentStatus: moneyPosition({ ...localSale, amountPaid: nextAmountPaid }).status,
            updatedAt: now,
          },
        },
        advancePatches,
      });
    }

    const saleRef = doc(db, 'sales', saleId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(saleRef);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        const oldPay = (sale.payments || []).find((x) => x.id === paymentId);
        if (!oldPay) throw new Error('Payment entry not found.');
        const txCheck = canChangeEntry(
          {
            createdByUid: oldPay.recordedBy || sale.createdBy,
            createdByName: oldPay.recordedByName || sale.createdByName,
            createdAt: oldPay.recordedAt || oldPay.date || sale.createdAt,
          },
          realUserUid,
          permissions,
          role
        );
        if (!txCheck.allowed) throw new Error(txCheck.reason || 'Locked: cannot remove this payment.');

        let advSnap: DocumentSnapshot | null = null;
        const advRef = oldPay.mode === 'advance' && oldPay.advanceId ? doc(db, 'customer_advances', oldPay.advanceId) : null;
        if (advRef) {
          advSnap = await tx.get(advRef);
        }

        const nextPayments = (sale.payments || []).filter((x) => x.id !== paymentId);
        const nextAmountPaid = round2(nextPayments.reduce((a, x) => a + (x.amount || 0), 0));

        if (advRef && advSnap && advSnap.exists()) {
          const adv = advSnap.data() as CustomerAdvance;
          let removedOne = false;
          const nextUses = (adv.uses || []).filter((u) => {
            if (!removedOne && u.saleId === saleId && Math.abs(u.amount - oldPay.amount) < 0.01) {
              removedOne = true;
              return false;
            }
            return true;
          });
          const nextRemaining = Math.min(adv.amount, round2((adv.remaining || 0) + oldPay.amount));
          tx.update(advRef, { remaining: nextRemaining, uses: nextUses });
        }

        tx.update(saleRef, {
          payments: nextPayments,
          amountPaid: nextAmountPaid,
          paymentStatus: moneyPosition({ ...sale, amountPaid: nextAmountPaid }).status,
          updatedAt: now,
        });
      });
      if (opId) confirmTradeOp(opId);
    } catch (err) {
      if (opId) revertTradeOp(opId);
      throw friendly(err, 'The payment could not be removed.');
    }
  };

  const createCustomerAdvance: TradeContextType['createCustomerAdvance'] = async (input) => {
    assertOnline();
    if (!permissions.canRecordPayments) throw new Error('Your role is not allowed to record payments.');
    const amt = round2(input.amount);
    if (!(amt > 0)) throw new Error('Enter an amount more than 0.');
    const advRef = doc(collection(db, 'customer_advances'));
    const now = new Date().toISOString();
    const draft: CustomerAdvance = removeUndefinedFields({
      id: advRef.id,
      partyKey: input.partyKey,
      partyName: input.partyName.trim() || 'Customer',
      partyPhone: input.partyPhone?.trim() || undefined,
      amount: amt,
      remaining: amt,
      mode: input.mode,
      date: input.date || todayISODate(),
      note: input.note?.trim() || undefined,
      uses: [],
      createdAt: now,
      createdBy: realUserUid,
      createdByName: realUserName,
    });
    const opId = `createAdv-${advRef.id}-${Date.now()}`;
    registerTradeOp({ id: opId, addedAdvances: [draft] });
    try {
      await runTransaction(db, async (tx) => {
        tx.set(advRef, draft);
      });
      confirmTradeOp(opId, { addedAdvances: [draft] });
      return draft;
    } catch (err) {
      revertTradeOp(opId);
      throw friendly(err, 'Could not save customer advance.');
    }
  };

  const editCustomerAdvance: TradeContextType['editCustomerAdvance'] = async (advanceId, p) => {
    assertOnline();
    if (!permissions.canEditPayments) throw new Error('Your role is not allowed to edit payments.');
    const newAmt = round2(p.amount);
    if (!(newAmt > 0)) throw new Error('Enter an amount more than 0.');
    const localAdv = customerAdvancesRef.current.find((a) => a.id === advanceId);
    let opId: string | null = null;
    const cleanMoneyStr = (n: number) => formatINR(round2(n), round2(n) % 1 !== 0);

    if (localAdv) {
      const changeCheck = canChangeEntry(
        {
          createdByUid: localAdv.createdBy,
          createdByName: localAdv.createdByName,
          createdAt: localAdv.createdAt || localAdv.date,
        },
        realUserUid,
        permissions,
        role
      );
      if (!changeCheck.allowed) throw new Error(changeCheck.reason || 'Locked: cannot edit this advance.');
      const usedTotal = round2((localAdv.uses || []).reduce((a, u) => a + (u.amount || 0), 0));
      if (newAmt < usedTotal - 0.009) {
        const invs = Array.from(new Set((localAdv.uses || []).map((u) => u.invoiceNumber))).join(', ');
        throw new Error(`${cleanMoneyStr(usedTotal)} already used on ${invs || 'invoices'}`);
      }
      const nextRemaining = Math.max(0, round2(newAmt - usedTotal));
      opId = `editAdv-${advanceId}-${Date.now()}`;
      registerTradeOp({
        id: opId,
        advancePatches: {
          [advanceId]: removeUndefinedFields({
            amount: newAmt,
            remaining: nextRemaining,
            mode: p.mode,
            date: p.date,
            note: p.note?.trim() || undefined,
          }),
        },
      });
    }

    const advRef = doc(db, 'customer_advances', advanceId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(advRef);
        if (!snap.exists()) throw new Error('Advance entry not found.');
        const adv = snap.data() as CustomerAdvance;
        const txCheck = canChangeEntry(
          {
            createdByUid: adv.createdBy,
            createdByName: adv.createdByName,
            createdAt: adv.createdAt || adv.date,
          },
          realUserUid,
          permissions,
          role
        );
        if (!txCheck.allowed) throw new Error(txCheck.reason || 'Locked: cannot edit this advance.');
        const usedTotal = round2((adv.uses || []).reduce((a, u) => a + (u.amount || 0), 0));
        if (newAmt < usedTotal - 0.009) {
          const invs = Array.from(new Set((adv.uses || []).map((u) => u.invoiceNumber))).join(', ');
          throw new Error(`${cleanMoneyStr(usedTotal)} already used on ${invs || 'invoices'}`);
        }
        const nextRemaining = Math.max(0, round2(newAmt - usedTotal));
        tx.update(advRef, {
          amount: newAmt,
          remaining: nextRemaining,
          mode: p.mode,
          date: p.date,
          note: p.note?.trim() ? p.note.trim() : deleteField(),
        });
      });
      if (opId) confirmTradeOp(opId);
    } catch (err) {
      if (opId) revertTradeOp(opId);
      throw friendly(err, 'Could not update advance entry.');
    }
  };

  const deleteCustomerAdvance: TradeContextType['deleteCustomerAdvance'] = async (advanceId) => {
    assertOnline();
    if (!permissions.canDeletePayments) throw new Error('Your role is not allowed to remove payments.');
    const now = new Date().toISOString();
    const localAdv = customerAdvancesRef.current.find((a) => a.id === advanceId);
    let opId: string | null = null;

    if (localAdv) {
      const changeCheck = canChangeEntry(
        {
          createdByUid: localAdv.createdBy,
          createdByName: localAdv.createdByName,
          createdAt: localAdv.createdAt || localAdv.date,
        },
        realUserUid,
        permissions,
        role
      );
      if (!changeCheck.allowed) throw new Error(changeCheck.reason || 'Locked: cannot remove this advance.');
      const salePatches: Record<string, Partial<Sale>> = {};
      const affectedIds = Array.from(new Set((localAdv.uses || []).map((u) => u.saleId).filter(Boolean)));
      for (const sId of affectedIds) {
        const s = salesRef.current.find((x) => x.id === sId);
        if (!s || s.status === 'cancelled') continue;
        const nextPayments = (s.payments || []).filter((p) => p.advanceId !== advanceId);
        if (nextPayments.length !== (s.payments || []).length) {
          const nextAmountPaid = round2(nextPayments.reduce((a, x) => a + (x.amount || 0), 0));
          salePatches[sId] = {
            payments: nextPayments,
            amountPaid: nextAmountPaid,
            paymentStatus: moneyPosition({ ...s, amountPaid: nextAmountPaid }).status,
            updatedAt: now,
          };
        }
      }
      opId = `delAdv-${advanceId}-${Date.now()}`;
      registerTradeOp({ id: opId, deletedAdvanceIds: [advanceId], salePatches });
    }

    const advRef = doc(db, 'customer_advances', advanceId);
    try {
      await runTransaction(db, async (tx) => {
        const advSnap = await tx.get(advRef);
        if (!advSnap.exists()) throw new Error('Advance entry not found.');
        const adv = advSnap.data() as CustomerAdvance;
        const txCheck = canChangeEntry(
          {
            createdByUid: adv.createdBy,
            createdByName: adv.createdByName,
            createdAt: adv.createdAt || adv.date,
          },
          realUserUid,
          permissions,
          role
        );
        if (!txCheck.allowed) throw new Error(txCheck.reason || 'Locked: cannot remove this advance.');
        const affectedIds = Array.from(new Set((adv.uses || []).map((u) => u.saleId).filter(Boolean)));
        const saleEntries: { ref: DocumentReference; sale: Sale }[] = [];
        for (const sId of affectedIds) {
          const sRef = doc(db, 'sales', sId);
          const sSnap = await tx.get(sRef);
          if (sSnap.exists()) {
            saleEntries.push({ ref: sRef, sale: sSnap.data() as Sale });
          }
        }

        for (const { ref, sale } of saleEntries) {
          if (sale.status === 'cancelled') continue;
          const nextPayments = (sale.payments || []).filter((p) => p.advanceId !== advanceId);
          if (nextPayments.length !== (sale.payments || []).length) {
            const nextAmountPaid = round2(nextPayments.reduce((a, x) => a + (x.amount || 0), 0));
            tx.update(ref, {
              payments: nextPayments,
              amountPaid: nextAmountPaid,
              paymentStatus: moneyPosition({ ...sale, amountPaid: nextAmountPaid }).status,
              updatedAt: now,
            });
          }
        }

        tx.delete(advRef);
      });
      if (opId) confirmTradeOp(opId);
    } catch (err) {
      if (opId) revertTradeOp(opId);
      throw friendly(err, 'Could not remove advance entry.');
    }
  };

  const applyCustomerAdvanceToSale: TradeContextType['applyCustomerAdvanceToSale'] = async (
    saleId,
    partyKey,
    date
  ) => {
    assertOnline();
    if (!permissions.canRecordPayments && !permissions.canCreateSales && !permissions.canEditSales) {
      throw new Error('Your role is not allowed to apply customer advances.');
    }
    const candidateAdvances = customerAdvancesRef.current
      .filter((a) => a.partyKey === partyKey && (a.remaining || 0) > 0.009)
      .sort((a, b) => new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime());

    if (candidateAdvances.length === 0) return 0;
    const now = new Date().toISOString();
    const localSale = salesRef.current.find((s) => s.id === saleId);
    let opId: string | null = null;
    const newEntriesForOp: PaymentEntry[] = [];

    if (localSale && localSale.status !== 'cancelled') {
      let dueLeft = Math.max(0, round2(moneyPosition(localSale).balance));
      const advancePatches: Record<string, Partial<CustomerAdvance>> = {};
      for (const adv of candidateAdvances) {
        if (dueLeft <= 0.009) break;
        const applyAmt = round2(Math.min(adv.remaining || 0, dueLeft));
        if (applyAmt <= 0.009) continue;
        dueLeft = round2(dueLeft - applyAmt);
        const payEntry: PaymentEntry = removeUndefinedFields({
          id: newId(),
          amount: applyAmt,
          date: date || todayISODate(),
          mode: 'advance',
          advanceId: adv.id,
          note: adv.note ? `Advance (${adv.note})` : 'Advance adjusted',
          recordedBy: realUserUid,
          recordedByName: realUserName,
          recordedAt: now,
        });
        newEntriesForOp.push(payEntry);
        const nextRem = Math.max(0, round2((adv.remaining || 0) - applyAmt));
        const nextUse: CustomerAdvanceUse = {
          saleId: localSale.id,
          invoiceNumber: localSale.invoiceNumber,
          amount: applyAmt,
          date: date || todayISODate(),
        };
        advancePatches[adv.id] = {
          remaining: nextRem,
          uses: [...(adv.uses || []), nextUse],
        };
      }
      if (newEntriesForOp.length > 0) {
        const nextPayments = [...(localSale.payments || []), ...newEntriesForOp];
        const nextAmountPaid = round2(nextPayments.reduce((a, x) => a + (x.amount || 0), 0));
        opId = `applyAdv-${saleId}-${Date.now()}`;
        registerTradeOp({
          id: opId,
          salePatches: {
            [saleId]: {
              payments: nextPayments,
              amountPaid: nextAmountPaid,
              paymentStatus: moneyPosition({ ...localSale, amountPaid: nextAmountPaid }).status,
              updatedAt: now,
            },
          },
          advancePatches,
        });
      }
    }

    const saleRef = doc(db, 'sales', saleId);
    try {
      const appliedTotal = await runTransaction(db, async (tx) => {
        const saleSnap = await tx.get(saleRef);
        if (!saleSnap.exists()) throw new Error('Sale not found.');
        const sale = saleSnap.data() as Sale;
        if (sale.status === 'cancelled') return 0;

        const advEntries: { ref: DocumentReference; adv: CustomerAdvance }[] = [];
        for (const cand of candidateAdvances) {
          const ref = doc(db, 'customer_advances', cand.id);
          const snap = await tx.get(ref);
          if (snap.exists()) {
            advEntries.push({ ref, adv: snap.data() as CustomerAdvance });
          }
        }

        let dueLeft = Math.max(0, round2(moneyPosition(sale).balance));
        if (dueLeft <= 0.009) return 0;

        const addedPayments: PaymentEntry[] = [];
        let totalApplied = 0;
        let idx = 0;
        for (const { ref, adv } of advEntries) {
          if (dueLeft <= 0.009) break;
          const rem = round2(adv.remaining || 0);
          if (rem <= 0.009) continue;
          const applyAmt = round2(Math.min(rem, dueLeft));
          if (applyAmt <= 0.009) continue;
          dueLeft = round2(dueLeft - applyAmt);
          totalApplied = round2(totalApplied + applyAmt);

          const reused = newEntriesForOp[idx];
          idx += 1;
          const payEntry: PaymentEntry = removeUndefinedFields({
            id: reused && Math.abs(reused.amount - applyAmt) < 0.01 ? reused.id : newId(),
            amount: applyAmt,
            date: date || todayISODate(),
            mode: 'advance',
            advanceId: adv.id,
            note: adv.note ? `Advance (${adv.note})` : 'Advance adjusted',
            recordedBy: realUserUid,
            recordedByName: realUserName,
            recordedAt: now,
          });
          addedPayments.push(payEntry);

          const nextUses: CustomerAdvanceUse[] = [
            ...(adv.uses || []),
            {
              saleId: sale.id,
              invoiceNumber: sale.invoiceNumber,
              amount: applyAmt,
              date: date || todayISODate(),
            },
          ];
          tx.update(ref, {
            remaining: Math.max(0, round2(rem - applyAmt)),
            uses: nextUses,
          });
        }

        if (addedPayments.length > 0) {
          const nextPayments = [...(sale.payments || []), ...addedPayments];
          const nextAmountPaid = round2(nextPayments.reduce((a, x) => a + (x.amount || 0), 0));
          tx.update(saleRef, {
            payments: nextPayments,
            amountPaid: nextAmountPaid,
            paymentStatus: moneyPosition({ ...sale, amountPaid: nextAmountPaid }).status,
            updatedAt: now,
          });
        }
        return totalApplied;
      });
      if (opId) confirmTradeOp(opId);
      return appliedTotal;
    } catch (err) {
      if (opId) revertTradeOp(opId);
      throw friendly(err, 'Could not apply advance.');
    }
  };

  const createSalesReturn: TradeContextType['createSalesReturn'] = async (saleId, input) => {
    assertOnline();
    if (!permissions.canCreateSalesReturn) throw new Error('Your role is not allowed to record sales returns.');
    const lines = input.lines.filter((l) => Number(l.quantity) > 0);
    if (!lines.length) throw new Error('Enter a return quantity for at least one item.');
    ensureUniqueLines(lines);
    if (!input.reason?.trim()) throw new Error('Choose a reason for the return.');
    const saleRef = doc(db, 'sales', saleId);
    const retRef = doc(collection(db, 'sales_returns'));
    const now = new Date().toISOString();
    const estimatedSr = guessNextDocNumber('SR', salesReturnsRef.current, 'returnNumber');
    const localSale = salesRef.current.find((s) => s.id === saleId);
    const movRefs = new Map<string, DocumentReference>();
    let opId: string | null = null;

    if (localSale) {
      if (localSale.status === 'cancelled') {
        throw new Error('Cancelled sales cannot have returns.');
      }
      const returned = { ...(localSale.returnedQty || {}) };
      const retLines: TradeReturnLine[] = lines.map((l) => {
        const sl = localSale.lines.find((x) => x.itemId === l.itemId);
        if (!sl) throw new Error('That item is not on this invoice.');
        const already = returned[l.itemId] || 0;
        const left = round2(sl.quantity - already);
        if (Number(l.quantity) > left + 1e-9) {
          throw new Error(`${sl.itemName}: only ${left} ${sl.unit} can still be returned (sold ${sl.quantity}, already returned ${already}).`);
        }
        returned[l.itemId] = round2(already + Number(l.quantity));
        const calc = calcLine({ quantity: l.quantity, rate: sl.rate, discountPct: sl.discountPct, gstPct: sl.gstPct });
        return {
          itemId: sl.itemId,
          itemName: sl.itemName,
          unit: sl.unit,
          quantity: Number(l.quantity),
          rate: sl.rate,
          discountPct: sl.discountPct,
          gstPct: sl.gstPct,
          ...calc,
        };
      });
      const total = sumLines(retLines).grandTotal;
      const itemPatches: Record<string, Partial<InventoryItem>> = {};
      const movs: StockMovement[] = [];
      if (input.condition === 'good') {
        for (const rl of retLines) {
          const it = itemsRef.current.find((i) => i.id === rl.itemId);
          if (!it) continue;
          const prev = getItemQuantity(it);
          const nextQty = round2(prev + rl.quantity);
          const mRef = doc(collection(db, 'movements'));
          movRefs.set(rl.itemId, mRef);
          itemPatches[it.id] = {
            quantity: nextQty,
            updatedAt: now,
            lastUpdatedBy: realUserName,
          };
          movs.push({
            id: mRef.id,
            itemId: it.id,
            itemName: it.name,
            type: 'in',
            quantity: rl.quantity,
            previousQuantity: prev,
            newQuantity: nextQty,
            reason: `Sales return ${estimatedSr} against ${localSale.invoiceNumber} (${localSale.customer.name})`,
            referenceId: retRef.id,
            performedBy: realUserUid,
            performedByName: realUserName,
            timestamp: now,
          });
        }
      }
      const draftRet: SalesReturn = removeUndefinedFields({
        id: retRef.id,
        returnNumber: estimatedSr,
        saleId: localSale.id,
        invoiceNumber: localSale.invoiceNumber,
        customerName: localSale.customer.name,
        lines: retLines,
        total,
        reason: input.reason.trim(),
        condition: input.condition,
        date: input.date,
        notes: input.notes?.trim() || undefined,
        createdBy: realUserUid,
        createdByName: realUserName,
        createdAt: now,
      });
      const returnsTotal = round2((localSale.returnsTotal || 0) + total);
      opId = `createSR-${retRef.id}-${Date.now()}`;
      registerTradeOp({
        id: opId,
        addedSalesReturns: [draftRet],
        salePatches: {
          [saleId]: {
            returnedQty: returned,
            returnsTotal,
            returnStatus: returnStatusFor(localSale.lines, returned),
            paymentStatus: moneyPosition({ ...localSale, returnsTotal }).status,
            updatedAt: now,
          },
        },
      });
      if (Object.keys(itemPatches).length > 0) {
        registerOptimisticOp({ id: opId, itemPatches, movements: movs });
      }
    }

    try {
      const savedRet = await runTransaction(db, async (tx) => {
        // ---- reads
        const snap = await tx.get(saleRef);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        if (sale.status === 'cancelled') {
          throw new Error('Cancelled sales cannot have returns.');
        }
        const counter = await readCounter(tx, 'sales_return');
        const itemMap = input.condition === 'good' ? await readItems(tx, lines.map((l) => l.itemId)) : null;

        const returned = { ...(sale.returnedQty || {}) };
        const retLines: TradeReturnLine[] = lines.map((l) => {
          const sl = sale.lines.find((x) => x.itemId === l.itemId);
          if (!sl) throw new Error('That item is not on this invoice.');
          const already = returned[l.itemId] || 0;
          const left = round2(sl.quantity - already);
          if (Number(l.quantity) > left + 1e-9) {
            throw new Error(`${sl.itemName}: only ${left} ${sl.unit} can still be returned (sold ${sl.quantity}, already returned ${already}).`);
          }
          returned[l.itemId] = round2(already + Number(l.quantity));
          const calc = calcLine({ quantity: l.quantity, rate: sl.rate, discountPct: sl.discountPct, gstPct: sl.gstPct });
          return {
            itemId: sl.itemId,
            itemName: sl.itemName,
            unit: sl.unit,
            quantity: Number(l.quantity),
            rate: sl.rate,
            discountPct: sl.discountPct,
            gstPct: sl.gstPct,
            ...calc,
          };
        });
        const total = sumLines(retLines).grandTotal;
        const returnNumber = docNumber('SR', counter.next);

        // ---- writes
        writeCounter(tx, counter);
        if (itemMap) {
          for (const rl of retLines) {
            const entry = itemMap.get(rl.itemId)!;
            if (!entry.item) continue;
            const prev = getItemQuantity(entry.item);
            const nextQty = round2(prev + rl.quantity);
            tx.update(entry.ref, {
              quantity: nextQty,
              updatedAt: now,
              lastUpdatedBy: realUserName,
              lastMovementType: 'in',
              lastMovementReason: `Sales return ${returnNumber}`,
            });
            movement(
              tx,
              entry.item,
              'in',
              rl.quantity,
              prev,
              nextQty,
              `Sales return ${returnNumber} against ${sale.invoiceNumber} (${sale.customer.name})`,
              retRef.id,
              now,
              movRefs.get(rl.itemId)
            );
          }
        }
        const ret: SalesReturn = removeUndefinedFields({
          id: retRef.id,
          returnNumber,
          saleId: sale.id,
          invoiceNumber: sale.invoiceNumber,
          customerName: sale.customer.name,
          lines: retLines,
          total,
          reason: input.reason.trim(),
          condition: input.condition,
          date: input.date,
          notes: input.notes?.trim() || undefined,
          createdBy: realUserUid,
          createdByName: realUserName,
          createdAt: now,
        });
        tx.set(retRef, ret);
        const returnsTotal = round2((sale.returnsTotal || 0) + total);
        tx.update(saleRef, {
          returnedQty: returned,
          returnsTotal,
          returnStatus: returnStatusFor(sale.lines, returned),
          paymentStatus: moneyPosition({ ...sale, returnsTotal }).status,
          updatedAt: now,
        });
        return ret;
      });
      if (opId) {
        confirmTradeOp(opId, { addedSalesReturns: [savedRet] });
        if (input.condition === 'good') confirmOptimisticOp(opId);
      }
      return savedRet;
    } catch (err) {
      if (opId) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
      }
      throw friendly(err, 'The return could not be saved.');
    }
  };

  const editSalesReturn: TradeContextType['editSalesReturn'] = async (returnId, input) => {
    assertOnline();
    if (!permissions.canEditSalesReturn) throw new Error('Your role is not allowed to edit sales returns.');
    const lines = input.lines.filter((l) => Number(l.quantity) > 0);
    if (!lines.length) throw new Error('Enter a return quantity for at least one item.');
    ensureUniqueLines(lines);
    if (!input.reason?.trim()) throw new Error('Choose a reason for the return.');

    const retRef = doc(db, 'sales_returns', returnId);
    const now = new Date().toISOString();
    const localOldRet = salesReturnsRef.current.find((r) => r.id === returnId);
    const localSale = localOldRet ? salesRef.current.find((s) => s.id === localOldRet.saleId) : undefined;
    const movRefs = new Map<string, DocumentReference>();
    let opId: string | null = null;

    if (localOldRet && localSale) {
      if (localSale.status === 'cancelled') throw new Error('This invoice is cancelled, so its returns can no longer be changed.');
      const allItemIds = Array.from(new Set([...localOldRet.lines.map((l) => l.itemId), ...lines.map((l) => l.itemId)]));
      const otherReturned: Record<string, number> = { ...(localSale.returnedQty || {}) };
      for (const ol of localOldRet.lines) {
        otherReturned[ol.itemId] = Math.max(0, round2((otherReturned[ol.itemId] || 0) - ol.quantity));
      }
      const newReturned: Record<string, number> = { ...otherReturned };
      const retLines: TradeReturnLine[] = lines.map((l) => {
        const sl = localSale.lines.find((x) => x.itemId === l.itemId);
        if (!sl) throw new Error('That item is not on this invoice.');
        const alreadyOther = otherReturned[l.itemId] || 0;
        const left = round2(sl.quantity - alreadyOther);
        if (Number(l.quantity) > left + 1e-9) {
          throw new Error(`${sl.itemName}: only ${left} ${sl.unit} can be returned (sold ${sl.quantity}, other returns ${alreadyOther}).`);
        }
        newReturned[l.itemId] = round2(alreadyOther + Number(l.quantity));
        const calc = calcLine({ quantity: l.quantity, rate: sl.rate, discountPct: sl.discountPct, gstPct: sl.gstPct });
        return {
          itemId: sl.itemId,
          itemName: sl.itemName,
          unit: sl.unit,
          quantity: Number(l.quantity),
          rate: sl.rate,
          discountPct: sl.discountPct,
          gstPct: sl.gstPct,
          ...calc,
        };
      });
      const total = sumLines(retLines).grandTotal;
      const itemPatches: Record<string, Partial<InventoryItem>> = {};
      const movs: StockMovement[] = [];
      for (const itemId of allItemIds) {
        const oldQty = localOldRet.condition === 'good' ? (localOldRet.lines.find((l) => l.itemId === itemId)?.quantity || 0) : 0;
        const newQty = input.condition === 'good' ? (retLines.find((l) => l.itemId === itemId)?.quantity || 0) : 0;
        const delta = round2(newQty - oldQty);
        if (delta !== 0) {
          const it = itemsRef.current.find((i) => i.id === itemId);
          if (it) {
            const prev = getItemQuantity(it);
            const next = round2(prev + delta);
            if (next < 0) {
              throw new Error(`Cannot update return: reducing returned stock for ${it.name} would leave negative stock (${next} ${it.unit}).`);
            }
            const mRef = doc(collection(db, 'movements'));
            movRefs.set(itemId, mRef);
            itemPatches[it.id] = {
              quantity: next,
              updatedAt: now,
              lastUpdatedBy: realUserName,
            };
            movs.push({
              id: mRef.id,
              itemId: it.id,
              itemName: it.name,
              type: delta > 0 ? 'in' : 'out',
              quantity: Math.abs(delta),
              previousQuantity: prev,
              newQuantity: next,
              reason: `Edited sales return ${localOldRet.returnNumber} against ${localSale.invoiceNumber}`,
              referenceId: localOldRet.id,
              performedBy: realUserUid,
              performedByName: realUserName,
              timestamp: now,
            });
          }
        }
      }
      const updatedRet: SalesReturn = removeUndefinedFields({
        ...localOldRet,
        lines: retLines,
        total,
        reason: input.reason.trim(),
        condition: input.condition,
        date: input.date || localOldRet.date,
        notes: input.notes?.trim() || undefined,
        updatedAt: now,
        updatedBy: realUserUid,
        updatedByName: realUserName,
      });
      const newReturnsTotal = round2(Math.max(0, (localSale.returnsTotal || 0) - localOldRet.total + total));
      opId = `editSR-${returnId}-${Date.now()}`;
      registerTradeOp({
        id: opId,
        salesReturnPatches: { [returnId]: updatedRet },
        salePatches: {
          [localSale.id]: {
            returnedQty: newReturned,
            returnsTotal: newReturnsTotal,
            returnStatus: returnStatusFor(localSale.lines, newReturned),
            paymentStatus: moneyPosition({ ...localSale, returnsTotal: newReturnsTotal }).status,
            updatedAt: now,
          },
        },
      });
      if (Object.keys(itemPatches).length > 0) {
        registerOptimisticOp({ id: opId, itemPatches, movements: movs });
      }
    }

    try {
      const updated = await runTransaction(db, async (tx) => {
        const retSnap = await tx.get(retRef);
        if (!retSnap.exists()) throw new Error('Return not found.');
        const oldRet = retSnap.data() as SalesReturn;

        const saleRef = doc(db, 'sales', oldRet.saleId);
        const saleSnap = await tx.get(saleRef);
        if (!saleSnap.exists()) throw new Error('Original sale not found. You can delete this return instead.');
        const sale = saleSnap.data() as Sale;
        if (sale.status === 'cancelled') throw new Error('This invoice is cancelled, so its returns can no longer be changed.');

        const allItemIds = Array.from(new Set([...oldRet.lines.map((l) => l.itemId), ...lines.map((l) => l.itemId)]));
        const itemMap = await readItems(tx, allItemIds);

        const otherReturned: Record<string, number> = { ...(sale.returnedQty || {}) };
        for (const ol of oldRet.lines) {
          otherReturned[ol.itemId] = Math.max(0, round2((otherReturned[ol.itemId] || 0) - ol.quantity));
        }

        const newReturned: Record<string, number> = { ...otherReturned };
        const retLines: TradeReturnLine[] = lines.map((l) => {
          const sl = sale.lines.find((x) => x.itemId === l.itemId);
          if (!sl) throw new Error('That item is not on this invoice.');
          const alreadyOther = otherReturned[l.itemId] || 0;
          const left = round2(sl.quantity - alreadyOther);
          if (Number(l.quantity) > left + 1e-9) {
            throw new Error(`${sl.itemName}: only ${left} ${sl.unit} can be returned (sold ${sl.quantity}, other returns ${alreadyOther}).`);
          }
          newReturned[l.itemId] = round2(alreadyOther + Number(l.quantity));
          const calc = calcLine({ quantity: l.quantity, rate: sl.rate, discountPct: sl.discountPct, gstPct: sl.gstPct });
          return {
            itemId: sl.itemId,
            itemName: sl.itemName,
            unit: sl.unit,
            quantity: Number(l.quantity),
            rate: sl.rate,
            discountPct: sl.discountPct,
            gstPct: sl.gstPct,
            ...calc,
          };
        });

        const total = sumLines(retLines).grandTotal;

        for (const itemId of allItemIds) {
          const oldQty = oldRet.condition === 'good' ? (oldRet.lines.find((l) => l.itemId === itemId)?.quantity || 0) : 0;
          const newQty = input.condition === 'good' ? (retLines.find((l) => l.itemId === itemId)?.quantity || 0) : 0;
          const delta = round2(newQty - oldQty);
          if (delta !== 0) {
            const entry = itemMap.get(itemId);
            if (entry && entry.item) {
              const prev = getItemQuantity(entry.item);
              const next = round2(prev + delta);
              if (next < 0) {
                throw new Error(`Cannot update return: reducing returned stock for ${entry.item.name} would leave negative stock (${next} ${entry.item.unit}).`);
              }
              tx.update(entry.ref, {
                quantity: next,
                updatedAt: now,
                lastUpdatedBy: realUserName,
                lastMovementType: delta > 0 ? 'in' : 'out',
                lastMovementReason: `Edited sales return ${oldRet.returnNumber}`,
              });
              movement(
                tx,
                entry.item,
                delta > 0 ? 'in' : 'out',
                Math.abs(delta),
                prev,
                next,
                `Edited sales return ${oldRet.returnNumber} against ${sale.invoiceNumber}`,
                oldRet.id,
                now,
                movRefs.get(itemId)
              );
            }
          }
        }

        const updatedRet: SalesReturn = removeUndefinedFields({
          ...oldRet,
          lines: retLines,
          total,
          reason: input.reason.trim(),
          condition: input.condition,
          date: input.date || oldRet.date,
          notes: input.notes?.trim() || undefined,
          updatedAt: now,
          updatedBy: realUserUid,
          updatedByName: realUserName,
        });
        tx.set(retRef, updatedRet);

        const newReturnsTotal = round2(Math.max(0, (sale.returnsTotal || 0) - oldRet.total + total));
        tx.update(saleRef, {
          returnedQty: newReturned,
          returnsTotal: newReturnsTotal,
          returnStatus: returnStatusFor(sale.lines, newReturned),
          paymentStatus: moneyPosition({ ...sale, returnsTotal: newReturnsTotal }).status,
          updatedAt: now,
        });

        return updatedRet;
      });
      if (opId) {
        confirmTradeOp(opId, { salesReturnPatches: { [returnId]: updated } });
        confirmOptimisticOp(opId);
      }
      return updated;
    } catch (err) {
      if (opId) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
      }
      throw friendly(err, 'The sales return could not be updated.');
    }
  };

  const deleteSalesReturn: TradeContextType['deleteSalesReturn'] = async (returnId, reason) => {
    assertOnline();
    if (!permissions.canDeleteSalesReturn) throw new Error('Your role is not allowed to delete sales returns.');
    const retRef = doc(db, 'sales_returns', returnId);
    const now = new Date().toISOString();
    const localRet = salesReturnsRef.current.find((r) => r.id === returnId);
    const localSale = localRet?.saleId ? salesRef.current.find((s) => s.id === localRet.saleId) : undefined;
    const movRefs = new Map<string, DocumentReference>();
    let opId: string | null = null;

    if (localRet) {
      if (localSale && localSale.status === 'cancelled') {
        throw new Error('This invoice is cancelled, so its returns can no longer be changed.');
      }
      const itemPatches: Record<string, Partial<InventoryItem>> = {};
      const movs: StockMovement[] = [];
      if (localRet.condition === 'good') {
        for (const line of localRet.lines) {
          const it = itemsRef.current.find((i) => i.id === line.itemId);
          if (!it) continue;
          const prev = getItemQuantity(it);
          const next = round2(Math.max(0, prev - line.quantity));
          const mRef = doc(collection(db, 'movements'));
          movRefs.set(line.itemId, mRef);
          itemPatches[it.id] = {
            quantity: next,
            updatedAt: now,
            lastUpdatedBy: realUserName,
          };
          movs.push({
            id: mRef.id,
            itemId: it.id,
            itemName: it.name,
            type: 'out',
            quantity: line.quantity,
            previousQuantity: prev,
            newQuantity: next,
            reason: `Deleted sales return ${localRet.returnNumber}: stock deducted`,
            referenceId: localRet.id,
            performedBy: realUserUid,
            performedByName: realUserName,
            timestamp: now,
          });
        }
      }
      const salePatches: Record<string, Partial<Sale>> = {};
      if (localSale) {
        const newReturned: Record<string, number> = { ...(localSale.returnedQty || {}) };
        for (const line of localRet.lines) {
          newReturned[line.itemId] = Math.max(0, round2((newReturned[line.itemId] || 0) - line.quantity));
        }
        const newReturnsTotal = Math.max(0, round2((localSale.returnsTotal || 0) - localRet.total));
        salePatches[localSale.id] = {
          returnedQty: newReturned,
          returnsTotal: newReturnsTotal,
          returnStatus: returnStatusFor(localSale.lines, newReturned),
          paymentStatus: moneyPosition({ ...localSale, returnsTotal: newReturnsTotal }).status,
          updatedAt: now,
        };
      }
      opId = `delSR-${returnId}-${Date.now()}`;
      registerTradeOp({ id: opId, deletedSalesReturnIds: [returnId], salePatches });
      if (Object.keys(itemPatches).length > 0) {
        registerOptimisticOp({ id: opId, itemPatches, movements: movs });
      }
    }

    try {
      await runTransaction(db, async (tx) => {
        const retSnap = await tx.get(retRef);
        if (!retSnap.exists()) throw new Error('Return not found.');
        const ret = retSnap.data() as SalesReturn;

        const saleRef = ret.saleId ? doc(db, 'sales', ret.saleId) : null;
        const saleSnap = saleRef ? await tx.get(saleRef) : null;
        const sale = saleSnap && saleSnap.exists() ? (saleSnap.data() as Sale) : null;
        if (sale && sale.status === 'cancelled') {
          throw new Error('This invoice is cancelled, so its returns can no longer be changed.');
        }

        const itemMap = ret.condition === 'good' ? await readItems(tx, ret.lines.map((l) => l.itemId)) : null;

        if (itemMap && ret.condition === 'good') {
          for (const line of ret.lines) {
            const entry = itemMap.get(line.itemId);
            if (entry && entry.item) {
              const prev = getItemQuantity(entry.item);
              const next = round2(Math.max(0, prev - line.quantity));
              tx.update(entry.ref, {
                quantity: next,
                updatedAt: now,
                lastUpdatedBy: realUserName,
                lastMovementType: 'out',
                lastMovementReason: `Deleted sales return ${ret.returnNumber} (${reason || 'Return retracted'})`,
              });
              movement(
                tx,
                entry.item,
                'out',
                line.quantity,
                prev,
                next,
                `Deleted sales return ${ret.returnNumber}: stock deducted`,
                ret.id,
                now,
                movRefs.get(line.itemId)
              );
            }
          }
        }

        if (sale && saleRef) {
          const newReturned: Record<string, number> = { ...(sale.returnedQty || {}) };
          for (const line of ret.lines) {
            newReturned[line.itemId] = Math.max(0, round2((newReturned[line.itemId] || 0) - line.quantity));
          }
          const newReturnsTotal = Math.max(0, round2((sale.returnsTotal || 0) - ret.total));

          tx.update(saleRef, {
            returnedQty: newReturned,
            returnsTotal: newReturnsTotal,
            returnStatus: returnStatusFor(sale.lines, newReturned),
            paymentStatus: moneyPosition({ ...sale, returnsTotal: newReturnsTotal }).status,
            updatedAt: now,
          });
        }

        tx.delete(retRef);
      });
      if (opId) {
        confirmTradeOp(opId);
        confirmOptimisticOp(opId);
      }
    } catch (err) {
      if (opId) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
      }
      throw friendly(err, 'The sales return could not be deleted.');
    }
  };

  // =========================================================================
  // PURCHASE
  // =========================================================================
  const createPurchase = async (input: NewPurchaseInput): Promise<Purchase> => {
    assertOnline();
    if (!permissions.canCreatePurchase) throw new Error('Your role is not allowed to create purchase orders.');
    const supplierName = input.supplier.name?.trim();
    if (!supplierName) throw new Error('Supplier name is required.');
    if (!input.lines.length) throw new Error('Add at least one item.');
    ensureUniqueLines(input.lines);
    for (const l of input.lines) {
      if (!(Number(l.quantity) > 0)) throw new Error(`Quantity for ${itemName(l.itemId)} must be more than 0.`);
      if (Number(l.rate) < 0) throw new Error(`Rate for ${itemName(l.itemId)} can't be negative.`);
    }
    const ref = doc(collection(db, 'purchases'));
    const now = new Date().toISOString();
    const estimatedPo = guessNextDocNumber('PO', purchasesRef.current, 'poNumber');
    const optLines: PurchaseLine[] = input.lines.map((l) => {
      const it = itemsRef.current.find((i) => i.id === l.itemId);
      if (!it) throw new Error('One of the items was not found in inventory.');
      return removeUndefinedFields({
        itemId: it.id,
        itemName: it.name,
        sku: it.sku || undefined,
        unit: it.unit,
        quantity: Number(l.quantity),
        rate: round2(l.rate),
        gstPct: Number(l.gstPct) || 0,
        ...calcLine({ quantity: l.quantity, rate: l.rate, gstPct: l.gstPct }),
      });
    });
    const optTotals = sumLines(optLines);
    const draftPo: Purchase = removeUndefinedFields({
      id: ref.id,
      poNumber: estimatedPo,
      status: 'ordered',
      supplier: removeUndefinedFields({
        name: supplierName,
        phone: input.supplier.phone?.trim() || undefined,
        gstin: input.supplier.gstin?.trim().toUpperCase() || undefined,
        address: input.supplier.address?.trim() || undefined,
      }),
      expectedDate: input.expectedDate || undefined,
      notes: input.notes?.trim() || undefined,
      lines: optLines,
      ...optTotals,
      receivedQty: {},
      receipts: [],
      payments: [],
      amountPaid: 0,
      refunds: [],
      refundedTotal: 0,
      returnedQty: {},
      returnsTotal: 0,
      returnStatus: 'none',
      paymentStatus: optTotals.grandTotal > 0 ? 'unpaid' : 'paid',
      createdBy: realUserUid,
      createdByName: realUserName,
      createdAt: now,
      updatedAt: now,
    });
    const opId = `createPO-${ref.id}-${Date.now()}`;
    registerTradeOp({ id: opId, addedPurchases: [draftPo] });

    try {
      const savedPo = await runTransaction(db, async (tx) => {
        const counter = await readCounter(tx, 'purchase');
        const poNumber = docNumber('PO', counter.next);
        const lines: PurchaseLine[] = input.lines.map((l) => {
          const it = itemsRef.current.find((i) => i.id === l.itemId);
          if (!it) throw new Error('One of the items was not found in inventory.');
          return removeUndefinedFields({
            itemId: it.id,
            itemName: it.name,
            sku: it.sku || undefined,
            unit: it.unit,
            quantity: Number(l.quantity),
            rate: round2(l.rate),
            gstPct: Number(l.gstPct) || 0,
            ...calcLine({ quantity: l.quantity, rate: l.rate, gstPct: l.gstPct }),
          });
        });
        const totals = sumLines(lines);
        writeCounter(tx, counter);
        const po: Purchase = removeUndefinedFields({
          id: ref.id,
          poNumber,
          status: 'ordered',
          supplier: removeUndefinedFields({
            name: supplierName,
            phone: input.supplier.phone?.trim() || undefined,
            gstin: input.supplier.gstin?.trim().toUpperCase() || undefined,
            address: input.supplier.address?.trim() || undefined,
          }),
          expectedDate: input.expectedDate || undefined,
          notes: input.notes?.trim() || undefined,
          lines,
          ...totals,
          receivedQty: {},
          receipts: [],
          payments: [],
          amountPaid: 0,
          refunds: [],
          refundedTotal: 0,
          returnedQty: {},
          returnsTotal: 0,
          returnStatus: 'none',
          paymentStatus: totals.grandTotal > 0 ? 'unpaid' : 'paid',
          createdBy: realUserUid,
          createdByName: realUserName,
          createdAt: now,
          updatedAt: now,
        });
        tx.set(ref, po);
        return po;
      });
      confirmTradeOp(opId, { addedPurchases: [savedPo] });
      return savedPo;
    } catch (err) {
      revertTradeOp(opId);
      throw friendly(err, 'The purchase order could not be saved.');
    }
  };

  const cancelPurchase = async (purchaseId: string, reason: string) => {
    assertOnline();
    if (!permissions.canCreatePurchase) throw new Error('Your role is not allowed to cancel purchase orders.');
    const now = new Date().toISOString();
    const localPo = purchasesRef.current.find((p) => p.id === purchaseId);
    let opId: string | null = null;
    if (localPo) {
      if (localPo.status !== 'ordered' || (localPo.receipts || []).length > 0) {
        throw new Error('Goods have already been received on this order, so it can’t be cancelled. Use Return instead.');
      }
      if ((localPo.amountPaid || 0) > 0) throw new Error('A payment is recorded on this order, so it can’t be cancelled.');
      opId = `cancelPO-${purchaseId}-${Date.now()}`;
      registerTradeOp({
        id: opId,
        purchasePatches: {
          [purchaseId]: {
            status: 'cancelled',
            cancelledAt: now,
            cancelledBy: realUserName,
            cancelReason: reason?.trim() || 'Cancelled',
            paymentStatus: 'paid',
            updatedAt: now,
          },
        },
      });
    }
    const ref = doc(db, 'purchases', purchaseId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Purchase order not found.');
        const po = snap.data() as Purchase;
        if (po.status !== 'ordered' || (po.receipts || []).length > 0) {
          throw new Error('Goods have already been received on this order, so it can’t be cancelled. Use Return instead.');
        }
        if ((po.amountPaid || 0) > 0) throw new Error('A payment is recorded on this order, so it can’t be cancelled.');
        tx.update(ref, {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: realUserName,
          cancelReason: reason?.trim() || 'Cancelled',
          paymentStatus: 'paid',
          updatedAt: now,
        });
      });
      if (opId) confirmTradeOp(opId);
    } catch (err) {
      if (opId) revertTradeOp(opId);
      throw friendly(err, 'The order could not be cancelled.');
    }
  };

  const editPurchase = async (purchaseId: string, input: NewPurchaseInput): Promise<Purchase> => {
    assertOnline();
    if (!permissions.canEditPurchase) throw new Error('Your role is not allowed to edit purchase orders.');
    const supplierName = input.supplier.name?.trim();
    if (!supplierName) throw new Error('Supplier name is required.');
    if (!input.lines.length) throw new Error('Add at least one item.');
    ensureUniqueLines(input.lines);
    for (const l of input.lines) {
      if (!(Number(l.quantity) > 0)) throw new Error(`Quantity for ${itemName(l.itemId)} must be more than 0.`);
      if (Number(l.rate) < 0) throw new Error(`Rate for ${itemName(l.itemId)} can't be negative.`);
    }

    const ref = doc(db, 'purchases', purchaseId);
    const now = new Date().toISOString();
    const localPo = purchasesRef.current.find((p) => p.id === purchaseId);
    let opId: string | null = null;
    if (localPo) {
      if (localPo.status === 'cancelled') throw new Error('Cancelled purchase orders cannot be edited.');
      if ((localPo.receipts || []).length > 0) {
        throw new Error('This order has already received goods. Received purchase orders cannot have their items edited.');
      }
      const lines: PurchaseLine[] = input.lines.map((l) => {
        const it = itemsRef.current.find((i) => i.id === l.itemId);
        if (!it) throw new Error('One of the items was not found in inventory.');
        const calc = calcLine({ quantity: Number(l.quantity), rate: Number(l.rate), discountPct: 0, gstPct: Number(l.gstPct) || 0 });
        return removeUndefinedFields({
          itemId: it.id,
          itemName: it.name,
          sku: it.sku || undefined,
          unit: it.unit,
          quantity: Number(l.quantity),
          rate: round2(l.rate),
          gstPct: Number(l.gstPct) || 0,
          ...calc,
        });
      });
      const totals = sumLines(lines);
      const optPo: Purchase = removeUndefinedFields({
        ...localPo,
        supplier: removeUndefinedFields({
          name: supplierName,
          phone: input.supplier.phone?.trim() || undefined,
          gstin: input.supplier.gstin?.trim().toUpperCase() || undefined,
          address: input.supplier.address?.trim() || undefined,
        }),
        lines,
        subtotal: totals.subtotal,
        gstTotal: totals.gstTotal,
        grandTotal: totals.grandTotal,
        expectedDate: input.expectedDate || undefined,
        notes: input.notes?.trim() || undefined,
        updatedAt: now,
      });
      optPo.paymentStatus = moneyPosition(optPo).status;
      opId = `editPO-${purchaseId}-${Date.now()}`;
      registerTradeOp({ id: opId, purchasePatches: { [purchaseId]: optPo } });
    }

    try {
      const updated = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Purchase order not found.');
        const po = snap.data() as Purchase;
        if (po.status === 'cancelled') throw new Error('Cancelled purchase orders cannot be edited.');
        if ((po.receipts || []).length > 0) {
          throw new Error('This order has already received goods. Received purchase orders cannot have their items edited.');
        }

        const lines: PurchaseLine[] = input.lines.map((l) => {
          const it = itemsRef.current.find((i) => i.id === l.itemId);
          if (!it) throw new Error('One of the items was not found in inventory.');
          const calc = calcLine({ quantity: Number(l.quantity), rate: Number(l.rate), discountPct: 0, gstPct: Number(l.gstPct) || 0 });
          return removeUndefinedFields({
            itemId: it.id,
            itemName: it.name,
            sku: it.sku || undefined,
            unit: it.unit,
            quantity: Number(l.quantity),
            rate: round2(l.rate),
            gstPct: Number(l.gstPct) || 0,
            ...calc,
          });
        });
        const totals = sumLines(lines);

        const updatedPo: Purchase = removeUndefinedFields({
          ...po,
          supplier: removeUndefinedFields({
            name: supplierName,
            phone: input.supplier.phone?.trim() || undefined,
            gstin: input.supplier.gstin?.trim().toUpperCase() || undefined,
            address: input.supplier.address?.trim() || undefined,
          }),
          lines,
          subtotal: totals.subtotal,
          gstTotal: totals.gstTotal,
          grandTotal: totals.grandTotal,
          expectedDate: input.expectedDate || undefined,
          notes: input.notes?.trim() || undefined,
          updatedAt: now,
        });

        updatedPo.paymentStatus = moneyPosition(updatedPo).status;

        tx.update(ref, {
          supplier: updatedPo.supplier,
          lines: updatedPo.lines,
          subtotal: updatedPo.subtotal,
          gstTotal: updatedPo.gstTotal,
          grandTotal: updatedPo.grandTotal,
          expectedDate: updatedPo.expectedDate || null,
          notes: updatedPo.notes || null,
          paymentStatus: updatedPo.paymentStatus,
          updatedAt: now,
        });

        return updatedPo;
      });
      if (opId) confirmTradeOp(opId, { purchasePatches: { [purchaseId]: updated } });
      return updated;
    } catch (err) {
      if (opId) revertTradeOp(opId);
      throw friendly(err, 'The purchase order could not be edited.');
    }
  };

  const deletePurchase = async (purchaseId: string, reason?: string) => {
    assertOnline();
    if (!permissions.canDeletePurchase) throw new Error('Your role is not allowed to delete purchase orders.');
    const localPo = purchasesRef.current.find((p) => p.id === purchaseId);
    const now = new Date().toISOString();
    let opId: string | null = null;
    if (localPo) {
      if ((localPo.receipts || []).length > 0 || Object.values(localPo.receivedQty || {}).some((q) => Number(q) > 0)) {
        throw new Error('Goods were already received on this order, so it cannot be deleted. Use Purchase Return or Cancel instead.');
      }
      if ((localPo.amountPaid || 0) > 0) {
        throw new Error('Payments are recorded on this order, so it cannot be deleted. Cancel it instead so the record stays.');
      }
      opId = `delPO-${purchaseId}-${Date.now()}`;
      registerTradeOp({ id: opId, deletedPurchaseIds: [purchaseId] });
    }
    const ref = doc(db, 'purchases', purchaseId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Purchase order not found.');
        const po = snap.data() as Purchase;
        if ((po.receipts || []).length > 0 || Object.values(po.receivedQty || {}).some((q) => Number(q) > 0)) {
          throw new Error('Goods were already received on this order, so it cannot be deleted. Use Purchase Return or Cancel instead.');
        }
        if ((po.amountPaid || 0) > 0) {
          throw new Error('Payments are recorded on this order, so it cannot be deleted. Cancel it instead so the record stays.');
        }

        const totalReceived = Object.values(po.receivedQty || {}).reduce((a, b) => a + Number(b), 0);
        if (totalReceived > 0) {
          const itemMap = await readItems(tx, po.lines.map((l) => l.itemId));
          for (const line of po.lines) {
            const qtyRec = (po.receivedQty || {})[line.itemId] || 0;
            if (qtyRec > 0) {
              const entry = itemMap.get(line.itemId);
              if (!entry || !entry.item) continue;
              const prev = getItemQuantity(entry.item);
              const next = round2(Math.max(0, prev - qtyRec));
              tx.update(entry.ref, {
                quantity: next,
                updatedAt: now,
                lastUpdatedBy: realUserName,
                lastMovementType: 'out',
                lastMovementReason: `Deleted purchase order ${po.poNumber} (${reason || 'Received stock reversed'})`,
              });
              movement(
                tx,
                entry.item,
                'out',
                qtyRec,
                prev,
                next,
                `Deleted PO ${po.poNumber}: received stock reversed`,
                po.id,
                now
              );
            }
          }
        }

        tx.delete(ref);
      });
      if (opId) confirmTradeOp(opId);
    } catch (err) {
      if (opId) revertTradeOp(opId);
      throw friendly(err, 'The purchase order could not be deleted.');
    }
  };

  const receivePurchase: TradeContextType['receivePurchase'] = async (purchaseId, input) => {
    assertOnline();
    if (!permissions.canReceivePurchase) throw new Error('Your role is not allowed to receive goods.');
    const lines = input.lines.filter((l) => Number(l.quantity) > 0);
    if (!lines.length) throw new Error('Enter a received quantity for at least one item.');
    ensureUniqueLines(lines);

    const now = new Date().toISOString();
    const receiptId = newId();
    const movRefs = new Map<string, DocumentReference>();
    const localPo = purchasesRef.current.find((p) => p.id === purchaseId);
    let opId: string | null = null;

    if (localPo) {
      if (localPo.status !== 'ordered' && localPo.status !== 'partly_received') {
        throw new Error(`This order is ${localPo.status.replace('_', ' ')}.`);
      }
      const received = { ...(localPo.receivedQty || {}) };
      const receiptLines: PurchaseReceipt['lines'] = [];
      for (const l of lines) {
        const pl = localPo.lines.find((x) => x.itemId === l.itemId);
        if (!pl) throw new Error('That item is not on this order.');
        const got = received[l.itemId] || 0;
        const left = round2(pl.quantity - got);
        if (Number(l.quantity) > left + 1e-9) {
          throw new Error(`${pl.itemName}: only ${left} ${pl.unit} is still to receive (ordered ${pl.quantity}, received ${got}).`);
        }
        received[l.itemId] = round2(got + Number(l.quantity));
        receiptLines.push({ itemId: pl.itemId, itemName: pl.itemName, quantity: Number(l.quantity) });
      }
      const allIn = localPo.lines.every((pl) => (received[pl.itemId] || 0) >= pl.quantity - 1e-9);
      const itemPatches: Record<string, Partial<InventoryItem>> = {};
      const movs: StockMovement[] = [];
      for (const rl of receiptLines) {
        const it = itemsRef.current.find((i) => i.id === rl.itemId);
        if (!it) throw new Error(`${rl.itemName} was deleted from inventory. Add it again first.`);
        const pl = localPo.lines.find((x) => x.itemId === rl.itemId)!;
        const prev = getItemQuantity(it);
        const nextQty = round2(prev + rl.quantity);
        const mRef = doc(collection(db, 'movements'));
        movRefs.set(rl.itemId, mRef);
        itemPatches[it.id] = {
          quantity: nextQty,
          unitCost: weightedAverageCost(prev, it.unitCost || 0, rl.quantity, pl.rate),
          updatedAt: now,
          lastUpdatedBy: realUserName,
        };
        movs.push({
          id: mRef.id,
          itemId: it.id,
          itemName: it.name,
          type: 'in',
          quantity: rl.quantity,
          previousQuantity: prev,
          newQuantity: nextQty,
          reason: `Purchase ${localPo.poNumber} from ${localPo.supplier.name}${input.billNumber ? ` (Bill ${input.billNumber})` : ''}`,
          referenceId: localPo.id,
          performedBy: realUserUid,
          performedByName: realUserName,
          timestamp: now,
        });
      }
      const receipt: PurchaseReceipt = removeUndefinedFields({
        id: receiptId,
        billNumber: input.billNumber?.trim() || undefined,
        billDate: input.billDate || undefined,
        lines: receiptLines,
        receivedBy: realUserUid,
        receivedByName: realUserName,
        receivedAt: now,
      });
      opId = `receivePO-${purchaseId}-${Date.now()}`;
      registerTradeOp({
        id: opId,
        purchasePatches: {
          [purchaseId]: {
            receivedQty: received,
            receipts: [...(localPo.receipts || []), receipt],
            status: allIn ? 'received' : 'partly_received',
            updatedAt: now,
          },
        },
      });
      registerOptimisticOp({ id: opId, itemPatches, movements: movs });
    }

    const ref = doc(db, 'purchases', purchaseId);
    try {
      await runTransaction(db, async (tx) => {
        // ---- reads
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Purchase order not found.');
        const po = snap.data() as Purchase;
        if (po.status !== 'ordered' && po.status !== 'partly_received') {
          throw new Error(`This order is ${po.status.replace('_', ' ')}.`);
        }
        const itemMap = await readItems(tx, lines.map((l) => l.itemId));

        const received = { ...(po.receivedQty || {}) };
        const receiptLines: PurchaseReceipt['lines'] = [];
        for (const l of lines) {
          const pl = po.lines.find((x) => x.itemId === l.itemId);
          if (!pl) throw new Error('That item is not on this order.');
          const got = received[l.itemId] || 0;
          const left = round2(pl.quantity - got);
          if (Number(l.quantity) > left + 1e-9) {
            throw new Error(`${pl.itemName}: only ${left} ${pl.unit} is still to receive (ordered ${pl.quantity}, received ${got}).`);
          }
          received[l.itemId] = round2(got + Number(l.quantity));
          receiptLines.push({ itemId: pl.itemId, itemName: pl.itemName, quantity: Number(l.quantity) });
        }
        const allIn = po.lines.every((pl) => (received[pl.itemId] || 0) >= pl.quantity - 1e-9);

        // ---- writes
        for (const rl of receiptLines) {
          const entry = itemMap.get(rl.itemId)!;
          if (!entry.item) throw new Error(`${rl.itemName} was deleted from inventory. Add it again first.`);
          const pl = po.lines.find((x) => x.itemId === rl.itemId)!;
          const prev = getItemQuantity(entry.item);
          const nextQty = round2(prev + rl.quantity);
          tx.update(entry.ref, {
            quantity: nextQty,
            unitCost: weightedAverageCost(prev, entry.item.unitCost || 0, rl.quantity, pl.rate),
            updatedAt: now,
            lastUpdatedBy: realUserName,
            lastMovementType: 'in',
            lastMovementReason: `Purchase ${po.poNumber} from ${po.supplier.name}`,
          });
          movement(
            tx,
            entry.item,
            'in',
            rl.quantity,
            prev,
            nextQty,
            `Purchase ${po.poNumber} from ${po.supplier.name}${input.billNumber ? ` (Bill ${input.billNumber})` : ''}`,
            po.id,
            now,
            movRefs.get(rl.itemId)
          );
        }
        const receipt: PurchaseReceipt = removeUndefinedFields({
          id: receiptId,
          billNumber: input.billNumber?.trim() || undefined,
          billDate: input.billDate || undefined,
          lines: receiptLines,
          receivedBy: realUserUid,
          receivedByName: realUserName,
          receivedAt: now,
        });
        tx.update(ref, {
          receivedQty: received,
          receipts: [...(po.receipts || []), receipt],
          status: allIn ? 'received' : 'partly_received',
          updatedAt: now,
        });
      });
      if (opId) {
        confirmTradeOp(opId);
        confirmOptimisticOp(opId);
      }
    } catch (err) {
      if (opId) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
      }
      throw friendly(err, 'The goods could not be received.');
    }
  };

  const recordPurchaseMoney = async (purchaseId: string, p: PaymentInput, kind: 'payment' | 'refund') => {
    assertOnline();
    if (!permissions.canRecordPurchasePayments) throw new Error('Your role is not allowed to record supplier payments.');
    if (!(Number(p.amount) > 0)) throw new Error('Enter an amount more than 0.');
    const now = new Date().toISOString();
    const payEntry = payment(p, now);
    const localPo = purchasesRef.current.find((po) => po.id === purchaseId);
    let opId: string | null = null;
    if (localPo) {
      if (localPo.status === 'cancelled') throw new Error('This order is cancelled.');
      const pos = moneyPosition(localPo);
      if (kind === 'payment') {
        if (p.amount > pos.balance + 0.009) throw new Error(`Only ${pos.balance.toFixed(2)} is payable on this order.`);
        const amountPaid = round2((localPo.amountPaid || 0) + p.amount);
        opId = `poPay-${purchaseId}-${Date.now()}`;
        registerTradeOp({
          id: opId,
          purchasePatches: {
            [purchaseId]: {
              payments: [...(localPo.payments || []), payEntry],
              amountPaid,
              paymentStatus: moneyPosition({ ...localPo, amountPaid }).status,
              updatedAt: now,
            },
          },
        });
      } else {
        const due = -pos.balance;
        if (p.amount > due + 0.009) throw new Error(`Only ${Math.max(0, due).toFixed(2)} refund is due from the supplier.`);
        const refundedTotal = round2((localPo.refundedTotal || 0) + p.amount);
        opId = `poRefund-${purchaseId}-${Date.now()}`;
        registerTradeOp({
          id: opId,
          purchasePatches: {
            [purchaseId]: {
              refunds: [...(localPo.refunds || []), payEntry],
              refundedTotal,
              paymentStatus: moneyPosition({ ...localPo, refundedTotal }).status,
              updatedAt: now,
            },
          },
        });
      }
    }

    const ref = doc(db, 'purchases', purchaseId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Purchase order not found.');
        const po = snap.data() as Purchase;
        if (po.status === 'cancelled') throw new Error('This order is cancelled.');
        const pos = moneyPosition(po);
        if (kind === 'payment') {
          if (p.amount > pos.balance + 0.009) throw new Error(`Only ${pos.balance.toFixed(2)} is payable on this order.`);
          const amountPaid = round2((po.amountPaid || 0) + p.amount);
          tx.update(ref, {
            payments: [...(po.payments || []), payEntry],
            amountPaid,
            paymentStatus: moneyPosition({ ...po, amountPaid }).status,
            updatedAt: now,
          });
        } else {
          const due = -pos.balance;
          if (p.amount > due + 0.009) throw new Error(`Only ${Math.max(0, due).toFixed(2)} refund is due from the supplier.`);
          const refundedTotal = round2((po.refundedTotal || 0) + p.amount);
          tx.update(ref, {
            refunds: [...(po.refunds || []), payEntry],
            refundedTotal,
            paymentStatus: moneyPosition({ ...po, refundedTotal }).status,
            updatedAt: now,
          });
        }
      });
      if (opId) confirmTradeOp(opId);
    } catch (err) {
      if (opId) revertTradeOp(opId);
      throw friendly(err, 'The payment could not be saved.');
    }
  };

  const createPurchaseReturn: TradeContextType['createPurchaseReturn'] = async (purchaseId, input) => {
    assertOnline();
    if (!permissions.canCreatePurchaseReturn) throw new Error('Your role is not allowed to return goods to suppliers.');
    const lines = input.lines.filter((l) => Number(l.quantity) > 0);
    if (!lines.length) throw new Error('Enter a return quantity for at least one item.');
    ensureUniqueLines(lines);
    if (!input.reason?.trim()) throw new Error('Choose a reason for the return.');
    const poRef = doc(db, 'purchases', purchaseId);
    const retRef = doc(collection(db, 'purchase_returns'));
    const now = new Date().toISOString();
    const estimatedPr = guessNextDocNumber('PR', purchaseReturnsRef.current, 'returnNumber');
    const localPo = purchasesRef.current.find((p) => p.id === purchaseId);
    const movRefs = new Map<string, DocumentReference>();
    let opId: string | null = null;

    if (localPo) {
      if (localPo.status !== 'partly_received' && localPo.status !== 'received') {
        throw new Error('Nothing has been received on this order yet.');
      }
      const returned = { ...(localPo.returnedQty || {}) };
      const retLines: TradeReturnLine[] = lines.map((l) => {
        const pl = localPo.lines.find((x) => x.itemId === l.itemId);
        if (!pl) throw new Error('That item is not on this order.');
        const got = (localPo.receivedQty || {})[l.itemId] || 0;
        const already = returned[l.itemId] || 0;
        const left = round2(got - already);
        if (Number(l.quantity) > left + 1e-9) {
          throw new Error(`${pl.itemName}: only ${left} ${pl.unit} can be returned (received ${got}, already returned ${already}).`);
        }
        const it = itemsRef.current.find((i) => i.id === l.itemId);
        if (!it) throw new Error(`${pl.itemName} is no longer in inventory.`);
        const onHand = getItemQuantity(it);
        if (Number(l.quantity) > onHand + 1e-9) {
          throw new Error(`${pl.itemName}: only ${onHand} ${pl.unit} in stock now, so you can't return ${l.quantity}.`);
        }
        returned[l.itemId] = round2(already + Number(l.quantity));
        return {
          itemId: pl.itemId,
          itemName: pl.itemName,
          unit: pl.unit,
          quantity: Number(l.quantity),
          rate: pl.rate,
          discountPct: 0,
          gstPct: pl.gstPct,
          ...calcLine({ quantity: l.quantity, rate: pl.rate, gstPct: pl.gstPct }),
        };
      });
      const total = sumLines(retLines).grandTotal;
      const itemPatches: Record<string, Partial<InventoryItem>> = {};
      const movs: StockMovement[] = [];
      for (const rl of retLines) {
        const it = itemsRef.current.find((i) => i.id === rl.itemId)!;
        const prev = getItemQuantity(it);
        const nextQty = round2(prev - rl.quantity);
        const mRef = doc(collection(db, 'movements'));
        movRefs.set(rl.itemId, mRef);
        itemPatches[it.id] = {
          quantity: nextQty,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        };
        movs.push({
          id: mRef.id,
          itemId: it.id,
          itemName: it.name,
          type: 'out',
          quantity: rl.quantity,
          previousQuantity: prev,
          newQuantity: nextQty,
          reason: `Purchase return ${estimatedPr} to ${localPo.supplier.name} against ${localPo.poNumber}`,
          referenceId: retRef.id,
          performedBy: realUserUid,
          performedByName: realUserName,
          timestamp: now,
        });
      }
      const draftRet: PurchaseReturn = removeUndefinedFields({
        id: retRef.id,
        returnNumber: estimatedPr,
        purchaseId: localPo.id,
        poNumber: localPo.poNumber,
        supplierName: localPo.supplier.name,
        lines: retLines,
        total,
        reason: input.reason.trim(),
        vehicleNumber: input.vehicleNumber?.trim() || undefined,
        date: input.date,
        notes: input.notes?.trim() || undefined,
        createdBy: realUserUid,
        createdByName: realUserName,
        createdAt: now,
      });
      const returnsTotal = round2((localPo.returnsTotal || 0) + total);
      const receivedLines = localPo.lines.map((pl) => ({ itemId: pl.itemId, quantity: (localPo.receivedQty || {})[pl.itemId] || 0 }));
      opId = `createPR-${retRef.id}-${Date.now()}`;
      registerTradeOp({
        id: opId,
        addedPurchaseReturns: [draftRet],
        purchasePatches: {
          [purchaseId]: {
            returnedQty: returned,
            returnsTotal,
            returnStatus: returnStatusFor(receivedLines.filter((l) => l.quantity > 0), returned),
            paymentStatus: moneyPosition({ ...localPo, returnsTotal }).status,
            updatedAt: now,
          },
        },
      });
      registerOptimisticOp({ id: opId, itemPatches, movements: movs });
    }

    try {
      const savedRet = await runTransaction(db, async (tx) => {
        // ---- reads
        const snap = await tx.get(poRef);
        if (!snap.exists()) throw new Error('Purchase order not found.');
        const po = snap.data() as Purchase;
        if (po.status !== 'partly_received' && po.status !== 'received') {
          throw new Error('Nothing has been received on this order yet.');
        }
        const counter = await readCounter(tx, 'purchase_return');
        const itemMap = await readItems(tx, lines.map((l) => l.itemId));

        const returned = { ...(po.returnedQty || {}) };
        const retLines: TradeReturnLine[] = lines.map((l) => {
          const pl = po.lines.find((x) => x.itemId === l.itemId);
          if (!pl) throw new Error('That item is not on this order.');
          const got = (po.receivedQty || {})[l.itemId] || 0;
          const already = returned[l.itemId] || 0;
          const left = round2(got - already);
          if (Number(l.quantity) > left + 1e-9) {
            throw new Error(`${pl.itemName}: only ${left} ${pl.unit} can be returned (received ${got}, already returned ${already}).`);
          }
          const entry = itemMap.get(l.itemId)!;
          if (!entry.item) throw new Error(`${pl.itemName} is no longer in inventory.`);
          const onHand = getItemQuantity(entry.item);
          if (Number(l.quantity) > onHand + 1e-9) {
            throw new Error(`${pl.itemName}: only ${onHand} ${pl.unit} in stock now, so you can't return ${l.quantity}.`);
          }
          returned[l.itemId] = round2(already + Number(l.quantity));
          return {
            itemId: pl.itemId,
            itemName: pl.itemName,
            unit: pl.unit,
            quantity: Number(l.quantity),
            rate: pl.rate,
            discountPct: 0,
            gstPct: pl.gstPct,
            ...calcLine({ quantity: l.quantity, rate: pl.rate, gstPct: pl.gstPct }),
          };
        });
        const total = sumLines(retLines).grandTotal;
        const returnNumber = docNumber('PR', counter.next);

        // ---- writes
        writeCounter(tx, counter);
        for (const rl of retLines) {
          const entry = itemMap.get(rl.itemId)!;
          const prev = getItemQuantity(entry.item!);
          const nextQty = round2(prev - rl.quantity);
          tx.update(entry.ref, {
            quantity: nextQty,
            updatedAt: now,
            lastUpdatedBy: realUserName,
            lastMovementType: 'out',
            lastMovementReason: `Purchase return ${returnNumber}`,
          });
          movement(
            tx,
            entry.item!,
            'out',
            rl.quantity,
            prev,
            nextQty,
            `Purchase return ${returnNumber} to ${po.supplier.name} against ${po.poNumber}`,
            retRef.id,
            now,
            movRefs.get(rl.itemId)
          );
        }
        const ret: PurchaseReturn = removeUndefinedFields({
          id: retRef.id,
          returnNumber,
          purchaseId: po.id,
          poNumber: po.poNumber,
          supplierName: po.supplier.name,
          lines: retLines,
          total,
          reason: input.reason.trim(),
          vehicleNumber: input.vehicleNumber?.trim() || undefined,
          date: input.date,
          notes: input.notes?.trim() || undefined,
          createdBy: realUserUid,
          createdByName: realUserName,
          createdAt: now,
        });
        tx.set(retRef, ret);
        const returnsTotal = round2((po.returnsTotal || 0) + total);
        const receivedLines = po.lines.map((pl) => ({ itemId: pl.itemId, quantity: (po.receivedQty || {})[pl.itemId] || 0 }));
        tx.update(poRef, {
          returnedQty: returned,
          returnsTotal,
          returnStatus: returnStatusFor(receivedLines.filter((l) => l.quantity > 0), returned),
          paymentStatus: moneyPosition({ ...po, returnsTotal }).status,
          updatedAt: now,
        });
        return ret;
      });
      if (opId) {
        confirmTradeOp(opId, { addedPurchaseReturns: [savedRet] });
        confirmOptimisticOp(opId);
      }
      return savedRet;
    } catch (err) {
      if (opId) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
      }
      throw friendly(err, 'The return could not be saved.');
    }
  };

  const editPurchaseReturn: TradeContextType['editPurchaseReturn'] = async (returnId, input) => {
    assertOnline();
    if (!permissions.canEditPurchaseReturn) throw new Error('Your role is not allowed to edit purchase returns.');
    const lines = input.lines.filter((l) => Number(l.quantity) > 0);
    if (!lines.length) throw new Error('Enter a return quantity for at least one item.');
    ensureUniqueLines(lines);
    if (!input.reason?.trim()) throw new Error('Choose a reason for the return.');

    const retRef = doc(db, 'purchase_returns', returnId);
    const now = new Date().toISOString();
    const localOldRet = purchaseReturnsRef.current.find((r) => r.id === returnId);
    const localPo = localOldRet ? purchasesRef.current.find((p) => p.id === localOldRet.purchaseId) : undefined;
    const movRefs = new Map<string, DocumentReference>();
    let opId: string | null = null;

    if (localOldRet && localPo) {
      const allItemIds = Array.from(new Set([...localOldRet.lines.map((l) => l.itemId), ...lines.map((l) => l.itemId)]));
      const otherReturned: Record<string, number> = { ...(localPo.returnedQty || {}) };
      for (const ol of localOldRet.lines) {
        otherReturned[ol.itemId] = Math.max(0, round2((otherReturned[ol.itemId] || 0) - ol.quantity));
      }
      const newReturned: Record<string, number> = { ...otherReturned };
      const retLines: TradeReturnLine[] = lines.map((l) => {
        const pl = localPo.lines.find((x) => x.itemId === l.itemId);
        if (!pl) throw new Error('That item is not on this purchase order.');
        const received = (localPo.receivedQty || {})[l.itemId] || 0;
        const otherRet = otherReturned[l.itemId] || 0;
        const maxLeft = round2(received - otherRet);
        if (Number(l.quantity) > maxLeft + 1e-9) {
          throw new Error(`${pl.itemName}: only ${maxLeft} ${pl.unit} can be returned (received ${received}, other returns ${otherRet}).`);
        }
        newReturned[l.itemId] = round2(otherRet + Number(l.quantity));
        return {
          itemId: pl.itemId,
          itemName: pl.itemName,
          unit: pl.unit,
          quantity: Number(l.quantity),
          rate: pl.rate,
          discountPct: 0,
          gstPct: pl.gstPct,
          ...calcLine({ quantity: l.quantity, rate: pl.rate, gstPct: pl.gstPct }),
        };
      });
      const total = sumLines(retLines).grandTotal;
      const itemPatches: Record<string, Partial<InventoryItem>> = {};
      const movs: StockMovement[] = [];
      for (const itemId of allItemIds) {
        const oldQty = localOldRet.lines.find((l) => l.itemId === itemId)?.quantity || 0;
        const newQty = retLines.find((l) => l.itemId === itemId)?.quantity || 0;
        const deltaDeduction = round2(newQty - oldQty);
        if (deltaDeduction !== 0) {
          const it = itemsRef.current.find((i) => i.id === itemId);
          if (it) {
            const prev = getItemQuantity(it);
            const next = round2(prev - deltaDeduction);
            if (next < 0) {
              throw new Error(`Cannot update return: increasing return of ${it.name} requires ${deltaDeduction} units, but stock only has ${prev} ${it.unit}.`);
            }
            const mRef = doc(collection(db, 'movements'));
            movRefs.set(itemId, mRef);
            itemPatches[it.id] = {
              quantity: next,
              updatedAt: now,
              lastUpdatedBy: realUserName,
            };
            movs.push({
              id: mRef.id,
              itemId: it.id,
              itemName: it.name,
              type: deltaDeduction > 0 ? 'out' : 'in',
              quantity: Math.abs(deltaDeduction),
              previousQuantity: prev,
              newQuantity: next,
              reason: `Edited purchase return ${localOldRet.returnNumber} to ${localPo.supplier.name}`,
              referenceId: localOldRet.id,
              performedBy: realUserUid,
              performedByName: realUserName,
              timestamp: now,
            });
          }
        }
      }
      const updatedRet: PurchaseReturn = removeUndefinedFields({
        ...localOldRet,
        lines: retLines,
        total,
        reason: input.reason.trim(),
        vehicleNumber: input.vehicleNumber?.trim() || undefined,
        date: input.date || localOldRet.date,
        notes: input.notes?.trim() || undefined,
        updatedAt: now,
        updatedBy: realUserUid,
        updatedByName: realUserName,
      });
      const newReturnsTotal = round2(Math.max(0, (localPo.returnsTotal || 0) - localOldRet.total + total));
      const receivedLines = localPo.lines.map((pl) => ({ itemId: pl.itemId, quantity: (localPo.receivedQty || {})[pl.itemId] || 0 }));
      opId = `editPR-${returnId}-${Date.now()}`;
      registerTradeOp({
        id: opId,
        purchaseReturnPatches: { [returnId]: updatedRet },
        purchasePatches: {
          [localPo.id]: {
            returnedQty: newReturned,
            returnsTotal: newReturnsTotal,
            returnStatus: returnStatusFor(receivedLines.filter((l) => l.quantity > 0), newReturned),
            paymentStatus: moneyPosition({ ...localPo, returnsTotal: newReturnsTotal }).status,
            updatedAt: now,
          },
        },
      });
      if (Object.keys(itemPatches).length > 0) {
        registerOptimisticOp({ id: opId, itemPatches, movements: movs });
      }
    }

    try {
      const updated = await runTransaction(db, async (tx) => {
        const retSnap = await tx.get(retRef);
        if (!retSnap.exists()) throw new Error('Purchase return not found.');
        const oldRet = retSnap.data() as PurchaseReturn;

        const poRef = doc(db, 'purchases', oldRet.purchaseId);
        const poSnap = await tx.get(poRef);
        if (!poSnap.exists()) throw new Error('Original purchase order not found. You can delete this return instead.');
        const po = poSnap.data() as Purchase;

        const allItemIds = Array.from(new Set([...oldRet.lines.map((l) => l.itemId), ...lines.map((l) => l.itemId)]));
        const itemMap = await readItems(tx, allItemIds);

        const otherReturned: Record<string, number> = { ...(po.returnedQty || {}) };
        for (const ol of oldRet.lines) {
          otherReturned[ol.itemId] = Math.max(0, round2((otherReturned[ol.itemId] || 0) - ol.quantity));
        }

        const newReturned: Record<string, number> = { ...otherReturned };
        const retLines: TradeReturnLine[] = lines.map((l) => {
          const pl = po.lines.find((x) => x.itemId === l.itemId);
          if (!pl) throw new Error('That item is not on this purchase order.');
          const received = (po.receivedQty || {})[l.itemId] || 0;
          const otherRet = otherReturned[l.itemId] || 0;
          const maxLeft = round2(received - otherRet);
          if (Number(l.quantity) > maxLeft + 1e-9) {
            throw new Error(`${pl.itemName}: only ${maxLeft} ${pl.unit} can be returned (received ${received}, other returns ${otherRet}).`);
          }
          newReturned[l.itemId] = round2(otherRet + Number(l.quantity));
          return {
            itemId: pl.itemId,
            itemName: pl.itemName,
            unit: pl.unit,
            quantity: Number(l.quantity),
            rate: pl.rate,
            discountPct: 0,
            gstPct: pl.gstPct,
            ...calcLine({ quantity: l.quantity, rate: pl.rate, gstPct: pl.gstPct }),
          };
        });

        const total = sumLines(retLines).grandTotal;

        for (const itemId of allItemIds) {
          const oldQty = oldRet.lines.find((l) => l.itemId === itemId)?.quantity || 0;
          const newQty = retLines.find((l) => l.itemId === itemId)?.quantity || 0;
          const deltaDeduction = round2(newQty - oldQty);
          if (deltaDeduction !== 0) {
            const entry = itemMap.get(itemId);
            if (entry && entry.item) {
              const prev = getItemQuantity(entry.item);
              const next = round2(prev - deltaDeduction);
              if (next < 0) {
                throw new Error(`Cannot update return: increasing return of ${entry.item.name} requires ${deltaDeduction} units, but stock only has ${prev} ${entry.item.unit}.`);
              }
              tx.update(entry.ref, {
                quantity: next,
                updatedAt: now,
                lastUpdatedBy: realUserName,
                lastMovementType: deltaDeduction > 0 ? 'out' : 'in',
                lastMovementReason: `Edited purchase return ${oldRet.returnNumber}`,
              });
              movement(
                tx,
                entry.item,
                deltaDeduction > 0 ? 'out' : 'in',
                Math.abs(deltaDeduction),
                prev,
                next,
                `Edited purchase return ${oldRet.returnNumber} to ${po.supplier.name}`,
                oldRet.id,
                now,
                movRefs.get(itemId)
              );
            }
          }
        }

        const updatedRet: PurchaseReturn = removeUndefinedFields({
          ...oldRet,
          lines: retLines,
          total,
          reason: input.reason.trim(),
          vehicleNumber: input.vehicleNumber?.trim() || undefined,
          date: input.date || oldRet.date,
          notes: input.notes?.trim() || undefined,
          updatedAt: now,
          updatedBy: realUserUid,
          updatedByName: realUserName,
        });
        tx.set(retRef, updatedRet);

        const newReturnsTotal = round2(Math.max(0, (po.returnsTotal || 0) - oldRet.total + total));
        const receivedLines = po.lines.map((pl) => ({ itemId: pl.itemId, quantity: (po.receivedQty || {})[pl.itemId] || 0 }));
        tx.update(poRef, {
          returnedQty: newReturned,
          returnsTotal: newReturnsTotal,
          returnStatus: returnStatusFor(receivedLines.filter((l) => l.quantity > 0), newReturned),
          paymentStatus: moneyPosition({ ...po, returnsTotal: newReturnsTotal }).status,
          updatedAt: now,
        });

        return updatedRet;
      });
      if (opId) {
        confirmTradeOp(opId, { purchaseReturnPatches: { [returnId]: updated } });
        confirmOptimisticOp(opId);
      }
      return updated;
    } catch (err) {
      if (opId) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
      }
      throw friendly(err, 'The purchase return could not be updated.');
    }
  };

  const deletePurchaseReturn: TradeContextType['deletePurchaseReturn'] = async (returnId, reason) => {
    assertOnline();
    if (!permissions.canDeletePurchaseReturn) throw new Error('Your role is not allowed to delete purchase returns.');
    const retRef = doc(db, 'purchase_returns', returnId);
    const now = new Date().toISOString();
    const localRet = purchaseReturnsRef.current.find((r) => r.id === returnId);
    const localPo = localRet?.purchaseId ? purchasesRef.current.find((p) => p.id === localRet.purchaseId) : undefined;
    const movRefs = new Map<string, DocumentReference>();
    let opId: string | null = null;

    if (localRet) {
      const itemPatches: Record<string, Partial<InventoryItem>> = {};
      const movs: StockMovement[] = [];
      for (const line of localRet.lines) {
        const it = itemsRef.current.find((i) => i.id === line.itemId);
        if (!it) continue;
        const prev = getItemQuantity(it);
        const next = round2(prev + line.quantity);
        const mRef = doc(collection(db, 'movements'));
        movRefs.set(line.itemId, mRef);
        itemPatches[it.id] = {
          quantity: next,
          updatedAt: now,
          lastUpdatedBy: realUserName,
        };
        movs.push({
          id: mRef.id,
          itemId: it.id,
          itemName: it.name,
          type: 'in',
          quantity: line.quantity,
          previousQuantity: prev,
          newQuantity: next,
          reason: `Deleted purchase return ${localRet.returnNumber}: stock restored`,
          referenceId: localRet.id,
          performedBy: realUserUid,
          performedByName: realUserName,
          timestamp: now,
        });
      }
      const purchasePatches: Record<string, Partial<Purchase>> = {};
      if (localPo) {
        const newReturned: Record<string, number> = { ...(localPo.returnedQty || {}) };
        for (const line of localRet.lines) {
          newReturned[line.itemId] = Math.max(0, round2((newReturned[line.itemId] || 0) - line.quantity));
        }
        const newReturnsTotal = Math.max(0, round2((localPo.returnsTotal || 0) - localRet.total));
        const receivedLines = localPo.lines.map((pl) => ({ itemId: pl.itemId, quantity: (localPo.receivedQty || {})[pl.itemId] || 0 }));
        purchasePatches[localPo.id] = {
          returnedQty: newReturned,
          returnsTotal: newReturnsTotal,
          returnStatus: returnStatusFor(receivedLines.filter((l) => l.quantity > 0), newReturned),
          paymentStatus: moneyPosition({ ...localPo, returnsTotal: newReturnsTotal }).status,
          updatedAt: now,
        };
      }
      opId = `delPR-${returnId}-${Date.now()}`;
      registerTradeOp({ id: opId, deletedPurchaseReturnIds: [returnId], purchasePatches });
      if (Object.keys(itemPatches).length > 0) {
        registerOptimisticOp({ id: opId, itemPatches, movements: movs });
      }
    }

    try {
      await runTransaction(db, async (tx) => {
        const retSnap = await tx.get(retRef);
        if (!retSnap.exists()) throw new Error('Purchase return not found.');
        const ret = retSnap.data() as PurchaseReturn;

        const poRef = ret.purchaseId ? doc(db, 'purchases', ret.purchaseId) : null;
        const poSnap = poRef ? await tx.get(poRef) : null;
        const po = poSnap && poSnap.exists() ? (poSnap.data() as Purchase) : null;

        const itemMap = await readItems(tx, ret.lines.map((l) => l.itemId));

        for (const line of ret.lines) {
          const entry = itemMap.get(line.itemId);
          if (entry && entry.item) {
            const prev = getItemQuantity(entry.item);
            const next = round2(prev + line.quantity);
            tx.update(entry.ref, {
              quantity: next,
              updatedAt: now,
              lastUpdatedBy: realUserName,
              lastMovementType: 'in',
              lastMovementReason: `Deleted purchase return ${ret.returnNumber} (${reason || 'Return cancelled'})`,
            });
            movement(
              tx,
              entry.item,
              'in',
              line.quantity,
              prev,
              next,
              `Deleted purchase return ${ret.returnNumber}: stock restored`,
              ret.id,
              now,
              movRefs.get(line.itemId)
            );
          }
        }

        if (po && poRef) {
          const newReturned: Record<string, number> = { ...(po.returnedQty || {}) };
          for (const line of ret.lines) {
            newReturned[line.itemId] = Math.max(0, round2((newReturned[line.itemId] || 0) - line.quantity));
          }
          const newReturnsTotal = Math.max(0, round2((po.returnsTotal || 0) - ret.total));
          const receivedLines = po.lines.map((pl) => ({ itemId: pl.itemId, quantity: (po.receivedQty || {})[pl.itemId] || 0 }));

          tx.update(poRef, {
            returnedQty: newReturned,
            returnsTotal: newReturnsTotal,
            returnStatus: returnStatusFor(receivedLines.filter((l) => l.quantity > 0), newReturned),
            paymentStatus: moneyPosition({ ...po, returnsTotal: newReturnsTotal }).status,
            updatedAt: now,
          });
        }

        tx.delete(retRef);
      });
      if (opId) {
        confirmTradeOp(opId);
        confirmOptimisticOp(opId);
      }
    } catch (err) {
      if (opId) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
      }
      throw friendly(err, 'The purchase return could not be deleted.');
    }
  };

  // =========================================================================
  // BATTERY CHECKS
  // =========================================================================
  const createBatteryCheck: TradeContextType['createBatteryCheck'] = async (input) => {
    assertOnline();
    if (!permissions.canCreateSalesReturn) {
      throw new Error('Your role is not allowed to record battery checks.');
    }
    const partyName = input.partyName.trim();
    if (!partyName) throw new Error('Customer name is required.');
    const problem = input.problem.trim();
    if (!problem) throw new Error('Describe the problem.');
    const qty = Number(input.quantity);
    if (!(qty > 0)) throw new Error('Quantity must be more than 0.');
    const item = itemsRef.current.find((i) => i.id === input.itemId);
    if (!item) throw new Error('Select a battery item.');

    const checkRef = doc(collection(db, 'battery_checks'));
    const receivedAt =
      input.receivedAt === todayISODate()
        ? new Date().toISOString()
        : `${input.receivedAt || todayISODate()}T12:00:00.000Z`;

    const draft: BatteryCheck = removeUndefinedFields({
      id: checkRef.id,
      partyName,
      partyPhone: (input.partyPhone || '').trim(),
      itemId: item.id,
      itemName: item.name,
      quantity: round2(qty),
      serial: input.serial?.trim() || undefined,
      problem,
      receivedAt,
      status: 'checking',
      createdBy: realUserUid,
      createdByName: realUserName,
    });

    const opId = `createBC-${checkRef.id}-${Date.now()}`;
    registerTradeOp({ id: opId, addedBatteryChecks: [draft] });

    try {
      await runTransaction(db, async (tx) => {
        tx.set(checkRef, draft);
      });
      confirmTradeOp(opId, { addedBatteryChecks: [draft] });
      return draft;
    } catch (err) {
      revertTradeOp(opId);
      throw friendly(err, 'Could not save battery check.');
    }
  };

  const resolveBatteryCheck: TradeContextType['resolveBatteryCheck'] = async (checkId, input) => {
    assertOnline();
    if (!permissions.canCreateSalesReturn) {
      throw new Error('Your role is not allowed to resolve battery checks.');
    }
    const localCheck = batteryChecksRef.current.find((b) => b.id === checkId);
    if (!localCheck) throw new Error('Battery check record not found.');
    if (localCheck.status !== 'checking') throw new Error('This battery check is already resolved.');

    const checkRef = doc(db, 'battery_checks', checkId);
    const resolvedAt = new Date().toISOString();
    const cleanNote = input.resultNote?.trim() || undefined;

    if (input.outcome === 'ok_returned' || input.outcome === 'repaired_returned') {
      const updatedLocal: BatteryCheck = removeUndefinedFields({
        ...localCheck,
        status: input.outcome,
        resultNote: cleanNote,
        resolvedAt,
        resolvedBy: realUserUid,
        resolvedByName: realUserName,
      });
      const opId = `resolveBC-${checkId}-${Date.now()}`;
      registerTradeOp({ id: opId, batteryCheckPatches: { [checkId]: updatedLocal } });
      try {
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(checkRef);
          if (!snap.exists()) throw new Error('Battery check not found.');
          const cur = snap.data() as BatteryCheck;
          if (cur.status !== 'checking') throw new Error('This battery check is already resolved.');
          tx.update(
            checkRef,
            removeUndefinedFields({
              status: input.outcome,
              resultNote: cleanNote || null,
              resolvedAt,
              resolvedBy: realUserUid,
              resolvedByName: realUserName,
            })
          );
        });
        confirmTradeOp(opId, { batteryCheckPatches: { [checkId]: updatedLocal } });
        return updatedLocal;
      } catch (err) {
        revertTradeOp(opId);
        throw friendly(err, 'Could not save battery check result.');
      }
    }

    if (input.outcome === 'replaced') {
      const localItem = itemsRef.current.find((i) => i.id === localCheck.itemId);
      if (!localItem) throw new Error(`${localCheck.itemName} was not found in inventory.`);
      const localOnHand = getItemQuantity(localItem);
      if (localOnHand < localCheck.quantity) {
        throw new Error(`Only ${localOnHand} ${localItem.unit} of ${localItem.name} in stock.`);
      }
      const nextQty = round2(localOnHand - localCheck.quantity);
      const mRef = doc(collection(db, 'movements'));
      const reason = `Warranty replacement · ${localCheck.partyName}`;
      const updatedLocal: BatteryCheck = removeUndefinedFields({
        ...localCheck,
        status: 'replaced',
        resultNote: cleanNote,
        resolvedAt,
        resolvedBy: realUserUid,
        resolvedByName: realUserName,
      });

      const opId = `replaceBC-${checkId}-${Date.now()}`;
      registerTradeOp({ id: opId, batteryCheckPatches: { [checkId]: updatedLocal } });
      registerOptimisticOp({
        id: opId,
        itemPatches: {
          [localItem.id]: {
            quantity: nextQty,
            updatedAt: resolvedAt,
            lastUpdatedBy: realUserName,
          },
        },
        movements: [
          {
            id: mRef.id,
            itemId: localItem.id,
            itemName: localItem.name,
            type: 'out',
            quantity: localCheck.quantity,
            previousQuantity: localOnHand,
            newQuantity: nextQty,
            reason,
            referenceId: checkId,
            performedBy: realUserUid,
            performedByName: realUserName,
            timestamp: resolvedAt,
          },
        ],
      });

      try {
        await runTransaction(db, async (tx) => {
          const checkSnap = await tx.get(checkRef);
          if (!checkSnap.exists()) throw new Error('Battery check not found.');
          const curCheck = checkSnap.data() as BatteryCheck;
          if (curCheck.status !== 'checking') throw new Error('This battery check is already resolved.');

          const itemRef = doc(db, 'items', curCheck.itemId);
          const itemSnap = await tx.get(itemRef);
          if (!itemSnap.exists()) throw new Error(`${curCheck.itemName} was not found in inventory.`);
          const itemData = itemSnap.data() as InventoryItem;
          const onHand = getItemQuantity(itemData);
          if (onHand < curCheck.quantity) {
            throw new Error(`Only ${onHand} ${itemData.unit} of ${itemData.name} in stock.`);
          }
          const next = round2(onHand - curCheck.quantity);
          tx.update(itemRef, {
            quantity: next,
            updatedAt: resolvedAt,
            lastUpdatedBy: realUserName,
            lastMovementType: 'out',
            lastMovementReason: reason,
          });
          movement(
            tx,
            itemData,
            'out',
            curCheck.quantity,
            onHand,
            next,
            reason,
            checkId,
            resolvedAt,
            mRef
          );
          tx.update(
            checkRef,
            removeUndefinedFields({
              status: 'replaced',
              resultNote: cleanNote || null,
              resolvedAt,
              resolvedBy: realUserUid,
              resolvedByName: realUserName,
            })
          );
        });
        confirmTradeOp(opId, { batteryCheckPatches: { [checkId]: updatedLocal } });
        confirmOptimisticOp(opId);
        return updatedLocal;
      } catch (err) {
        revertTradeOp(opId);
        revertOptimisticOp(opId);
        throw friendly(err, 'Could not replace battery.');
      }
    }

    // Outcome: 'taken_back' -> createSalesReturn on party's NEWEST eligible invoices with damaged condition
    const partyKey = getCustomerKey({ name: localCheck.partyName, phone: localCheck.partyPhone });
    const cleanPartyName = localCheck.partyName.trim().toLowerCase();
    const partySales = salesRef.current
      .filter((s) => {
        if (s.status === 'cancelled') return false;
        const sk = getCustomerKey(s.customer);
        if (sk === partyKey) return true;
        return (s.customer?.name || '').trim().toLowerCase() === cleanPartyName;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const splits: { sale: Sale; qty: number }[] = [];
    let remaining = round2(localCheck.quantity);
    for (const s of partySales) {
      if (remaining <= 1e-9) break;
      const sl = s.lines.find((l) => l.itemId === localCheck.itemId);
      if (!sl) continue;
      const alreadyRet = Number((s.returnedQty || {})[localCheck.itemId] || 0);
      const avail = Math.max(0, round2(sl.quantity - alreadyRet));
      if (avail <= 0) continue;
      const take = Math.min(remaining, avail);
      splits.push({ sale: s, qty: round2(take) });
      remaining = round2(remaining - take);
    }

    if (remaining > 1e-9) {
      const availTotal = round2(localCheck.quantity - remaining);
      throw new Error(
        `This customer only has ${availTotal} returnable ${localCheck.itemName} across active bills (need ${localCheck.quantity}).`
      );
    }

    const retReason = cleanNote || `Battery check: ${localCheck.problem}`;
    const today = todayISODate();
    let totalCredit = 0;
    const linkedSaleIds: string[] = [];

    for (const sp of splits) {
      const createdRet = await createSalesReturn(sp.sale.id, {
        lines: [{ itemId: localCheck.itemId, quantity: sp.qty }],
        reason: retReason,
        condition: 'damaged',
        date: today,
        notes: cleanNote,
      });
      totalCredit = round2(totalCredit + createdRet.total);
      if (!linkedSaleIds.includes(sp.sale.id)) linkedSaleIds.push(sp.sale.id);
    }

    const updatedLocal: BatteryCheck = removeUndefinedFields({
      ...localCheck,
      status: 'taken_back',
      resultNote: cleanNote,
      resolvedAt,
      resolvedBy: realUserUid,
      resolvedByName: realUserName,
      linkedSaleIds,
      creditAmount: totalCredit,
    });

    const opId = `takeBackBC-${checkId}-${Date.now()}`;
    registerTradeOp({ id: opId, batteryCheckPatches: { [checkId]: updatedLocal } });

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(checkRef);
        if (!snap.exists()) throw new Error('Battery check not found.');
        tx.update(
          checkRef,
          removeUndefinedFields({
            status: 'taken_back',
            resultNote: cleanNote || null,
            resolvedAt,
            resolvedBy: realUserUid,
            resolvedByName: realUserName,
            linkedSaleIds,
            creditAmount: totalCredit,
          })
        );
      });
      confirmTradeOp(opId, { batteryCheckPatches: { [checkId]: updatedLocal } });
      return updatedLocal;
    } catch (err) {
      revertTradeOp(opId);
      throw friendly(err, 'Credit note saved, but could not update battery check status.');
    }
  };

  return (
    <TradeContext.Provider
      value={{
        sales,
        salesReturns,
        batteryChecks,
        customerAdvances,
        purchases,
        purchaseReturns,
        hasMoreSales: rawSales.length >= salesLimit,
        hasMorePurchases: rawPurchases.length >= purchasesLimit,
        loadMoreSales,
        loadMorePurchases,
        openSalesCount,
        openPurchaseCount,
        customers,
        suppliers,
        tradeError,
        createSale,
        editSale,
        deleteSale,
        cancelSale,
        recordSalePayment: (id, p) => recordSaleMoney(id, p, 'payment'),
        editSalePayment,
        deleteSalePayment,
        recordSaleRefund: (id, p) => recordSaleMoney(id, p, 'refund'),
        createCustomerAdvance,
        editCustomerAdvance,
        deleteCustomerAdvance,
        applyCustomerAdvanceToSale,
        createSalesReturn,
        editSalesReturn,
        deleteSalesReturn,
        createBatteryCheck,
        resolveBatteryCheck,
        createPurchase,
        editPurchase,
        deletePurchase,
        cancelPurchase,
        receivePurchase,
        recordPurchasePayment: (id, p) => recordPurchaseMoney(id, p, 'payment'),
        recordPurchaseRefund: (id, p) => recordPurchaseMoney(id, p, 'refund'),
        createPurchaseReturn,
        editPurchaseReturn,
        deletePurchaseReturn,
      }}
    >
      {children}
    </TradeContext.Provider>
  );
};

export const useTrade = () => {
  const ctx = useContext(TradeContext);
  if (!ctx) throw new Error('useTrade must be used within a TradeProvider');
  return ctx;
};

