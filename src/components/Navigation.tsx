import React from 'react';
import {
  Boxes,
  CookingPot,
  Sparkles,
  BarChart3,
  History,
  Users,
  Shield,
  AlertTriangle,
  ClipboardCheck,
  ShoppingCart,
  ShoppingBag,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';

export type ActiveTab = 'inventory' | 'recipes' | 'production' | 'sales' | 'purchase' | 'analytics' | 'audit' | 'movements' | 'team';

interface NavigationProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ activeTab, onSelectTab }) => {
  const { items, recipes, pendingAuditCount } = useInventory();
  const { permissions } = useAuth();

  const lowStockCount = items.filter((i) => i.quantity <= i.minStock).length;

  const allTabs: {
    id: ActiveTab;
    label: string;
    icon: React.ElementType;
    badge?: number;
    alert?: boolean;
    alertCount?: number;
    alertTitle?: string;
    visible?: boolean;
  }[] = [
    {
      id: 'inventory',
      label: 'Inventory & Stock',
      icon: Boxes,
      badge: items.length,
      alert: lowStockCount > 0,
      alertCount: lowStockCount,
      alertTitle: `${lowStockCount} items below minimum stock threshold`,
      visible: true,
    },
    {
      id: 'recipes',
      label: 'Recipes & BOM',
      icon: CookingPot,
      badge: recipes.length,
      visible: permissions.canEditRecipes,
    },
    {
      id: 'production',
      label: 'Batch Production',
      icon: Sparkles,
      visible: permissions.canViewBatchProductionOption,
    },
    {
      id: 'sales',
      label: 'Sales',
      icon: ShoppingCart,
      visible: permissions.canViewSalesOption,
    },
    {
      id: 'purchase',
      label: 'Purchase',
      icon: ShoppingBag,
      visible: permissions.canViewPurchaseOption || permissions.canReceivePurchase,
    },
    {
      id: 'audit',
      label: 'Audit Reports',
      icon: ClipboardCheck,
      badge: pendingAuditCount > 0 ? pendingAuditCount : undefined,
      alert: pendingAuditCount > 0,
      alertCount: pendingAuditCount,
      alertTitle: `${pendingAuditCount} pending audit requests`,
      visible: permissions.canViewAuditReports,
    },
    {
      id: 'analytics',
      label: 'Analytics & Reports',
      icon: BarChart3,
      visible: permissions.canViewShelfOption,
    },
    {
      id: 'movements',
      label: 'Stock Movements',
      icon: History,
      visible: permissions.canViewStockMovementsOption,
    },
    {
      id: 'team',
      label: 'Roles & Access Control',
      icon: Shield,
      visible: permissions.canViewRolesAccessOption,
    },
  ];

  const tabs = allTabs.filter((t) => t.visible !== false);

  return (
    <div className="bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <nav className="flex space-x-1 sm:space-x-4 overflow-x-auto py-2.5 no-scrollbar">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all duration-150 shrink-0 ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{tab.label}</span>

                {tab.badge !== undefined && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      isActive
                        ? 'bg-slate-800 text-slate-200'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}

                {tab.alert && tab.alertCount !== undefined && tab.alertCount > 0 && (
                  <span
                    title={tab.alertTitle || `${tab.alertCount} items`}
                    className="flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-rose-500 text-white animate-pulse"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    <span>{tab.alertCount}</span>
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
};
