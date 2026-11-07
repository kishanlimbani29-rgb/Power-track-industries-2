import React, { useState, useRef } from 'react';
import {
  X,
  FileSpreadsheet,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  FileText,
  Boxes,
  Loader2,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useInventory } from '../context/InventoryContext';
import { ItemType } from '../types/inventory';
import { downloadExcelFile, downloadCSVFile } from '../utils/fileDownload';

interface ExcelImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ParsedItem {
  name: string;
  sku: string;
  type: ItemType;
  category: string;
  unit: string;
  quantity: number;
  minStock: number;
  unitCost: number;
  sellingPrice: number;
  supplier: string;
  location: string;
  notes: string;
  isValid: boolean;
  error?: string;
}

export const ExcelImportModal: React.FC<ExcelImportModalProps> = ({ isOpen, onClose }) => {
  const { addItem, items: existingItems } = useInventory();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const resetState = () => {
    setFileName(null);
    setParsedItems([]);
    setIsProcessing(false);
    setIsImporting(false);
    setImportProgress({ current: 0, total: 0 });
    setStatusMessage(null);
    setErrorMessage(null);
  };

  const handleDownloadTemplate = (format: 'xlsx' | 'csv') => {
    const sampleRows = [
      {
        'Item Name': 'Refined Lead Ingot 99.97%',
        'SKU / Code': 'RAW-LED-001',
        'Classification': 'Raw Material',
        'Unit of Measure': 'kg',
        'Current Stock': 500,
        'Min Stock Alert': 100,
        'Unit Cost (₹)': 2.15,
        'Selling Price (₹)': 0,
        'Supplier / Vendor': 'National Smelting Corp',
        'Shelf / Location': 'Bay 1 - Heavy Storage',
        'Notes': 'High purity bullion grade lead for plate casting',
      },
      {
        'Item Name': 'Lead Oxide Powder (Grey Oxide)',
        'SKU / Code': 'RAW-OXI-002',
        'Classification': 'Raw Material',
        'Unit of Measure': 'kg',
        'Current Stock': 250,
        'Min Stock Alert': 50,
        'Unit Cost (₹)': 2.8,
        'Selling Price (₹)': 0,
        'Supplier / Vendor': 'Apex Chemical Minerals',
        'Shelf / Location': 'Dry Silo 2',
        'Notes': '70-80% lead monoxide (PbO) / free lead',
      },
      {
        'Item Name': 'Positive Lead Plate 12V Sub-Assembly',
        'SKU / Code': 'SMF-PLT-003',
        'Classification': 'Semi Finished',
        'Unit of Measure': 'pcs',
        'Current Stock': 120,
        'Min Stock Alert': 30,
        'Unit Cost (₹)': 3.4,
        'Selling Price (₹)': 0,
        'Supplier / Vendor': 'In-House Foundry',
        'Shelf / Location': 'Curing Chamber 1',
        'Notes': 'Pasted and cured grid plates ready for formation',
      },
      {
        'Item Name': '12V 100Ah Deep Cycle Power Battery',
        'SKU / Code': 'FIN-BAT-004',
        'Classification': 'Finished Good',
        'Unit of Measure': 'pcs',
        'Current Stock': 45,
        'Min Stock Alert': 15,
        'Unit Cost (₹)': 48.5,
        'Selling Price (₹)': 115,
        'Supplier / Vendor': 'Power Track Manufacturing',
        'Shelf / Location': 'Finished Goods Rack A',
        'Notes': 'Complete assembly with sealed casing and terminals',
      },
      {
        'Item Name': 'Dual Terminal Brass Connector',
        'SKU / Code': 'ITM-TRM-005',
        'Classification': 'Composite',
        'Unit of Measure': 'pcs',
        'Current Stock': 300,
        'Min Stock Alert': 50,
        'Unit Cost (₹)': 1.2,
        'Selling Price (₹)': 3.5,
        'Supplier / Vendor': 'Precision Hardware Inc',
        'Shelf / Location': 'Bin 14-C',
        'Notes': 'Can be sold as replacement part or consumed in assembly',
      },
    ];

    if (format === 'xlsx') {
      downloadExcelFile(sampleRows, 'power_track_inventory_template.xlsx', 'Inventory Template');
    } else {
      const csvLines = [
        'Item Name,SKU / Code,Classification,Unit of Measure,Current Stock,Min Stock Alert,Unit Cost (₹),Selling Price (₹),Supplier / Vendor,Shelf / Location,Notes',
        'Refined Lead Ingot 99.97%,RAW-LED-001,Raw Material,kg,500,100,2.15,0,National Smelting Corp,Bay 1 - Heavy Storage,High purity bullion grade lead for plate casting',
        'Lead Oxide Powder (Grey Oxide),RAW-OXI-002,Raw Material,kg,250,50,2.8,0,Apex Chemical Minerals,Dry Silo 2,70-80% lead monoxide (PbO) / free lead',
        'Positive Lead Plate 12V Sub-Assembly,SMF-PLT-003,Semi Finished,pcs,120,30,3.4,0,In-House Foundry,Curing Chamber 1,Pasted and cured grid plates ready for formation',
        '12V 100Ah Deep Cycle Power Battery,FIN-BAT-004,Finished Good,pcs,45,15,48.5,115,Power Track Manufacturing,Finished Goods Rack A,Complete assembly with sealed casing and terminals',
        'Dual Terminal Brass Connector,ITM-TRM-005,Composite,pcs,300,50,1.2,3.5,Precision Hardware Inc,Bin 14-C,Can be sold as replacement part or consumed in assembly',
      ].join('\n');
      downloadCSVFile(csvLines, 'power_track_inventory_template.csv');
    }
  };

  const parseNumericCell = (val: any, defaultVal: number = 0): number => {
    if (val === undefined || val === null || val === '') return defaultVal;
    if (typeof val === 'number') return isNaN(val) ? defaultVal : val;
    const cleaned = String(val).replace(/,/g, '').trim();
    if (cleaned === '') return defaultVal;
    const num = Number(cleaned);
    return isNaN(num) ? defaultVal : num;
  };

  const getRowValue = (row: Record<string, any>, keys: string[]): any => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
        return row[k];
      }
    }
    return undefined;
  };

  const parseType = (val: any): ItemType => {
    if (!val) return 'raw_material';
    const s = String(val).toLowerCase().trim().replace(/[-_]/g, ' ');
    if (s.includes('semi')) return 'semi_finished';
    if (s.includes('finish') || s.includes('ready') || s.includes('fg')) return 'finished_good';
    if (s.includes('composite') || s.includes('both') || s.includes('dual')) return 'both';
    return 'raw_material';
  };

  const normalizeKey = (key: string): string => {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
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
        throw new Error('The uploaded sheet is empty. Please add product rows.');
      }

      const seenNamesInSheet = new Set<string>();
      const seenSkusInSheet = new Set<string>();

      const items: ParsedItem[] = rawRows.map((row, idx) => {
        // Map keys flexibly
        const normalizedRow: Record<string, any> = {};
        Object.entries(row).forEach(([k, v]) => {
          normalizedRow[normalizeKey(k)] = v;
        });

        const name = String(
          normalizedRow['itemname'] ||
          normalizedRow['name'] ||
          normalizedRow['product'] ||
          normalizedRow['productname'] ||
          normalizedRow['item'] ||
          ''
        ).trim();

        const sku = String(
          normalizedRow['skucode'] ||
          normalizedRow['sku'] ||
          normalizedRow['code'] ||
          normalizedRow['itemcode'] ||
          ''
        ).trim() || `SKU-${Date.now().toString().slice(-4)}${idx + 1}`;

        const rawType =
          normalizedRow['classification'] ||
          normalizedRow['itemclassification'] ||
          normalizedRow['type'] ||
          normalizedRow['itemtype'] ||
          '';

        const type = parseType(rawType);

        const unit = String(
          normalizedRow['unitofmeasure'] ||
          normalizedRow['unit'] ||
          normalizedRow['uom'] ||
          'kg'
        ).trim() || 'kg';

        const rawQuantity = getRowValue(normalizedRow, ['currentstock', 'stock', 'quantity', 'qty']);
        const quantity = parseNumericCell(rawQuantity, 0);

        const rawMinStock = getRowValue(normalizedRow, ['minstockalert', 'minstock', 'minimumstock', 'alertlevel', 'minlevel']);
        const minStock = parseNumericCell(rawMinStock, 5);

        const rawUnitCost = getRowValue(normalizedRow, ['unitcost', 'unitcostrupee', 'unitcostdollar', 'cost', 'costperunit']);
        const unitCost = parseNumericCell(rawUnitCost, 0);

        const rawSellingPrice = getRowValue(normalizedRow, ['sellingprice', 'sellingpricerupee', 'sellingpricedollar', 'price', 'retailprice']);
        const sellingPrice = parseNumericCell(rawSellingPrice, 0);

        const supplier = String(
          normalizedRow['suppliervendor'] ||
          normalizedRow['supplier'] ||
          normalizedRow['vendor'] ||
          ''
        ).trim();

        const location = String(
          normalizedRow['shelflocation'] ||
          normalizedRow['shelf'] ||
          normalizedRow['location'] ||
          ''
        ).trim();

        const notes = String(
          normalizedRow['notes'] ||
          normalizedRow['description'] ||
          normalizedRow['note'] ||
          ''
        ).trim();

        const nameLower = name.toLowerCase();
        const skuLower = sku.toLowerCase();

        let isValid = true;
        let error: string | undefined;

        if (!name) {
          isValid = false;
          error = 'Missing Item Name';
        } else if (existingItems.some((ei) => ei.name.trim().toLowerCase() === nameLower)) {
          isValid = false;
          error = `Item name "${name}" already exists in inventory`;
        } else if (seenNamesInSheet.has(nameLower)) {
          isValid = false;
          error = `Duplicate item name "${name}" in spreadsheet`;
        } else if (existingItems.some((ei) => (ei.sku || '').trim().toLowerCase() === skuLower)) {
          isValid = false;
          error = `SKU "${sku}" already exists in inventory`;
        } else if (seenSkusInSheet.has(skuLower)) {
          isValid = false;
          error = `Duplicate SKU "${sku}" in spreadsheet`;
        }

        if (name) seenNamesInSheet.add(nameLower);
        if (sku) seenSkusInSheet.add(skuLower);

        return {
          name,
          sku,
          type,
          category: 'General',
          unit,
          quantity: Math.max(0, quantity),
          minStock: Math.max(0, minStock),
          unitCost: Math.max(0, unitCost),
          sellingPrice: type === 'raw_material' ? 0 : Math.max(0, sellingPrice),
          supplier,
          location,
          notes,
          isValid,
          error,
        };
      });

      setParsedItems(items);
      const validCount = items.filter((i) => i.isValid).length;
      setStatusMessage(`Found ${items.length} rows (${validCount} ready to import)`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to parse Excel file. Please verify file format.');
      setParsedItems([]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExecuteImport = async () => {
    const validItems = parsedItems.filter((i) => i.isValid);
    if (validItems.length === 0) {
      setErrorMessage('No valid items to import.');
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);
    setImportProgress({ current: 0, total: validItems.length });

    try {
      for (let i = 0; i < validItems.length; i++) {
        const item = validItems[i];
        await addItem({
          name: item.name,
          sku: item.sku,
          type: item.type,
          category: item.category,
          unit: item.unit,
          quantity: item.quantity,
          minStock: item.minStock,
          unitCost: item.unitCost,
          sellingPrice: item.sellingPrice,
          supplier: item.supplier,
          location: item.location,
          notes: item.notes,
        });
        setImportProgress({ current: i + 1, total: validItems.length });
      }

      setStatusMessage(`Successfully imported all ${validItems.length} inventory items!`);
      setTimeout(() => {
        resetState();
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error occurred while saving items to inventory.');
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
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/60 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Import Inventory from Excel / CSV</h2>
              <p className="text-xs text-slate-500">Bulk add raw materials and finished goods in seconds</p>
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
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
                  Step 1: Download Pre-Formatted Template
                </span>
                <p className="text-xs text-slate-700 mt-0.5 font-medium">
                  Use this template with the exact columns (Name, SKU, Classification, Unit, Stock, Cost, etc.)
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleDownloadTemplate('xlsx')}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-700 bg-white border border-emerald-300 hover:bg-emerald-50 transition shadow-2xs cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-emerald-600" />
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
              Step 2: Upload Your Filled Spreadsheet
            </label>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/20 rounded-2xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 group"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx, .xls, .csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:scale-105 transition">
                <Upload className="w-6 h-6" />
              </div>
              <div className="text-xs font-semibold text-slate-800">
                {fileName ? (
                  <span className="text-indigo-600 font-bold">{fileName}</span>
                ) : (
                  'Click to upload or drag & drop Excel / CSV file'
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
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span className="font-medium">{statusMessage}</span>
            </div>
          )}

          {/* Step 3: Parsed Rows Preview */}
          {parsedItems.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                  Spreadsheet Preview ({parsedItems.length} Products)
                </span>
                <span className="text-[11px] text-slate-500">
                  {parsedItems.filter((i) => i.isValid).length} Valid
                </span>
              </div>

              <div className="border border-slate-200 rounded-xl max-h-56 overflow-y-auto divide-y divide-slate-100 bg-slate-50">
                {parsedItems.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 flex items-center justify-between gap-3 text-xs bg-white hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 truncate flex items-center gap-1.5">
                        <span>{item.name || <span className="text-rose-500 italic">Missing Name</span>}</span>
                        <span className="font-mono text-[10px] text-slate-500 bg-slate-100 px-1 py-0.2 rounded">
                          {item.sku}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span className="capitalize">{item.type.replace('_', ' ')}</span>
                        <span>•</span>
                        <span>
                          {item.quantity} {item.unit}
                        </span>
                        {item.unitCost > 0 && (
                          <>
                            <span>•</span>
                            <span>Cost: ₹{item.unitCost.toFixed(2)}</span>
                          </>
                        )}
                        {item.sellingPrice > 0 && (
                          <>
                            <span>•</span>
                            <span>Sell: ₹{item.sellingPrice.toFixed(2)}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      {item.isValid ? (
                        <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          Ready
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                          {item.error || 'Invalid'}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Import Progress Bar */}
          {isImporting && (
            <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-indigo-900">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  Saving items to inventory...
                </span>
                <span>
                  {importProgress.current} / {importProgress.total}
                </span>
              </div>
              <div className="w-full bg-indigo-200/60 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-150"
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
            {parsedItems.length > 0 && (
              <span>
                {parsedItems.filter((i) => i.isValid).length} items will be added to your database.
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

            {parsedItems.filter((i) => i.isValid).length > 0 && (
              <button
                type="button"
                onClick={handleExecuteImport}
                disabled={isImporting || isProcessing}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Importing...</span>
                  </>
                ) : (
                  <>
                    <Boxes className="w-3.5 h-3.5" />
                    <span>Import {parsedItems.filter((i) => i.isValid).length} Products</span>
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
