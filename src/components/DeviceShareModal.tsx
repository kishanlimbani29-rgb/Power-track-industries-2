import React, { useState, useEffect, useRef } from 'react';
import { X, Copy, Check, Smartphone, ShieldCheck, Share2, MessageCircle } from 'lucide-react';
import { useInventory } from '../context/InventoryContext';

interface DeviceShareModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DeviceShareModal: React.FC<DeviceShareModalProps> = ({ isOpen, onClose }) => {
  const { isLiveConnected, lastSyncTime, syncEventCount } = useInventory();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const pointerDownTargetRef = useRef<EventTarget | null>(null);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const appUrl = window.location.href.split('#')[0].split('?')[0];

  // Clipboard API fallback for Android WebView / iframe restrictions
  const handleCopy = async () => {
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(appUrl);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = appUrl;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, appUrl.length);
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
    }
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const handleShare = async () => {
    try {
      await navigator.share({
        title: 'Power Track - Real-Time Inventory',
        text: 'Open Power Track Multi-Device Inventory on this device:',
        url: appUrl,
      });
    } catch {
      // user cancelled the share sheet — ignore
    }
  };

  const whatsappShareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(
    `Open Power Track Real-Time Inventory on your mobile or tablet: ${appUrl}`
  )}`;

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
    appUrl
  )}&margin=8`;

  return (
    <div
      onPointerDown={(e) => {
        pointerDownTargetRef.current = e.target;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pointerDownTargetRef.current === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-[70] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Pinned Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
              <img
                src="/pti-logo.png"
                alt="Power Track PTI Logo"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">Connect Other Devices</h2>
              <p className="text-[11px] text-slate-500">Live multi-device synchronization</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close dialog (Esc)"
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
          {/* Cloud Sync Live Status */}
          <div className="p-3 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-900">Firestore Cloud Sync: Live</div>
                <div className="text-[10px] text-emerald-700">
                  Last update: {lastSyncTime ? lastSyncTime.toLocaleTimeString() : 'Just now'} ({syncEventCount} updates)
                </div>
              </div>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-emerald-200/70 text-emerald-800">
              Active
            </span>
          </div>

          {/* Quick Share Buttons (Mobile Friendly) */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Share link with mobile or coworker
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <a
                href={whatsappShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-98 transition shadow-xs cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 fill-white" />
                <span>Share on WhatsApp</span>
              </a>

              {canShare ? (
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-98 transition shadow-xs cursor-pointer"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Native Share Sheet</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 active:scale-98 transition shadow-2xs border border-slate-200 cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4 text-slate-600" />}
                  <span>{copied ? 'Link Copied!' : 'Copy Direct Link'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Direct Link Input with Copy Button */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Application Web Link
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={appUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full min-w-0 px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-50 text-slate-700 font-mono select-all focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopy}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition shrink-0 cursor-pointer ${
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                }`}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
            {copyFailed && (
              <p className="mt-1.5 text-[11px] text-amber-700">
                Automatic copy is restricted. Tap the text box, select all, and copy.
              </p>
            )}
          </div>

          {/* QR Code Section for Camera Scan */}
          <div className="flex flex-col sm:flex-row items-center gap-3.5 p-3.5 rounded-xl border border-slate-200 bg-slate-50/70">
            <div className="p-2 bg-white rounded-xl shadow-2xs border border-slate-200 shrink-0">
              <img
                src={qrCodeUrl}
                alt="Scan to open Power Track on phone or tablet"
                className="w-28 h-28 rounded-lg object-contain"
              />
            </div>
            <div className="space-y-1 text-center sm:text-left">
              <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-center sm:justify-start gap-1.5">
                <Smartphone className="w-4 h-4 text-indigo-600" />
                <span>Scan With Another Device</span>
              </div>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                Scan this code from any phone, tablet, or secondary computer. Inventory edits, sales bills, and stock entries sync instantaneously across all screens in real time.
              </p>
              <div className="text-[10px] text-slate-500 flex items-center justify-center sm:justify-start gap-1 pt-0.5">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                <span>Secure role permissions apply on all devices</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pinned Bottom Footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end shrink-0 bg-slate-50/70">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
