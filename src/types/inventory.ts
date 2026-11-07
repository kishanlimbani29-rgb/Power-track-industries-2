export type ItemType = 'raw_material' | 'semi_finished' | 'finished_good' | 'both';

export type UserRole = 'admin' | 'manager' | 'staff' | 'viewer' | (string & {});

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  status?: 'active' | 'suspended' | 'pending';
  photoURL?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: UserRole;
  invitedBy: string;
  invitedByName?: string;
  createdAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  type: ItemType;
  category: string;
  unit: string;
  quantity: number;
  minStock: number;
  unitCost: number; // Cost to purchase or produce 1 unit
  sellingPrice: number; // Retail selling price (for finished goods)
  supplier?: string;
  location?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  lastUpdatedBy?: string;
}

export interface IngredientRequirement {
  rawItemId: string;
  rawItemName: string;
  quantity: number; // Amount needed per recipe batch
  unit: string;
}

export interface Recipe {
  id: string;
  name: string;
  finishedItemId: string;
  finishedItemName: string;
  yieldQuantity: number; // Output quantity produced per single batch (e.g., 10 loaves or 1 unit)
  laborCost: number; // Estimated labor / overhead cost per batch
  instructions?: string;
  ingredients: IngredientRequirement[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export type StockMovementType =
  | 'in'
  | 'out'
  | 'production_consume'
  | 'production_yield'
  | 'adjustment'
  | 'waste';

export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  type: StockMovementType;
  quantity: number; // Positive number
  previousQuantity: number;
  newQuantity: number;
  reason?: string;
  referenceId?: string; // e.g. Batch ID
  performedBy?: string;
  performedByName?: string;
  timestamp: string;
}

export interface DeductedMaterial {
  rawItemId: string;
  rawItemName: string;
  quantity: number;
  unit: string;
  unitCost: number;
}

export interface ProductionBatch {
  id: string;
  recipeId: string;
  recipeName: string;
  finishedItemId: string;
  finishedItemName: string;
  batchMultiplier: number; // e.g., 2 batches
  quantityProduced: number; // Total units finished
  totalBatchCost: number;
  rawMaterialsDeducted: DeductedMaterial[];
  notes?: string;
  performedBy?: string;
  performedByName?: string;
  timestamp: string;
  // Void tracking for reversed production batches
  isVoid?: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
  voidReason?: string;
}

export type AuditRequestType = 'production' | 'dispatch' | 'raw_material_in'; // 'dispatch' kept for old requests; new sales go through the Sales page
export type AuditRequestStatus = 'pending' | 'approved' | 'rejected';

export interface AuditRequest {
  id: string;
  type: AuditRequestType;
  title: string;
  status: AuditRequestStatus;

  // Submitted by
  submittedBy: string;
  submittedByRole?: string;
  submittedAt: string;

  // For 'production':
  recipeId?: string;
  recipeName?: string;
  finishedItemId?: string;
  finishedItemName?: string;
  batchMultiplier?: number;
  expectedYield?: number;
  unit?: string;
  materialsNeeded?: Array<{
    rawItemId: string;
    rawItemName: string;
    quantity: number;
    unit: string;
  }>;

  // For 'dispatch':
  dispatchItemId?: string;
  dispatchItemName?: string;
  dispatchQuantity?: number;
  dispatchUnit?: string;
  customerOrDestination?: string;

  // For 'raw_material_in':
  rawItemId?: string;
  rawItemName?: string;
  rawQuantity?: number;
  rawUnit?: string;
  supplierName?: string;
  unitPurchaseCost?: number;
  batchNumber?: string;
  shelfLocation?: string;

  notes?: string;

