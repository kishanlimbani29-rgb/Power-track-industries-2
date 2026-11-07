import React, { useState, useEffect, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { InventoryProvider } from './context/InventoryContext';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { ActiveTab } from './components/Navigation';
import { InventoryView } from './components/InventoryView';
import { RecipesView } from './components/RecipesView';
import { ProductionView } from './components/ProductionView';
import { AnalyticsView } from './components/AnalyticsView';
import { MovementsView } from './components/MovementsView';
import { TeamView } from './components/TeamView';
import { ItemModal } from './components/ItemModal';
import { RecipeModal } from './components/RecipeModal';
import { StockAdjustModal } from './components/StockAdjustModal';
import { DeviceShareModal } from './components/DeviceShareModal';
import { ExcelImportModal } from './components/ExcelImportModal';
import { RecipeExcelImportModal } from './components/RecipeExcelImportModal';
import { AuditReportView } from './components/AuditReportView';
import { AuthScreen } from './components/AuthScreen';
import { PWAInstallModal } from './components/PWAInstallModal';
import { TradeProvider } from './context/TradeContext';
import { SalesView } from './components/trade/SalesView';
import { PurchaseView } from './components/trade/PurchaseView';
import { InventoryItem, Recipe } from './types/inventory';
import { CheckCircle2, FileSpreadsheet, Eye, LogOut } from 'lucide-react';

const TAB_TITLES: Record<ActiveTab, string> = {
  inventory: 'Inventory & Stock Master',
  recipes: 'Recipes & Bill of Materials (BOM)',
  production: 'Batch Production & Manufacturing',
  sales: 'Sales & Customer Invoices',
  purchase: 'Purchase Orders & Suppliers',
  audit: 'Audit Reports & Verification Queue',
  analytics: 'Executive Analytics & Decision Reports',
  movements: 'Stock Movement Audit Trail',
  team: 'User Rights & Role Access Control',
};

function StodoApp() {
  const {
    currentUser,
    isLoading,
    isEmailVerified,
    isPendingApproval,
    isSuspended,
    profileError,
    permissions,
    isTestingRole,
    role,
    exitSimulatedRole,
  } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('inventory');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Modal States
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<InventoryItem | null>(null);

  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [recipeToEdit, setRecipeToEdit] = useState<Recipe | null>(null);

  const [isProductionNewRunOpen, setIsProductionNewRunOpen] = useState(false);
  const [produceRecipe, setProduceRecipe] = useState<Recipe | null>(null);

  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);

  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isExcelImportModalOpen, setIsExcelImportModalOpen] = useState(false);
  const [isRecipeExcelImportModalOpen, setIsRecipeExcelImportModalOpen] = useState(false);
  const [isPWAInstallModalOpen, setIsPWAInstallModalOpen] = useState(false);

  // Global toast notification when an Excel/CSV file is generated & downloaded
  const [downloadToast, setDownloadToast] = useState<{ fileName: string; format: string } | null>(null);

  // If user role does not have permission to view shelf/analytics option, recipes, production, movements, team, or audit reports, fallback to inventory tab
  useEffect(() => {
    if (!permissions.canViewShelfOption && activeTab === 'analytics') {
      setActiveTab('inventory');
    }
    if (!permissions.canEditRecipes && activeTab === 'recipes') {
      setActiveTab('inventory');
    }
    if (!permissions.canViewAuditReports && activeTab === 'audit') {
      setActiveTab('inventory');
    }
    if (!permissions.canViewBatchProductionOption && activeTab === 'production') {
      setActiveTab('inventory');
    }
    if (!permissions.canViewStockMovementsOption && activeTab === 'movements') {
      setActiveTab('inventory');
    }
    if (!permissions.canViewRolesAccessOption && activeTab === 'team') {
      setActiveTab('inventory');
    }
    if (!permissions.canViewSalesOption && activeTab === 'sales') {
      setActiveTab('inventory');
    }
    if (!(permissions.canViewPurchaseOption || permissions.canReceivePurchase) && activeTab === 'purchase') {
      setActiveTab('inventory');
    }
  }, [
    permissions.canViewSalesOption,
    permissions.canViewPurchaseOption,
    permissions.canReceivePurchase,
    permissions.canViewShelfOption,
    permissions.canEditRecipes,
    permissions.canViewAuditReports,
    permissions.canViewBatchProductionOption,
    permissions.canViewStockMovementsOption,
    permissions.canViewRolesAccessOption,
    activeTab,
  ]);

  useEffect(() => {
    const handleDownloadEvent = (e: any) => {
      if (e.detail?.fileName) {
        setDownloadToast({ fileName: e.detail.fileName, format: e.detail.format || 'xlsx' });
        setTimeout(() => {
          setDownloadToast(null);
        }, 4000);
      }
    };

    window.addEventListener('powertrack_download_started', handleDownloadEvent);
    return () => {
      window.removeEventListener('powertrack_download_started', handleDownloadEvent);
    };
  }, []);

  const modalHistoryPushedRef = useRef(false);

  // Close modals & mobile menu when Phone's back button or system back gesture is used.
  // Pushes a single history entry when transitioning from 0 to 1+ open dialogs/shelves,
  // preventing premature closes when switching between sidebar and dialogs.
  const isAnyModalOpen = Boolean(
    isItemModalOpen ||
    isRecipeModalOpen ||
    isAdjustModalOpen ||
    isShareModalOpen ||
    isExcelImportModalOpen ||
    isRecipeExcelImportModalOpen ||
    isPWAInstallModalOpen ||
    isMobileSidebarOpen
  );

  useEffect(() => {
    if (isAnyModalOpen) {
      if (!modalHistoryPushedRef.current) {
        modalHistoryPushedRef.current = true;
        window.history.pushState({ modalOpen: true }, '');
      }

      const handlePopState = () => {
        modalHistoryPushedRef.current = false;
        setIsItemModalOpen(false);
        setIsRecipeModalOpen(false);
        setIsAdjustModalOpen(false);
        setIsShareModalOpen(false);
        setIsExcelImportModalOpen(false);
        setIsRecipeExcelImportModalOpen(false);
        setIsPWAInstallModalOpen(false);
        setIsMobileSidebarOpen(false);
      };

      window.addEventListener('popstate', handlePopState);
      return () => {
        window.removeEventListener('popstate', handlePopState);
      };
    } else {
      if (modalHistoryPushedRef.current) {
        modalHistoryPushedRef.current = false;
        if (window.history.state?.modalOpen) {
          window.history.back();
        }
      }
    }
  }, [isAnyModalOpen]);

  const handleOpenAddItem = () => {
    setItemToEdit(null);
    setIsItemModalOpen(true);
  };

  const handleOpenEditItem = (item: InventoryItem) => {
    setItemToEdit(item);
    setIsItemModalOpen(true);
  };

  const handleOpenAdjustStock = (item?: InventoryItem) => {
    setAdjustItem(item || null);
    setIsAdjustModalOpen(true);
  };

  const handleOpenAddRecipe = () => {
    setRecipeToEdit(null);
    setIsRecipeModalOpen(true);
  };

  const handleOpenEditRecipe = (recipe: Recipe) => {
    setRecipeToEdit(recipe);
    setIsRecipeModalOpen(true);
  };

  const handleOpenProduce = (recipe?: Recipe) => {
    setProduceRecipe(recipe || null);
    setIsProductionNewRunOpen(true);
    setActiveTab('production');
  };

  // Loading and Authentication Gates (Evaluated AFTER all hooks are registered)
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-slate-300">
          <div className="w-16 h-16 rounded-2xl bg-white p-2 shadow-2xl flex items-center justify-center border border-slate-700/50">
            <img
              src="/assets/aistudio/Powr_Track_LOGO_-_Copy_33e0f8ab.png"
              alt="Power Track Logo"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-semibold tracking-wider uppercase text-slate-400">Loading Power Track...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser || !isEmailVerified || isPendingApproval || isSuspended || profileError) {
    return <AuthScreen />;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex text-slate-900 font-sans antialiased selection:bg-indigo-100 selection:text-indigo-900">
      {/* Side Shelf (Sidebar) holding all navigation options */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onOpenShareModal={() => setIsShareModalOpen(true)}
        onOpenInstallModal={() => setIsPWAInstallModalOpen(true)}
      />

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Admin Preview Mode Banner */}
        {isTestingRole && (
          <div className="bg-amber-400 text-slate-950 px-4 py-2.5 text-xs font-semibold flex items-center justify-between gap-3 shadow-md shrink-0 sticky top-0 z-50 border-b border-amber-500">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-900 animate-ping shrink-0" />
              <span className="font-extrabold uppercase tracking-wide">Admin Role Preview:</span>
              <span className="truncate">
                Testing system as <strong className="font-extrabold underline">{role.toUpperCase()}</strong>. All capability gates reflect this persona.
              </span>
            </div>
            <button
              onClick={exitSimulatedRole}
              className="px-3 py-1 rounded-lg bg-slate-900 text-white font-bold text-xs hover:bg-slate-800 transition shrink-0 cursor-pointer shadow-xs active:scale-95"
            >
              Exit Preview
            </button>
          </div>
        )}

        {/* Top Header with title, mobile toggle, live sync & role switcher */}
        <Header
          onOpenShareModal={() => setIsShareModalOpen(true)}
          onToggleSidebar={() => setIsMobileSidebarOpen((prev) => !prev)}
          activeTabTitle={TAB_TITLES[activeTab]}
        />

        {/* Main Workspace Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {activeTab === 'inventory' && (
            <InventoryView
              onOpenAddItem={handleOpenAddItem}
              onOpenEditItem={handleOpenEditItem}
              onOpenAdjustStock={handleOpenAdjustStock}
              onOpenProduce={() => handleOpenProduce()}
              onOpenExcelImport={() => setIsExcelImportModalOpen(true)}
            />
          )}

          {activeTab === 'recipes' && permissions.canEditRecipes && (
            <RecipesView
              onOpenAddRecipe={handleOpenAddRecipe}
              onOpenEditRecipe={handleOpenEditRecipe}
              onOpenProduce={handleOpenProduce}
              onOpenExcelImport={() => setIsRecipeExcelImportModalOpen(true)}
              onOpenAdjustStock={handleOpenAdjustStock}
              onOpenEditItem={handleOpenEditItem}
            />
          )}

          {activeTab === 'production' && permissions.canViewBatchProductionOption && (
            <ProductionView
              initialRecipeId={produceRecipe?.id}
              isNewRunInitiallyOpen={isProductionNewRunOpen}
              onCloseNewRun={() => {
                setIsProductionNewRunOpen(false);
                setProduceRecipe(null);
              }}
            />
          )}

          {activeTab === 'sales' && permissions.canViewSalesOption && <SalesView />}

          {activeTab === 'purchase' && (permissions.canViewPurchaseOption || permissions.canReceivePurchase) && (
            <PurchaseView />
          )}

          {activeTab === 'audit' && permissions.canViewAuditReports && (
            <AuditReportView />
          )}

          {activeTab === 'analytics' && permissions.canViewShelfOption && (
            <AnalyticsView
              onOpenAdjustStock={handleOpenAdjustStock}
              onOpenProduce={handleOpenProduce}
            />
          )}

          {activeTab === 'movements' && permissions.canViewStockMovementsOption && (
            <MovementsView onOpenAdjustStock={handleOpenAdjustStock} />
          )}

          {activeTab === 'team' && permissions.canViewRolesAccessOption && <TeamView />}
        </main>


      </div>

      {/* Modals */}
      <ItemModal
        isOpen={isItemModalOpen}
        onClose={() => setIsItemModalOpen(false)}
        itemToEdit={itemToEdit}
        onOpenAdjustStock={handleOpenAdjustStock}
      />

      <RecipeModal
        isOpen={isRecipeModalOpen}
        onClose={() => setIsRecipeModalOpen(false)}
        recipeToEdit={recipeToEdit}
      />

      <StockAdjustModal
        isOpen={isAdjustModalOpen}
        onClose={() => setIsAdjustModalOpen(false)}
        item={adjustItem}
      />

      <DeviceShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
      />

      <ExcelImportModal
        isOpen={isExcelImportModalOpen}
        onClose={() => setIsExcelImportModalOpen(false)}
      />

      <RecipeExcelImportModal
        isOpen={isRecipeExcelImportModalOpen}
        onClose={() => setIsRecipeExcelImportModalOpen(false)}
      />

      <PWAInstallModal
        isOpen={isPWAInstallModalOpen}
        onClose={() => setIsPWAInstallModalOpen(false)}
      />

      {/* Floating Download Feedback Toast */}
      {downloadToast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm w-[calc(100vw-2.5rem)] bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-2xl border border-slate-700/60 flex items-center gap-3 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Download Triggered</span>
            </div>
            <p className="text-[11px] text-slate-300 truncate font-mono mt-0.5">
              {downloadToast.fileName}
            </p>
          </div>
          <button
            onClick={() => setDownloadToast(null)}
            className="text-slate-400 hover:text-white text-xs font-bold px-1 py-0.5"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <InventoryProvider>
        <TradeProvider>
          <StodoApp />
        </TradeProvider>
      </InventoryProvider>
    </AuthProvider>
  );
}
