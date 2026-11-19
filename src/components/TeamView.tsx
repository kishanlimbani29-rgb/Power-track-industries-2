import React, { useState, useRef, useEffect } from 'react';
import {
  Shield,
  Check,
  X,
  Sliders,
  Lock,
  Unlock,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Crown,
  Plus,
  Trash2,
  Copy,
  Sparkles,
  RotateCcw,
  ArrowLeft,
  ChevronRight,
  Package,
  BookOpen,
  Boxes,
  DollarSign,
  Coins,
  Landmark,
  UserCheck,
  CheckCheck,
  Ban,
  Info,
  Layers,
  ClipboardCheck,
  UserPlus,
  Users,
  Mail,
  Clock,
  ShieldAlert,
  History,
  FileSpreadsheet,
  ExternalLink,
  ShoppingCart,
  ShoppingBag,
  Wallet,
  Undo2,
  Truck,
  Pencil,
  MoreVertical,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  UserRole,
  RolePermissions,
  RoleDefinition,
  ROLE_PERMISSIONS,
  BOOLEAN_PERMISSION_KEYS,
  BooleanPermissionKey,
  ChangeWindow,
  tradePermissions,
  resolveRolePermissions,
} from '../types/inventory';
import { CHANGE_WINDOW_OPTIONS } from '../utils/changeWindow';

interface CapabilityConfig {
  key: BooleanPermissionKey;
  title: string;
  category: 'inventory' | 'recipes' | 'production' | 'finances' | 'admin' | 'audit' | 'movements' | 'sales' | 'purchase';
  categoryLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  allowedDesc: string;
  deniedDesc: string;
}

const CAPABILITY_LIST: CapabilityConfig[] = [
  // 1. Inventory & Stock
  {
    key: 'canEditItems',
    title: 'Create & Edit Inventory Items',
    category: 'inventory',
    categoryLabel: 'Inventory & Items Master',
    icon: Package,
    allowedDesc: 'User can add new raw materials or finished goods, edit quantities, supplier information, and unit purchase costs.',
    deniedDesc: 'Item catalog is read-only. User cannot create or edit item specifications.',
  },
  {
    key: 'canDeleteItems',
    title: 'Delete Inventory Items',
    category: 'inventory',
    categoryLabel: 'Inventory & Items Master',
    icon: Trash2,
    allowedDesc: 'User has authority to permanently delete items and raw materials from the inventory catalog.',
    deniedDesc: 'Deletion blocked. Protects catalog from accidental or unauthorized item removal.',
  },
  {
    key: 'canOpenProductDetail',
    title: 'Tap on Product & Open Product (View Details)',
    category: 'inventory',
    categoryLabel: 'Inventory & Items Master',
    icon: ExternalLink,
    allowedDesc: 'User can tap on any product card in inventory to open the full product detail page, stock statement, and transaction history.',
    deniedDesc: 'Product cards are view-only on the list. Tapping to open the product detail page and stock statement is restricted for this role.',
  },
  {
    key: 'canAdjustStock',
    title: 'Perform Stock In / Out / Audits',
    category: 'inventory',
    categoryLabel: 'Inventory & Items Master',
    icon: Boxes,
    allowedDesc: 'User can log purchase shipment receipts, record damage or waste, dispatch sales orders, and perform physical audit reconciliations.',
    deniedDesc: 'Direct stock manual adjustments and logs are restricted.',
  },
  {
    key: 'canViewStockMovementsOption',
    title: 'View Self Option (Stock Movement)',
    category: 'movements',
    categoryLabel: 'Stock Movement & Ledger',
    icon: History,
    allowedDesc: 'User can view and access the Stock Movements menu in the side shelf navigation drawer and inspect the audit trail.',
    deniedDesc: 'The Stock Movements menu is completely hidden from the side shelf for this role.',
  },
  {
    key: 'canExportExcel',
    title: 'Export Excel Spreadsheets (.xlsx)',
    category: 'inventory',
    categoryLabel: 'Data Export & Spreadsheets',
    icon: FileSpreadsheet,
    allowedDesc: 'User can download and export inventory catalogs, batch manufacturing ledgers, stock movements, and financial valuation reports to Excel (.xlsx) files.',
    deniedDesc: 'Excel export buttons are hidden across the entire system. User cannot export or download spreadsheet files.',
  },

  // 2. Product BOM
  {
    key: 'canEditRecipes',
    title: 'Create & edit BOMs',
    category: 'recipes',
    categoryLabel: 'Product BOM',
    icon: BookOpen,
    allowedDesc: 'User can view the Product BOM menu in the shelf, create & edit BOMs, define material consumption quantities, and adjust batch yields.',
    deniedDesc: 'The Product BOM menu is hidden from the side shelf and access is restricted for this role.',
  },
  {
    key: 'canDeleteRecipes',
    title: 'Delete BOMs',
    category: 'recipes',
    categoryLabel: 'Product BOM',
    icon: Trash2,
    allowedDesc: 'User can permanently delete BOMs and production formulas.',
    deniedDesc: 'BOMs are protected from accidental or unauthorized deletion.',
  },

  // 3. Manufacturing
  {
    key: 'canViewBatchProductionOption',
    title: 'View Self Option (Batch Production)',
    category: 'production',
    categoryLabel: 'Batch Production & Manufacturing',
    icon: Sparkles,
    allowedDesc: 'User can view and access the Batch Production menu in the side shelf navigation drawer.',
    deniedDesc: 'The Batch Production menu is completely hidden from the side shelf for this role.',
  },
  {
    key: 'canProduceBatch',
    title: 'Execute Batch Production',
    category: 'production',
    categoryLabel: 'Batch Production & Manufacturing',
    icon: Boxes,
    allowedDesc: 'User can execute production runs, record finished output quantities, and trigger automated FIFO raw material stock deductions.',
    deniedDesc: 'Batch production runs cannot be started or recorded.',
  },

  // 4. Financial Valuation
  {
    key: 'canViewCostPerUnit',
    title: 'View Cost Per Unit (Unit Cost)',
    category: 'finances',
    categoryLabel: 'Financial Valuation & Analytics',
    icon: Coins,
    allowedDesc: 'User can view purchase cost per unit, raw material costs, and procurement prices across product cards and lists.',
    deniedDesc: 'Unit purchase costs and material costs are masked and hidden (•••) from this role.',
  },
  {
    key: 'canViewTotalAssetValue',
    title: 'View Total Asset Value (Inventory Valuation)',
    category: 'finances',
    categoryLabel: 'Financial Valuation & Analytics',
    icon: Landmark,
    allowedDesc: 'User can view total stock valuation, warehouse inventory asset totals, and line item asset values.',
    deniedDesc: 'Total asset valuation metrics and inventory value cards are masked and hidden (•••) from this role.',
  },
  {
    key: 'canViewFinances',
    title: 'View Margins & Profit Reports',
    category: 'finances',
    categoryLabel: 'Financial Valuation & Analytics',
    icon: DollarSign,
    allowedDesc: 'User has visibility into item cost breakdowns, estimated batch margins, gross profit percentages, and financial reports.',
    deniedDesc: 'Margin percentages and financial profit reports are masked and hidden from this role.',
  },
  {
    key: 'canViewShelfOption',
    title: 'View Shelf Option (Analytics & Reports)',
    category: 'finances',
    categoryLabel: 'Reports & Shelf Optimization',
    icon: Layers,
    allowedDesc: 'User can view and access the Analytics & Reports menu in the side shelf and analyze warehouse shelf allocation.',
    deniedDesc: 'The Analytics & Reports menu is completely hidden from the side shelf and shelf analytics is restricted for this role.',
  },

  // 5. Audit Reports & Verification Queue
  {
    key: 'canViewAuditReports',
    title: 'View Self Option (Audit Reports)',
    category: 'audit',
    categoryLabel: 'Audit Reports & Verification Queue',
    icon: ClipboardCheck,
    allowedDesc: 'User can view and access the Audit Reports menu in the side shelf navigation drawer.',
    deniedDesc: 'The Audit Reports menu is completely hidden from the shelf for this role.',
  },
  {
    key: 'canSubmitAuditRequests',
    title: 'Enter Audit Requests (Production, Dispatch, Raw In)',
    category: 'audit',
    categoryLabel: 'Audit Reports & Verification Queue',
    icon: Boxes,
    allowedDesc: 'User can submit new production runs, finished goods dispatches, and incoming raw material requests into the pending audit queue.',
    deniedDesc: 'User cannot submit requests into the audit queue. Form is restricted.',
  },
  {
    key: 'canAuditRequests',
    title: 'Audit & Approve Requests (Take Into Account)',
    category: 'audit',
    categoryLabel: 'Audit Reports & Verification Queue',
    icon: CheckCheck,
    allowedDesc: 'Authorized auditor authority: Can review, verify, reject, or approve pending requests to immediately apply them into active inventory and batches.',
    deniedDesc: 'User cannot audit or approve requests. Verification buttons are hidden.',
  },

  // 5b. Sales
  {
    key: 'canViewSalesOption',
    title: 'View Self Option (Sales)',
    category: 'sales',
    categoryLabel: 'Sales & Customer Invoices',
    icon: ShoppingCart,
    allowedDesc: 'User can open the Sales menu in the side shelf and see invoices, customers and payment status.',
    deniedDesc: 'The Sales menu is completely hidden from the side shelf for this role.',
  },
  {
    key: 'canCreateSales',
    title: 'Create Sales & Update Status',
    category: 'sales',
    categoryLabel: 'Sales & Customer Invoices',
    icon: ShoppingCart,
    allowedDesc: 'User can create new sales (stock is taken off), mark them Dispatched / Delivered, and cancel them before delivery.',
    deniedDesc: 'User cannot create sales or change their status.',
  },
  {
    key: 'canEditSales',
    title: 'Edit Sale Invoices',
    category: 'sales',
    categoryLabel: 'Sales & Customer Invoices',
    icon: Pencil,
    allowedDesc: 'User can edit customer details, line items, quantities, rates, discounts, and notes on confirmed or dispatched sales.',
    deniedDesc: 'Editing sales invoices is restricted for this role.',
  },
  {
    key: 'canDeleteSales',
    title: 'Delete Sale Invoices',
    category: 'sales',
    categoryLabel: 'Sales & Customer Invoices',
    icon: Trash2,
    allowedDesc: 'User has authority to permanently delete sales invoices. Deducted stock is automatically returned to inventory.',
    deniedDesc: 'Deleting sales invoices is restricted for this role.',
  },
  {
    key: 'canRecordPayments',
    title: 'Record Customer Payments & Refunds',
    category: 'sales',
    categoryLabel: 'Sales & Customer Invoices',
    icon: Wallet,
    allowedDesc: 'User can record payments received from customers and refunds paid back.',
    deniedDesc: 'Payment buttons are hidden on sales.',
  },
  {
    key: 'canEditPayments',
    title: 'Edit Payments',
    category: 'sales',
    categoryLabel: 'Sales & Customer Invoices',
    icon: Pencil,
    allowedDesc: 'User can edit customer payment and advance entries (amount, mode, date, note).',
    deniedDesc: 'Editing customer payment or advance entries is restricted for this role.',
  },
  {
    key: 'canDeletePayments',
    title: 'Remove Payments',
    category: 'sales',
    categoryLabel: 'Sales & Customer Invoices',
    icon: Trash2,
    allowedDesc: 'User can remove customer payment and advance entries and recalculate party balances.',
    deniedDesc: 'Removing customer payment or advance entries is restricted for this role.',
  },
  {
    key: 'canCreateSalesReturn',
    title: 'Sales Returns (Credit Notes)',
    category: 'sales',
    categoryLabel: 'Sales & Customer Invoices',
    icon: Undo2,
    allowedDesc: 'User can record goods returned by customers. Good-condition returns go back into stock.',
    deniedDesc: 'User cannot record sales returns.',
  },
  {
    key: 'canEditSalesReturn',
    title: 'Edit Sales Returns',
    category: 'sales',
    categoryLabel: 'Sales & Customer Invoices',
    icon: Pencil,
    allowedDesc: 'User can edit returned quantities, reason, and condition on sales returns. Stock adjustments are recalculated.',
    deniedDesc: 'Editing sales returns is restricted for this role.',
  },
  {
    key: 'canDeleteSalesReturn',
    title: 'Delete Sales Returns',
    category: 'sales',
    categoryLabel: 'Sales & Customer Invoices',
    icon: Trash2,
    allowedDesc: 'User can permanently delete sales returns. Any stock that was added back is safely reversed.',
    deniedDesc: 'Deleting sales returns is restricted for this role.',
  },
  // 5c. Purchase
  {
    key: 'canViewPurchaseOption',
    title: 'View Self Option (Purchase)',
    category: 'purchase',
    categoryLabel: 'Purchase & Supplier Orders',
    icon: ShoppingBag,
    allowedDesc: 'User can open the Purchase menu in the side shelf and see purchase orders.',
    deniedDesc: 'The Purchase menu is completely hidden from the side shelf for this role.',
  },
  {
    key: 'canCreatePurchase',
    title: 'Create & Cancel Purchase Orders',
    category: 'purchase',
    categoryLabel: 'Purchase & Supplier Orders',
    icon: ShoppingBag,
    allowedDesc: 'User can create purchase orders for suppliers and cancel orders that have not been received.',
    deniedDesc: 'User cannot create or cancel purchase orders.',
  },
  {
    key: 'canEditPurchase',
    title: 'Edit Purchase Orders',
    category: 'purchase',
    categoryLabel: 'Purchase & Supplier Orders',
    icon: Pencil,
    allowedDesc: 'User can edit supplier details, items, quantities, rates, and expected dates on purchase orders before they are received.',
    deniedDesc: 'Editing purchase orders is restricted for this role.',
  },
  {
    key: 'canDeletePurchase',
    title: 'Delete Purchase Orders',
    category: 'purchase',
    categoryLabel: 'Purchase & Supplier Orders',
    icon: Trash2,
    allowedDesc: 'User has authority to permanently delete purchase orders. Any received stock is automatically reversed.',
    deniedDesc: 'Deleting purchase orders is restricted for this role.',
  },
  {
    key: 'canReceivePurchase',
    title: 'Receive Goods into Stock',
    category: 'purchase',
    categoryLabel: 'Purchase & Supplier Orders',
    icon: Truck,
    allowedDesc: 'User can receive delivered goods against a purchase order. Stock goes up and the average cost is updated.',
    deniedDesc: 'User cannot receive goods against purchase orders.',
  },
  {
    key: 'canRecordPurchasePayments',
    title: 'Record Supplier Payments & Refunds',
    category: 'purchase',
    categoryLabel: 'Purchase & Supplier Orders',
    icon: Wallet,
    allowedDesc: 'User can record payments made to suppliers and refunds received from them.',
    deniedDesc: 'Payment buttons are hidden on purchase orders.',
  },
  {
    key: 'canCreatePurchaseReturn',
    title: 'Purchase Returns (Debit Notes)',
    category: 'purchase',
    categoryLabel: 'Purchase & Supplier Orders',
    icon: Undo2,
    allowedDesc: 'User can return received goods to the supplier. Stock goes down.',
    deniedDesc: 'User cannot record purchase returns.',
  },
  {
    key: 'canEditPurchaseReturn',
    title: 'Edit Purchase Returns',
    category: 'purchase',
    categoryLabel: 'Purchase & Supplier Orders',
    icon: Pencil,
    allowedDesc: 'User can edit returned quantities, vehicle number, and notes on purchase debit notes. Stock is recalculated.',
    deniedDesc: 'Editing purchase returns is restricted for this role.',
  },
  {
    key: 'canDeletePurchaseReturn',
    title: 'Delete Purchase Returns',
    category: 'purchase',
    categoryLabel: 'Purchase & Supplier Orders',
    icon: Trash2,
    allowedDesc: 'User can permanently delete purchase returns. Deducted stock is restored to inventory.',
    deniedDesc: 'Deleting purchase returns is restricted for this role.',
  },

  // 6. Administration & Security
  {
    key: 'canViewRolesAccessOption',
    title: 'View Self Option (Roles & Access Control)',
    category: 'admin',
    categoryLabel: 'Administration & Security',
    icon: Shield,
    allowedDesc: 'User can view and access the Roles & Access Control menu in the side shelf navigation drawer.',
    deniedDesc: 'The Roles & Access Control menu is completely hidden from the side shelf for this role.',
  },
  {
    key: 'canManageUsers',
    title: 'Manage Team Roles & Access Rights',
    category: 'admin',
    categoryLabel: 'Administration & Security',
    icon: ShieldCheck,
    allowedDesc: 'Full authority to configure role access switches, assign user roles, and create or delete custom roles.',
    deniedDesc: 'Access control configuration is locked. User cannot modify security settings.',
  },
];