  // Audit decision details
  auditedBy?: string;
  auditedAt?: string;
  auditNotes?: string;
  executionError?: string;
}

export interface RolePermissions {
  canEditItems: boolean;
  canDeleteItems: boolean;
  canOpenProductDetail: boolean; // Tap on product card to open full product statement and ledger details
  canEditRecipes: boolean;
  canDeleteRecipes: boolean;
  canProduceBatch: boolean;
  canAdjustStock: boolean;
  canViewCostPerUnit: boolean; // View purchase cost per unit and raw ingredient unit costs
  canViewTotalAssetValue: boolean; // View total inventory asset valuation and line total values
  canViewFinances: boolean; // View margins and profit analytics
  canViewShelfOption: boolean; // View shelf & storage location analytics in Analytics & Reports
  canViewBatchProductionOption: boolean; // View Batch Production menu in shelf
  canViewAuditReports: boolean; // View Audit Reports menu in shelf
  canViewStockMovementsOption: boolean; // View Stock Movements menu in shelf
  canViewRolesAccessOption: boolean; // View Roles & Access Control menu in shelf
  canExportExcel: boolean; // Export inventory, movements, batches, and reports to Excel spreadsheets
  canSubmitAuditRequests: boolean; // Submit new production, dispatch, and raw material in requests
  canAuditRequests: boolean; // Review, audit, approve (take into account), and reject requests
  canManageUsers: boolean;
  // Sales & Purchase
  canViewSalesOption: boolean; // View Sales menu in shelf
  canCreateSales: boolean; // Create sales, change status, cancel
  canEditSales: boolean; // Edit sale invoices (customer, items, quantities, rates, notes)
  canDeleteSales: boolean; // Delete sale invoices and return stock to inventory
  canRecordPayments: boolean; // Record customer payments & refunds
  canCreateSalesReturn: boolean; // Record sales returns (credit notes)
  canEditSalesReturn: boolean; // Edit sales return details and quantities
  canDeleteSalesReturn: boolean; // Delete sales return (reverses stock restoration)
  canViewPurchaseOption: boolean; // View Purchase menu in shelf
  canCreatePurchase: boolean; // Create / cancel purchase orders
  canEditPurchase: boolean; // Edit purchase orders (supplier, items, quantities, rates, notes)
  canDeletePurchase: boolean; // Delete purchase orders and reverse received stock
  canReceivePurchase: boolean; // Receive goods into stock
  canRecordPurchasePayments: boolean; // Record supplier payments & refunds
  canCreatePurchaseReturn: boolean; // Return goods to supplier (debit notes)
  canEditPurchaseReturn: boolean; // Edit purchase return details and quantities
  canDeletePurchaseReturn: boolean; // Delete purchase return (reverses stock deduction)
}

export const TRADE_PERMISSION_KEYS = [
  'canViewSalesOption',
  'canCreateSales',
  'canEditSales',
  'canDeleteSales',
  'canRecordPayments',
  'canCreateSalesReturn',
  'canEditSalesReturn',
  'canDeleteSalesReturn',
  'canViewPurchaseOption',
  'canCreatePurchase',
  'canEditPurchase',
  'canDeletePurchase',
  'canReceivePurchase',
  'canRecordPurchasePayments',
  'canCreatePurchaseReturn',
  'canEditPurchaseReturn',
  'canDeletePurchaseReturn',
] as const;

export type TradePermissionKey = (typeof TRADE_PERMISSION_KEYS)[number];

/** All Sales & Purchase switches set to one value (used by Grant All / Revoke All / blank roles). */
export const tradePermissions = (value: boolean): Pick<RolePermissions, TradePermissionKey> => ({
  canViewSalesOption: value,
  canCreateSales: value,
  canEditSales: value,
  canDeleteSales: value,
  canRecordPayments: value,
  canCreateSalesReturn: value,
  canEditSalesReturn: value,
  canDeleteSalesReturn: value,
  canViewPurchaseOption: value,
  canCreatePurchase: value,
  canEditPurchase: value,
  canDeletePurchase: value,
  canReceivePurchase: value,
  canRecordPurchasePayments: value,
  canCreatePurchaseReturn: value,
  canEditPurchaseReturn: value,
  canDeletePurchaseReturn: value,
});

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  admin: {
    canEditItems: true,
    canDeleteItems: true,
    canOpenProductDetail: true,
    canEditRecipes: true,
    canDeleteRecipes: true,
    canProduceBatch: true,
    canAdjustStock: true,
    canViewCostPerUnit: true,
    canViewTotalAssetValue: true,
    canViewFinances: true,
    canViewShelfOption: true,
    canViewBatchProductionOption: true,
    canViewAuditReports: true,
    canViewStockMovementsOption: true,
    canViewRolesAccessOption: true,
    canExportExcel: true,
    canSubmitAuditRequests: true,
    canAuditRequests: true,
    canManageUsers: true,
    ...tradePermissions(true),
  },
  manager: {
    canEditItems: true,
    canDeleteItems: true,
    canOpenProductDetail: true,
    canEditRecipes: true,
    canDeleteRecipes: true,
    canProduceBatch: true,
    canAdjustStock: true,
    canViewCostPerUnit: true,
    canViewTotalAssetValue: true,
    canViewFinances: true,
    canViewShelfOption: true,
    canViewBatchProductionOption: true,
    canViewAuditReports: true,
    canViewStockMovementsOption: true,
    canViewRolesAccessOption: true,
    canExportExcel: true,
    canSubmitAuditRequests: true,
    canAuditRequests: true,
    canManageUsers: false,
    ...tradePermissions(true),
  },
  staff: {
    canEditItems: false,
    canDeleteItems: false,
    canOpenProductDetail: true,
    canEditRecipes: false,
    canDeleteRecipes: false,
    canProduceBatch: true,
    canAdjustStock: true,
    canViewCostPerUnit: false,
    canViewTotalAssetValue: false,
    canViewFinances: false,
    canViewShelfOption: true,
    canViewBatchProductionOption: true,
    canViewAuditReports: true,
    canViewStockMovementsOption: true,
    canViewRolesAccessOption: false,
    canExportExcel: true,
    canSubmitAuditRequests: true,
    canAuditRequests: false,
    canManageUsers: false,
    ...tradePermissions(false),
    canViewPurchaseOption: true,
    canReceivePurchase: true,
  },
  viewer: {
    canEditItems: false,
    canDeleteItems: false,
    canOpenProductDetail: false,
    canEditRecipes: false,
    canDeleteRecipes: false,
    canProduceBatch: false,
    canAdjustStock: false,
    canViewCostPerUnit: false,
    canViewTotalAssetValue: false,
    canViewFinances: false,
    canViewShelfOption: false,
    canViewBatchProductionOption: false,
    canViewAuditReports: true,
    canViewStockMovementsOption: true,
    canViewRolesAccessOption: false,
    canExportExcel: false,
    canSubmitAuditRequests: false,
    canAuditRequests: false,
    canManageUsers: false,
    ...tradePermissions(false),
  },
};

