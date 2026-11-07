import React, { useState } from 'react';
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
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  UserRole,
  RolePermissions,
  RoleDefinition,
  ROLE_PERMISSIONS,
  tradePermissions,
} from '../types/inventory';

interface CapabilityConfig {
  key: keyof RolePermissions;
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

  // 2. Recipes & BOM
  {
    key: 'canEditRecipes',
    title: 'Build & Modify Recipes / BOM',
    category: 'recipes',
    categoryLabel: 'Recipes & Bill of Materials',
    icon: BookOpen,
    allowedDesc: 'User can view the Recipes & BOM menu in the shelf, build bill of materials (BOM), define ingredient consumption formulas, and adjust batch yields.',
    deniedDesc: 'The Recipes & BOM menu is hidden from the side shelf and access is restricted for this role.',
  },
  {
    key: 'canDeleteRecipes',
    title: 'Delete Recipes',
    category: 'recipes',
    categoryLabel: 'Recipes & Bill of Materials',
    icon: Trash2,
    allowedDesc: 'User can permanently delete recipe blueprints and production formulas.',
    deniedDesc: 'Recipe formulas are protected from accidental or unauthorized deletion.',
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
    allowedDesc: 'User can view purchase cost per unit, raw ingredient costs, and procurement prices across product cards and lists.',
    deniedDesc: 'Unit purchase costs and ingredient costs are masked and hidden (•••) from this role.',
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

export const TeamView: React.FC = () => {
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

  // Navigation tab state: 'roles' (Role Rights & Access Control) | 'team' (Team Members & Approvals)
  const [activeTab, setActiveTab] = useState<'roles' | 'team'>('roles');

  // Page navigation state: null = Roles List, string = Role detail access control page
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

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

  // Helper to get effective permissions for a role
  const getRoleEffectivePermissions = (roleId: string): RolePermissions => {
    const defaultPerms = ROLE_PERMISSIONS[roleId as keyof typeof ROLE_PERMISSIONS] || {
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
    };

    if (rolePermissions && rolePermissions[roleId as UserRole]) {
      return {
        ...defaultPerms,
        ...rolePermissions[roleId as UserRole],
      };
    }
    const roleDef = allRoles.find((r) => r.id === roleId);
    if (roleDef) {
      return {
        ...defaultPerms,
        ...roleDef.permissions,
      };
    }
    return defaultPerms;
  };

  // Count how many capabilities are enabled for a role
  const getEnabledCount = (roleId: string) => {
    const perms = getRoleEffectivePermissions(roleId);
    return Object.values(perms).filter(Boolean).length;
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

  // Grant All Capabilities for target role (Single write for all 14 switches)
  const handleGrantAll = async (targetRole: UserRole) => {
    if (!isAdmin) {
      showNotification('Administrator privileges required.');
      return;
    }

    try {
      const grantAllPerms: RolePermissions = {
        canEditItems: true,
        canDeleteItems: true,
        canOpenProductDetail: true,
        canAdjustStock: true,
        canEditRecipes: true,
        canDeleteRecipes: true,
        canProduceBatch: true,
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
          showNotification(`Role "${roleDef.title}" has been deleted.`);
          if (selectedRoleId === roleDef.id) {
            setSelectedRoleId(null);
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
      // Navigate directly to the new role to control its access
      setSelectedRoleId(cleanId);
    } catch (err: any) {
      setRoleModalError(err?.message || 'Failed to create role');
    } finally {
      setIsCreatingRole(false);
    }
  };

  const selectedRoleDef = selectedRoleId
    ? allRoles.find((r) => r.id === selectedRoleId) || null
    : null;

  const selectedRolePerms = selectedRoleId ? getRoleEffectivePermissions(selectedRoleId) : null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
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

      {/* ========================================================================= */}
      {/* VIEW A: DEDICATED SEPARATE ACCESS CONTROL PAGE FOR SELECTED ROLE         */}
      {/* ========================================================================= */}
      {selectedRoleDef && selectedRolePerms ? (
        <div className="space-y-6 animate-in fade-in duration-200">
          {/* Top Navigation & Breadcrumbs */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSelectedRoleId(null)}
              className="inline-flex items-center gap-2 text-xs font-bold text-indigo-700 bg-white hover:bg-indigo-50 px-3.5 py-2 rounded-xl border border-indigo-200 transition shadow-2xs cursor-pointer w-fit"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>← Back to All Roles</span>
            </button>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="hover:text-slate-700 cursor-pointer" onClick={() => setSelectedRoleId(null)}>
                Role Rights & Access Control
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-bold text-slate-900 capitalize">{selectedRoleDef.title}</span>
            </div>
          </div>

          {/* Role Header Banner Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs relative overflow-hidden">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
              <div className="flex items-start gap-4">
                <div
                  className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-xs shrink-0 ${
                    getRoleColorTheme(selectedRoleDef.color).bg
                  }`}
                >
                  {selectedRoleDef.id === 'admin' ? (
                    <Crown className="w-7 h-7 text-white" />
                  ) : (
                    <Shield className="w-7 h-7 text-white" />
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-xl font-bold text-slate-900">{selectedRoleDef.title}</h2>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${getBadgeClass(
                        selectedRoleDef.color
                      )}`}
                    >
                      {selectedRoleDef.isSystem ? 'Built-in System Role' : 'Custom Role'}
                    </span>
                    <span className="text-[11px] font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                      slug: {selectedRoleDef.id}
                    </span>
                  </div>
                  <div className="pt-1 flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                    <span className="inline-flex items-center gap-1 font-semibold text-indigo-700">
                      <Sliders className="w-3.5 h-3.5" />
                      <span>
                        {getEnabledCount(selectedRoleDef.id)} of {CAPABILITY_LIST.length} capabilities
                        allowed
                      </span>
                    </span>
                    <span>•</span>
                    <span className="text-emerald-700 font-medium">Real-time Cloud Sync Active</span>
                  </div>
                </div>
              </div>

              {/* Header Actions: Simulate Persona, Grant All, Revoke All, Reset */}
              <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0">
                {/* Switch to this role button (Admin preview only) */}
                {isRealAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      switchSimulatedRole(selectedRoleDef.id as UserRole);
                      showNotification(`Active preview persona switched to ${selectedRoleDef.title}.`);
                    }}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer border ${
                      role === selectedRoleDef.id
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                        : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200'
                    }`}
                    title="Preview Power Track under this role's rights (Admin Only)"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      {role === selectedRoleDef.id ? 'Currently Active Preview' : 'Test as this Role'}
                    </span>
                  </button>
                )}

                {isAdmin && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleGrantAll(selectedRoleDef.id as UserRole)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition cursor-pointer"
                      title="Turn ON all capabilities for this role"
                    >
                      <CheckCheck className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Grant All</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRevokeAll(selectedRoleDef.id as UserRole)}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition cursor-pointer"
                      title="Turn OFF all non-essential capabilities"
                    >
                      <Ban className="w-3.5 h-3.5 text-rose-600" />
                      <span>Revoke All</span>
                    </button>

                    {selectedRoleDef.isSystem && (
                      <button
                        type="button"
                        onClick={() => handleResetSingleRole(selectedRoleDef.id as UserRole)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 transition cursor-pointer"
                        title="Restore factory default rights"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                        <span>Reset</span>
                      </button>
                    )}

                    {!selectedRoleDef.isSystem && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomRole(selectedRoleDef)}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 transition cursor-pointer"
                        title="Delete custom role"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                        <span>Delete Role</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Capabilities Control Panel */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-600" />
                  <span>Access Control Switches for {selectedRoleDef.title}</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Tap any switch to permit or restrict this role from performing that specific action
                </p>
              </div>

              {!isAdmin && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Read-Only (Requires Admin Persona)</span>
                </span>
              )}
            </div>

            {/* List of Capabilities */}
            <div className="divide-y divide-slate-100 p-2 sm:p-4">
              {CAPABILITY_LIST.filter(
                (cap) => selectedRoleDef.id === 'admin' || cap.key !== 'canManageUsers'
              ).map((cap) => {
                const isAllowed = selectedRolePerms[cap.key] ?? false;
                const isLockedAdmin =
                  selectedRoleDef.id === 'admin' && cap.key === 'canManageUsers';
                const IconComponent = cap.icon;

                return (
                  <div
                    key={`cap-${cap.key}`}
                    className={`p-4 sm:p-5 rounded-2xl transition flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      isAllowed ? 'hover:bg-indigo-50/20' : 'hover:bg-slate-50'
                    }`}
                  >
                    {/* Left: Capability Info */}
                    <div className="flex items-start gap-3.5 flex-1 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          isAllowed
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}
                      >
                        <IconComponent className="w-5 h-5" />
                      </div>

                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-bold text-slate-900">{cap.title}</h4>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                            {cap.categoryLabel}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          {isAllowed ? cap.allowedDesc : cap.deniedDesc}
                        </p>
                      </div>
                    </div>

                    {/* Right: Toggle Switch & Status Label */}
                    <div className="flex items-center justify-between sm:justify-end gap-3.5 shrink-0 pl-13 sm:pl-0">
                      <span
                        className={`text-xs font-bold inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${
                          isAllowed
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {isAllowed ? (
                          <>
                            <Check className="w-3 h-3 stroke-[3]" />
                            <span>ALLOWED</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-3 h-3" />
                            <span>RESTRICTED</span>
                          </>
                        )}
                      </span>

                      {/* Interactive Toggle Switch */}
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isAllowed}
                        disabled={!isAdmin || isLockedAdmin}
                        onClick={() =>
                          handleToggleCapability(
                            selectedRoleDef.id as UserRole,
                            cap.key,
                            isAllowed
                          )
                        }
                        title={
                          isLockedAdmin
                            ? 'Administrator must keep User Management rights to prevent lockout'
                            : !isAdmin
                            ? 'Admin privileges required'
                            : `Toggle ${cap.title}`
                        }
                        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                          isAllowed ? 'bg-indigo-600' : 'bg-slate-300'
                        } ${!isAdmin || isLockedAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
                            isAllowed ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        >
                          {isAllowed ? (
                            <Check className="w-3.5 h-3.5 text-indigo-600 stroke-[3]" />
                          ) : (
                            <X className="w-3 h-3 text-slate-400 stroke-[2.5]" />
                          )}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer with helpful guidance */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
              <div className="flex items-center gap-1.5">
                <Info className="w-4 h-4 text-slate-400 shrink-0" />
                <span>
                  All changes take effect immediately across all connected client devices in real-time.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRoleId(null)}
                className="font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
              >
                ← Return to Role List
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* ========================================================================= */
        /* VIEW B: LIST OF EACH ROLE (CLICKABLE TO OPEN SEPARATE ACCESS PAGE)        */
        /* ========================================================================= */
        <div className="space-y-5">
          {/* Top navigation tabs: Role Rights vs Team Directory */}
          {isRealAdmin && (
            <div className="flex border-b border-slate-200 gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('roles')}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition cursor-pointer ${
                  activeTab === 'roles'
                    ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-xl'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Role Rights & Access Control</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('team')}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold border-b-2 transition cursor-pointer relative ${
                  activeTab === 'team'
                    ? 'border-indigo-600 text-indigo-600 bg-indigo-50/50 rounded-t-xl'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Team & Member Access</span>
                {pendingUsers.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500 text-white animate-pulse">
                    {pendingUsers.length}
                  </span>
                )}
              </button>
            </div>
          )}

          {activeTab === 'roles' ? (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                    Role Rights & Access Control
                  </h1>
                </div>

                {/* Action Buttons: Add Role + Reset Defaults (Only shown when admin) */}
                {isAdmin && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleClonePreset('staff');
                        setNewRoleTitle('');
                        setNewRoleId('');
                        setRoleModalError(null);
                        setIsAddRoleModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition shadow-xs cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>+ Add Role</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleResetAllDefaults}
                      title="Reset all built-in role permissions to standard baseline defaults"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition shadow-2xs cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                      <span>Reset Defaults</span>
                    </button>
                  </div>
                )}
              </div>

              {/* LIST OF ROLES */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3">
                {allRoles.map((r, rIdx) => {
                  const theme = getRoleColorTheme(r.color);

                  return (
                    <div
                      key={`role-card-${r.id || rIdx}`}
                      onClick={() => setSelectedRoleId(r.id)}
                      className="p-3.5 sm:p-4 bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 shadow-2xs hover:shadow-md transition cursor-pointer flex items-center justify-between gap-3 group active:scale-[0.99] relative overflow-hidden"
                    >
                      {/* Top colored accent indicator */}
                      <div
                        className={`absolute top-0 left-0 right-0 h-1 ${theme.bg}`}
                      />

                      {/* Left: Icon + Title + System/Custom badge + slug */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-11 h-11 rounded-xl flex items-center justify-center font-bold text-base shadow-xs shrink-0 text-white ${theme.bg}`}
                        >
                          {r.id === 'admin' ? (
                            <Crown className="w-5 h-5 text-white" />
                          ) : (
                            <Shield className="w-5 h-5 text-white" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm sm:text-base font-bold text-slate-900 group-hover:text-indigo-600 transition truncate">
                              {r.title}
                            </h3>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getBadgeClass(
                                r.color
                              )}`}
                            >
                              {r.isSystem ? 'System' : 'Custom'}
                            </span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-400 block mt-0.5">
                            slug: {r.id}
                          </span>
                        </div>
                      </div>

                      {/* Right: Chevron indicating click to enter */}
                      <div className="w-8 h-8 rounded-xl bg-slate-50 group-hover:bg-indigo-50 border border-slate-200 group-hover:border-indigo-200 text-slate-400 group-hover:text-indigo-600 flex items-center justify-center transition shrink-0">
                        <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                      </div>
                    </div>
                  );
                })}

                {/* Add Custom Role Prompt Card */}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      handleClonePreset('staff');
                      setNewRoleTitle('');
                      setNewRoleId('');
                      setRoleModalError(null);
                      setIsAddRoleModalOpen(true);
                    }}
                    className="rounded-2xl border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-indigo-50/20 hover:bg-indigo-50/50 p-4 text-center transition flex flex-col items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
                      <Plus className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-indigo-950">+ Add New Custom Role</h4>
                      <p className="text-[11px] text-slate-500 max-w-xs mt-0.5">
                        Create roles like Shift Supervisor, Quality Inspector, Auditor, or Kitchen Staff
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold text-indigo-600 bg-white px-2.5 py-1 rounded-lg border border-indigo-200 shadow-2xs mt-1">
                      Create Role
                    </span>
                  </button>
                )}
              </div>
            </div>
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
                      <h2 className="text-base font-bold text-slate-900">
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
                              className="px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                              {allRoles.map((r) => (
                                <option key={r.id} value={r.id}>
                                  Assign as {r.title}
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
                    <h2 className="text-base font-bold text-slate-900">Invite New Team Member</h2>
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
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    />
                  </div>

                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as UserRole)}
                    className="px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {allRoles
                      .filter((r) => r.id !== 'admin')
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.title}
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
                    <h2 className="text-base font-bold text-slate-900">
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
                            className={`px-2.5 py-1.5 text-xs rounded-xl border border-slate-300 bg-white font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                              isRootAdmin ? 'bg-slate-100 cursor-not-allowed opacity-70' : ''
                            }`}
                          >
                            {allRoles.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.title}
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
                    placeholder="e.g., Shift Supervisor, Kitchen Lead, Quality Auditor"
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
                    placeholder="e.g., shift_supervisor"
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
                    placeholder="e.g., Supervises floor shifts and verifies recipe batch executions."
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