export type AccessLevel = 'Hidden' | 'View' | 'Work' | 'Full';

export interface SectionDefinition {
  id: string;
  name: string;
  icon: string;
  allKeys: (keyof RolePermissions)[];
  viewKeys: (keyof RolePermissions)[];
  workKeys?: (keyof RolePermissions)[]; // undefined for Team which only has Hidden | View | Full
  fullKeys: (keyof RolePermissions)[];
  descriptions: {
    hidden: string;
    view: string;
    work?: string;
    full: string;
  };
}

export const SECTIONS: SectionDefinition[] = [
  {
    id: 'inventory',
    name: 'Inventory',
    icon: '📦',
    viewKeys: ['canOpenProductDetail', 'canViewStockMovementsOption'],
    workKeys: ['canOpenProductDetail', 'canViewStockMovementsOption', 'canAdjustStock', 'canExportExcel'],
    fullKeys: ['canOpenProductDetail', 'canViewStockMovementsOption', 'canAdjustStock', 'canExportExcel', 'canEditItems', 'canDeleteItems'],
    allKeys: ['canOpenProductDetail', 'canViewStockMovementsOption', 'canAdjustStock', 'canExportExcel', 'canEditItems', 'canDeleteItems'],
    descriptions: {
      hidden: "Can't see inventory or stock movements",
      view: 'Open items and view stock movement ledger',
      work: 'Open items, stock in/out, export',
      full: 'Create, edit, delete items, stock in/out, export',
    },
  },
  {
    id: 'production',
    name: 'Production (BOMs & batches)',
    icon: '🧪',
    viewKeys: ['canViewBatchProductionOption'],
    workKeys: ['canViewBatchProductionOption', 'canProduceBatch'],
    fullKeys: ['canViewBatchProductionOption', 'canProduceBatch', 'canEditRecipes', 'canDeleteRecipes'],
    allKeys: ['canViewBatchProductionOption', 'canProduceBatch', 'canEditRecipes', 'canDeleteRecipes'],
    descriptions: {
      hidden: "Can't see production or BOMs",
      view: 'Look only: view batch production screen',
      work: 'View batches and execute production runs (no BOM edits)',
      full: 'Create & edit BOMs, delete BOMs, produce batches',
    },
  },
  {
    id: 'audit',
    name: 'Audit',
    icon: '📋',
    viewKeys: ['canViewAuditReports'],
    workKeys: ['canViewAuditReports', 'canSubmitAuditRequests'],
    fullKeys: ['canViewAuditReports', 'canSubmitAuditRequests', 'canAuditRequests'],
    allKeys: ['canViewAuditReports', 'canSubmitAuditRequests', 'canAuditRequests'],
    descriptions: {
      hidden: "Can't see audit reports",
      view: 'Look only: view audit reports',
      work: 'View audit and submit production/dispatch requests',
      full: 'Audit, verify, approve, and reject requests',
    },
  },
  {
    id: 'sales',
    name: 'Sales',
    icon: '🧾',
    viewKeys: ['canViewSalesOption'],
    workKeys: ['canViewSalesOption', 'canCreateSales', 'canRecordPayments', 'canCreateSalesReturn'],
    fullKeys: ['canViewSalesOption', 'canCreateSales', 'canRecordPayments', 'canEditPayments', 'canDeletePayments', 'canCreateSalesReturn', 'canEditSales', 'canDeleteSales', 'canEditSalesReturn', 'canDeleteSalesReturn'],
    allKeys: ['canViewSalesOption', 'canCreateSales', 'canRecordPayments', 'canEditPayments', 'canDeletePayments', 'canCreateSalesReturn', 'canEditSales', 'canDeleteSales', 'canEditSalesReturn', 'canDeleteSalesReturn'],
    descriptions: {
      hidden: "Can't see sales invoices or customer orders",
      view: 'Look only: view sales invoices and customers',
      work: 'Create sales, record payments, sales returns',
      full: 'Edit, delete invoices, edit/remove payments & credit notes',
    },
  },
  {
    id: 'purchase',
    name: 'Purchase',
    icon: '🚚',
    viewKeys: ['canViewPurchaseOption'],
    workKeys: ['canViewPurchaseOption', 'canCreatePurchase', 'canReceivePurchase', 'canRecordPurchasePayments', 'canCreatePurchaseReturn'],
    fullKeys: ['canViewPurchaseOption', 'canCreatePurchase', 'canReceivePurchase', 'canRecordPurchasePayments', 'canCreatePurchaseReturn', 'canEditPurchase', 'canDeletePurchase', 'canEditPurchaseReturn', 'canDeletePurchaseReturn'],
    allKeys: ['canViewPurchaseOption', 'canCreatePurchase', 'canReceivePurchase', 'canRecordPurchasePayments', 'canCreatePurchaseReturn', 'canEditPurchase', 'canDeletePurchase', 'canEditPurchaseReturn', 'canDeletePurchaseReturn'],
    descriptions: {
      hidden: "Can't see purchase orders or suppliers",
      view: 'Look only: view purchase orders',
      work: 'Create orders, receive goods, record payments & returns',
      full: 'Edit, delete purchase orders and debit notes',
    },
  },
  {
    id: 'finances',
    name: 'Money & Reports',
    icon: '💰',
    viewKeys: ['canViewShelfOption'],
    workKeys: ['canViewShelfOption', 'canViewCostPerUnit', 'canViewTotalAssetValue'],
    fullKeys: ['canViewShelfOption', 'canViewCostPerUnit', 'canViewTotalAssetValue', 'canViewFinances'],
    allKeys: ['canViewShelfOption', 'canViewCostPerUnit', 'canViewTotalAssetValue', 'canViewFinances'],
    descriptions: {
      hidden: "Can't see finances, costs, or valuations",
      view: 'Look only: view warehouse shelf analytics',
      work: 'View unit purchase costs and total asset valuation',
      full: 'Margins, profit reports, and all financial metrics',
    },
  },
  {
    id: 'team',
    name: 'Team',
    icon: '👥',
    viewKeys: ['canViewRolesAccessOption'],
    fullKeys: ['canViewRolesAccessOption', 'canManageUsers'],
    allKeys: ['canViewRolesAccessOption', 'canManageUsers'],
    descriptions: {
      hidden: "Can't see team or roles menu",
      view: 'Look only: view roles & team access control',
      full: 'Manage team roles, statuses, and permissions',
    },
  },
];