export interface RoleDefinition {
  id: string;
  title: string;
  desc: string;
  badge: string;
  color: string;
  isSystem?: boolean;
  permissions: RolePermissions;
}

export const DEFAULT_ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: 'admin',
    title: 'Administrator / Owner',
    desc: 'Complete control: item catalog, recipe formulas, costs, margins, and user role assignments.',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    color: 'emerald',
    isSystem: true,
    permissions: ROLE_PERMISSIONS.admin,
  },
  {
    id: 'manager',
    title: 'Production & Inventory Manager',
    desc: 'Can create items, build recipes, execute batch runs, adjust stock, and review reports.',
    badge: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    color: 'indigo',
    isSystem: true,
    permissions: ROLE_PERMISSIONS.manager,
  },
  {
    id: 'staff',
    title: 'Kitchen & Floor Staff',
    desc: 'Can execute recipe production batches, record stock in/out, and check inventory levels.',
    badge: 'bg-amber-100 text-amber-800 border-amber-200',
    color: 'amber',
    isSystem: true,
    permissions: ROLE_PERMISSIONS.staff,
  },
  {
    id: 'viewer',
    title: 'Auditor & Read-Only Viewer',
    desc: 'Safe read-only access to view current stock quantities and movement audit logs.',
    badge: 'bg-slate-100 text-slate-800 border-slate-200',
    color: 'slate',
    isSystem: true,
    permissions: ROLE_PERMISSIONS.viewer,
  },
];


