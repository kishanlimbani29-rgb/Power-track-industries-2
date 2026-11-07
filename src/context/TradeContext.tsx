import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  collection,
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
import {
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
import {
  calcLine,
  docNumber,
  moneyPosition,
  newId,
  round2,
  sumLines,
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

interface TradeContextType {
  sales: Sale[];
  salesReturns: SalesReturn[];
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

  createSale: (input: NewSaleInput) => Promise<Sale>;
  editSale: (saleId: string, input: NewSaleInput) => Promise<Sale>;
  deleteSale: (saleId: string, reason?: string) => Promise<void>;
  setSaleStatus: (saleId: string, next: 'dispatched' | 'delivered') => Promise<void>;
  cancelSale: (saleId: string, reason: string) => Promise<void>;
  recordSalePayment: (saleId: string, p: PaymentInput) => Promise<void>;
  recordSaleRefund: (saleId: string, p: PaymentInput) => Promise<void>;
  createSalesReturn: (
    saleId: string,
    input: { lines: QtyLineInput[]; reason: string; condition: SalesReturnCondition; date: string; notes?: string }
  ) => Promise<SalesReturn>;
  editSalesReturn: (
    returnId: string,
    input: { lines: QtyLineInput[]; reason: string; condition: SalesReturnCondition; date: string; notes?: string }
  ) => Promise<SalesReturn>;
  deleteSalesReturn: (returnId: string, reason?: string) => Promise<void>;

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
  const { items } = useInventory();

  const [sales, setSales] = useState<Sale[]>([]);
  const [salesReturns, setSalesReturns] = useState<SalesReturn[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [salesLimit, setSalesLimit] = useState(100);
  const [purchasesLimit, setPurchasesLimit] = useState(100);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const canSeeSales = permissions.canViewSalesOption;
  const canSeePurchases = permissions.canViewPurchaseOption || permissions.canReceivePurchase;
  const active = Boolean(currentUser && profile && profile.status === 'active');

  // Listeners: only for active users who are allowed to see the data
  useEffect(() => {
    if (!active || !canSeeSales) {
      setSales([]);
      setSalesReturns([]);
      return;
    }
    const onErr = (label: string) => (e: any) => {
      console.warn(`${label} listener error:`, e?.message || e);
      setTradeError(`Can't load ${label.toLowerCase()} – you may not have access.`);
    };
    const u1 = onSnapshot(
      query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(salesLimit)),
      (snap) => {
        const list: Sale[] = [];
        snap.forEach((d) => list.push(d.data() as Sale));
        setSales(list);
        setTradeError(null);
      },
      onErr('Sales')
    );
    const u2 = onSnapshot(
      query(collection(db, 'sales_returns'), orderBy('createdAt', 'desc'), limit(300)),
      (snap) => {
        const list: SalesReturn[] = [];
        snap.forEach((d) => list.push(d.data() as SalesReturn));
        setSalesReturns(list);
      },
      onErr('Sales returns')
    );
    return () => {
      u1();
      u2();
    };
  }, [active, canSeeSales, salesLimit, role]);

  useEffect(() => {
    if (!active || !canSeePurchases) {
      setPurchases([]);
      setPurchaseReturns([]);
      return;
    }
    const onErr = (label: string) => (e: any) => {
      console.warn(`${label} listener error:`, e?.message || e);
      setTradeError(`Can't load ${label.toLowerCase()} – you may not have access.`);
    };
    const u1 = onSnapshot(
      query(collection(db, 'purchases'), orderBy('createdAt', 'desc'), limit(purchasesLimit)),
      (snap) => {
        const list: Purchase[] = [];
        snap.forEach((d) => list.push(d.data() as Purchase));
        setPurchases(list);
        setTradeError(null);
      },
      onErr('Purchases')
    );
    let u2 = () => {};
    if (permissions.canViewPurchaseOption) {
      u2 = onSnapshot(
        query(collection(db, 'purchase_returns'), orderBy('createdAt', 'desc'), limit(300)),
        (snap) => {
          const list: PurchaseReturn[] = [];
          snap.forEach((d) => list.push(d.data() as PurchaseReturn));
          setPurchaseReturns(list);
        },
        onErr('Purchase returns')
      );
    }
    return () => {
      u1();
      u2();
    };
  }, [active, canSeePurchases, permissions.canViewPurchaseOption, purchasesLimit, role]);

  const loadMoreSales = useCallback(() => setSalesLimit((n) => n + 100), []);
  const loadMorePurchases = useCallback(() => setPurchasesLimit((n) => n + 100), []);

  const openSalesCount = useMemo(
    () => sales.filter((s) => s.status === 'confirmed' || s.status === 'dispatched').length,
    [sales]
  );
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

  const itemName = (id: string) => items.find((i) => i.id === id)?.name || 'Item';

  const movement = (
    tx: Transaction,
    item: InventoryItem,
    type: 'in' | 'out',
    qty: number,
    prev: number,
    next: number,
    reason: string,
    referenceId: string,
    now: string
  ) => {
    const ref = doc(collection(db, 'movements'));
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
  const createSale = async (input: NewSaleInput): Promise<Sale> => {
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
    try {
      return await runTransaction(db, async (tx) => {
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
          movement(tx, entry.item!, 'out', line.quantity, prev, next, `Sale ${invoiceNumber} to ${customerName}`, saleRef.id, now);
        }
        const sale: Sale = removeUndefinedFields({
          id: saleRef.id,
          invoiceNumber,
          status: 'confirmed',
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
        });
        tx.set(saleRef, sale);
        return sale;
      });
    } catch (err) {
      throw friendly(err, 'The sale could not be saved.');
    }
  };

  const setSaleStatus = async (saleId: string, next: 'dispatched' | 'delivered') => {
    assertOnline();
    if (!permissions.canCreateSales) throw new Error('Your role is not allowed to change sales.');
    const ref = doc(db, 'sales', saleId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        const ok =
          (sale.status === 'confirmed' && (next === 'dispatched' || next === 'delivered')) ||
          (sale.status === 'dispatched' && next === 'delivered');
        if (!ok) throw new Error(`This sale is already ${sale.status}.`);
        const now = new Date().toISOString();
        const upd: Record<string, any> = { status: next, updatedAt: now };
        if (next === 'dispatched') upd.dispatchedAt = now;
        if (next === 'delivered') upd.deliveredAt = now;
        tx.update(ref, upd);
      });
    } catch (err) {
      throw friendly(err, 'Status could not be updated.');
    }
  };

  const cancelSale = async (saleId: string, reason: string) => {
    assertOnline();
    if (!permissions.canCreateSales) throw new Error('Your role is not allowed to cancel sales.');
    const ref = doc(db, 'sales', saleId);
    try {
      await runTransaction(db, async (tx) => {
        // ---- reads
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        if (sale.status === 'cancelled') throw new Error('This sale is already cancelled.');
        if (sale.status === 'delivered') throw new Error('A delivered sale can’t be cancelled. Use Return instead.');
        if ((sale.amountPaid || 0) > 0) throw new Error('A payment is recorded on this sale, so it can’t be cancelled. Use Return instead.');
        if ((sale.returnsTotal || 0) > 0) throw new Error('This sale has returns, so it can’t be cancelled.');
        const itemMap = await readItems(tx, sale.lines.map((l) => l.itemId));
        // ---- writes
        const now = new Date().toISOString();
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
          movement(tx, entry.item, 'in', line.quantity, prev, nextQty, `Cancelled sale ${sale.invoiceNumber}: ${reason || 'Cancelled'}`, sale.id, now);
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
    } catch (err) {
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
    try {
      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(saleRef);
        if (!snap.exists()) throw new Error('Sale not found.');
        const oldSale = snap.data() as Sale;
        if (oldSale.status === 'cancelled') throw new Error('Cancelled sales cannot be edited.');
        if ((oldSale.returnsTotal || 0) > 0 || Object.values(oldSale.returnedQty || {}).some((q) => Number(q) > 0)) {
          throw new Error('This sale already has returns (credit notes), so its items cannot be edited.');
        }

        // Collect all distinct item IDs (both from old lines and new lines)
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

        // Verify stock availability for net increases
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

        // Build new lines
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

        // Adjust stock for all affected items
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
              now
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
    } catch (err) {
      throw friendly(err, 'The sale could not be edited.');
    }
  };

  const deleteSale = async (saleId: string, reason?: string) => {
    assertOnline();
    if (!permissions.canDeleteSales) throw new Error('Your role is not allowed to delete sales.');
    const ref = doc(db, 'sales', saleId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        // Guard: keep invoices that have money or returns against them (GST / audit trail).
        if ((sale.amountPaid || 0) > 0 || (sale.returnsTotal || 0) > 0 || Object.values(sale.returnedQty || {}).some((q) => Number(q) > 0)) {
          throw new Error('This sale has payments or returns, so it cannot be deleted. Cancel it instead so the record stays.');
        }

        if (sale.status !== 'cancelled') {
          const itemMap = await readItems(tx, sale.lines.map((l) => l.itemId));
          const now = new Date().toISOString();
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
                now
              );
            }
          }
        }

        tx.delete(ref);
      });
    } catch (err) {
      throw friendly(err, 'The sale could not be deleted.');
    }
  };

  const recordSaleMoney = async (saleId: string, p: PaymentInput, kind: 'payment' | 'refund') => {
    assertOnline();
    if (!permissions.canRecordPayments) throw new Error('Your role is not allowed to record payments.');
    if (!(Number(p.amount) > 0)) throw new Error('Enter an amount more than 0.');
    const ref = doc(db, 'sales', saleId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        if (sale.status === 'cancelled') throw new Error('This sale is cancelled.');
        const pos = moneyPosition(sale);
        const now = new Date().toISOString();
        if (kind === 'payment') {
          if (p.amount > pos.balance + 0.009) throw new Error(`Only ${pos.balance.toFixed(2)} is due on this sale.`);
          const payments = [...(sale.payments || []), payment(p, now)];
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
          const refunds = [...(sale.refunds || []), payment(p, now)];
          const refundedTotal = round2((sale.refundedTotal || 0) + p.amount);
          tx.update(ref, {
            refunds,
            refundedTotal,
            paymentStatus: moneyPosition({ ...sale, refundedTotal }).status,
            updatedAt: now,
          });
        }
      });
    } catch (err) {
      throw friendly(err, 'The payment could not be saved.');
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
    try {
      return await runTransaction(db, async (tx) => {
        // ---- reads
        const snap = await tx.get(saleRef);
        if (!snap.exists()) throw new Error('Sale not found.');
        const sale = snap.data() as Sale;
        if (sale.status !== 'dispatched' && sale.status !== 'delivered') {
          throw new Error('Returns are only possible after the sale is dispatched or delivered.');
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
        const now = new Date().toISOString();

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
            movement(tx, entry.item, 'in', rl.quantity, prev, nextQty, `Sales return ${returnNumber} against ${sale.invoiceNumber} (${sale.customer.name})`, retRef.id, now);
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
    } catch (err) {
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
    try {
      return await runTransaction(db, async (tx) => {
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
        const now = new Date().toISOString();

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
                now
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
    } catch (err) {
      throw friendly(err, 'The sales return could not be updated.');
    }
  };

  const deleteSalesReturn: TradeContextType['deleteSalesReturn'] = async (returnId, reason) => {
    assertOnline();
    if (!permissions.canDeleteSalesReturn) throw new Error('Your role is not allowed to delete sales returns.');
    const retRef = doc(db, 'sales_returns', returnId);
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
        const now = new Date().toISOString();

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
                now
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
    } catch (err) {
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
    try {
      return await runTransaction(db, async (tx) => {
        const counter = await readCounter(tx, 'purchase');
        const poNumber = docNumber('PO', counter.next);
        const lines: PurchaseLine[] = input.lines.map((l) => {
          const it = items.find((i) => i.id === l.itemId);
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
    } catch (err) {
      throw friendly(err, 'The purchase order could not be saved.');
    }
  };

  const cancelPurchase = async (purchaseId: string, reason: string) => {
    assertOnline();
    if (!permissions.canCreatePurchase) throw new Error('Your role is not allowed to cancel purchase orders.');
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
        const now = new Date().toISOString();
        tx.update(ref, {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: realUserName,
          cancelReason: reason?.trim() || 'Cancelled',
          paymentStatus: 'paid',
          updatedAt: now,
        });
      });
    } catch (err) {
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
    try {
      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Purchase order not found.');
        const po = snap.data() as Purchase;
        if (po.status === 'cancelled') throw new Error('Cancelled purchase orders cannot be edited.');
        if ((po.receipts || []).length > 0) {
          throw new Error('This order has already received goods. Received purchase orders cannot have their items edited.');
        }

        const lines: PurchaseLine[] = input.lines.map((l) => {
          const it = items.find((i) => i.id === l.itemId);
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
    } catch (err) {
      throw friendly(err, 'The purchase order could not be edited.');
    }
  };

  const deletePurchase = async (purchaseId: string, reason?: string) => {
    assertOnline();
    if (!permissions.canDeletePurchase) throw new Error('Your role is not allowed to delete purchase orders.');
    const ref = doc(db, 'purchases', purchaseId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Purchase order not found.');
        const po = snap.data() as Purchase;
        // Guard: never delete an order that already has stock received or money recorded.
        if ((po.receipts || []).length > 0 || Object.values(po.receivedQty || {}).some((q) => Number(q) > 0)) {
          throw new Error('Goods were already received on this order, so it cannot be deleted. Use Purchase Return or Cancel instead.');
        }
        if ((po.amountPaid || 0) > 0) {
          throw new Error('Payments are recorded on this order, so it cannot be deleted. Cancel it instead so the record stays.');
        }

        const totalReceived = Object.values(po.receivedQty || {}).reduce((a, b) => a + Number(b), 0);
        if (totalReceived > 0) {
          const itemMap = await readItems(tx, po.lines.map((l) => l.itemId));
          const now = new Date().toISOString();
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
    } catch (err) {
      throw friendly(err, 'The purchase order could not be deleted.');
    }
  };

  const receivePurchase: TradeContextType['receivePurchase'] = async (purchaseId, input) => {
    assertOnline();
    if (!permissions.canReceivePurchase) throw new Error('Your role is not allowed to receive goods.');
    const lines = input.lines.filter((l) => Number(l.quantity) > 0);
    if (!lines.length) throw new Error('Enter a received quantity for at least one item.');
    ensureUniqueLines(lines);
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
        const now = new Date().toISOString();

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
          movement(tx, entry.item, 'in', rl.quantity, prev, nextQty, `Purchase ${po.poNumber} from ${po.supplier.name}${input.billNumber ? ` (Bill ${input.billNumber})` : ''}`, po.id, now);
        }
        const receipt: PurchaseReceipt = removeUndefinedFields({
          id: newId(),
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
    } catch (err) {
      throw friendly(err, 'The goods could not be received.');
    }
  };

  const recordPurchaseMoney = async (purchaseId: string, p: PaymentInput, kind: 'payment' | 'refund') => {
    assertOnline();
    if (!permissions.canRecordPurchasePayments) throw new Error('Your role is not allowed to record supplier payments.');
    if (!(Number(p.amount) > 0)) throw new Error('Enter an amount more than 0.');
    const ref = doc(db, 'purchases', purchaseId);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('Purchase order not found.');
        const po = snap.data() as Purchase;
        if (po.status === 'cancelled') throw new Error('This order is cancelled.');
        const pos = moneyPosition(po);
        const now = new Date().toISOString();
        if (kind === 'payment') {
          if (p.amount > pos.balance + 0.009) throw new Error(`Only ${pos.balance.toFixed(2)} is payable on this order.`);
          const amountPaid = round2((po.amountPaid || 0) + p.amount);
          tx.update(ref, {
            payments: [...(po.payments || []), payment(p, now)],
            amountPaid,
            paymentStatus: moneyPosition({ ...po, amountPaid }).status,
            updatedAt: now,
          });
        } else {
          const due = -pos.balance;
          if (p.amount > due + 0.009) throw new Error(`Only ${Math.max(0, due).toFixed(2)} refund is due from the supplier.`);
          const refundedTotal = round2((po.refundedTotal || 0) + p.amount);
          tx.update(ref, {
            refunds: [...(po.refunds || []), payment(p, now)],
            refundedTotal,
            paymentStatus: moneyPosition({ ...po, refundedTotal }).status,
            updatedAt: now,
          });
        }
      });
    } catch (err) {
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
    try {
      return await runTransaction(db, async (tx) => {
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
        const now = new Date().toISOString();

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
          movement(tx, entry.item!, 'out', rl.quantity, prev, nextQty, `Purchase return ${returnNumber} to ${po.supplier.name} against ${po.poNumber}`, retRef.id, now);
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
    } catch (err) {
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
    try {
      return await runTransaction(db, async (tx) => {
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
        const now = new Date().toISOString();

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
                now
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
    } catch (err) {
      throw friendly(err, 'The purchase return could not be updated.');
    }
  };

  const deletePurchaseReturn: TradeContextType['deletePurchaseReturn'] = async (returnId, reason) => {
    assertOnline();
    if (!permissions.canDeletePurchaseReturn) throw new Error('Your role is not allowed to delete purchase returns.');
    const retRef = doc(db, 'purchase_returns', returnId);
    try {
      await runTransaction(db, async (tx) => {
        const retSnap = await tx.get(retRef);
        if (!retSnap.exists()) throw new Error('Purchase return not found.');
        const ret = retSnap.data() as PurchaseReturn;

        const poRef = ret.purchaseId ? doc(db, 'purchases', ret.purchaseId) : null;
        const poSnap = poRef ? await tx.get(poRef) : null;
        const po = poSnap && poSnap.exists() ? (poSnap.data() as Purchase) : null;

        const itemMap = await readItems(tx, ret.lines.map((l) => l.itemId));
        const now = new Date().toISOString();

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
              now
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
    } catch (err) {
      throw friendly(err, 'The purchase return could not be deleted.');
    }
  };

  return (
    <TradeContext.Provider
      value={{
        sales,
        salesReturns,
        purchases,
        purchaseReturns,
        hasMoreSales: sales.length >= salesLimit,
        hasMorePurchases: purchases.length >= purchasesLimit,
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
        setSaleStatus,
        cancelSale,
        recordSalePayment: (id, p) => recordSaleMoney(id, p, 'payment'),
        recordSaleRefund: (id, p) => recordSaleMoney(id, p, 'refund'),
        createSalesReturn,
        editSalesReturn,
        deleteSalesReturn,
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