export const PERMISSION_META: Record<keyof RolePermissions, { shortName: string; tag: string; desc: string }> = {
  canOpenProductDetail: {
    shortName: 'Open product details',
    tag: 'open items',
    desc: 'Tap on product cards to open statement, ledger, and detail view.',
  },
  canViewStockMovementsOption: {
    shortName: 'View stock movements',
    tag: 'view ledger',
    desc: 'Open Stock Movements menu in the side shelf navigation.',
  },
  canAdjustStock: {
    shortName: 'Stock in / out / audits',
    tag: 'stock in/out',
    desc: 'Perform manual stock adjustments, receipts, waste, and audits.',
  },
  canExportExcel: {
    shortName: 'Export Excel spreadsheets',
    tag: 'export',
    desc: 'Download inventory, batches, movements, and reports to .xlsx.',
  },
  canEditItems: {
    shortName: 'Create & edit items',
    tag: 'edit items',
    desc: 'Add new items, update specifications, suppliers, and costs.',
  },
  canDeleteItems: {
    shortName: 'Delete inventory items',
    tag: 'delete items',
    desc: 'Permanently remove raw materials or products from catalog.',
  },
  canViewBatchProductionOption: {
    shortName: 'View batch production',
    tag: 'view batches',
    desc: 'Open Batch Production menu in the side shelf navigation.',
  },
  canProduceBatch: {
    shortName: 'Execute batch production',
    tag: 'produce batches',
    desc: 'Execute production runs and automatically deduct raw materials.',
  },
  canEditRecipes: {
    shortName: 'Create & edit BOMs',
    tag: 'edit BOMs',
    desc: 'Create & edit Bill of Materials (BOM), material quantities, and yields.',
  },
  canDeleteRecipes: {
    shortName: 'Delete BOMs',
    tag: 'delete BOMs',
    desc: 'Permanently remove BOMs and production formulas.',
  },
  canViewAuditReports: {
    shortName: 'View audit reports',
    tag: 'view audit',
    desc: 'Open Audit Reports menu in the side shelf navigation.',
  },
  canSubmitAuditRequests: {
    shortName: 'Submit audit requests',
    tag: 'submit requests',
    desc: 'Submit production, dispatch, and raw receipt requests to queue.',
  },
  canAuditRequests: {
    shortName: 'Audit & approve requests',
    tag: 'audit & approve',
    desc: 'Authorized auditor: review, verify, approve, or reject requests.',
  },
  canViewSalesOption: {
    shortName: 'View sales invoices',
    tag: 'view sales',
    desc: 'Open Sales menu in the side shelf navigation drawer.',
  },
  canCreateSales: {
    shortName: 'Create & dispatch sales',
    tag: 'create sales',
    desc: 'Create sales orders, deduct stock, update dispatch status.',
  },
  canRecordPayments: {
    shortName: 'Record customer payments',
    tag: 'record payments',
    desc: 'Record payments received from customers and advances.',
  },
  canEditPayments: {
    shortName: 'Edit payments',
    tag: 'edit payments',
    desc: 'Edit payment or advance amount, mode, date, and notes.',
  },
  canDeletePayments: {
    shortName: 'Remove payments',
    tag: 'remove payments',
    desc: 'Remove payment or advance entries and recalculate party due.',
  },
  canCreateSalesReturn: {
    shortName: 'Sales returns (credit notes)',
    tag: 'sales returns',
    desc: 'Record customer returns; good condition items return to stock.',
  },
  canEditSales: {
    shortName: 'Edit sale invoices',
    tag: 'edit sales',
    desc: 'Edit customer info, line items, quantities, rates, and notes.',
  },
  canDeleteSales: {
    shortName: 'Delete sale invoices',
    tag: 'delete sales',
    desc: 'Permanently delete sale invoices and restore deducted stock.',
  },
  canEditSalesReturn: {
    shortName: 'Edit sales returns',
    tag: 'edit returns',
    desc: 'Edit returned quantities, reason, and condition on returns.',
  },
  canDeleteSalesReturn: {
    shortName: 'Delete sales returns',
    tag: 'delete returns',
    desc: 'Permanently delete sales returns and safely reverse restock.',
  },
  canViewPurchaseOption: {
    shortName: 'View purchase orders',
    tag: 'view purchase',
    desc: 'Open Purchase menu in the side shelf navigation drawer.',
  },
  canCreatePurchase: {
    shortName: 'Create purchase orders',
    tag: 'create orders',
    desc: 'Create purchase orders for suppliers and cancel unreceived orders.',
  },
  canReceivePurchase: {
    shortName: 'Receive goods into stock',
    tag: 'receive goods',
    desc: 'Receive delivered goods against orders and update average cost.',
  },
  canRecordPurchasePayments: {
    shortName: 'Record supplier payments',
    tag: 'supplier payments',
    desc: 'Record payments made to suppliers and refunds received.',
  },
  canCreatePurchaseReturn: {
    shortName: 'Purchase returns (debit notes)',
    tag: 'purchase returns',
    desc: 'Return received goods to suppliers and deduct stock.',
  },
  canEditPurchase: {
    shortName: 'Edit purchase orders',
    tag: 'edit orders',
    desc: 'Edit supplier info, items, quantities, rates, and expected dates.',
  },
  canDeletePurchase: {
    shortName: 'Delete purchase orders',
    tag: 'delete orders',
    desc: 'Permanently delete purchase orders and reverse received stock.',
  },
  canEditPurchaseReturn: {
    shortName: 'Edit purchase returns',
    tag: 'edit debit notes',
    desc: 'Edit returned quantities, vehicle number, and notes on debit notes.',
  },
  canDeletePurchaseReturn: {
    shortName: 'Delete purchase returns',
    tag: 'delete debit notes',
    desc: 'Permanently delete purchase returns and restore deducted stock.',
  },
  canViewShelfOption: {
    shortName: 'View shelf analytics',
    tag: 'shelf reports',
    desc: 'Open Analytics & Reports to analyze warehouse shelf allocation.',
  },
  canViewCostPerUnit: {
    shortName: 'View unit cost',
    tag: 'unit cost',
    desc: 'View purchase cost per unit and raw material prices.',
  },
  canViewTotalAssetValue: {
    shortName: 'View asset valuation',
    tag: 'valuation',
    desc: 'View total inventory valuation and warehouse asset totals.',
  },
  canViewFinances: {
    shortName: 'Margins & profit reports',
    tag: 'margins',
    desc: 'View estimated batch margins, gross profit, and financial reports.',
  },
  canViewRolesAccessOption: {
    shortName: 'View roles & team menu',
    tag: 'view roles',
    desc: 'Open Roles & Access Control menu in the side shelf.',
  },
  canManageUsers: {
    shortName: 'Manage team & roles',
    tag: 'manage team',
    desc: 'Full authority to configure access switches and manage team roles.',
  },
  changeWindow: {
    shortName: 'Time limit for changes',
    tag: 'time limit',
    desc: 'How long after creation entries can be edited, voided, or removed.',
  },
  canChangeOthersEntries: {
    shortName: "Can change other people's entries",
    tag: "others' entries",
    desc: 'Allow editing, voiding, or removing entries created by other team members.',
  },
};

export type SectionEvalLevel = AccessLevel | 'Custom';

export function evaluateSectionLevel(
  section: SectionDefinition,
  permissions: RolePermissions
): {
  level: SectionEvalLevel;
  isCustomMix: boolean;
  displayLevel: string;
  summary: string;
} {
  const activeKeys = section.allKeys.filter((k) => Boolean(permissions[k]));

  // 1. Hidden = no key of the section is on
  if (activeKeys.length === 0) {
    return {
      level: 'Hidden',
      isCustomMix: false,
      displayLevel: 'Hidden',
      summary: section.descriptions.hidden,
    };
  }

  const hasAll = (keys: (keyof RolePermissions)[]) =>
    keys.length > 0 && keys.every((k) => Boolean(permissions[k]));

  const exactMatch = (keys: (keyof RolePermissions)[]) =>
    activeKeys.length === keys.length && hasAll(keys);

  // 2. Exact Full / Work / View matches
  if (exactMatch(section.fullKeys)) {
    return {
      level: 'Full',
      isCustomMix: false,
      displayLevel: 'Full',
      summary: section.descriptions.full,
    };
  }

  if (section.workKeys && exactMatch(section.workKeys)) {
    return {
      level: 'Work',
      isCustomMix: false,
      displayLevel: 'Work',
      summary: section.descriptions.work || '',
    };
  }

  if (exactMatch(section.viewKeys)) {
    return {
      level: 'View',
      isCustomMix: false,
      displayLevel: 'View',
      summary: section.descriptions.view,
    };
  }

  // 3. Some keys are on, doesn't match a level exactly -> highest fully-included level + "✱"
  if (section.workKeys && hasAll(section.workKeys)) {
    const extraKeys = activeKeys.filter((k) => !section.workKeys!.includes(k));
    const extraTags = extraKeys.map((k) => PERMISSION_META[k]?.tag || k).join(', ');
    return {
      level: 'Work',
      isCustomMix: true,
      displayLevel: 'Work ✱',
      summary: `Work + ${extraTags} ✱`,
    };
  }

  if (hasAll(section.viewKeys)) {
    const extraKeys = activeKeys.filter((k) => !section.viewKeys.includes(k));
    const extraTags = extraKeys.map((k) => PERMISSION_META[k]?.tag || k).join(', ');
    return {
      level: 'View',
      isCustomMix: true,
      displayLevel: 'View ✱',
      summary: `View + ${extraTags} ✱`,
    };
  }

  // 4. No level is fully included, but some keys are on -> "Custom ✱" (never "Hidden")
  const activeTags = activeKeys.map((k) => PERMISSION_META[k]?.tag || k).join(', ');
  return {
    level: 'Custom',
    isCustomMix: true,
    displayLevel: 'Custom ✱',
    summary: `Custom: ${activeTags} ✱`,
  };
}

export interface TeamViewProps {
  returnToAllRolesKey?: number;
}

const SECTION_SHORT_LABELS: Record<string, string> = {
  inventory: 'Inventory',
  production: 'Production',
  audit: 'Audit',
  sales: 'Sales',
  purchase: 'Purchase',
  finances: 'Money',
  team: 'Team',
};