// =========================================================================
// SALES & PURCHASE
// =========================================================================

export type PaymentMode = 'cash' | 'upi' | 'bank' | 'cheque' | 'other';
export type PaymentStatus = 'unpaid' | 'partly_paid' | 'paid' | 'refund_due';
export type ReturnStatus = 'none' | 'partly_returned' | 'fully_returned';

export interface PaymentEntry {
  id: string;
  amount: number;
  date: string; // yyyy-mm-dd
  mode: PaymentMode;
  note?: string;
  recordedBy: string;
  recordedByName?: string;
  recordedAt: string;
}

export interface PartyInfo {
  name: string;
  phone?: string;
  gstin?: string;
  address?: string;
}

export interface SaleLine {
  itemId: string;
  itemName: string;
  sku?: string;
  unit: string;
  quantity: number;
  rate: number; // selling rate per unit, before discount & GST
  discountPct: number;
  gstPct: number;
  taxable: number; // qty × rate − discount
  gstAmount: number;
  amount: number; // taxable + GST
  costPrice: number; // item unit cost at the time of sale (for profit)
}

export type SaleStatus = 'confirmed' | 'dispatched' | 'delivered' | 'cancelled';

export interface Sale {
  id: string;
  invoiceNumber: string; // INV-2026-0001
  status: SaleStatus;
  customer: PartyInfo;
  lines: SaleLine[];
  subtotal: number; // sum of taxable
  gstTotal: number;
  grandTotal: number;
  vehicleNumber?: string;
  trackingNumber?: string;
  notes?: string;
  payments: PaymentEntry[];
  amountPaid: number;
  refunds: PaymentEntry[];
  refundedTotal: number;
  returnedQty: Record<string, number>; // itemId -> qty returned so far
  returnsTotal: number; // value of credit notes
  returnStatus: ReturnStatus;
  paymentStatus: PaymentStatus;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  dispatchedAt?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
}

export interface TradeReturnLine {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  rate: number;
  discountPct: number;
  gstPct: number;
  taxable: number;
  gstAmount: number;
  amount: number;
}

export type SalesReturnCondition = 'good' | 'damaged';

export interface SalesReturn {
  id: string;
  returnNumber: string; // SR-2026-0001
  saleId: string;
  invoiceNumber: string;
  customerName: string;
  lines: TradeReturnLine[];
  total: number;
  reason: string;
  condition: SalesReturnCondition;
  date: string;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

export interface PurchaseLine {
  itemId: string;
  itemName: string;
  sku?: string;
  unit: string;
  quantity: number; // ordered
  rate: number; // purchase rate per unit before GST
  gstPct: number;
  taxable: number;
  gstAmount: number;
  amount: number;
}

export interface PurchaseReceipt {
  id: string;
  billNumber?: string;
  billDate?: string;
  lines: { itemId: string; itemName: string; quantity: number }[];
  receivedBy: string;
  receivedByName?: string;
  receivedAt: string;
}

export type PurchaseStatus = 'ordered' | 'partly_received' | 'received' | 'cancelled';

export interface Purchase {
  id: string;
  poNumber: string; // PO-2026-0001
  status: PurchaseStatus;
  supplier: PartyInfo;
  expectedDate?: string;
  notes?: string;
  lines: PurchaseLine[];
  subtotal: number;
  gstTotal: number;
  grandTotal: number;
  receivedQty: Record<string, number>;
  receipts: PurchaseReceipt[];
  payments: PaymentEntry[];
  amountPaid: number;
  refunds: PaymentEntry[];
  refundedTotal: number;
  returnedQty: Record<string, number>;
  returnsTotal: number;
  returnStatus: ReturnStatus;
  paymentStatus: PaymentStatus;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelReason?: string;
}

export interface PurchaseReturn {
  id: string;
  returnNumber: string; // PR-2026-0001
  purchaseId: string;
  poNumber: string;
  supplierName: string;
  lines: TradeReturnLine[];
  total: number;
  reason: string;
  vehicleNumber?: string;
  date: string;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}
