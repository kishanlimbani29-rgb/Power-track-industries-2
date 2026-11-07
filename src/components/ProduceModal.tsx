import React, { useState, useEffect, useMemo } from 'react';
import { X, Sparkles, CheckCircle2, AlertTriangle, Flame, ClipboardCheck, AlertCircle } from 'lucide-react';
import confetti from 'canvas-confetti';
import { Recipe } from '../types/inventory';
import { useInventory } from '../context/InventoryContext';
import { useAuth } from '../context/AuthContext';
import { formatFirestoreError } from '../firebase/config';
import {
  resolveInventoryItem,
  getAvailableStockForIngredient,
} from '../utils/itemResolver';

interface ProduceModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedRecipe?: Recipe | null;
}

export const ProduceModal: React.FC<ProduceModalProps> = ({
  isOpen,
  onClose,
  selectedRecipe: initialRecipe,
}) => {
  const { items, recipes, produceRecipeBatch, submitAuditRequest, getRecipeFeasibility } = useInventory();
  const { permissions, simulatedName } = useAuth();

  const [recipeId, setRecipeId] = useState<string>('');
  const [batchMultiplier, setBatchMultiplier] = useState<number | string>(1);
  const [notes, setNotes] = useState<string>('');
  const [directApproval, setDirectApproval] = useState(false);
  const [isProducing, setIsProducing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<string | null>(null);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (initialRecipe) {
      setRecipeId(initialRecipe.id);
    } else if (recipes.length > 0 && !recipeId) {
      setRecipeId(recipes[0].id);
    }
    setBatchMultiplier(1);
    setNotes('');
    setError(null);
    setSuccessResult(null);
    setIsProducing(false);
  }, [initialRecipe, isOpen]);

  if (!isOpen) return null;

  const currentRecipe = recipes.find((r) => r.id === recipeId) || initialRecipe || recipes[0];
  const finishedItem = currentRecipe
    ? items.find((i) => i.id === currentRecipe.finishedItemId)
    : null;
  const feasibility = currentRecipe ? getRecipeFeasibility(currentRecipe) : { maxBatchesPossible: 0, maxUnitsPossible: 0 };

  const numMultiplier = batchMultiplier === '' ? 0 : Math.max(0, Number(batchMultiplier) || 0);
  const totalUnitsYielded = currentRecipe ? (Number(currentRecipe.yieldQuantity) || 1) * numMultiplier : 0;

  // Aggregate quantities per material first
  const aggregatedIngredients = useMemo(() => {
    if (!currentRecipe) return [];
    const map = new Map<string, { rawItemId: string; rawItemName: string; quantity: number; unit: string }>();
    for (const ing of currentRecipe.ingredients) {
      const existing = map.get(ing.rawItemId);
      if (existing) {
        existing.quantity += Number(ing.quantity) || 0;
      } else {
        map.set(ing.rawItemId, {
          rawItemId: ing.rawItemId,
          rawItemName: ing.rawItemName,
          quantity: Number(ing.quantity) || 0,
          unit: ing.unit,
        });
      }
    }
    return Array.from(map.values());
  }, [currentRecipe]);

  // Check each ingredient availability and existence
  const ingredientChecks = aggregatedIngredients.map((ing) => {
    const raw = items.find((i) => i.id === ing.rawItemId);
    const isMissing = !raw;
    const available = raw ? Number(raw.quantity) || 0 : 0;
    const required = (Number(ing.quantity) || 0) * numMultiplier;
    const isSufficient = !isMissing && available >= required;
    const remainingAfter = Math.max(0, available - required);

    return {
      rawItemId: ing.rawItemId,
      name: raw ? raw.name : ing.rawItemName,
      unit: raw ? raw.unit : ing.unit,
      isMissing,
      available,
      required,
      isSufficient,
      remainingAfter,
      shortage: Math.max(0, required - available),
    };
  });

  const hasMissingMaterial = ingredientChecks.some((c) => c.isMissing);
  const hasAnyShortage = ingredientChecks.some((c) => !c.isSufficient);

  const handleExecute = async () => {
    if (!currentRecipe) return;
    const parsedMultiplier = Number(batchMultiplier);
    if (!parsedMultiplier || parsedMultiplier <= 0) {
      setError('Please enter a valid batch quantity.');
      return;
    }

    if (hasMissingMaterial) {
      setError('Missing material — edit recipe');
      return;
    }

    if (hasAnyShortage) {
      setError('Cannot proceed: Some raw materials have insufficient stock.');
      return;
    }

    setIsProducing(true);
    setError(null);

    try {
      if (directApproval && permissions.canAuditRequests) {
        // Direct Auditor Execution: updates inventory immediately in a transaction
        const res = await produceRecipeBatch(currentRecipe.id, parsedMultiplier, notes);
        if (res.success) {
          try {
            confetti({
              particleCount: 60,
              spread: 70,
              origin: { y: 0.6 },
            });
          } catch {}
          setSuccessResult(
            `Direct Production Completed: Successfully produced ${totalUnitsYielded} ${
              finishedItem?.unit || 'units'
            } of ${
              finishedItem?.name || currentRecipe.name
            }! Raw material stocks have been deducted and inventory updated.`
          );
          // Keep button disabled until modal closes
          setTimeout(() => {
            onClose();
          }, 2200);
        } else {
          setError(res.error || 'Failed to complete production run.');
          setIsProducing(false);
        }
      } else {
        // Submits request into Audit Queue for verification
        const materialsNeeded = aggregatedIngredients.map((ing) => ({
          rawItemId: ing.rawItemId,
          rawItemName: ing.rawItemName,
          quantity: (Number(ing.quantity) || 0) * parsedMultiplier,
          unit: ing.unit,
        }));

        const auditSubmissionPayload: Parameters<typeof submitAuditRequest>[0] = {
          type: 'production',
          title: `Production: ${currentRecipe.name} (${parsedMultiplier}x)`,
          recipeId: currentRecipe.id,
          recipeName: currentRecipe.name,
          finishedItemId: currentRecipe.finishedItemId,
          finishedItemName: currentRecipe.finishedItemName,
          batchMultiplier: parsedMultiplier,
          expectedYield: totalUnitsYielded,
          unit: finishedItem?.unit || 'units',
          materialsNeeded,
        };

        if (notes.trim()) {
          auditSubmissionPayload.notes = notes.trim();
        }

        await submitAuditRequest(auditSubmissionPayload);

        try {
          confetti({
            particleCount: 40,
            spread: 60,
            origin: { y: 0.6 },
          });
        } catch {}

        setSuccessResult(
          `Batch production for "${currentRecipe.name}" (${parsedMultiplier}x) has been submitted for Audit! Raw materials will be deducted and finished goods added only after an owner or authorized auditor approves the entry in the Audit Report shelf.`
        );
        // Keep button disabled until modal closes
        setTimeout(() => {
          onClose();
        }, 2500);
      }
    } catch (err: any) {
      setError(formatFirestoreError(err, 'Failed to complete production run.'));
      setIsProducing(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isProducing) onClose();
      }}
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4"
    >
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl border border-slate-200 flex flex-col max-h-[92vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Pinned Top Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-900">Record Production Run</h2>
            <p className="text-xs text-slate-500">
              Transform raw materials into finished goods via recipe
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProducing}
            title="Close dialog (Esc)"
            className="p-1.5 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success View */}
        {successResult ? (
          <div className="p-8 text-center space-y-3 my-auto">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Production Logged!</h3>
            <p className="text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
              {successResult}
            </p>
            <div className="text-[11px] text-slate-400 font-medium">Closing in a moment...</div>
          </div>
        ) : (
          <>
            {error && (
              <div className="mx-5 mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 shrink-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Scrollable Body */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Recipe Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Select Recipe Formula <span className="text-rose-500">*</span>
                </label>
                <select
                  value={recipeId}
                  onChange={(e) => setRecipeId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {recipes.map((rec) => (
                    <option key={rec.id} value={rec.id}>
                      {rec.name} → Yields: {rec.yieldQuantity} {rec.finishedItemName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Multiplier & Calculated Output */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Batch Multiplier
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={batchMultiplier}
                    onChange={(e) => setBatchMultiplier(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 bg-white font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <span className="text-[10px] text-slate-500 mt-0.5 block">
                    e.g. 1 = standard batch, 2 = double
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Output Produced
                  </label>
                  <div className="px-3 py-2 text-sm rounded-xl border border-emerald-200 bg-emerald-50/60 font-bold text-emerald-800">
                    +{totalUnitsYielded} {finishedItem?.unit || 'units'}
                  </div>
                  <span className="text-[10px] text-slate-500 mt-0.5 block truncate">
                    Item: {finishedItem?.name || currentRecipe?.finishedItemName}
                  </span>
                </div>
              </div>

              {/* Feasibility Indicator */}
              <div className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-slate-100 border border-slate-200">
                <span className="text-slate-600 font-medium">Max possible with current stock:</span>
                <span className="font-bold text-slate-900">
                  {feasibility.maxBatchesPossible} batches ({feasibility.maxUnitsPossible}{' '}
                  {finishedItem?.unit || 'units'})
                </span>
              </div>

              {/* Ingredients Checklist */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
                  Material Consumption Checklist
                </label>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {ingredientChecks.map((check) => (
                    <div
                      key={check.rawItemId}
                      className={`p-2.5 rounded-xl border text-xs flex items-center justify-between transition ${
                        check.isMissing
                          ? 'bg-rose-50 border-rose-300 text-rose-800'
                          : !check.isSufficient
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="font-semibold truncate">{check.name}</div>
                        {check.isMissing ? (
                          <div className="text-[11px] font-bold text-rose-600 mt-0.5 flex items-center gap-1">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>Missing material — edit recipe</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500">
                            Available: <strong className="text-slate-700">{check.available}</strong> {check.unit}
                          </div>
                        )}
                      </div>

                      {!check.isMissing && (
                        <div className="text-right shrink-0">
                          <div className="font-bold text-rose-700">
                            -{Number(check.required.toFixed(2))} {check.unit}
                          </div>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              check.isSufficient
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {check.isSufficient
                              ? `Remain: ${check.remainingAfter.toFixed(1)}`
                              : `Short by ${check.shortage.toFixed(1)}`}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Operator Notes / Batch Details
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Lot #9201, Shift 2 run, room temp 22°C"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Governance & Approval Options */}
              <div className="pt-1 space-y-2">
                <div className="p-3 bg-amber-50/80 rounded-xl border border-amber-200/80 flex items-start gap-2.5">
                  <Flame className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-bold text-amber-900 block">Governance Workflow</span>
                    <span className="text-[11px] text-amber-800">
                      Entry is sent to the <strong>Audit Reports</strong> queue first. Raw materials are reduced and inventory is updated only after owner or auditor approval.
                    </span>
                  </div>
                </div>

                {permissions.canAuditRequests && (
                  <label className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 cursor-pointer hover:bg-slate-100 transition">
                    <input
                      type="checkbox"
                      checked={directApproval}
                      onChange={(e) => setDirectApproval(e.target.checked)}
                      className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                    />
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-800 text-[11px]">
                        Direct Auditor Approval (Bypass Queue)
                      </span>
                      <span className="text-[10px] text-slate-500">
                        As an authorized owner/auditor, immediately deduct raw materials and update inventory stock now.
                      </span>
                    </div>
                  </label>
                )}
              </div>
            </div>

            {/* Pinned Bottom Footer Action Buttons */}
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/70">
              <div className="text-[11px] text-slate-500 truncate max-w-[150px]">
                By: <span className="font-semibold text-slate-700">{simulatedName}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isProducing}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-200 transition cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExecute}
                  disabled={
                    isProducing ||
                    !!successResult ||
                    hasAnyShortage ||
                    hasMissingMaterial ||
                    (!permissions.canProduceBatch && !permissions.canSubmitAuditRequests)
                  }
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white transition shadow-xs cursor-pointer active:scale-95 disabled:opacity-50 ${
                    directApproval
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  {directApproval ? (
                    <Sparkles className="w-3.5 h-3.5" />
                  ) : (
                    <ClipboardCheck className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isProducing
                      ? 'Processing...'
                      : directApproval
                      ? `Produce & Update Stock (${totalUnitsYielded} Units)`
                      : `Submit for Audit (${totalUnitsYielded} Units)`}
                  </span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