export const TeamView: React.FC<TeamViewProps> = ({ returnToAllRolesKey = 0 }) => {
  const {
    currentUser,
    role,
    actualRole,
    switchSimulatedRole,
    permissions,
    rolePermissions,
    updateRolePermission,
    setRoleFullPermissions,
    resetRolePermissions,
    allRoles,
    addCustomRole,
    renameCustomRole,
    deleteCustomRole,
    teamMembers,
    pendingUsers,
    activeUsers,
    invites,
    approvePendingUser,
    rejectPendingUser,
    updateUserRole,
    updateUserStatus,
    removeTeamMember,
    createInvite,
    deleteInvite,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'roles' | 'team'>('roles');

  // Two-screen state: null = Screen 1 (All Roles), string = Screen 2 (Role Detail)
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);

  // Local draft of permissions per role (in-memory changes before Save)
  const [draftRolePermissions, setDraftRolePermissions] = useState<Record<string, RolePermissions>>({});

  // Fine-tune bottom sheet state (which section is being fine-tuned)
  const [fineTuneSection, setFineTuneSection] = useState<SectionDefinition | null>(null);

  // Top ⋮ menu & secondary modals for Role Detail / Test Role
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCopyFromModalOpen, setIsCopyFromModalOpen] = useState(false);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameTitleInput, setRenameTitleInput] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [testUnsavedRoleId, setTestUnsavedRoleId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const roleDetailHistoryPushedRef = useRef(false);
  const ignoreNextPopStateRef = useRef(false);

  useEffect(() => {
    if (returnToAllRolesKey > 0) {
      setActiveTab('roles');
      setEditingRoleId(null);
      setIsMenuOpen(false);
      setFineTuneSection(null);
    }
  }, [returnToAllRolesKey]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  // Invite by email form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('staff');
  const [isInviting, setIsInviting] = useState(false);
  const [approvalRoles, setApprovalRoles] = useState<Record<string, UserRole>>({});

  // Notification feedback
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // Add Custom Role Modal States
  const [isAddRoleModalOpen, setIsAddRoleModalOpen] = useState(false);
  const [newRoleTitle, setNewRoleTitle] = useState('');
  const [newRoleId, setNewRoleId] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('purple');
  const [newRolePermissions, setNewRolePermissions] = useState<RolePermissions>({
    canEditItems: true,
    canDeleteItems: false,
    canOpenProductDetail: true,
    canEditRecipes: true,
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
    changeWindow: '2h',
    canChangeOthersEntries: false,
  });
  const [roleModalError, setRoleModalError] = useState<string | null>(null);
  const [isCreatingRole, setIsCreatingRole] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    isDestructive?: boolean;
    onConfirm: () => void | Promise<void>;
  } | null>(null);

  const isRealAdmin = actualRole === 'admin';
  const canManageTeam = Boolean(permissions.canManageUsers);
  const isAdmin = permissions.canManageUsers && isRealAdmin;

  const showNotification = (msg: string) => {
    setActionFeedback(msg);
    setTimeout(() => {
      setActionFeedback(null);
    }, 4500);
  };

  const handleApproveUser = async (targetUid: string) => {
    const assignedRole = approvalRoles[targetUid] || 'staff';
    try {
      await approvePendingUser(targetUid, assignedRole);
      showNotification(`User approved with role: ${assignedRole.toUpperCase()}`);
    } catch (err: any) {
      showNotification(`Failed to approve user: ${err?.message || err}`);
    }
  };

  const handleRejectUser = (targetUid: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Reject Registration?',
      message: 'Are you sure you want to reject and remove this registration?',
      confirmLabel: 'Reject Registration',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await rejectPendingUser(targetUid);
          showNotification('User registration was rejected.');
        } catch (err: any) {
          showNotification(`Failed to reject user: ${err?.message || err}`);
        }
      },
    });
  };

  const handleRoleChange = async (targetUid: string, newRole: UserRole) => {
    try {
      await updateUserRole(targetUid, newRole);
      showNotification(`Role updated to ${newRole.toUpperCase()}`);
    } catch (err: any) {
      showNotification(`Failed to change role: ${err?.message || err}`);
    }
  };

  const handleStatusToggle = async (targetUid: string, currentStatus?: string) => {
    const nextStatus = currentStatus === 'suspended' ? 'active' : 'suspended';
    try {
      await updateUserStatus(targetUid, nextStatus);
      showNotification(`User account marked as ${nextStatus.toUpperCase()}`);
    } catch (err: any) {
      showNotification(`Failed to update user status: ${err?.message || err}`);
    }
  };

  const handleRemoveMember = (targetUid: string, name: string) => {
    setConfirmDialog({
      isOpen: true,
      title: 'Remove Team Member?',
      message: `Are you sure you want to remove ${name}? They will immediately be signed out and lose access to Power Track.`,
      confirmLabel: 'Remove Member',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await removeTeamMember(targetUid);
          showNotification(`Member "${name}" was removed.`);
        } catch (err: any) {
          showNotification(`Failed to remove member: ${err?.message || err}`);
        }
      },
    });
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setIsInviting(true);
    try {
      await createInvite(inviteEmail, inviteRole);
      showNotification(`Pre-authorized invite created for ${inviteEmail.trim().toLowerCase()} with role: ${inviteRole.toUpperCase()}`);
      setInviteEmail('');
    } catch (err: any) {
      showNotification(`Failed to create invite: ${err?.message || err}`);
    } finally {
      setIsInviting(false);
    }
  };

  const handleCancelInvite = async (inviteId: string) => {
    try {
      await deleteInvite(inviteId);
      showNotification('Invitation cancelled.');
    } catch (err: any) {
      showNotification(`Failed to cancel invite: ${err?.message || err}`);
    }
  };

  const getBadgeClass = (color: string) => {
    switch (color) {
      case 'emerald':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'indigo':
        return 'bg-indigo-50 text-indigo-800 border-indigo-200';
      case 'amber':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'purple':
        return 'bg-purple-50 text-purple-800 border-purple-200';
      case 'cyan':
        return 'bg-cyan-50 text-cyan-800 border-cyan-200';
      case 'rose':
        return 'bg-rose-50 text-rose-800 border-rose-200';
      case 'sky':
        return 'bg-sky-50 text-sky-800 border-sky-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const getRoleColorTheme = (color: string) => {
    switch (color) {
      case 'emerald':
        return {
          bg: 'bg-emerald-500',
          lightBg: 'bg-emerald-50',
          border: 'border-emerald-200',
          text: 'text-emerald-700',
          ring: 'ring-emerald-500/20',
        };
      case 'indigo':
        return {
          bg: 'bg-indigo-600',
          lightBg: 'bg-indigo-50',
          border: 'border-indigo-200',
          text: 'text-indigo-700',
          ring: 'ring-indigo-500/20',
        };
      case 'amber':
        return {
          bg: 'bg-amber-500',
          lightBg: 'bg-amber-50',
          border: 'border-amber-200',
          text: 'text-amber-700',
          ring: 'ring-amber-500/20',
        };
      case 'purple':
        return {
          bg: 'bg-purple-600',
          lightBg: 'bg-purple-50',
          border: 'border-purple-200',
          text: 'text-purple-700',
          ring: 'ring-purple-500/20',
        };
      case 'cyan':
        return {
          bg: 'bg-cyan-600',
          lightBg: 'bg-cyan-50',
          border: 'border-cyan-200',
          text: 'text-cyan-700',
          ring: 'ring-cyan-500/20',
        };
      case 'rose':
        return {
          bg: 'bg-rose-600',
          lightBg: 'bg-rose-50',
          border: 'border-rose-200',
          text: 'text-rose-700',
          ring: 'ring-rose-500/20',
        };
      default:
        return {
          bg: 'bg-slate-600',
          lightBg: 'bg-slate-50',
          border: 'border-slate-200',
          text: 'text-slate-700',
          ring: 'ring-slate-500/20',
        };
    }
  };

  // Helper to get saved effective permissions for a role (settings/roles_permissions with ROLE_PERMISSIONS defaults)
  const getRoleEffectivePermissions = (roleId: string): RolePermissions => {
    return resolveRolePermissions(roleId, rolePermissions, allRoles);
  };

  // Count how many capabilities are enabled for a role
  const getEnabledCount = (roleId: string) => {
    const perms = getRoleEffectivePermissions(roleId);
    return BOOLEAN_PERMISSION_KEYS.filter((k) => Boolean(perms[k])).length;
  };

  // Toggle single permission for target role
  const handleToggleCapability = async (
    targetRole: UserRole,
    permKey: keyof RolePermissions,
    currentValue: boolean
  ) => {
    if (!isAdmin) {
      showNotification('Administrator privileges required to toggle access rights. Switch to Admin persona above.');
      return;
    }

    if (targetRole === 'admin' && permKey === 'canManageUsers' && currentValue === true) {
      showNotification('Master Administrator must retain User Management rights to prevent administrative lockout.');
      return;
    }

    const nextValue = !currentValue;
    try {
      await updateRolePermission(targetRole, permKey, nextValue);
      const capability = CAPABILITY_LIST.find((c) => c.key === permKey);
      showNotification(
        `Updated: ${targetRole.toUpperCase()} permission for "${capability?.title || permKey}" set to ${
          nextValue ? 'ALLOWED' : 'RESTRICTED'
        }.`
      );
    } catch (err: any) {
      showNotification(`Failed to update permission: ${err?.message || err}`);
    }
  };

  // Grant All Capabilities for target role (Single write for all switches)
  const handleGrantAll = async (targetRole: UserRole) => {
    if (!isAdmin) {
      showNotification('Administrator privileges required.');
      return;
    }

    try {
      const grantAllPerms: RolePermissions = {
        ...ROLE_PERMISSIONS.admin,
      };
      await setRoleFullPermissions(targetRole, grantAllPerms);
      showNotification(`All ${CAPABILITY_LIST.length} capabilities enabled for role: ${targetRole.toUpperCase()}.`);
    } catch (err: any) {
      showNotification(`Error updating permissions: ${err?.message || err}`);
    }
  };

  // Revoke All Capabilities for target role (Single write)
  const handleRevokeAll = async (targetRole: UserRole) => {
    if (!isAdmin) {
      showNotification('Administrator privileges required.');
      return;
    }

    try {
      const revokeAllPerms: RolePermissions = {
        canEditItems: false,
        canDeleteItems: false,
        canOpenProductDetail: false,
        canAdjustStock: false,
        canEditRecipes: false,
        canDeleteRecipes: false,
        canProduceBatch: false,
        canViewCostPerUnit: false,
        canViewTotalAssetValue: false,
        canViewFinances: false,
        canViewShelfOption: false,
        canViewBatchProductionOption: false,
        canViewAuditReports: false,
        canViewStockMovementsOption: false,
        canViewRolesAccessOption: false,
        canExportExcel: false,
        canSubmitAuditRequests: false,
        canAuditRequests: false,
        canManageUsers: targetRole === 'admin', // keep manage users on admin to prevent lockout
        ...tradePermissions(false),
        changeWindow: targetRole === 'admin' ? 'none' : '15m',
        canChangeOthersEntries: targetRole === 'admin',
      };
      await setRoleFullPermissions(targetRole, revokeAllPerms);
      showNotification(
        `All non-administrative capabilities revoked (Read-Only) for role: ${targetRole.toUpperCase()}.`
      );
    } catch (err: any) {
      showNotification(`Error revoking permissions: ${err?.message || err}`);
    }
  };

  // Reset target role to its default preset (Single write)
  const handleResetSingleRole = async (targetRole: UserRole) => {
    if (!isAdmin) {
      showNotification('Administrator privileges required.');
      return;
    }

    const defaultPerms = ROLE_PERMISSIONS[targetRole as keyof typeof ROLE_PERMISSIONS];
    if (!defaultPerms) {
      showNotification('This is a custom role. You can toggle switches individually.');
      return;
    }

    try {
      await setRoleFullPermissions(targetRole, defaultPerms);
      showNotification(`Role ${targetRole.toUpperCase()} has been restored to factory baseline defaults.`);
    } catch (err: any) {
      showNotification(`Failed to reset: ${err?.message || err}`);
    }
  };

  // Handle global reset to defaults
  const handleResetAllDefaults = () => {
    if (!isAdmin) {
      showNotification('Administrator privileges required to reset access rights.');
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: 'Reset Permissions to Factory Baseline?',
      message: 'Reset all built-in role access permissions to factory default configuration? Custom roles will be preserved.',
      confirmLabel: 'Reset All to Defaults',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await resetRolePermissions();
          showNotification('Built-in role permissions successfully reset to factory defaults.');
        } catch (err: any) {
          showNotification(`Failed to reset: ${err?.message || err}`);
        }
      },
    });
  };

  // Delete Custom Role
  const handleDeleteCustomRole = (roleDef: RoleDefinition) => {
    if (!isAdmin) {
      showNotification('Administrator privileges required to delete custom roles.');
      return;
    }

    if (roleDef.isSystem) {
      showNotification('Built-in system roles (Admin, Manager, Staff, Viewer) cannot be deleted.');
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: 'Delete Custom Role?',
      message: `Are you sure you want to delete the role "${roleDef.title}"? This cannot be undone.`,
      confirmLabel: 'Delete Role',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await deleteCustomRole(roleDef.id);
          setDraftRolePermissions((prev) => {
            const next = { ...prev };
            delete next[roleDef.id];
            return next;
          });
          showNotification(`Role "${roleDef.title}" has been deleted.`);
          if (editingRoleId === roleDef.id) {
            closeRoleDetailCleanly();
          }
        } catch (err: any) {
          showNotification(`Failed to delete role: ${err?.message || err}`);
        }
      },
    });
  };

  // Clone preset when creating custom role
  const handleClonePreset = (presetKey: 'manager' | 'staff' | 'viewer' | 'blank') => {
    if (presetKey === 'blank') {
      setNewRolePermissions({
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
        canViewAuditReports: false,
        canViewStockMovementsOption: false,
        canViewRolesAccessOption: false,
        canExportExcel: false,
        canSubmitAuditRequests: false,
        canAuditRequests: false,
        canManageUsers: false,
        ...tradePermissions(false),
        changeWindow: '2h',
        canChangeOthersEntries: false,
      });
      return;
    }
    const template = ROLE_PERMISSIONS[presetKey];
    if (template) {
      setNewRolePermissions({ ...template });
    }
  };

  const handleTitleChange = (val: string) => {
    setNewRoleTitle(val);
    if (!newRoleId || newRoleId === newRoleTitle.toLowerCase().replace(/[^a-z0-9]/g, '_')) {
      const generated = val
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .slice(0, 24);
      setNewRoleId(generated);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoleModalError(null);

    const cleanId = newRoleId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!cleanId) {
      setRoleModalError('Role identifier slug is required.');
      return;
    }

    if (!newRoleTitle.trim()) {
      setRoleModalError('Role title is required.');
      return;
    }

    if (allRoles.some((r) => r.id === cleanId)) {
      setRoleModalError(`Role identifier "${cleanId}" already exists. Please pick a distinct name.`);
      return;
    }

    setIsCreatingRole(true);
    try {
      await addCustomRole({
        id: cleanId,
        title: newRoleTitle.trim(),
        desc: newRoleDesc.trim() || `Custom role with designated permissions.`,
        badge: getBadgeClass(newRoleColor),
        color: newRoleColor,
        permissions: newRolePermissions,
      });

      showNotification(`Success: Role "${newRoleTitle.trim()}" created! You can now configure its access.`);
      setIsAddRoleModalOpen(false);
      setNewRoleTitle('');
      setNewRoleId('');
      setNewRoleDesc('');
      // Navigate directly to the new role's detail screen to control its access
      openRoleDetail(cleanId);
    } catch (err: any) {
      setRoleModalError(err?.message || 'Failed to create role');
    } finally {
      setIsCreatingRole(false);
    }
  };

  const getRoleDisplayName = (r?: RoleDefinition | null, fallbackId?: string): string => {
    const id = r?.id || fallbackId || '';
    if (id === 'admin') return 'Owner';
    if (id === 'manager') return 'Manager';
    if (id === 'staff') return 'Staff';
    if (id === 'viewer') return 'Viewer';
    return r?.title || id;
  };

  const getRoleMemberCount = (roleId: string): number => {
    if (activeUsers && activeUsers.length > 0) {
      return activeUsers.filter((m) => m.role === roleId).length;
    }
    return actualRole === roleId ? 1 : 0;
  };

  const formatMemberCount = (count: number): string => {
    return `${count} ${count === 1 ? 'member' : 'members'}`;
  };

  const openRoleDetail = (roleId: string) => {
    setIsMenuOpen(false);
    setFineTuneSection(null);
    setEditingRoleId(roleId);
    if (!roleDetailHistoryPushedRef.current) {
      window.history.pushState({ roleDetail: true }, '');
      roleDetailHistoryPushedRef.current = true;
    }
  };

  const closeRoleDetailCleanly = () => {
    setIsMenuOpen(false);
    setFineTuneSection(null);
    setEditingRoleId(null);
    if (roleDetailHistoryPushedRef.current) {
      roleDetailHistoryPushedRef.current = false;
      ignoreNextPopStateRef.current = true;
      window.history.back();
    }
  };

  // Effective role helper for Screen 2 (defaults to manager only for fallback type safety when null)
  const selectedRole = editingRoleId || 'manager';
  const selectedRoleDef = allRoles.find((r) => r.id === selectedRole) || allRoles[0];
  const selectedRoleDisplayName = getRoleDisplayName(selectedRoleDef, selectedRole);

  // Working permissions for a given role (Owner is always Full everywhere)
  const getWorkingPermissions = (roleId: string): RolePermissions => {
    if (roleId === 'admin') {
      return { ...ROLE_PERMISSIONS.admin };
    }
    return draftRolePermissions[roleId] || getRoleEffectivePermissions(roleId);
  };

  const getRoleDiffCount = (roleId: string): number => {
    if (roleId === 'admin') return 0;
    const draft = draftRolePermissions[roleId];
    if (!draft) return 0;
    const saved = getRoleEffectivePermissions(roleId);
    return (Object.keys(saved) as (keyof RolePermissions)[]).filter(
      (k) => draft[k] !== saved[k]
    ).length;
  };

  const savedPerms = getRoleEffectivePermissions(selectedRole);
  const workingPerms = getWorkingPermissions(selectedRole);

  const changedKeys =
    !editingRoleId || selectedRole === 'admin'
      ? []
      : (Object.keys(savedPerms) as (keyof RolePermissions)[]).filter(
          (k) => workingPerms[k] !== savedPerms[k]
        );
  const isDirty = changedKeys.length > 0;
  const diffCount = changedKeys.length;

  const hasAnyCustomMix = SECTIONS.some(
    (sec) => evaluateSectionLevel(sec, workingPerms).isCustomMix
  );

  // Back navigation from Screen 2 -> Screen 1 (with Discard changes? prompt if dirty)
  const handleBackToAllRoles = () => {
    if (!editingRoleId) return;
    if (isDirty) {
      setConfirmDialog({
        isOpen: true,
        title: 'Discard changes?',
        message: `You have ${diffCount} unsaved change${
          diffCount > 1 ? 's' : ''
        } for ${selectedRoleDisplayName}. Discard them and return to All roles?`,
        confirmLabel: 'Discard',
        isDestructive: true,
        onConfirm: () => {
          const targetRole = editingRoleId;
          setDraftRolePermissions((prev) => {
            const next = { ...prev };
            delete next[targetRole];
            return next;
          });
          closeRoleDetailCleanly();
        },
      });
      return;
    }
    closeRoleDetailCleanly();
  };

  // Phone / browser Back button support while Screen 2 is open
  useEffect(() => {
    const onPopState = () => {
      if (ignoreNextPopStateRef.current) {
        ignoreNextPopStateRef.current = false;
        return;
      }
      if (!editingRoleId) return;

      if (fineTuneSection) {
        setFineTuneSection(null);
        window.history.pushState({ roleDetail: true }, '');
        roleDetailHistoryPushedRef.current = true;
        return;
      }

      const currentDiff = getRoleDiffCount(editingRoleId);
      if (currentDiff > 0) {
        window.history.pushState({ roleDetail: true }, '');
        roleDetailHistoryPushedRef.current = true;
        const roleObj = allRoles.find((r) => r.id === editingRoleId);
        const rName = getRoleDisplayName(roleObj, editingRoleId);
        setConfirmDialog({
          isOpen: true,
          title: 'Discard changes?',
          message: `You have ${currentDiff} unsaved change${
            currentDiff > 1 ? 's' : ''
          } for ${rName}. Discard them and return to All roles?`,
          confirmLabel: 'Discard',
          isDestructive: true,
          onConfirm: () => {
            const targetRole = editingRoleId;
            setDraftRolePermissions((prev) => {
              const next = { ...prev };
              delete next[targetRole];
              return next;
            });
            closeRoleDetailCleanly();
          },
        });
      } else {
        roleDetailHistoryPushedRef.current = false;
        setIsMenuOpen(false);
        setFineTuneSection(null);
        setEditingRoleId(null);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  });

  // Switch top tab with discard prompt if inside a dirty Role Detail screen
  const handleSelectTab = (newTab: 'roles' | 'team') => {
    if (newTab === activeTab) {
      if (newTab === 'roles' && editingRoleId) {
        handleBackToAllRoles();
      }
      return;
    }
    if (editingRoleId && isDirty) {
      setConfirmDialog({
        isOpen: true,
        title: 'Discard changes?',
        message: `You have ${diffCount} unsaved change${
          diffCount > 1 ? 's' : ''
        } for ${selectedRoleDisplayName}. Discard them to switch tabs?`,
        confirmLabel: 'Discard & Switch',
        isDestructive: true,
        onConfirm: () => {
          const targetRole = editingRoleId;
          setDraftRolePermissions((prev) => {
            const next = { ...prev };
            delete next[targetRole];
            return next;
          });
          closeRoleDetailCleanly();
          setActiveTab(newTab);
        },
      });
      return;
    }
    if (editingRoleId) {
      closeRoleDetailCleanly();
    }
    setActiveTab(newTab);
  };

  // Trigger "Test this role" (from Screen 1 card OR Screen 2 top bar / menu)
  const handleTriggerTestRole = (targetRoleId: string) => {
    if (targetRoleId === 'admin') return;
    if (!canManageTeam) return;

    const unsavedCount = getRoleDiffCount(targetRoleId);
    if (unsavedCount > 0) {
      setTestUnsavedRoleId(targetRoleId);
      return;
    }

    if (editingRoleId) {
      closeRoleDetailCleanly();
    }
    switchSimulatedRole(targetRoleId as UserRole);
  };

  const handleSaveAndTestRole = async () => {
    if (!testUnsavedRoleId) return;
    const targetRoleId = testUnsavedRoleId;
    const draft = draftRolePermissions[targetRoleId];
    if (!draft) {
      setTestUnsavedRoleId(null);
      if (editingRoleId) closeRoleDetailCleanly();
      switchSimulatedRole(targetRoleId as UserRole);
      return;
    }

    setIsSaving(true);
    try {
      await setRoleFullPermissions(targetRoleId as UserRole, draft);
      setDraftRolePermissions((prev) => {
        const next = { ...prev };
        delete next[targetRoleId];
        return next;
      });
      setTestUnsavedRoleId(null);
      if (editingRoleId) {
        closeRoleDetailCleanly();
      }
      switchSimulatedRole(targetRoleId as UserRole);
    } catch (err: any) {
      showNotification(`Failed to save permissions before testing: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestWithoutSavingRole = () => {
    if (!testUnsavedRoleId) return;
    const targetRoleId = testUnsavedRoleId;
    setTestUnsavedRoleId(null);
    if (editingRoleId) {
      closeRoleDetailCleanly();
    }
    switchSimulatedRole(targetRoleId as UserRole);
  };

  // Rename custom role
  const handleSubmitRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoleId || selectedRoleDef?.isSystem) return;
    const trimmed = renameTitleInput.trim();
    if (!trimmed) {
      setRenameError('Role name cannot be empty.');
      return;
    }
    setIsRenaming(true);
    setRenameError(null);
    try {
      await renameCustomRole(editingRoleId, trimmed);
      setIsRenameModalOpen(false);
      showNotification(`Role renamed to "${trimmed}".`);
    } catch (err: any) {
      setRenameError(err?.message || 'Failed to rename role.');
    } finally {
      setIsRenaming(false);
    }
  };

  // Set standard level for a section (Hidden, View, Work, Full)
  const handleSetSectionLevel = (section: SectionDefinition, targetLevel: AccessLevel) => {
    if (selectedRole === 'admin') return; // Owner locked
    if (!isAdmin) {
      showNotification('Administrator privileges required to change permissions.');
      return;
    }

    const updatedRolePerms: RolePermissions = { ...workingPerms };

    // Reset all keys in this section to false first
    section.allKeys.forEach((key) => {
      if (key === 'changeWindow') return;
      updatedRolePerms[key] = false;
    });

    if (targetLevel === 'View') {
      section.viewKeys.forEach((key) => {
        if (key === 'changeWindow') return;
        updatedRolePerms[key] = true;
      });
    } else if (targetLevel === 'Work' && section.workKeys) {
      section.workKeys.forEach((key) => {
        if (key === 'changeWindow') return;
        updatedRolePerms[key] = true;
      });
    } else if (targetLevel === 'Full') {
      section.fullKeys.forEach((key) => {
        if (key === 'changeWindow') return;
        updatedRolePerms[key] = true;
      });
    }
    // Hidden leaves all false

    setDraftRolePermissions((prev) => ({
      ...prev,
      [selectedRole]: updatedRolePerms,
    }));
  };

  // Toggle single capability switch inside Fine-tune bottom sheet or Time-limit card
  const handleToggleCapabilityInDraft = (key: keyof RolePermissions) => {
    if (selectedRole === 'admin') return; // Owner locked
    if (!isAdmin) {
      showNotification('Administrator privileges required.');
      return;
    }
    if (key === 'changeWindow') return;

    const updatedRolePerms: RolePermissions = {
      ...workingPerms,
      [key]: !workingPerms[key],
    };

    setDraftRolePermissions((prev) => ({
      ...prev,
      [selectedRole]: updatedRolePerms,
    }));
  };

  const handleSetChangeWindowInDraft = (win: ChangeWindow) => {
    if (selectedRole === 'admin') return;
    if (!isAdmin) {
      showNotification('Administrator privileges required.');
      return;
    }
    const updatedRolePerms: RolePermissions = {
      ...workingPerms,
      changeWindow: win,
    };
    setDraftRolePermissions((prev) => ({
      ...prev,
      [selectedRole]: updatedRolePerms,
    }));
  };

  // Save changes to Firestore and return to Screen 1 (All roles)
  const handleSaveChanges = async () => {
    if (!isAdmin) {
      showNotification('Administrator privileges required to save permissions.');
      return;
    }
    if (!isDirty || selectedRole === 'admin') return;

    setIsSaving(true);
    try {
      await setRoleFullPermissions(selectedRole as UserRole, workingPerms);
      setDraftRolePermissions((prev) => {
        const next = { ...prev };
        delete next[selectedRole];
        return next;
      });
      showNotification(
        `Permissions for ${selectedRoleDisplayName} saved successfully.`
      );
      closeRoleDetailCleanly();
    } catch (err: any) {
      showNotification(`Failed to save permissions: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Undo changes
  const handleUndoChanges = () => {
    if (!isDirty) return;
    setDraftRolePermissions((prev) => {
      const next = { ...prev };
      delete next[selectedRole];
      return next;
    });
    showNotification('Unsaved changes reverted.');
  };

  // Prompt to copy permissions from another role
  const promptCopyFrom = (sourceRoleId: string, sourceTitle: string) => {
    const targetTitle = selectedRoleDisplayName;
    setConfirmDialog({
      isOpen: true,
      title: 'Copy Permissions?',
      message: `Copy all access permissions from "${sourceTitle}" into "${targetTitle}"? This will overwrite the working permissions for ${targetTitle}.`,
      confirmLabel: 'Copy Permissions',
      onConfirm: () => {
        const sourcePerms =
          sourceRoleId === 'admin'
            ? getWorkingPermissions('admin')
            : getRoleEffectivePermissions(sourceRoleId);
        setDraftRolePermissions((prev) => ({
          ...prev,
          [selectedRole]: { ...sourcePerms },
        }));
        showNotification(
          `Permissions copied from ${sourceTitle} into ${targetTitle}. Review and tap Save.`
        );
      },
    });
  };

  // Prompt reset single role to default
  const promptResetSingleRole = (targetRole: UserRole) => {
    const defaultPerms = ROLE_PERMISSIONS[targetRole as keyof typeof ROLE_PERMISSIONS];
    if (!defaultPerms) return;
    const roleTitle = selectedRoleDisplayName;
    setConfirmDialog({
      isOpen: true,
      title: `Reset ${roleTitle} to Factory Defaults?`,
      message: `Restore ${roleTitle} permissions to the standard baseline configuration?`,
      confirmLabel: 'Reset to Default',
      isDestructive: true,
      onConfirm: async () => {
        try {
          await setRoleFullPermissions(targetRole, defaultPerms);
          setDraftRolePermissions((prev) => {
            const next = { ...prev };
            delete next[targetRole];
            return next;
          });
          showNotification(`${roleTitle} restored to factory baseline.`);
        } catch (err: any) {
          showNotification(`Failed to reset: ${err?.message || err}`);
        }
      },
    });
  };

  const getAccessChipStyle = (level: SectionEvalLevel): string => {
    switch (level) {
      case 'Full':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Work':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'View':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'Custom':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'Hidden':
      default:
        return 'bg-slate-50 text-slate-400 border-slate-200/70 line-through';
    }
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-16">
      {/* Action Feedback Banner */}
      {actionFeedback && (
        <div className="p-3.5 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-900 text-xs flex items-center justify-between shadow-2xs animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="font-semibold">{actionFeedback}</span>
          </div>
          <button
            onClick={() => setActionFeedback(null)}
            className="text-indigo-600 hover:text-indigo-900 text-xs font-bold px-2 py-0.5 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top navigation tabs: Roles vs Team Directory */}
      {isAdmin && (
        <div className="flex border-b border-slate-200 gap-2">
          <button
            type="button"
            onClick={() => handleSelectTab('roles')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition cursor-pointer ${
              activeTab === 'roles'
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Roles</span>
          </button>
          <button
            type="button"
            onClick={() => handleSelectTab('team')}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition cursor-pointer relative ${
              activeTab === 'team'
                ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-xl'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Team &amp; Member Access</span>
            {pendingUsers.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white animate-pulse">
                {pendingUsers.length}
              </span>
            )}
          </button>
        </div>
      )}

      {activeTab === 'roles' ? (
        editingRoleId === null ? (
          /* =================================================================== */
          /* SCREEN 1 — ALL ROLES                                                */
          /* =================================================================== */
          <div className="space-y-4">
            {/* Top right: "＋ New Role" button */}
            {canManageTeam && (
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    handleClonePreset('staff');
                    setNewRoleTitle('');
                    setNewRoleId('');
                    setRoleModalError(null);
                    setIsAddRoleModalOpen(true);
                  }}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition inline-flex items-center gap-1.5 cursor-pointer shrink-0 active:scale-95"
                >
                  <span>＋ New Role</span>
                </button>
              </div>
            )}

            {/* One clickable card per role */}
            <div className="space-y-3">
              {allRoles.map((r) => {
                const isOwner = r.id === 'admin';
                const displayName = getRoleDisplayName(r);
                const memberCount = getRoleMemberCount(r.id);
                const roleSavedPerms = getRoleEffectivePermissions(r.id);
                const hasUnsavedDraft = getRoleDiffCount(r.id) > 0;

                return (
                  <div
                    key={`role-card-${r.id}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => openRoleDetail(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openRoleDetail(r.id);
                      }
                    }}
                    className="bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm p-4 transition cursor-pointer flex flex-col gap-2.5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        {/* Role name (bold) + Custom badge + member count */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm sm:text-base font-bold text-slate-900">
                            {displayName}
                          </span>
                          {!r.isSystem && (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                              Custom
                            </span>
                          )}
                          <span className="text-xs text-slate-500 font-medium">
                            · {formatMemberCount(memberCount)}
                          </span>
                          {hasUnsavedDraft && (
                            <span
                              className="w-2 h-2 rounded-full bg-amber-400 shrink-0"
                              title="Unsaved changes"
                            />
                          )}
                        </div>

                        {/* Summary chips OR Owner lock line */}
                        {isOwner ? (
                          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                            <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                            <span>Full access · cannot be changed</span>
                          </div>
                        ) : (
                          <div className="line-clamp-2 overflow-hidden leading-6 text-xs text-slate-400">
                            {SECTIONS.map((sec) => {
                              const evalRes = evaluateSectionLevel(sec, roleSavedPerms);
                              const shortLabel = SECTION_SHORT_LABELS[sec.id] || sec.name;
                              return (
                                <span
                                  key={`chip-${r.id}-${sec.id}`}
                                  className={`inline-block px-2 py-0.5 mr-1.5 mb-1 rounded-md text-[11px] leading-4 font-semibold border align-middle whitespace-nowrap ${getAccessChipStyle(
                                    evalRes.level
                                  )}`}
                                >
                                  {shortLabel} {evalRes.displayLevel}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Right arrow › */}
                      <ChevronRight className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                    </div>

                    {/* Bottom-right: 👁 Test this role (every role except Owner, only for users who can manage team / admins) */}
                    {!isOwner && canManageTeam && (
                      <div className="flex items-center justify-end pt-0.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTriggerTestRole(r.id);
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 transition cursor-pointer active:scale-95"
                        >
                          <span aria-hidden="true">👁</span>
                          <span>Test this role</span>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* =================================================================== */
          /* SCREEN 2 — ROLE DETAIL                                              */
          /* =================================================================== */
          <div className="space-y-4">
            {/* Top bar: ← All roles, role name, member count, 👁 Test this role, ⋮ menu */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1 min-w-0">
                <button
                  type="button"
                  onClick={handleBackToAllRoles}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer"
                >
                  <ArrowLeft className="w-4 h-4 shrink-0" />
                  <span>All roles</span>
                </button>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-slate-900">
                    {selectedRoleDisplayName}
                  </h2>
                  {!selectedRoleDef?.isSystem && (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                      Custom
                    </span>
                  )}
                  <span className="text-xs text-slate-500 font-medium">
                    · {formatMemberCount(getRoleMemberCount(selectedRole))}
                  </span>
                </div>
              </div>

              {/* Right actions (Hidden for Owner) */}
              {selectedRole !== 'admin' && canManageTeam && (
                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                  <button
                    type="button"
                    onClick={() => handleTriggerTestRole(selectedRole)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-indigo-50 hover:text-indigo-700 border border-slate-200 hover:border-indigo-200 shadow-2xs transition cursor-pointer active:scale-95"
                  >
                    <span aria-hidden="true">👁</span>
                    <span>Test this role</span>
                  </button>

                  {isAdmin && (
                    <div className="relative shrink-0" ref={menuRef}>
                      <button
                        type="button"
                        onClick={() => setIsMenuOpen((v) => !v)}
                        className="w-8 h-8 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 flex items-center justify-center transition cursor-pointer shadow-2xs"
                        title="Role options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {isMenuOpen && (
                        <div className="absolute right-0 top-full mt-1.5 w-52 bg-white rounded-2xl shadow-xl border border-slate-200 py-1.5 z-40 animate-in fade-in zoom-in-95 duration-100">
                          {/* Test this role */}
                          <button
                            type="button"
                            onClick={() => {
                              setIsMenuOpen(false);
                              handleTriggerTestRole(selectedRole);
                            }}
                            className="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center gap-2 transition cursor-pointer"
                          >
                            <span aria-hidden="true">👁</span>
                            <span>Test this role</span>
                          </button>

                          {/* Copy from… */}
                          <button
                            type="button"
                            onClick={() => {
                              setIsMenuOpen(false);
                              setIsCopyFromModalOpen(true);
                            }}
                            className="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center gap-2 transition cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5 text-slate-400" />
                            <span>Copy from…</span>
                          </button>

                          {/* ↺ Reset to default */}
                          {selectedRoleDef?.isSystem && selectedRole !== 'admin' && (
                            <button
                              type="button"
                              onClick={() => {
                                setIsMenuOpen(false);
                                promptResetSingleRole(selectedRole as UserRole);
                              }}
                              className="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition cursor-pointer"
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                              <span>↺ Reset to default</span>
                            </button>
                          )}

                          {/* Custom role actions: Rename & Delete role */}
                          {!selectedRoleDef?.isSystem && (
                            <>
                              <div className="my-1 border-t border-slate-100" />
                              <button
                                type="button"
                                onClick={() => {
                                  setIsMenuOpen(false);
                                  setRenameTitleInput(selectedRoleDef?.title || '');
                                  setRenameError(null);
                                  setIsRenameModalOpen(true);
                                }}
                                className="w-full text-left px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5 text-slate-400" />
                                <span>Rename</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setIsMenuOpen(false);
                                  handleDeleteCustomRole(selectedRoleDef!);
                                }}
                                className="w-full text-left px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                <span>Delete role</span>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Small grey line explaining the levels */}
            <p className="text-xs text-slate-500">
              Hidden = can&apos;t see · View = look only · Work = create &amp; update · Full = also edit &amp; delete
            </p>

            {/* Owner read-only banner */}
            {selectedRole === 'admin' && (
              <div className="p-3 sm:p-3.5 rounded-xl bg-amber-50/80 border border-amber-200 text-amber-900 text-xs font-semibold flex items-center gap-2.5 shadow-2xs">
                <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Full access · cannot be changed (Owner always has full access)</span>
              </div>
            )}

            {/* T3 Section Cards (Hidden / View / Work / Full + Fine-tune ›) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 sm:gap-4">
              {SECTIONS.map((section) => {
                const evalResult = evaluateSectionLevel(section, workingPerms);
                const isOwner = selectedRole === 'admin';
                const isTeam = section.id === 'team';
                const options: AccessLevel[] = isTeam
                  ? ['Hidden', 'View', 'Full']
                  : ['Hidden', 'View', 'Work', 'Full'];

                return (
                  <div
                    key={`section-card-${section.id}`}
                    className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-4.5 shadow-2xs space-y-3 flex flex-col justify-between"
                  >
                    <div>
                      {/* Header */}
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-lg shrink-0">{section.icon}</span>
                          <h3 className="text-sm font-bold text-slate-900 truncate">
                            {section.name}
                          </h3>
                          {!isOwner && evalResult.level === 'Custom' && (
                            <span
                              className={`px-2 py-0.5 rounded-md text-[11px] leading-4 font-semibold border shrink-0 ${getAccessChipStyle(
                                evalResult.level
                              )}`}
                            >
                              {evalResult.displayLevel}
                            </span>
                          )}
                        </div>
                        {!isOwner ? (
                          <button
                            type="button"
                            onClick={() => setFineTuneSection(section)}
                            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer shrink-0"
                          >
                            Fine-tune ›
                          </button>
                        ) : (
                          <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1 shrink-0">
                            <Lock className="w-3 h-3" />
                            Locked
                          </span>
                        )}
                      </div>

                      {/* Segmented Control */}
                      <div
                        className={`grid ${
                          isTeam ? 'grid-cols-3' : 'grid-cols-4'
                        } gap-1 p-1 bg-slate-100 rounded-xl select-none`}
                      >
                        {options.map((opt) => {
                          const isSelected = isOwner
                            ? opt === 'Full'
                            : evalResult.level === opt;
                          const buttonLabel = isOwner
                            ? opt
                            : isSelected
                            ? evalResult.displayLevel
                            : opt;

                          return (
                            <button
                              key={`${section.id}-${opt}`}
                              type="button"
                              disabled={isOwner || !isAdmin}
                              onClick={() => handleSetSectionLevel(section, opt)}
                              className={`py-2 text-xs rounded-lg transition font-bold text-center ${
                                isSelected
                                  ? 'bg-indigo-600 text-white shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                              } ${isOwner || !isAdmin ? 'cursor-default' : 'cursor-pointer'}`}
                            >
                              {buttonLabel}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* One small grey line saying what this role can do */}
                    <p className="text-xs text-slate-500 leading-relaxed min-h-[18px]">
                      {isOwner ? section.descriptions.full : evalResult.summary}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Time limit for changes card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-4.5 shadow-2xs space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900">Time limit for changes</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Controls editing or removing sales bills, payments, stock entries, and production batches
                    </p>
                  </div>
                </div>
                {selectedRole === 'admin' && (
                  <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1 shrink-0">
                    <Lock className="w-3 h-3" />
                    Locked
                  </span>
                )}
              </div>

              {selectedRole === 'admin' ? (
                <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 flex items-center justify-between gap-2">
                  <span>No limit · all entries</span>
                  <span className="text-[11px] font-normal text-slate-500">Owner</span>
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900">Change window</p>
                      <p className="text-[11px] text-slate-500">
                        After this window passes, past entries lock automatically
                      </p>
                    </div>
                    <select
                      value={workingPerms.changeWindow || '2h'}
                      disabled={!isAdmin}
                      onChange={(e) => handleSetChangeWindowInDraft(e.target.value as ChangeWindow)}
                      aria-label="Time limit for changes"
                      className="h-9 px-3 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 shrink-0"
                    >
                      {CHANGE_WINDOW_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="text-xs font-bold text-slate-900">
                        Can change other people&apos;s entries
                      </p>
                      <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                        When off, this role can only change entries they created themselves
                      </p>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(workingPerms.canChangeOthersEntries)}
                      disabled={!isAdmin}
                      onClick={() => handleToggleCapabilityInDraft('canChangeOthersEntries')}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        workingPerms.canChangeOthersEntries ? 'bg-indigo-600' : 'bg-slate-300'
                      } ${!isAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
                          workingPerms.canChangeOthersEntries ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      >
                        {workingPerms.canChangeOthersEntries ? (
                          <Check className="w-3 h-3 text-indigo-600 stroke-[3]" />
                        ) : (
                          <X className="w-2.5 h-2.5 text-slate-400 stroke-[2.5]" />
                        )}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Sticky Bottom Bar: "{n} changes · Undo · Save" */}
            <div
              style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
              className="sticky bottom-0 z-30 -mx-4 sm:-mx-6 -mb-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-lg flex items-center justify-between gap-3"
            >
              <div>
                {selectedRole === 'admin' ? (
                  <span className="text-xs font-medium text-slate-500 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-600" />
                    Owner always has full access
                  </span>
                ) : isDirty ? (
                  <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    {diffCount} change{diffCount > 1 ? 's' : ''}
                  </span>
                ) : hasAnyCustomMix ? (
                  <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                    <span>✱ custom mix</span>
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">0 changes</span>
                )}
              </div>

              {selectedRole !== 'admin' && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleUndoChanges}
                    disabled={!isDirty || isSaving}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 rounded-xl transition cursor-pointer"
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveChanges}
                    disabled={!isDirty || isSaving}
                    className="text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed px-4 py-2 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {/* "Fine-tune ›" Bottom Sheet */}
            {fineTuneSection && (() => {
              const fineTuneEval = evaluateSectionLevel(fineTuneSection, workingPerms);
              return (
              <div
                onClick={(e) => {
                  if (e.target === e.currentTarget) setFineTuneSection(null);
                }}
                className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
              >
                <div
                  style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
                  className="bg-white rounded-t-3xl sm:rounded-2xl max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden animate-in slide-in-from-bottom sm:zoom-in-95 duration-200"
                >
                  {/* Header */}
                  <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0 gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xl shrink-0">{fineTuneSection.icon}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-bold text-slate-900">
                            Fine-tune {fineTuneSection.name}
                          </h3>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] leading-4 font-semibold border ${getAccessChipStyle(
                              fineTuneEval.level
                            )}`}
                          >
                            {fineTuneEval.displayLevel}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {selectedRoleDisplayName} · {fineTuneEval.summary}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFineTuneSection(null)}
                      className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition cursor-pointer shrink-0"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Switches List */}
                  <div className="p-4 sm:p-5 divide-y divide-slate-100 overflow-y-auto space-y-1">
                    {fineTuneSection.allKeys.map((key) => {
                      const meta = PERMISSION_META[key];
                      const isAllowed = Boolean(workingPerms[key]);
                      const isLockedAdmin =
                        selectedRole === 'admin' && key === 'canManageUsers';

                      return (
                        <div
                          key={`finetune-${key}`}
                          className="py-3 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <p className="text-xs font-bold text-slate-900">
                              {meta?.shortName || key}
                            </p>
                            <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                              {meta?.desc || ''}
                            </p>
                          </div>

                          {/* Interactive iOS toggle switch */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isAllowed}
                            disabled={!isAdmin || isLockedAdmin || selectedRole === 'admin'}
                            onClick={() => handleToggleCapabilityInDraft(key)}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              isAllowed ? 'bg-indigo-600' : 'bg-slate-300'
                            } ${
                              !isAdmin || isLockedAdmin || selectedRole === 'admin'
                                ? 'opacity-60 cursor-not-allowed'
                                : ''
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
                                isAllowed ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            >
                              {isAllowed ? (
                                <Check className="w-3 h-3 text-indigo-600 stroke-[3]" />
                              ) : (
                                <X className="w-2.5 h-2.5 text-slate-400 stroke-[2.5]" />
                              )}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer */}
                  <div className="p-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => setFineTuneSection(null)}
                      className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition cursor-pointer shadow-xs"
                    >
                      Done
                    </button>
                  </div>
                </div>
              </div>
              );
            })()}
          </div>
        )
      ) : (
            /* ======================================================================= */
            /* TEAM & MEMBER ACCESS (ADMIN ONLY)                                      */
            /* ======================================================================= */
            <div className="space-y-6">
              {/* SECTION 1: PENDING APPROVALS */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-amber-500" />
                    <div>
                      <h2 className="text-sm sm:text-base font-bold text-slate-900">
                        Pending User Approvals ({pendingUsers.length})
                      </h2>
                      <p className="text-xs text-slate-500">
                        New signups require Admin approval before accessing inventory data
                      </p>
                    </div>
                  </div>
                </div>

                {pendingUsers.length === 0 ? (
                  <div className="p-4 bg-slate-50 rounded-xl text-center text-xs text-slate-500 border border-dashed border-slate-200">
                    No pending approval requests. All user registrations have been processed.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {pendingUsers.map((pUser) => {
                      const selectedRole = approvalRoles[pUser.uid] || 'staff';
                      return (
                        <div
                          key={`pending-${pUser.uid}`}
                          className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 font-bold flex items-center justify-center shrink-0">
                              {(pUser.displayName || pUser.email || 'U')[0].toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900">
                                {pUser.displayName || 'Unnamed User'}
                              </p>
                              <p className="text-xs text-slate-500 font-mono">{pUser.email}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap">
                            <select
                              value={selectedRole}
                              onChange={(e) =>
                                setApprovalRoles((prev) => ({
                                  ...prev,
                                  [pUser.uid]: e.target.value as UserRole,
                                }))
                              }
                              className="h-[38px] px-2.5 text-sm rounded-xl border border-slate-300 bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              {allRoles.map((r) => (
                                <option key={r.id} value={r.id}>
                                  Assign as {getRoleDisplayName(r)}
                                </option>
                              ))}
                            </select>

                            <button
                              type="button"
                              onClick={() => handleApproveUser(pUser.uid)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition shadow-xs cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Approve</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRejectUser(pUser.uid)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 active:scale-95 transition cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Reject</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* SECTION 2: INVITE BY EMAIL */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                <div className="flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-indigo-600" />
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-slate-900">Invite New Team Member</h2>
                    <p className="text-xs text-slate-500">
                      Pre-authorized emails automatically receive the chosen role upon signup and email verification
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSendInvite} className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="email"
                      required
                      placeholder="colleague@domain.com"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      className="w-full h-[38px] pl-9 pr-3 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    />
                  </div>

                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as UserRole)}
                    className="h-[38px] px-3 text-sm rounded-xl border border-slate-300 bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {allRoles
                      .filter((r) => r.id !== 'admin')
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {getRoleDisplayName(r)}
                        </option>
                      ))}
                  </select>

                  <button
                    type="submit"
                    disabled={isInviting || !inviteEmail.trim()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl shadow-xs transition inline-flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{isInviting ? 'Inviting...' : 'Send Invite'}</span>
                  </button>
                </form>

                {/* Pending Invites List */}
                {invites.length > 0 && (
                  <div className="pt-2 border-t border-slate-100">
                    <p className="text-xs font-bold text-slate-700 mb-2">Pending Pre-Authorizations:</p>
                    <div className="space-y-1.5">
                      {invites.map((inv) => (
                        <div
                          key={`invite-${inv.id}`}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <Mail className="w-3.5 h-3.5 text-slate-400" />
                            <span className="font-mono text-slate-800">{inv.email}</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 uppercase">
                              {inv.role}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCancelInvite(inv.id)}
                            className="text-xs text-rose-600 hover:text-rose-800 font-semibold cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION 3: ACTIVE & SUSPENDED USERS DIRECTORY */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-emerald-600" />
                  <div>
                    <h2 className="text-sm sm:text-base font-bold text-slate-900">
                      Team Directory ({teamMembers.length})
                    </h2>
                    <p className="text-xs text-slate-500">
                      Manage permissions, update user roles, or suspend access
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {teamMembers.map((member) => {
                    const isRootAdmin = member.email?.toLowerCase() === 'kishanlimbani29@gmail.com';
                    const isSuspended = member.status === 'suspended';

                    return (
                      <div
                        key={`member-${member.uid}`}
                        className={`py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isSuspended ? 'opacity-70 bg-slate-50/50 p-2 rounded-xl' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-10 h-10 rounded-full font-bold flex items-center justify-center shrink-0 ${
                              isSuspended
                                ? 'bg-rose-100 text-rose-700'
                                : 'bg-indigo-100 text-indigo-700'
                            }`}
                          >
                            {(member.displayName || member.email || 'U')[0].toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-bold text-slate-900">
                                {member.displayName || 'Team Member'}
                              </p>
                              {isRootAdmin && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200">
                                  <Crown className="w-3 h-3 text-amber-600" />
                                  <span>Owner</span>
                                </span>
                              )}
                              {isSuspended && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">
                                  Suspended
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 font-mono">{member.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {/* Role Changer Dropdown */}
                          <select
                            value={member.role}
                            disabled={isRootAdmin}
                            onChange={(e) =>
                              handleRoleChange(member.uid, e.target.value as UserRole)
                            }
                            title={
                              isRootAdmin
                                ? 'Owner role is protected'
                                : 'Change this member role'
                            }
                            className={`h-[38px] px-2.5 text-sm rounded-xl border border-slate-300 bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                              isRootAdmin ? 'bg-slate-100 cursor-not-allowed opacity-70' : ''
                            }`}
                          >
                            {allRoles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {getRoleDisplayName(r)}
                              </option>
                            ))}
                          </select>

                          {/* Suspend / Reactivate button */}
                          {!isRootAdmin && (
                            <button
                              type="button"
                              onClick={() => handleStatusToggle(member.uid, member.status)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                                isSuspended
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                              }`}
                            >
                              {isSuspended ? 'Reactivate' : 'Suspend'}
                            </button>
                          )}

                          {/* Remove button */}
                          {!isRootAdmin && (
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveMember(
                                  member.uid,
                                  member.displayName || member.email || 'Member'
                                )
                              }
                              className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition cursor-pointer"
                              title="Remove member from system"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

      {/* ========================================================================= */}
      {/* MODAL DIALOG: ADD NEW CUSTOM ROLE                                         */}
      {/* ========================================================================= */}
      {isAddRoleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Add New Role to RBAC</h3>
                  <p className="text-xs text-slate-500">
                    Create a custom role and configure its access controls
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddRoleModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200/60 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleCreateRole} className="p-6 space-y-5 overflow-y-auto flex-1">
              {roleModalError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{roleModalError}</span>
                </div>
              )}

              {/* Quick Template Presets */}
              <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-100 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                    <Copy className="w-3.5 h-3.5 text-indigo-600" />
                    Quick Base Preset (Clone rights from existing role):
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    type="button"
                    onClick={() => handleClonePreset('manager')}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-900 transition text-center shadow-2xs cursor-pointer"
                  >
                    Like Manager
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClonePreset('staff')}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white border border-amber-200 hover:bg-amber-50 text-amber-900 transition text-center shadow-2xs cursor-pointer"
                  >
                    Like Staff
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClonePreset('viewer')}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 transition text-center shadow-2xs cursor-pointer"
                  >
                    Like Viewer
                  </button>
                  <button
                    type="button"
                    onClick={() => handleClonePreset('blank')}
                    className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-white border border-purple-200 hover:bg-purple-50 text-purple-900 transition text-center shadow-2xs cursor-pointer"
                  >
                    Empty / Deny All
                  </button>
                </div>
              </div>

              {/* Role Name and Slug */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Role Title / Display Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newRoleTitle}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="e.g., Line Supervisor, QC Inspector, Store Keeper"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Displayed on badges and cards</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Role Key / Identifier *
                  </label>
                  <input
                    type="text"
                    required
                    value={newRoleId}
                    onChange={(e) =>
                      setNewRoleId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_'))
                    }
                    placeholder="e.g., line_supervisor"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50 font-mono text-slate-700"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5">Internal slug identifier</p>
                </div>
              </div>

              {/* Description & Color Theme */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Description & Duties
                  </label>
                  <input
                    type="text"
                    value={newRoleDesc}
                    onChange={(e) => setNewRoleDesc(e.target.value)}
                    placeholder="e.g., Supervises assembly lines and verifies BOM batch executions."
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Color Theme</label>
                  <div className="flex items-center gap-2 pt-1">
                    {[
                      { id: 'purple', bg: 'bg-purple-500' },
                      { id: 'indigo', bg: 'bg-indigo-500' },
                      { id: 'cyan', bg: 'bg-cyan-500' },
                      { id: 'emerald', bg: 'bg-emerald-500' },
                      { id: 'amber', bg: 'bg-amber-500' },
                      { id: 'rose', bg: 'bg-rose-500' },
                    ].map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setNewRoleColor(c.id)}
                        className={`w-7 h-7 rounded-full ${c.bg} transition transform ${
                          newRoleColor === c.id
                            ? 'ring-2 ring-offset-2 ring-indigo-600 scale-110'
                            : 'opacity-70 hover:opacity-100 hover:scale-105'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Initial Permission Switches */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <span className="text-xs font-bold text-slate-800">
                  Initial Permission Capabilities:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {CAPABILITY_LIST.map((cap) => {
                    const isChecked = newRolePermissions[cap.key];
                    return (
                      <div
                        key={`new-perm-${cap.key}`}
                        onClick={() =>
                          setNewRolePermissions((prev) => ({
                            ...prev,
                            [cap.key]: !prev[cap.key],
                          }))
                        }
                        className={`p-2.5 rounded-xl border text-xs flex items-center justify-between cursor-pointer transition ${
                          isChecked
                            ? 'bg-indigo-50/50 border-indigo-200 text-indigo-950 font-semibold'
                            : 'bg-slate-50/70 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <span className="truncate pr-2">{cap.title}</span>
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                            isChecked ? 'bg-indigo-600 text-white' : 'border border-slate-300 bg-white'
                          }`}
                        >
                          {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Modal Actions */}
              <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddRoleModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-xl transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingRole}
                  className="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  {isCreatingRole ? (
                    <span>Creating...</span>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      <span>Create Role & Open Access Control</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Copy Permissions From Modal */}
      {isCopyFromModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsCopyFromModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Copy permissions from…</h3>
              <button
                type="button"
                onClick={() => setIsCopyFromModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Choose a role to copy all access levels into {selectedRoleDisplayName}:
            </p>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {allRoles
                .filter((r) => r.id !== selectedRole)
                .map((r) => {
                  const rName = getRoleDisplayName(r);
                  return (
                    <button
                      key={`copy-modal-${r.id}`}
                      type="button"
                      onClick={() => {
                        setIsCopyFromModalOpen(false);
                        promptCopyFrom(r.id, rName);
                      }}
                      className="w-full text-left px-3.5 py-2.5 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 text-xs font-bold text-slate-800 flex items-center justify-between transition cursor-pointer"
                    >
                      <span>{rName}</span>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Rename Custom Role Modal */}
      {isRenameModalOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsRenameModalOpen(false);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
        >
          <form
            onSubmit={handleSubmitRename}
            className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Rename Role</h3>
              <button
                type="button"
                onClick={() => setIsRenameModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {renameError && (
              <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {renameError}
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Role Name
              </label>
              <input
                type="text"
                required
                autoFocus
                value={renameTitleInput}
                onChange={(e) => setRenameTitleInput(e.target.value)}
                placeholder="e.g., Line Supervisor"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsRenameModalOpen(false)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isRenaming || !renameTitleInput.trim()}
                className="flex-1 py-2 text-xs font-bold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition shadow-xs cursor-pointer"
              >
                {isRenaming ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Save Changes Before Testing Modal */}
      {testUnsavedRoleId && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setTestUnsavedRoleId(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 space-y-3.5">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 text-base">
                👁
              </div>
              <button
                type="button"
                onClick={() => setTestUnsavedRoleId(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Save changes before testing?
              </h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {getRoleDisplayName(
                  allRoles.find((r) => r.id === testUnsavedRoleId),
                  testUnsavedRoleId
                )}{' '}
                has unsaved permission changes. Save them before starting the role preview, or test using currently saved permissions?
              </p>
            </div>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveAndTestRole}
                className="w-full py-2.5 text-xs font-bold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition shadow-xs cursor-pointer"
              >
                {isSaving ? 'Saving...' : 'Save & test'}
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={handleTestWithoutSavingRole}
                className="w-full py-2 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition cursor-pointer"
              >
                Test without saving
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setTestUnsavedRoleId(null)}
                className="w-full py-2 text-xs font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {confirmDialog && confirmDialog.isOpen && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmDialog(null);
          }}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
        >
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150 space-y-3">
            <div className="flex items-start justify-between">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  confirmDialog.isDestructive ? 'bg-rose-100 text-rose-600' : 'bg-indigo-100 text-indigo-600'
                }`}
              >
                {confirmDialog.isDestructive ? <Trash2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              </div>
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">{confirmDialog.title}</h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">{confirmDialog.message}</p>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="flex-1 py-2 text-xs font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const action = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  await action();
                }}
                className={`flex-1 py-2 text-xs font-bold rounded-xl text-white transition shadow-xs cursor-pointer ${
                  confirmDialog.isDestructive
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
