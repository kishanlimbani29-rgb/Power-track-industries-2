import React, { useState } from 'react';
import { Smartphone, Download, Check, X, ExternalLink, HelpCircle, Share2, Layers } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PWAInstallModal: React.FC<PWAInstallModalProps> = ({ isOpen, onClose }) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, install } = usePWAInstall();
  const [installSuccess, setInstallSuccess] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

  if (!isOpen) return null;

  const appUrl = window.location.origin;
  const pwaBuilderUrl = `https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(appUrl)}`;

  const handleTriggerInstall = async () => {
    setIsInstalling(true);
    try {
      const success = await install();
      if (success) {
        setInstallSuccess(true);
        setTimeout(() => {
          onClose();
        }, 2500);
      }
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-6 text-white text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="w-16 h-16 rounded-2xl bg-white p-2 mx-auto flex items-center justify-center shadow-lg mb-3 border border-slate-200">
            <img src="/pti-logo.png" alt="Power Track" className="w-full h-full object-contain" />
          </div>

          <h2 className="text-lg sm:text-xl font-bold tracking-tight">
            Install Power Track on Android
          </h2>
          <p className="text-xs text-indigo-200/80 mt-1 max-w-xs mx-auto">
            Install as a native full-screen app (WebAPK) on your phone with zero app-store delays
          </p>
        </div>

        {/* Content */}
        <div className="p-5 sm:p-6 space-y-4 text-xs text-slate-600 overflow-y-auto max-h-[75vh]">
          {isInstalled || installSuccess ? (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto">
                <Check className="w-5 h-5 stroke-[3]" />
              </div>
              <h3 className="font-bold text-emerald-950 text-sm">App Already Installed!</h3>
              <p className="text-emerald-800">
                Power Track is installed on this device.
              </p>
              <div className="mt-2 p-2.5 rounded-xl bg-white/80 border border-emerald-200 text-[11px] text-slate-700 text-left space-y-1">
                <p className="font-bold text-slate-900">Updating Home Screen Icon to New PTI Logo:</p>
                <p className="text-slate-600">
                  If your phone's home screen still shows the old lightning icon, simply remove that shortcut and tap Chrome menu (⋮) → &quot;Install app&quot; or &quot;Add to Home screen&quot; once to apply the new PTI battery logo.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Option 1: Native 1-Tap WebAPK Install */}
              <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                    <Smartphone className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Option 1: 1-Tap Native Install (WebAPK)</h4>
                    <p className="text-slate-600 text-[11px] mt-0.5">
                      Android automatically generates a native WebAPK package that installs directly to your home screen with full offline support and no URL bar.
                    </p>
                  </div>
                </div>

                {isInstallable ? (
                  <button
                    onClick={handleTriggerInstall}
                    disabled={isInstalling}
                    className="w-full py-2.5 px-4 rounded-xl font-bold text-xs bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white transition shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <Download className="w-4 h-4" />
                    <span>{isInstalling ? 'Installing App...' : 'Install App to Phone (1-Tap)'}</span>
                  </button>
                ) : (
                  <div className="bg-white p-3 rounded-xl border border-indigo-100 text-[11px] space-y-1.5 text-slate-700">
                    <p className="font-semibold text-indigo-950">How to install in Chrome on Android:</p>
                    <ol className="list-decimal pl-4 space-y-1 text-slate-600">
                      <li>Tap the <strong>3 dots (⋮)</strong> menu in Chrome at top right.</li>
                      <li>Select <strong>&quot;Install app&quot;</strong> or <strong>&quot;Add to Home screen&quot;</strong>.</li>
                      <li>Android will create and install the native WebAPK app package.</li>
                    </ol>
                  </div>
                )}
              </div>

              {/* Option 2: Standalone .APK File via PWABuilder */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-slate-800 text-white flex items-center justify-center shrink-0 mt-0.5">
                    <Download className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-sm">Option 2: Download Raw .APK File</h4>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      If you need a physical <code>.apk</code> file for sideloading or Google Play:
                    </p>
                  </div>
                </div>

                <p className="text-[11px] text-slate-600">
                  Use Microsoft & Google&apos;s official <strong>PWABuilder</strong> tool to package this app into a signed Android APK in 1 click:
                </p>

                <a
                  href={pwaBuilderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 w-full py-2 px-3.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs transition cursor-pointer shadow-2xs"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Generate .APK on PWABuilder</span>
                </a>
              </div>

              {/* iOS Guide */}
              {isIOS && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] space-y-1 text-amber-900">
                  <p className="font-bold flex items-center gap-1.5">
                    <Share2 className="w-3.5 h-3.5" />
                    <span>For iPhone / iPad (Safari):</span>
                  </p>
                  <p>
                    Tap the <strong>Share</strong> button (box with upward arrow) at the bottom of Safari, then tap <strong>&quot;Add to Home Screen&quot;</strong>.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Footer App Details */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Package ID: <code>com.stodo.powertrack</code></span>
            <span>Version: 1.0.0</span>
          </div>
        </div>
      </div>
    </div>
  );
};
