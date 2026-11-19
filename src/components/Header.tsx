import React from 'react';
import { Menu } from 'lucide-react';
import { useInventory } from '../context/InventoryContext';

interface HeaderProps {
  onToggleSidebar: () => void;
  activeTabTitle: string;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  activeTabTitle,
}) => {
  const { isLiveConnected } = useInventory();

  return (
    <header
      className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-2xs"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Left: Mobile Toggle & Active Section Breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            {/* Hamburger button to toggle the side shelf */}
            <button
              onClick={onToggleSidebar}
              title="Toggle side shelf menu"
              className="p-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-100 transition lg:hidden cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Logo on mobile or breadcrumb on desktop */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="lg:hidden w-8 h-8 rounded-lg bg-slate-50 border border-slate-200 p-0.5 flex items-center justify-center shrink-0 shadow-2xs overflow-hidden">
                <img
                  src="/pti-logo.png"
                  alt="PTI Logo"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm sm:text-base text-slate-900 truncate">
                  {activeTabTitle}
                </div>
                <div className="text-[11px] text-slate-400 hidden sm:block truncate">
                  Power Track – Battery Inventory &amp; Production
                </div>
              </div>
            </div>
          </div>

          {/* Right: Non-clickable Live Sync Status Dot */}
          <div className="flex items-center shrink-0">
            <span
              title={isLiveConnected ? 'Live sync on' : 'Connecting…'}
              className={`inline-block h-2 w-2 rounded-full ${
                isLiveConnected ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
          </div>
        </div>
      </div>
    </header>
  );
};
