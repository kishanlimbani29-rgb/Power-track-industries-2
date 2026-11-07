import React, { useState, useRef } from 'react';
import {
  X,
  CookingPot,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  FileText,
  Loader2,
  Layers,
  Sparkles,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useInventory } from '../context/InventoryContext';
import { IngredientRequirement, InventoryItem } from '../types/inventory';
import { resolveInventoryItem } from '../utils/itemResolver';
import { downloadExcelFile, downloadCSVFile } from '../utils/fileDownload';

interface RecipeExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ParsedRecipe {
  name: string;
  finishedProductQuery: string;
  matchedFinishedItem?: InventoryItem;
  yieldQuantity: number;
  laborCost: number;
  instructions: string;
  ingredients: {
    rawItemQuery: string;
    matchedRawItem?: InventoryItem;
    quantity: number;
    unit: string;
  }[];
  isValid: boolean;
  error?: string;
}

export const RecipeExcelImportModal: React.FC<RecipeExcelImportModalProps> = ({ isOpen, onClose }) => {
  const { items, addRecipe, addItem } = useInventory();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedRecipes, setParsedRecipes] = useState<ParsedRecipe[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setFileName(null);
    setParsedRecipes([]);
    setIsProcessing(false);
    setIsImporting(false);
    setImportProgress({ current: 0, total: 0 });
    setStatusMessage(null);
    setErrorMessage(null);
  };

  const handleDownloadTemplate = (format: 'xlsx' | 'csv') => {
    const sampleRows = [
      {
        'Recipe Name': '12V 100Ah Deep Cycle Power Battery Assembly',
        'Finished Product (Name or SKU)': '12V 100Ah Deep Cycle Power Battery',
        'Yield Quantity': 1,
        'Labor Cost (₹)': 18.5,
        'Instructions': 'Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.',
        'Ingredient (Name or SKU)': 'Positive Lead Plate 12V Sub-Assembly',
        'Ingredient Quantity': 6,
        'Ingredient Unit': 'pcs',
      },
      {
        'Recipe Name': '12V 100Ah Deep Cycle Power Battery Assembly',
        'Finished Product (Name or SKU)': '12V 100Ah Deep Cycle Power Battery',
        'Yield Quantity': 1,
        'Labor Cost (₹)': 18.5,
        'Instructions': 'Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.',
        'Ingredient (Name or SKU)': 'Refined Lead Ingot 99.97%',
        'Ingredient Quantity': 14.5,
        'Ingredient Unit': 'kg',
      },
      {
        'Recipe Name': '12V 100Ah Deep Cycle Power Battery Assembly',
        'Finished Product (Name or SKU)': '12V 100Ah Deep Cycle Power Battery',
        'Yield Quantity': 1,
        'Labor Cost (₹)': 18.5,
        'Instructions': 'Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.',
        'Ingredient (Name or SKU)': 'Lead Oxide Powder (Grey Oxide)',
        'Ingredient Quantity': 5.2,
        'Ingredient Unit': 'kg',
      },
      {
        'Recipe Name': '12V 100Ah Deep Cycle Power Battery Assembly',
        'Finished Product (Name or SKU)': '12V 100Ah Deep Cycle Power Battery',
        'Yield Quantity': 1,
        'Labor Cost (₹)': 18.5,
        'Instructions': 'Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.',
        'Ingredient (Name or SKU)': 'Dual Terminal Brass Connector',
        'Ingredient Quantity': 2,
        'Ingredient Unit': 'pcs',
      },
      {
        'Recipe Name': 'Positive Lead Plate 12V Sub-Assembly (10x Batch)',
        'Finished Product (Name or SKU)': 'Positive Lead Plate 12V Sub-Assembly',
        'Yield Quantity': 10,
        'Labor Cost (₹)': 6.0,
        'Instructions': 'Cast gravity lead grids from bullion ingot, apply active paste mixture with grey lead oxide powder, flash-dry and transfer to humidity curing chambers for 48 hours.',
        'Ingredient (Name or SKU)': 'Refined Lead Ingot 99.97%',
        'Ingredient Quantity': 5,
        'Ingredient Unit': 'kg',
      },
      {
        'Recipe Name': 'Positive Lead Plate 12V Sub-Assembly (10x Batch)',
        'Finished Product (Name or SKU)': 'Positive Lead Plate 12V Sub-Assembly',
        'Yield Quantity': 10,
        'Labor Cost (₹)': 6.0,
        'Instructions': 'Cast gravity lead grids from bullion ingot, apply active paste mixture with grey lead oxide powder, flash-dry and transfer to humidity curing chambers for 48 hours.',
        'Ingredient (Name or SKU)': 'Lead Oxide Powder (Grey Oxide)',
        'Ingredient Quantity': 3.5,
        'Ingredient Unit': 'kg',
      },
    ];

    if (format === 'xlsx') {
      downloadExcelFile(sampleRows, 'power_track_recipe_bom_template.xlsx', 'Recipe BOM Template');
    } else {
      const csvLines = [
        'Recipe Name,Finished Product (Name or SKU),Yield Quantity,Labor Cost (₹),Instructions,Ingredient (Name or SKU),Ingredient Quantity,Ingredient Unit',
        '12V 100Ah Deep Cycle Power Battery Assembly,12V 100Ah Deep Cycle Power Battery,1,18.5,"Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.",Positive Lead Plate 12V Sub-Assembly,6,pcs',
        '12V 100Ah Deep Cycle Power Battery Assembly,12V 100Ah Deep Cycle Power Battery,1,18.5,"Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.",Refined Lead Ingot 99.97%,14.5,kg',
        '12V 100Ah Deep Cycle Power Battery Assembly,12V 100Ah Deep Cycle Power Battery,1,18.5,"Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.",Lead Oxide Powder (Grey Oxide),5.2,kg',
        '12V 100Ah Deep Cycle Power Battery Assembly,12V 100Ah Deep Cycle Power Battery,1,18.5,"Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.",Dual Terminal Brass Connector,2,pcs',
        'Positive Lead Plate 12V Sub-Assembly (10x Batch),Positive Lead Plate 12V Sub-Assembly,10,6,"Cast gravity lead grids from bullion ingot, apply active paste mixture with grey lead oxide powder, flash-dry and transfer to humidity curing chambers for 48 hours.",Refined Lead Ingot 99.97%,5,kg',
        'Positive Lead Plate 12V Sub-Assembly (10x Batch),Positive Lead Plate 12V Sub-Assembly,10,6,"Cast gravity lead grids from bullion ingot, apply active paste mixture with grey lead oxide powder, flash-dry and transfer to humidity curing chambers for 48 hours.",Lead Oxide Powder (Grey Oxide),3.5,kg',
      ].join('\n');
      downloadCSVFile(csvLines, 'power_track_recipe_bom_template.csv');
    }
  };

  const parseNumeric = (val: any, defaultVal: number = 0): number => {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (typeof val === 'number') return isNaN(val) ? defaultVal : val;
    const cleaned = String(val).replace(/,/g, '').trim();
    if (cleaned === '') return defaultVal;
    const num = Number(cleaned);
    return isNaN(num) ? defaultVal : num;
  };

  const normalizeKey = (key: string): string => {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  const findMatchingItem = (query: string): InventoryItem | undefined => {
    if (!query) return undefined;
    const clean = query.trim().toLowerCase();
    return items.find(
      (i) => i.name.trim().toLowerCase() === clean || i.sku.trim().toLowerCase() === clean
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setIsProcessing(true);
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new Error('The uploaded spreadsheet does not contain any sheets.');
      }

      const worksheet = workbook.Sheets[firstSheetName];
      const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (!rawRows || rawRows.length === 0) {
        throw new Error('The uploaded sheet is empty. Please add recipe BOM rows.');
      }

      // Group rows by Recipe Name
      const recipeMap = new Map<string, {
        name: string;
        finishedProduct: string;
        yieldQuantity: number;
        laborCost: number;
        instructions: string;
        ingredients: {
          rawItemQuery: string;
          quantity: number;
          unit: string;
        }[];
      }>();

      rawRows.forEach((row, idx) => {
        const normalizedRow: Record<string, any> = {};
        Object.entries(row).forEach(([k, v]) => {
          normalizedRow[normalizeKey(k)] = v;
        });

        const recipeName = String(
          normalizedRow['recipename'] ||
          normalizedRow['name'] ||
          normalizedRow['recipe'] ||
          normalizedRow['bomname'] ||
          `Recipe ${idx + 1}`
        ).trim();

        const finishedProduct = String(
          normalizedRow['finishedproductnameorsku'] ||
          normalizedRow['finishedproduct'] ||
          normalizedRow['finisheditem'] ||
          normalizedRow['outputitem'] ||
          normalizedRow['product'] ||
          recipeName
        ).trim();

        const yieldQuantity = parseNumeric(
          normalizedRow['yieldquantity'] ||
          normalizedRow['yield'] ||
          normalizedRow['outputquantity'] ||
          normalizedRow['batchsize'],
          1
        );

        const laborCost = parseNumeric(
          normalizedRow['laborcost'] ||
          normalizedRow['laborcostrupee'] ||
          normalizedRow['laborcostdollar'] ||
          normalizedRow['labor'] ||
          normalizedRow['overhead'],
          0
        );

        const instructions = String(
          normalizedRow['instructions'] ||
          normalizedRow['description'] ||
          normalizedRow['notes'] ||
          normalizedRow['method'] ||
          ''
        ).trim();

        // Ingredient columns
        const ingredientQuery = String(
          normalizedRow['ingredientnameorsku'] ||
          normalizedRow['ingredient'] ||
          normalizedRow['ingredientname'] ||
          normalizedRow['rawmaterial'] ||
          normalizedRow['component'] ||
          ''
        ).trim();

        const ingredientQuantity = parseNumeric(
          normalizedRow['ingredientquantity'] ||
          normalizedRow['quantity'] ||
          normalizedRow['qty'] ||
          normalizedRow['amount'],
          1
        );

        const ingredientUnit = String(
          normalizedRow['ingredientunit'] ||
          normalizedRow['unit'] ||
          normalizedRow['uom'] ||
          'kg'
        ).trim() || 'kg';

        // Check if there's a multi-ingredient string column (e.g., "Lead: 5kg; Oxide: 2kg")
        const allIngredientsStr = String(normalizedRow['ingredients'] || '').trim();

        if (!recipeMap.has(recipeName)) {
          recipeMap.set(recipeName, {
            name: recipeName,
            finishedProduct,
            yieldQuantity: Math.max(0.01, yieldQuantity),
            laborCost: Math.max(0, laborCost),
            instructions,
            ingredients: [],
          });
        }

        const currentRecipe = recipeMap.get(recipeName)!;

        // If row has standard single ingredient column
        if (ingredientQuery) {
          currentRecipe.ingredients.push({
            rawItemQuery: ingredientQuery,
            quantity: Math.max(0.001, ingredientQuantity),
            unit: ingredientUnit,
          });
        }

        // If row had a combined string of ingredients
        if (allIngredientsStr) {
          const parts = allIngredientsStr.split(/[;,]/);
          parts.forEach((p) => {
            const clean = p.trim();
            if (!clean) return;
            // e.g. "Lead Ingot: 5 kg" or "Lead Ingot 5kg"
            const match = clean.match(/^([^:]+)(?::\s*|\s+)([0-9.]+)\s*([a-zA-Z]*)$/);
            if (match) {
              currentRecipe.ingredients.push({
                rawItemQuery: match[1].trim(),
                quantity: parseFloat(match[2]) || 1,
                unit: match[3]?.trim() || 'kg',
              });
            } else {
              currentRecipe.ingredients.push({
                rawItemQuery: clean,
                quantity: 1,
                unit: 'pcs',
              });
            }
          });
        }
      });

      // Match items and validate
      const finalRecipes: ParsedRecipe[] = Array.from(recipeMap.values()).map((r) => {
        const matchedFinishedItem = findMatchingItem(r.finishedProduct) || findMatchingItem(r.name);
        
        const mappedIngredients = r.ingredients.map((ing) => {
          const matchedRawItem = findMatchingItem(ing.rawItemQuery);
          return {
            ...ing,
            matchedRawItem,
            unit: matchedRawItem ? matchedRawItem.unit : ing.unit,
          };
        });

        const isValid = Boolean(r.name && r.finishedProduct);
        const error = !r.name ? 'Missing Recipe Name' : !r.finishedProduct ? 'Missing Finished Product' : undefined;

        return {
          name: r.name,
          finishedProductQuery: r.finishedProduct,
          matchedFinishedItem,
          yieldQuantity: r.yieldQuantity,
          laborCost: r.laborCost,
          instructions: r.instructions,
          ingredients: mappedIngredients,
          isValid,
          error,
        };
      });

      setParsedRecipes(finalRecipes);
      const validCount = finalRecipes.filter((r) => r.isValid).length;
      setStatusMessage(`Found ${finalRecipes.length} recipes with ${finalRecipes.reduce((acc, r) => acc + r.ingredients.length, 0)} total ingredients (${validCount} ready to import)`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to parse Excel file. Please verify file format.');
      setParsedRecipes([]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteImport = async () => {
    const validRecipes = parsedRecipes.filter((r) => r.isValid);
    if (validRecipes.length === 0) {
      setErrorMessage('No valid recipes to import.');
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);
    setImportProgress({ current: 0, total: validRecipes.length });

    try {
      // Session cache of items: remembers existing items AND items created during this import session
      // so duplicate materials (e.g. "Separator Sheet" used across multiple recipes) are created only once and reused!
      const sessionItemMap = new Map<string, { id: string; name: string; unit: string }>();
      items.forEach((it) => {
        sessionItemMap.set(it.name.trim().toLowerCase(), { id: it.id, name: it.name, unit: it.unit });
        if (it.sku) {
          sessionItemMap.set(it.sku.trim().toLowerCase(), { id: it.id, name: it.name, unit: it.unit });
        }
      });

      for (let i = 0; i < validRecipes.length; i++) {
        const rec = validRecipes[i];

        // 1. Ensure Finished Product exists (check existing, check session map, or create)
        const finKey = rec.finishedProductQuery.trim().toLowerCase();
        let finishedId: string;
        let finishedName: string;

        if (rec.matchedFinishedItem) {
          finishedId = rec.matchedFinishedItem.id;
          finishedName = rec.matchedFinishedItem.name;
          sessionItemMap.set(finKey, { id: finishedId, name: finishedName, unit: rec.matchedFinishedItem.unit });
        } else if (sessionItemMap.has(finKey)) {
          const cached = sessionItemMap.get(finKey)!;
          finishedId = cached.id;
          finishedName = cached.name;
        } else {
          // Auto-create finished product if not found
          const newFinId = await addItem({
            name: rec.finishedProductQuery,
            sku: `FIN-${Date.now().toString().slice(-4)}${i + 1}`,
            type: 'finished_good',
            category: 'General',
            unit: 'pcs',
            quantity: 0,
            minStock: 5,
            unitCost: 0,
            sellingPrice: 0,
            supplier: 'In-House Manufacturing',
            location: 'Finished Goods',
            notes: `Auto-created from recipe ${rec.name}`,
          });
          finishedId = newFinId;
          finishedName = rec.finishedProductQuery;
          sessionItemMap.set(finKey, { id: finishedId, name: finishedName, unit: 'pcs' });
        }

        // 2. Ensure each ingredient exists (check existing, check session map, or create)
        const finalizedIngredients: IngredientRequirement[] = [];

        for (const ing of rec.ingredients) {
          const rawKey = ing.rawItemQuery.trim().toLowerCase();
          let rawId: string;
          let rawName: string;
          let unit = ing.unit;

          if (ing.matchedRawItem) {
            rawId = ing.matchedRawItem.id;
            rawName = ing.matchedRawItem.name;
            unit = ing.matchedRawItem.unit;
            sessionItemMap.set(rawKey, { id: rawId, name: rawName, unit });
          } else if (sessionItemMap.has(rawKey)) {
            // REUSE item created earlier during this same import run!
            const cached = sessionItemMap.get(rawKey)!;
            rawId = cached.id;
            rawName = cached.name;
            unit = cached.unit || ing.unit;
          } else {
            // Auto-create raw material if not found
            const newRawId = await addItem({
              name: ing.rawItemQuery,
              sku: `RAW-${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 900)}`,
              type: 'raw_material',
              category: 'General',
              unit: ing.unit || 'kg',
              quantity: 0,
              minStock: 5,
              unitCost: 0,
              sellingPrice: 0,
              supplier: 'General Supply',
              location: 'Raw Materials Storage',
              notes: `Auto-created from recipe ingredient ${ing.rawItemQuery}`,
            });
            rawId = newRawId;
            rawName = ing.rawItemQuery;
            unit = ing.unit || 'kg';
            sessionItemMap.set(rawKey, { id: rawId, name: rawName, unit });
          }

          finalizedIngredients.push({
            rawItemId: rawId,
            rawItemName: rawName,
            quantity: ing.quantity,
            unit,
          });
        }

        // 3. Save Recipe
        await addRecipe({
          name: rec.name,
          finishedItemId: finishedId,
          finishedItemName: finishedName,
          yieldQuantity: rec.yieldQuantity,
          laborCost: rec.laborCost,
          instructions: rec.instructions,
          ingredients: finalizedIngredients,
        });

        setImportProgress({ current: i + 1, total: validRecipes.length });
      }

      setStatusMessage(`Successfully imported all ${validRecipes.length} recipes & BOMs!`);
      setTimeout(() => {
        resetState();
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error occurred while saving recipes.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 border border-purple-200/60 flex items-center justify-center shrink-0">
              <CookingPot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Import Recipes & BOM from Excel / CSV</h2>
              <p className="text-xs text-slate-500">Bulk import assembly formulas, yields, and ingredient lists</p>
            </div>
          </div>
          <button
            onClick={() => {
              resetState();
              onClose();
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Step 1: Download Templates */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                Step 1: Download Pre-Formatted Recipe Template
              </span>
              <p className="text-xs text-slate-700 mt-0.5 font-medium">
                Standard ERP format with Recipe Name, Finished Product, Yield, and Ingredient rows.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleDownloadTemplate('xlsx')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-purple-700 bg-white border border-purple-300 hover:bg-purple-50 transition shadow-2xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-purple-600" />
                <span>Download Excel (.xlsx)</span>
              </button>

              <button
                type="button"
                onClick={() => handleDownloadTemplate('csv')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 transition shadow-2xs cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>Download CSV (.csv)</span>
              </button>
            </div>
          </div>

          {/* Step 2: Upload Completed File */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Step 2: Upload Your Filled Recipe Spreadsheet
            </label>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-purple-400 hover:bg-purple-50/20 rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 group"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center group-hover:scale-105 transition">
                <Upload className="w-6 h-6" />
              </div>
              <div className="text-xs font-semibold text-slate-800">
                {fileName ? (
                  <span className="text-purple-600 font-bold">{fileName}</span>
                ) : (
                  'Click to upload or drag & drop Recipe Excel / CSV file'
                )}
              </div>
              <p className="text-[11px] text-slate-400">Supports .xlsx, .xls, and .csv files</p>
            </div>
          </div>

          {/* Error / Status Messages */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {statusMessage && (
            <div className="p-3.5 rounded-xl bg-purple-50 border border-purple-200 text-purple-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-purple-600" />
              <span className="font-medium">{statusMessage}</span>
            </div>
          )}

          {/* Step 3: Parsed Recipe BOM Preview */}
          {parsedRecipes.length > 0 && (
            <div className="space-y-3 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Spreadsheet Preview ({parsedRecipes.length} Recipes)
                </span>
                <span className="text-[11px] text-slate-500">
                  {parsedRecipes.filter((r) => r.isValid).length} Valid
                </span>
              </div>

              <div className="border border-slate-200 rounded-xl max-h-60 overflow-y-auto divide-y divide-slate-100 bg-slate-50">
                {parsedRecipes.map((rec, idx) => (
                  <div key={idx} className="p-3 bg-white hover:bg-slate-50 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                          <span>{rec.name}</span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            Yield: {rec.yieldQuantity}
                          </span>
                        </h4>
                        <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-2">
                          <span>
                            Output:{' '}
                            <strong className="text-slate-800">
                              {rec.matchedFinishedItem
                                ? `${rec.matchedFinishedItem.name} (${rec.matchedFinishedItem.sku})`
                                : rec.finishedProductQuery}
                            </strong>
                          </span>
                          {rec.matchedFinishedItem ? (
                            <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                              Existing: {rec.matchedFinishedItem.sku}
                            </span>
                          ) : (
                            <span className="text-[9px] text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                              Will create new finished good
                            </span>
                          )}
                          {rec.laborCost > 0 && <span>Labor: ₹{rec.laborCost.toFixed(2)}</span>}
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        {rec.isValid ? (
                          <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            Ready
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                            {rec.error || 'Invalid'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Ingredients summary */}
                    {rec.ingredients.length > 0 && (
                      <div className="bg-slate-50 rounded-lg p-2.5 border border-slate-200/80 text-[11px] text-slate-600 space-y-1.5">
                        <div className="font-semibold text-slate-700 flex items-center justify-between">
                          <span className="flex items-center gap-1">
                            <Layers className="w-3 h-3 text-purple-600" />
                            <span>{rec.ingredients.length} Ingredients Required:</span>
                          </span>
                        </div>
                        <div className="divide-y divide-slate-200/60">
                          {rec.ingredients.map((ing, iIdx) => (
                            <div
                              key={iIdx}
                              className="py-1 flex items-center justify-between text-[11px] gap-2 flex-wrap"
                            >
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-semibold text-slate-800">{ing.rawItemQuery}</span>
                                {ing.matchedRawItem ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-medium">
                                    Uses existing: <strong className="text-emerald-900">{ing.matchedRawItem.name}</strong> ({ing.matchedRawItem.sku})
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-medium">
                                    Will create new material ({ing.unit})
                                  </span>
                                )}
                              </div>
                              <span className="font-mono font-bold text-purple-700 shrink-0">
                                {ing.quantity} {ing.unit}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Import Progress Bar */}
          {isImporting && (
            <div className="p-4 rounded-xl bg-purple-50 border border-purple-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-purple-900">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                  Saving recipes to database...
                </span>
                <span>
                  {importProgress.current} / {importProgress.total}
                </span>
              </div>
              <div className="w-full bg-purple-200/60 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-purple-600 h-2 rounded-full transition-all duration-150"
                  style={{
                    width: `${(importProgress.current / (importProgress.total || 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50 rounded-b-2xl flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500">
            {parsedRecipes.length > 0 && (
              <span>
                {parsedRecipes.filter((r) => r.isValid).length} recipes will be saved to your system.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                resetState();
                onClose();
              }}
              disabled={isImporting}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200 transition cursor-pointer"
            >
              Cancel
            </button>

            {parsedRecipes.filter((r) => r.isValid).length > 0 && (
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={isImporting || isProcessing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Importing...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Import {parsedRecipes.filter((r) => r.isValid).length} Recipes</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
