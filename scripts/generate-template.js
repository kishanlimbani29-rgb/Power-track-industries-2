import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const sampleData = [
  {
    'Item Name': 'Refined Lead Ingot 99.97%',
    'SKU / Code': 'RAW-LED-001',
    'Classification': 'Raw Material',
    'Unit of Measure': 'kg',
    'Current Stock': 500,
    'Min Stock Alert': 100,
    'Unit Cost ($)': 2.15,
    'Selling Price ($)': 0,
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
    'Unit Cost ($)': 2.80,
    'Selling Price ($)': 0,
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
    'Unit Cost ($)': 3.40,
    'Selling Price ($)': 0,
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
    'Unit Cost ($)': 48.50,
    'Selling Price ($)': 115.00,
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
    'Unit Cost ($)': 1.20,
    'Selling Price ($)': 3.50,
    'Supplier / Vendor': 'Precision Hardware Inc',
    'Shelf / Location': 'Bin 14-C',
    'Notes': 'Can be sold as replacement part or consumed in assembly',
  },
];

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Generate Excel (.xlsx)
const worksheet = XLSX.utils.json_to_sheet(sampleData);
// Set column widths for readability in Excel
worksheet['!cols'] = [
  { wch: 35 }, // Item Name
  { wch: 16 }, // SKU
  { wch: 18 }, // Classification
  { wch: 16 }, // Unit
  { wch: 14 }, // Current Stock
  { wch: 16 }, // Min Stock
  { wch: 15 }, // Unit Cost
  { wch: 16 }, // Selling Price
  { wch: 26 }, // Supplier
  { wch: 24 }, // Location
  { wch: 45 }, // Notes
];

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventory Items');

const xlsxPath = path.join(publicDir, 'power_track_inventory_template.xlsx');
XLSX.writeFile(workbook, xlsxPath);
console.log('Created:', xlsxPath);

// 2. Generate CSV (.csv)
const csvContent = XLSX.utils.sheet_to_csv(worksheet);
const csvPath = path.join(publicDir, 'power_track_inventory_template.csv');
fs.writeFileSync(csvPath, csvContent, 'utf-8');
console.log('Created:', csvPath);
