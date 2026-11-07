import React from 'react';
import {
  Boxes,
  CookingPot,
  Sparkles,
  BarChart3,
  History,
  Users,
  AlertTriangle,
  X,
  Smartphone,
  Shield,
  Layers,
  ClipboardCheck,
  LogOut,
  ShoppingCart,
  ShoppingBag,
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
  onOpenShareModal: () => void;
  onOpenInstallModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile,
  onOpenShareModal,
  onOpenInstallModal,
}) => {
  const { items, recipes, isLiveConnected, syncEventCount, pendingAuditCount } = useInventory();
  const { openSalesCount, openPurchaseCount } = useTrade();
  const { currentUser, role, realUserName, permissions, signOut } = useAuth();

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
      alertTitle: `${lowStockCount} items below minimum stock threshold`,
      color: 'text-indigo-600',
      visible: true,
    },
    {
      id: 'recipes',
      label: 'Recipes & BOM',
      description: 'Formulas & material usage',
      icon: CookingPot,
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
    {
      id: 'team',
      label: 'Roles & Access Control',
      description: 'Role capabilities & permissions',
      icon: Shield,
      color: 'text-indigo-600',
      visible: permissions.canViewRolesAccessOption,
    },
  ];

  const navItems = allNavItems.filter((item) => item.visible !== false);

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
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-xs lg:hidden transition-opacity"
        />
      )}

      {/* Side Shelf Container - Fully scrollable up and down */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen max-h-screen w-72 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out shrink-0 ${
          isOpenMobile ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top Brand Header (Sticky at top of side shelf) */}
        <div className="h-16 px-5 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200/80 p-1 flex items-center justify-center shadow-xs shrink-0 overflow-hidden">
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

        {/* Scrollable Area - Can move up and down freely */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3 space-y-4">
          {/* Navigation Section */}
          <div>
            <div className="px-3 pb-2 pt-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Operations & Catalog
            </div>

            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-left text-xs transition group cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 text-white font-semibold shadow-xs'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon
                        className={`w-4 h-4 shrink-0 transition ${
                          isActive ? 'text-white' : `${item.color} group-hover:scale-110`
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{item.label}</div>
                        <div
                          className={`text-[10px] truncate font-normal ${
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
                          title={item.alertTitle || `${item.alertCount} items`}
                          className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white animate-pulse"
                        >
                          <AlertTriangle className="w-3 h-3" />
                          <span>{item.alertCount}</span>
                        </span>
                      )}

                      {item.badge !== undefined && (
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
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

          {/* Multi-Device Live Sync Card inside scrollable shelf */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  {isLiveConnected && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-2 w-2 ${
                      isLiveConnected ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                </span>
                <span className="text-xs font-bold text-slate-800">
                  {isLiveConnected ? 'Live Cloud Sync' : 'Connecting...'}
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {syncEventCount} updates
              </span>
            </div>

            <p className="text-[11px] text-slate-500 leading-snug">
              Syncs in real-time across mobile, tablets & desktops.
            </p>

            <div className="space-y-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  onOpenShareModal();
                  onCloseMobile();
                }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-2xs transition cursor-pointer active:bg-slate-100"
              >
                <Smartphone className="w-3.5 h-3.5 text-slate-500" />
                <span>Connect Other Devices</span>
              </button>

              {onOpenInstallModal && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenInstallModal();
                    onCloseMobile();
                  }}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100 border border-indigo-200/80 shadow-2xs transition cursor-pointer active:scale-98"
                >
                  <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Install App on Phone</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Section: Signed-in User Profile & Sign Out Button */}
        <div className="p-3 border-t border-slate-200 shrink-0 bg-slate-50 space-y-2">
          <div className="p-2.5 rounded-xl bg-white border border-slate-200 text-xs shadow-2xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-600 to-sky-500 text-white font-bold flex items-center justify-center shrink-0 text-xs shadow-2xs">
                  {(realUserName.charAt(0) || 'U').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-slate-900 truncate text-xs">
                    {realUserName}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono truncate">
                    {currentUser?.email}
                  </div>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                {role}
              </span>
            </div>

            <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => handleNavClick('team')}
                title="Configure user rights"
                className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
              >
                Roles & Team
              </button>
              <button
                type="button"
                onClick={() => signOut()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200/80 transition text-[11px] font-bold cursor-pointer"
                title="Sign out of Power Track"
              >
                <LogOut className="w-3 h-3" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
