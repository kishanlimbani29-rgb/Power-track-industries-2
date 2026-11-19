import React from 'react';
import {
  Boxes,
  ClipboardList,
  Sparkles,
  BarChart3,
  History,
  Users,
  AlertTriangle,
  X,
  Shield,
  Layers,
  ClipboardCheck,
  LogOut,
  ShoppingCart,
  ShoppingBag,
  Smartphone,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { useTrade } from '../context/TradeContext';
import { ActiveTab } from './Navigation';

interface SidebarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onOpenShareModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile,
  onOpenShareModal,
}) => {
  const { items, recipes, pendingAuditCount } = useInventory();
  const { openSalesCount, openPurchaseCount } = useTrade();
  const { currentUser, role, allRoles, realUserName, permissions, signOut } = useAuth();

  const roleLabel =
    role === 'admin'
      ? 'Owner'
      : role === 'manager'
      ? 'Manager'
      : role === 'staff'
      ? 'Staff'
      : role === 'viewer'
      ? 'Viewer'
      : allRoles.find((r) => r.id === role)?.title || role;

  const lowStockCount = items.filter((i) => i.quantity <= i.minStock).length;

  const allNavItems: {
    id: ActiveTab;
    label: string;
    description: string;
    icon: React.ElementType;
    badge?: number;
    alert?: boolean;
    alertCount?: number;
    alertTitle?: string;
    color: string;
    visible?: boolean;
  }[] = [
    {
      id: 'inventory',
      label: 'Inventory & Stock',
      description: 'Raw materials & finished goods',
      icon: Boxes,
      badge: items.length,
      alert: lowStockCount > 0,
      alertCount: lowStockCount,
      alertTitle: `${lowStockCount} low stock`,
      color: 'text-indigo-600',
      visible: true,
    },
    {
      id: 'recipes',
      label: 'Product BOM',
      description: 'BOMs & material usage',
      icon: ClipboardList,
      badge: recipes.length,
      color: 'text-amber-600',
      visible: permissions.canEditRecipes,
    },
    {
      id: 'production',
      label: 'Batch Production',
      description: 'Manufacture & auto-deduct',
      icon: Sparkles,
      color: 'text-emerald-600',
      visible: permissions.canViewBatchProductionOption,
    },
    {
      id: 'sales',
      label: 'Sales',
      description: 'Invoices, payments & returns',
      icon: ShoppingCart,
      badge: openSalesCount > 0 ? openSalesCount : undefined,
      color: 'text-emerald-600',
      visible: permissions.canViewSalesOption,
    },
    {
      id: 'purchase',
      label: 'Purchase',
      description: 'Orders, receiving & returns',
      icon: ShoppingBag,
      badge: openPurchaseCount > 0 ? openPurchaseCount : undefined,
      color: 'text-sky-600',
      visible: permissions.canViewPurchaseOption || permissions.canReceivePurchase,
    },
    {
      id: 'audit',
      label: 'Audit Reports',
      description: 'Production & raw material intake requests',
      icon: ClipboardCheck,
      badge: pendingAuditCount > 0 ? pendingAuditCount : undefined,
      alert: pendingAuditCount > 0,
      alertCount: pendingAuditCount,
      alertTitle: `${pendingAuditCount} pending audit requests`,
      color: 'text-teal-600',
      visible: permissions.canViewAuditReports,
    },
    {
      id: 'analytics',
      label: 'Analytics & Reports',
      description: 'Valuation, margins & reorders',
      icon: BarChart3,
      color: 'text-sky-600',
      visible: permissions.canViewShelfOption,
    },
    {
      id: 'movements',
      label: 'Stock Movements',
      description: 'Live transaction audit trail',
      icon: History,
      color: 'text-purple-600',
      visible: permissions.canViewStockMovementsOption,
    },
  ];

  const navItems = allNavItems.filter((item) => item.visible !== false);
  const showSettingsSection = permissions.canViewRolesAccessOption || Boolean(onOpenShareModal);

  const handleNavClick = (tabId: ActiveTab) => {
    onSelectTab(tabId);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          onTouchMove={(e) => e.preventDefault()}
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs lg:hidden transition-opacity touch-none"
        />
      )}

      {/* Side Shelf Container - Fully scrollable up and down */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-[100dvh] max-h-[100dvh] overscroll-contain w-72 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out shrink-0 ${
          isOpenMobile ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top Brand Header (Sticky at top of side shelf) */}
        <div
          className="border-b border-slate-100 shrink-0 bg-white"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="h-14 lg:h-16 px-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200/80 p-1 flex items-center justify-center shadow-xs shrink-0 overflow-hidden">
                <img
                  src="/pti-logo.png"
                  alt="Power Track Logo"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-extrabold text-base text-slate-900 tracking-tight leading-tight">Power Track</span>
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">PTI Inventory</span>
              </div>
            </div>

            {/* Mobile Close Button */}
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Area - Can move up and down freely */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-2.5 py-2 space-y-2.5">
          {/* Navigation Section */}
          <div>
            <div className="px-3 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Operations & Catalog
            </div>

            <nav className="space-y-0.5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-left text-xs transition group cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white font-semibold shadow-xs'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 transition ${
                          isActive ? 'text-white' : `${item.color} group-hover:scale-110`
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium leading-tight">{item.label}</div>
                        <div
                          className={`text-[9.5px] leading-tight truncate font-normal ${
                            isActive ? 'text-slate-300' : 'text-slate-400'
                          }`}
                        >
                          {item.description}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {item.alert && item.alertCount !== undefined && item.alertCount > 0 && (
                        <span
                          title={item.alertTitle || `${item.alertCount} low stock`}
                          aria-label={item.alertTitle || `${item.alertCount} low stock`}
                          className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white animate-pulse"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          <span>{item.alertCount}</span>
                        </span>
                      )}

                      {item.badge !== undefined && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                            isActive
                              ? 'bg-slate-800 text-slate-200'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {showSettingsSection && (
            <div className="pt-1 border-t border-slate-100">
              <div className="px-3 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                SETTINGS
              </div>

              <nav className="space-y-0.5">
                {permissions.canViewRolesAccessOption && (
                  <button
                    type="button"
                    onClick={() => handleNavClick('team')}
                    title="Configure user rights"
                    className={`w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-left text-xs transition group cursor-pointer ${
                      activeTab === 'team'
                        ? 'bg-slate-900 text-white font-semibold shadow-xs'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Shield
                        className={`w-4 h-4 shrink-0 transition ${
                          activeTab === 'team' ? 'text-white' : 'text-indigo-600 group-hover:scale-110'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium leading-tight">Roles & Team</div>
                        <div
                          className={`text-[9.5px] leading-tight truncate font-normal ${
                            activeTab === 'team' ? 'text-slate-300' : 'text-slate-400'
                          }`}
                        >
                          Users and access
                        </div>
                      </div>
                    </div>
                  </button>
                )}

                {onOpenShareModal && (
                  <button
                    type="button"
                    onClick={() => {
                      onCloseMobile();
                      onOpenShareModal();
                    }}
                    className="w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-left text-xs text-slate-700 hover:bg-slate-100 hover:text-slate-900 transition group cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Smartphone className="w-4 h-4 shrink-0 text-emerald-600 group-hover:scale-110 transition" />
                      <div className="min-w-0">
                        <div className="truncate font-medium leading-tight">Connect devices</div>
                        <div className="text-[9.5px] leading-tight truncate font-normal text-slate-400">
                          Open on another phone
                        </div>
                      </div>
                    </div>
                  </button>
                )}
              </nav>
            </div>
          )}
        </div>

        {/* Bottom Slim User Row (~56px) */}
        <div
          className="border-t border-slate-200 shrink-0 bg-slate-50"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="h-14 px-3 flex items-center justify-between gap-2.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-sky-500 text-white font-bold flex items-center justify-center shrink-0 text-xs shadow-2xs">
              {(realUserName.charAt(0) || 'U').toUpperCase()}
            </div>

            <div className="min-w-0 flex-1" title={currentUser?.email || realUserName}>
              <div className="font-bold text-slate-900 truncate text-xs leading-tight">
                {realUserName}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                <span className="px-1.5 py-0.5 rounded-full text-[9.5px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0 leading-none">
                  {roleLabel}
                </span>
                {currentUser?.email && (
                  <span className="hidden sm:inline text-[10px] text-slate-400 font-mono truncate">
                    {currentUser.email}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => signOut()}
              className="w-9 h-9 rounded-lg flex items-center justify-center text-rose-600 hover:text-rose-700 hover:bg-rose-50 transition shrink-0 cursor-pointer"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
