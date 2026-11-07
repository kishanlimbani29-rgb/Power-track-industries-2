import React, { useState, useMemo } from 'react';
import {
  ClipboardCheck,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Boxes,
  Truck,
  PackagePlus,
  Search,
  Filter,
  Download,
  Calendar,
  User,
  ShieldAlert,
  ArrowRight,
  Info,
  Layers,
  ChevronDown,
  Building,
  RotateCcw,
  Trash2,
  FileSpreadsheet,
} from 'lucide-react';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { formatFirestoreError } from '../firebase/config';
import { AuditRequest, AuditRequestType, AuditRequestStatus } from '../types/inventory';
import { downloadExcelFile } from '../utils/fileDownload';

export const AuditReportView: React.FC = () => {
  const {
    items,
    recipes,
    auditRequests,
    pendingAuditCount,
    submitAuditRequest,
    approveAuditRequest,
    rejectAuditRequest,
    deleteAuditRequest,
  } = useInventory();
  const { permissions, simulatedName, role } = useAuth();

  // Tab & Filter States
  const [activeStatusTab, setActiveStatusTab] = useState<'all' | AuditRequestStatus>('pending');
  const [filterType, setFilterType] = useState<'all' | AuditRequestType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State for New Audit Request Entry
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [entryType, setEntryType] = useState<AuditRequestType>('production');

  // Form Fields - Production
  const [prodRecipeId, setProdRecipeId] = useState('');
  const [prodBatchMultiplier, setProdBatchMultiplier] = useState<number>(1);
  const [prodNotes, setProdNotes] = useState('');

  // Form Fields - Dispatch
  const [dispatchItemId, setDispatchItemId] = useState('');
  const [dispatchQuantity, setDispatchQuantity] = useState<number>(1);
  const [dispatchCustomer, setDispatchCustomer] = useState('');
  const [dispatchNotes, setDispatchNotes] = useState('');

  // Form Fields - Raw Material In
  const [rawItemId, setRawItemId] = useState('');
  const [rawQuantity, setRawQuantity] = useState<number>(1);
  const [rawSupplier, setRawSupplier] = useState('');
  const [rawUnitCost, setRawUnitCost] = useState<number>(0);
  const [rawBatchNumber, setRawBatchNumber] = useState('');
  const [rawShelfLocation, setRawShelfLocation] = useState('');
  const [rawNotes, setRawNotes] = useState('');

  // Audit Approval/Rejection Modal
  const [selectedAuditRequest, setSelectedAuditRequest] = useState<AuditRequest | null>(null);
  const [auditAction, setAuditAction] = useState<'approve' | 'reject' | null>(null);
  const [auditNotesInput, setAuditNotesInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [requestToDelete, setRequestToDelete] = useState<AuditRequest | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filtered requests
  const filteredRequests = useMemo(() => {
    return auditRequests.filter((req) => {
      // Status filter
      if (activeStatusTab !== 'all' && req.status !== activeStatusTab) {
        return false;
      }
      // Type filter
      if (filterType !== 'all' && req.type !== filterType) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = req.title.toLowerCase().includes(query);
        const matchesSubmitter = req.submittedBy.toLowerCase().includes(query);
        const matchesRecipe = req.recipeName?.toLowerCase().includes(query) ?? false;
        const matchesItem = (req.finishedItemName || req.dispatchItemName || req.rawItemName)?.toLowerCase().includes(query) ?? false;
        const matchesCustomer = req.customerOrDestination?.toLowerCase().includes(query) ?? false;
        const matchesSupplier = req.supplierName?.toLowerCase().includes(query) ?? false;
        const matchesNotes = req.notes?.toLowerCase().includes(query) ?? false;
        return (
          matchesTitle ||
          matchesSubmitter ||
          matchesRecipe ||
          matchesItem ||
          matchesCustomer ||
          matchesSupplier ||
          matchesNotes
        );
      }
      return true;
    });
  }, [auditRequests, activeStatusTab, filterType, searchQuery]);

  // Statistics
  const stats = useMemo(() => {
    const total = auditRequests.length;
    const pending = auditRequests.filter((r) => r.status === 'pending').length;
    const approved = auditRequests.filter((r) => r.status === 'approved').length;
    const rejected = auditRequests.filter((r) => r.status === 'rejected').length;
    return { total, pending, approved, rejected };
  }, [auditRequests]);

  // Selected recipe preview for production request
  const selectedRecipe = useMemo(() => {
    return recipes.find((r) => r.id === prodRecipeId);
  }, [recipes, prodRecipeId]);

  // Recipe finished item unit
  const selectedRecipeFinishedItem = useMemo(() => {
    if (!selectedRecipe) return null;
    return items.find((i) => i.id === selectedRecipe.finishedItemId);
  }, [items, selectedRecipe]);

  // Selected item preview for dispatch
  const selectedDispatchItem = useMemo(() => {
    return items.find((i) => i.id === dispatchItemId);
  }, [items, dispatchItemId]);

  // Selected item preview for raw material in
  const selectedRawItem = useMemo(() => {
    return items.find((i) => i.id === rawItemId);
  }, [items, rawItemId]);

  // Handle Submit New Audit Request
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permissions.canSubmitAuditRequests) {
      setFeedbackMessage({
        type: 'error',
        text: 'Access Denied: You do not have permissions to submit audit requests.',
      });
      return;
    }

    try {
      if (entryType === 'production') {
        if (!selectedRecipe) {
          setFeedbackMessage({ type: 'error', text: 'Please select a recipe for production.' });
          return;
        }
        if (prodBatchMultiplier <= 0) {
          setFeedbackMessage({ type: 'error', text: 'Batch multiplier must be greater than zero.' });
          return;
        }

        const unit = selectedRecipeFinishedItem?.unit || 'units';

        const materialsNeeded = selectedRecipe.ingredients.map((ing) => ({
          rawItemId: ing.rawItemId,
          rawItemName: ing.rawItemName,
          quantity: ing.quantity * prodBatchMultiplier,
          unit: ing.unit,
        }));

        const prodPayload: Parameters<typeof submitAuditRequest>[0] = {
          type: 'production',
          title: `Production: ${selectedRecipe.name} (x${prodBatchMultiplier})`,
          recipeId: selectedRecipe.id,
          recipeName: selectedRecipe.name,
          finishedItemId: selectedRecipe.finishedItemId,
          finishedItemName: selectedRecipe.finishedItemName,
          batchMultiplier: prodBatchMultiplier,
          expectedYield: selectedRecipe.yieldQuantity * prodBatchMultiplier,
          unit,
          materialsNeeded,
        };
        if (prodNotes.trim()) {
          prodPayload.notes = prodNotes.trim();
        }

        await submitAuditRequest(prodPayload);
      } else if (entryType === 'dispatch') {
        if (!selectedDispatchItem) {
          setFeedbackMessage({ type: 'error', text: 'Please select an item to dispatch.' });
          return;
        }
        if (dispatchQuantity <= 0) {
          setFeedbackMessage({ type: 'error', text: 'Dispatch quantity must be greater than zero.' });
          return;
        }

        const dispatchPayload: Parameters<typeof submitAuditRequest>[0] = {
          type: 'dispatch',
          title: `Dispatch: ${dispatchQuantity} ${selectedDispatchItem.unit} of ${selectedDispatchItem.name}`,
          dispatchItemId: selectedDispatchItem.id,
          dispatchItemName: selectedDispatchItem.name,
          dispatchQuantity,
          dispatchUnit: selectedDispatchItem.unit,
        };
        if (dispatchCustomer.trim()) {
          dispatchPayload.customerOrDestination = dispatchCustomer.trim();
        }
        if (dispatchNotes.trim()) {
          dispatchPayload.notes = dispatchNotes.trim();
        }

        await submitAuditRequest(dispatchPayload);
      } else if (entryType === 'raw_material_in') {
        if (!selectedRawItem) {
          setFeedbackMessage({ type: 'error', text: 'Please select a raw material.' });
          return;
        }
        if (rawQuantity <= 0) {
          setFeedbackMessage({ type: 'error', text: 'Received quantity must be greater than zero.' });
          return;
        }

        const rawPayload: Parameters<typeof submitAuditRequest>[0] = {
          type: 'raw_material_in',
          title: `Material In: +${rawQuantity} ${selectedRawItem.unit} of ${selectedRawItem.name}`,
          rawItemId: selectedRawItem.id,
          rawItemName: selectedRawItem.name,
          rawQuantity,
          rawUnit: selectedRawItem.unit,
          unitPurchaseCost: rawUnitCost > 0 ? rawUnitCost : (selectedRawItem.unitCost || 0),
        };
        if (rawSupplier.trim()) {
          rawPayload.supplierName = rawSupplier.trim();
        }
        if (rawBatchNumber.trim()) {
          rawPayload.batchNumber = rawBatchNumber.trim();
        }
        if (rawShelfLocation.trim() || selectedRawItem.location) {
          rawPayload.shelfLocation = rawShelfLocation.trim() || selectedRawItem.location;
        }
        if (rawNotes.trim()) {
          rawPayload.notes = rawNotes.trim();
        }

        await submitAuditRequest(rawPayload);
      }

      // Close modal & reset fields
      setIsModalOpen(false);
      setProdRecipeId('');
      setProdBatchMultiplier(1);
      setProdNotes('');
      setDispatchItemId('');
      setDispatchQuantity(1);
      setDispatchCustomer('');
      setDispatchNotes('');
      setRawItemId('');
      setRawQuantity(1);
      setRawSupplier('');
      setRawUnitCost(0);
      setRawBatchNumber('');
      setRawShelfLocation('');
      setRawNotes('');

      // Show success toast
      setFeedbackMessage({
        type: 'success',
        text: 'Audit request successfully entered into queue. It is now awaiting authorized audit verification before affecting inventory stock.',
      });
      // Switch view to pending requests tab
      setActiveStatusTab('pending');
    } catch (err) {
      console.error(err);
      setFeedbackMessage({
        type: 'error',
        text: 'Failed to submit audit request. Please try again.',
      });
    }
  };

  // Execute Audit Approval (Take into account)
  const handleConfirmAuditAction = async () => {
    if (!selectedAuditRequest || !auditAction) return;

    setIsProcessing(true);
    try {
      if (auditAction === 'approve') {
        const result = await approveAuditRequest(selectedAuditRequest.id, auditNotesInput.trim() || undefined);
        if (result.success) {
          setFeedbackMessage({
            type: 'success',
            text: `Audit Approved! Entry "${selectedAuditRequest.title}" has been verified and fully taken into account in live inventory.`,
          });
        } else {
          setFeedbackMessage({
            type: 'error',
            text: `Audit failed: ${result.error || 'Inventory could not be updated.'}`,
          });
        }
      } else if (auditAction === 'reject') {
        const result = await rejectAuditRequest(selectedAuditRequest.id, auditNotesInput.trim() || undefined);
        if (result.success) {
          setFeedbackMessage({
            type: 'success',
            text: `Audit Rejected. Request "${selectedAuditRequest.title}" was marked as rejected and no inventory changes were applied.`,
          });
        } else {
          setFeedbackMessage({
            type: 'error',
            text: `Rejection failed: ${result.error || 'Could not update request.'}`,
          });
        }
      }
    } catch (err: any) {
      console.error(err);
      setFeedbackMessage({
        type: 'error',
        text: formatFirestoreError(err, 'An unexpected error occurred during auditing.'),
      });
    } finally {
      setIsProcessing(false);
      setSelectedAuditRequest(null);
      setAuditAction(null);
      setAuditNotesInput('');
    }
  };

  // Excel Export for audit log
  const handleExportExcel = () => {
    const rows = filteredRequests.map((r) => {
      const subDate = new Date(r.submittedAt);
      const audDate = r.auditedAt ? new Date(r.auditedAt) : null;
      return {
        'Request ID': r.id,
        'Entry Type': r.type.toUpperCase(),
        'Title / Details': r.title,
        'Status': r.status.toUpperCase(),
        'Submitted By': r.submittedBy,
        'Submission Date': subDate.toLocaleDateString(),
        'Submission Time': subDate.toLocaleTimeString(),
        'Audited By': r.auditedBy || 'N/A',
        'Audit Date': audDate ? audDate.toLocaleDateString() : 'N/A',
        'Audit Notes': r.auditNotes || '',
        'Submitter Remarks': r.notes || '',
      };
    });

    downloadExcelFile(
      rows,
      `powertrack_audit_log_${new Date().toISOString().slice(0, 10)}.xlsx`,
      'Audit Log'
    );
  };

  const handleConfirmDelete = async () => {
    if (!requestToDelete) return;
    const target = requestToDelete;
    setRequestToDelete(null);
    try {
      await deleteAuditRequest(target.id);
      setFeedbackMessage({
        type: 'success',
        text: `Audit record "${target.title}" deleted.`,
      });
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: formatFirestoreError(err, 'Failed to delete record.'),
      });
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <ClipboardCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900">Audit Reports & Verification</h1>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                Quality & Stock Governance
              </span>
              {pendingAuditCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold animate-pulse">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{pendingAuditCount} Pending Audit</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExportExcel}
            type="button"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 shadow-2xs transition cursor-pointer active:scale-95"
            title="Download audit log as Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Export Excel</span>
          </button>

          {permissions.canSubmitAuditRequests ? (
            <button
              onClick={() => setIsModalOpen(true)}
              type="button"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Enter New Request</span>
            </button>
          ) : (
            <div className="text-xs text-slate-400 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200 font-medium">
              Entry creation restricted for {role}
            </div>
          )}
        </div>
      </div>

      {/* Feedback Alert Toast */}
      {feedbackMessage && (
        <div
          className={`p-4 rounded-xl text-xs font-semibold flex items-center justify-between gap-3 border shadow-2xs transition ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedbackMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedbackMessage.text}</span>
          </div>
          <button
            onClick={() => setFeedbackMessage(null)}
            className="text-xs underline hover:no-underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Statistics & Quick Filter - Small & Fit in One Line (Marked with Black) */}
      <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
        {/* Pending Box */}
        <button
          type="button"
          onClick={() => setActiveStatusTab(activeStatusTab === 'pending' ? 'all' : 'pending')}
          className={`py-2 px-1.5 sm:px-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center justify-center ${
            activeStatusTab === 'pending'
              ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400/30 shadow-2xs'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-1 text-[11px] sm:text-xs font-semibold text-slate-600 truncate">
            <Clock className="w-3 h-3 text-amber-500 shrink-0" />
            <span className="truncate">Pending</span>
          </div>
          <div className="text-sm sm:text-base font-black text-slate-900 leading-tight mt-0.5">
            {stats.pending}
          </div>
        </button>

        {/* Approved Box */}
        <button
          type="button"
          onClick={() => setActiveStatusTab(activeStatusTab === 'approved' ? 'all' : 'approved')}
          className={`py-2 px-1.5 sm:px-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center justify-center ${
            activeStatusTab === 'approved'
              ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-400/30 shadow-2xs'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-1 text-[11px] sm:text-xs font-semibold text-slate-600 truncate">
            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
            <span className="truncate">Approved</span>
          </div>
          <div className="text-sm sm:text-base font-black text-slate-900 leading-tight mt-0.5">
            {stats.approved}
          </div>
        </button>

        {/* Rejected Box */}
        <button
          type="button"
          onClick={() => setActiveStatusTab(activeStatusTab === 'rejected' ? 'all' : 'rejected')}
          className={`py-2 px-1.5 sm:px-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center justify-center ${
            activeStatusTab === 'rejected'
              ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-400/30 shadow-2xs'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-1 text-[11px] sm:text-xs font-semibold text-slate-600 truncate">
            <XCircle className="w-3 h-3 text-rose-500 shrink-0" />
            <span className="truncate">Rejected</span>
          </div>
          <div className="text-sm sm:text-base font-black text-slate-900 leading-tight mt-0.5">
            {stats.rejected}
          </div>
        </button>

        {/* Total Box */}
        <button
          type="button"
          onClick={() => setActiveStatusTab('all')}
          className={`py-2 px-1.5 sm:px-2.5 rounded-xl border text-center transition cursor-pointer flex flex-col items-center justify-center ${
            activeStatusTab === 'all'
              ? 'bg-indigo-50 border-indigo-400 ring-2 ring-indigo-400/30 shadow-2xs'
              : 'bg-white border-slate-200 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center gap-1 text-[11px] sm:text-xs font-semibold text-slate-600 truncate">
            <ClipboardCheck className="w-3 h-3 text-indigo-500 shrink-0" />
            <span className="truncate">Total</span>
          </div>
          <div className="text-sm sm:text-base font-black text-slate-900 leading-tight mt-0.5">
            {stats.total}
          </div>
        </button>
      </div>

      {/* Search Bar (Red-marked tabs removed, search kept clean) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-2xs">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search audit requests by item, recipe, customer, supplier, or submitter..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Requests List */}
      <div className="space-y-3">
        {filteredRequests.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-2xs">
            <ClipboardCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-700">No requests found</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              There are no {activeStatusTab !== 'all' ? activeStatusTab : ''} requests matching your selected filters.
            </p>
            {permissions.canSubmitAuditRequests && (
              <button
                onClick={() => setIsModalOpen(true)}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-2xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Submit a Request</span>
              </button>
            )}
          </div>
        ) : (
          filteredRequests.map((req) => {
            const isPending = req.status === 'pending';
            const isApproved = req.status === 'approved';
            const isRejected = req.status === 'rejected';

            return (
              <div
                key={req.id}
                className={`bg-white rounded-2xl border transition shadow-2xs overflow-hidden ${
                  isPending
                    ? 'border-amber-200 hover:border-amber-300'
                    : isApproved
                    ? 'border-slate-200'
                    : 'border-rose-100'
                }`}
              >
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    {/* Left: Type Badge & Title */}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Type Badge */}
                        {req.type === 'production' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                            <Boxes className="w-3 h-3" />
                            Production Run
                          </span>
                        )}
                        {req.type === 'dispatch' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                            <Truck className="w-3 h-3" />
                            Finished Dispatch
                          </span>
                        )}
                        {req.type === 'raw_material_in' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <PackagePlus className="w-3 h-3" />
                            Raw Material In
                          </span>
                        )}

                        {/* Status Badge */}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-300">
                            <Clock className="w-3 h-3" />
                            Pending Audit
                          </span>
                        )}
                        {isApproved && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            Approved & Taken Into Account
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            <XCircle className="w-3 h-3" />
                            Audit Rejected
                          </span>
                        )}

                        <span className="text-[10px] text-slate-400 font-mono">
                          ID: {req.id.slice(-8)}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-slate-900">{req.title}</h3>

                      <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-400" />
                          <span>Submitted by: </span>
                          <strong className="text-slate-700">{req.submittedBy}</strong>
                          {req.submittedByRole && (
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded capitalize">
                              {req.submittedByRole}
                            </span>
                          )}
                        </span>
                        <span>•</span>
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" />
                          <span>{new Date(req.submittedAt).toLocaleString()}</span>
                        </span>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 pt-2 sm:pt-0 self-end sm:self-auto">
                      {isPending && (
                        <>
                          {permissions.canAuditRequests ? (
                            <>
                              <button
                                onClick={() => {
                                  setSelectedAuditRequest(req);
                                  setAuditAction('approve');
                                  setAuditNotesInput('');
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-2xs transition cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Approve & Take into Account</span>
                              </button>

                              <button
                                onClick={() => {
                                  setSelectedAuditRequest(req);
                                  setAuditAction('reject');
                                  setAuditNotesInput('');
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition cursor-pointer"
                              >
                                <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                <span>Reject</span>
                              </button>

                               <button
                                onClick={() => setRequestToDelete(req)}
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer"
                                title="Delete record"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 flex items-center gap-1">
                              <Info className="w-3 h-3" />
                              Awaiting Auditor Approval
                            </span>
                          )}
                        </>
                      )}

                      {!isPending && permissions.canAuditRequests && (
                        <button
                          onClick={() => setRequestToDelete(req)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition cursor-pointer ml-auto"
                          title="Delete record"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Detail Breakdown Box */}
                  <div className="mt-3 p-3.5 bg-slate-50/80 rounded-xl border border-slate-100 text-xs text-slate-700 space-y-2">
                    {/* Production Run Details */}
                    {req.type === 'production' && (
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                          <div>
                            <span className="text-slate-400 block">Recipe</span>
                            <span className="font-bold text-slate-800">{req.recipeName}</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">Batch Multiplier</span>
                            <span className="font-bold text-slate-800">{req.batchMultiplier}x Batch</span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">Expected Yield</span>
                            <span className="font-bold text-emerald-700">
                              +{req.expectedYield} {req.unit} ({req.finishedItemName})
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">Status Impact</span>
                            <span className="font-bold text-slate-600">
                              {isApproved ? 'Stock Deducted & Added' : 'Pending Verification'}
                            </span>
                          </div>
                        </div>

                        {req.materialsNeeded && req.materialsNeeded.length > 0 && (
                          <div className="pt-2 border-t border-slate-200">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                              Raw Materials to Deduct Upon Approval:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {req.materialsNeeded.map((mat) => (
                                <span
                                  key={mat.rawItemId}
                                  className="text-[11px] bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md"
                                >
                                  <strong>{mat.rawItemName}:</strong> {mat.quantity} {mat.unit}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Dispatch Details */}
                    {req.type === 'dispatch' && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-400 block">Dispatched Good</span>
                          <span className="font-bold text-slate-800">{req.dispatchItemName}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Quantity Deducted</span>
                          <span className="font-bold text-sky-700">
                            -{req.dispatchQuantity} {req.dispatchUnit}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Customer / Destination</span>
                          <span className="font-bold text-slate-800">
                            {req.customerOrDestination || 'Internal Facility'}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Raw Material In Details */}
                    {req.type === 'raw_material_in' && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                        <div>
                          <span className="text-slate-400 block">Raw Material</span>
                          <span className="font-bold text-slate-800">{req.rawItemName}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Quantity Received</span>
                          <span className="font-bold text-emerald-700">
                            +{req.rawQuantity} {req.rawUnit}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Supplier</span>
                          <span className="font-bold text-slate-800">{req.supplierName || 'Standard Vendor'}</span>
                        </div>
                        {permissions.canViewCostPerUnit && req.unitPurchaseCost !== undefined && (
                          <div>
                            <span className="text-slate-400 block">Unit Cost</span>
                            <span className="font-bold text-teal-700">
                              ₹{req.unitPurchaseCost.toFixed(2)} / {req.rawUnit}
                            </span>
                          </div>
                        )}
                        {req.shelfLocation && (
                          <div>
                            <span className="text-slate-400 block">Shelf / Bin</span>
                            <span className="font-bold text-slate-700">{req.shelfLocation}</span>
                          </div>
                        )}
                        {req.batchNumber && (
                          <div>
                            <span className="text-slate-400 block">Lot / Batch #</span>
                            <span className="font-mono text-slate-700">{req.batchNumber}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Notes from submitter */}
                    {req.notes && (
                      <div className="pt-2 border-t border-slate-200 text-[11px]">
                        <span className="text-slate-400 block font-semibold">Submitter Notes:</span>
                        <p className="text-slate-600 italic">"{req.notes}"</p>
                      </div>
                    )}

                    {/* Audit Resolution Remarks (If resolved) */}
                    {(req.auditedBy || req.auditNotes || req.executionError) && (
                      <div
                        className={`pt-2 border-t text-[11px] rounded-lg p-2.5 mt-2 ${
                          isApproved
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-rose-50 border-rose-200 text-rose-900'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold text-[11px] mb-1">
                          <span>
                            {isApproved ? '✓ Audited & Approved' : '✗ Audit Rejected'} by {req.auditedBy}
                          </span>
                          {req.auditedAt && (
                            <span className="font-normal text-[10px] opacity-80">
                              {new Date(req.auditedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                        {req.auditNotes && (
                          <p className="text-[11px] italic">Remarks: "{req.auditNotes}"</p>
                        )}
                        {req.executionError && (
                          <p className="text-[11px] font-bold text-rose-700 mt-1">
                            Execution note: {req.executionError}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ========================================================================= */}
      {/* MODAL 1: ENTER NEW AUDIT REQUEST (Production / Dispatch / Raw Material In) */}
      {/* ========================================================================= */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold">
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Enter New Request for Audit</h3>
                  <p className="text-[11px] text-slate-500">
                    Will be queued as pending until verified by an auditor
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Type Selector Tabs */}
            <div className="grid grid-cols-2 gap-2 mt-4 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setEntryType('production')}
                className={`py-2 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  entryType === 'production'
                    ? 'bg-white text-indigo-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Boxes className="w-3.5 h-3.5" />
                <span>Production</span>
              </button>

              {/* Dispatch requests moved to the Sales page (old dispatch requests stay visible in history) */}

              <button
                type="button"
                onClick={() => setEntryType('raw_material_in')}
                className={`py-2 px-2 rounded-lg text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                  entryType === 'raw_material_in'
                    ? 'bg-white text-indigo-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <PackagePlus className="w-3.5 h-3.5" />
                <span>Material In</span>
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="mt-4 space-y-4">
              {/* OPTION 1: PRODUCTION FORM */}
              {entryType === 'production' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Select Recipe / Formula *
                    </label>
                    <select
                      value={prodRecipeId}
                      onChange={(e) => setProdRecipeId(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">-- Choose Recipe to Produce --</option>
                      {recipes.map((rec) => {
                        const targetItem = items.find((i) => i.id === rec.finishedItemId);
                        const unit = targetItem?.unit || 'units';
                        return (
                          <option key={rec.id} value={rec.id}>
                            {rec.name} (Yield: {rec.yieldQuantity} {unit} of {rec.finishedItemName})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Batch Multiplier *
                    </label>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={prodBatchMultiplier}
                      onChange={(e) => setProdBatchMultiplier(parseFloat(e.target.value) || 1)}
                      required
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      e.g., 1 = single batch, 2 = double batch run
                    </p>
                  </div>

                  {/* Preview calculation */}
                  {selectedRecipe && (
                    <div className="p-3 bg-indigo-50/50 rounded-xl border border-indigo-100 text-xs space-y-2">
                      <div className="flex items-center justify-between text-indigo-950 font-bold">
                        <span>Expected Output:</span>
                        <span className="text-emerald-700">
                          +{selectedRecipe.yieldQuantity * prodBatchMultiplier}{' '}
                          {selectedRecipeFinishedItem?.unit || 'units'} of{' '}
                          {selectedRecipe.finishedItemName}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600">
                        <strong className="block text-slate-700 mb-0.5">Ingredients to deduct on approval:</strong>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {selectedRecipe.ingredients.map((ing) => (
                            <li key={ing.rawItemId}>
                              {ing.rawItemName}: {ing.quantity * prodBatchMultiplier} {ing.unit}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Production Notes / Operator Remarks
                    </label>
                    <textarea
                      rows={2}
                      value={prodNotes}
                      onChange={(e) => setProdNotes(e.target.value)}
                      placeholder="e.g., Morning shift production run on Line B..."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* OPTION 2: DISPATCH FORM */}
              {entryType === 'dispatch' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Item to Dispatch *
                    </label>
                    <select
                      value={dispatchItemId}
                      onChange={(e) => setDispatchItemId(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">-- Choose Item to Dispatch --</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} (Current Stock: {it.quantity} {it.unit} | {it.type.replace('_', ' ')})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Quantity to Dispatch *
                      </label>
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={dispatchQuantity}
                        onChange={(e) => setDispatchQuantity(parseFloat(e.target.value) || 0)}
                        required
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Customer / Destination
                      </label>
                      <input
                        type="text"
                        value={dispatchCustomer}
                        onChange={(e) => setDispatchCustomer(e.target.value)}
                        placeholder="e.g. Acme Corp / Store 4"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  {selectedDispatchItem && (
                    <div className="p-2.5 bg-slate-100 rounded-xl text-xs text-slate-600 flex items-center justify-between">
                      <span>Available in Warehouse:</span>
                      <strong className="text-slate-900">
                        {selectedDispatchItem.quantity} {selectedDispatchItem.unit}
                      </strong>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Dispatch Notes / Waybill #
                    </label>
                    <textarea
                      rows={2}
                      value={dispatchNotes}
                      onChange={(e) => setDispatchNotes(e.target.value)}
                      placeholder="e.g., Delivery van #12, PO-8492"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* OPTION 3: RAW MATERIAL IN FORM */}
              {entryType === 'raw_material_in' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Raw Material Received *
                    </label>
                    <select
                      value={rawItemId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setRawItemId(id);
                        const found = items.find((i) => i.id === id);
                        if (found) {
                          setRawUnitCost(found.unitCost || 0);
                          setRawShelfLocation(found.location || '');
                        }
                      }}
                      required
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="">-- Choose Raw Material --</option>
                      {items
                        .filter((it) => it.type === 'raw_material')
                        .concat(items.filter((it) => it.type !== 'raw_material'))
                        .map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name} ({it.type.replace('_', ' ')}) — Current: {it.quantity} {it.unit}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Quantity In *
                      </label>
                      <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={rawQuantity}
                        onChange={(e) => setRawQuantity(parseFloat(e.target.value) || 0)}
                        required
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Supplier / Vendor
                      </label>
                      <input
                        type="text"
                        value={rawSupplier}
                        onChange={(e) => setRawSupplier(e.target.value)}
                        placeholder="e.g. Apex Ingredients Ltd"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    {permissions.canViewCostPerUnit && (
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Unit Cost (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={rawUnitCost}
                          onChange={(e) => setRawUnitCost(parseFloat(e.target.value) || 0)}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    )}

                    <div className={permissions.canViewCostPerUnit ? '' : 'col-span-2'}>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Shelf / Bin Location
                      </label>
                      <input
                        type="text"
                        value={rawShelfLocation}
                        onChange={(e) => setRawShelfLocation(e.target.value)}
                        placeholder="e.g. Shelf A-03"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Batch / Lot #
                      </label>
                      <input
                        type="text"
                        value={rawBatchNumber}
                        onChange={(e) => setRawBatchNumber(e.target.value)}
                        placeholder="e.g. LOT-9912"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Notes / Invoice #
                    </label>
                    <textarea
                      rows={2}
                      value={rawNotes}
                      onChange={(e) => setRawNotes(e.target.value)}
                      placeholder="e.g. Received via delivery docket #5502, inspected ok."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Submitter Info Footer */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  Submitting as: <strong className="text-slate-800">{simulatedName}</strong>
                </span>
                <span className="text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded font-medium">
                  Entry will require audit approval
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-2xs transition cursor-pointer"
                >
                  Submit for Audit
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL 2: AUDITOR APPROVAL OR REJECTION DIALOG                              */}
      {/* ========================================================================= */}
      {selectedAuditRequest && auditAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white shrink-0 ${
                  auditAction === 'approve' ? 'bg-emerald-600' : 'bg-rose-600'
                }`}
              >
                {auditAction === 'approve' ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  {auditAction === 'approve'
                    ? 'Approve & Take Into Account'
                    : 'Reject Audit Request'}
                </h3>
                <p className="text-[11px] text-slate-500">
                  {auditAction === 'approve'
                    ? 'This will immediately update live inventory stock balances'
                    : 'No stock changes will be made'}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs">
                <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">
                  Request to Audit
                </span>
                <span className="text-slate-900 font-bold text-sm block mt-0.5">
                  {selectedAuditRequest.title}
                </span>
                <span className="text-[11px] text-slate-500 block mt-1">
                  Submitted by {selectedAuditRequest.submittedBy} on{' '}
                  {new Date(selectedAuditRequest.submittedAt).toLocaleDateString()}
                </span>
              </div>

              {auditAction === 'approve' && (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <Info className="w-4 h-4 text-emerald-700" />
                    <span>Audit Verification Effect:</span>
                  </div>
                  <p className="text-[11px]">
                    Once approved, Stodo executes the exact stock deductions and receipts in the master catalog and creates an audited stock movement ledger record.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Auditor Remarks / Notes {auditAction === 'reject' ? '*' : '(Optional)'}
                </label>
                <textarea
                  rows={3}
                  value={auditNotesInput}
                  onChange={(e) => setAuditNotesInput(e.target.value)}
                  placeholder={
                    auditAction === 'approve'
                      ? 'e.g. Verified quantities against physical shipment, approved for floor intake.'
                      : 'e.g. Discrepancy in batch volume, request rejected.'
                  }
                  required={auditAction === 'reject'}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={() => {
                    setSelectedAuditRequest(null);
                    setAuditAction(null);
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isProcessing || (auditAction === 'reject' && !auditNotesInput.trim())}
                  onClick={handleConfirmAuditAction}
                  className={`px-5 py-2 rounded-xl text-xs font-bold text-white shadow-2xs transition cursor-pointer flex items-center gap-1.5 ${
                    auditAction === 'approve'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  } disabled:opacity-50`}
                >
                  {isProcessing && <RotateCcw className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {auditAction === 'approve' ? 'Confirm & Take into Account' : 'Confirm Rejection'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {requestToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-xl border border-slate-200">
            <div className="w-12 h-12 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 mb-4 mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900 text-center mb-1">
              Delete Audit Record?
            </h3>
            <p className="text-xs text-slate-500 text-center mb-5">
              Are you sure you want to delete <span className="font-semibold text-slate-800">&quot;{requestToDelete.title}&quot;</span>? This record will be permanently removed.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRequestToDelete(null)}
                className="flex-1 py-2 px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="flex-1 py-2 px-3 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition cursor-pointer shadow-xs"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
