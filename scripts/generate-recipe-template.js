import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';

const sampleRecipeRows = [
  {
    'Recipe Name': '12V 100Ah Deep Cycle Power Battery Assembly',
    'Finished Product (Name or SKU)': '12V 100Ah Deep Cycle Power Battery',
    'Yield Quantity': 1,
    'Labor Cost ($)': 18.50,
    'Instructions': 'Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.',
    'Ingredient (Name or SKU)': 'Positive Lead Plate 12V Sub-Assembly',
    'Ingredient Quantity': 6,
    'Ingredient Unit': 'pcs',
  },
  {
    'Recipe Name': '12V 100Ah Deep Cycle Power Battery Assembly',
    'Finished Product (Name or SKU)': '12V 100Ah Deep Cycle Power Battery',
    'Yield Quantity': 1,
    'Labor Cost ($)': 18.50,
    'Instructions': 'Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.',
    'Ingredient (Name or SKU)': 'Refined Lead Ingot 99.97%',
    'Ingredient Quantity': 14.5,
    'Ingredient Unit': 'kg',
  },
  {
    'Recipe Name': '12V 100Ah Deep Cycle Power Battery Assembly',
    'Finished Product (Name or SKU)': '12V 100Ah Deep Cycle Power Battery',
    'Yield Quantity': 1,
    'Labor Cost ($)': 18.50,
    'Instructions': 'Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.',
    'Ingredient (Name or SKU)': 'Lead Oxide Powder (Grey Oxide)',
    'Ingredient Quantity': 5.2,
    'Ingredient Unit': 'kg',
  },
  {
    'Recipe Name': '12V 100Ah Deep Cycle Power Battery Assembly',
    'Finished Product (Name or SKU)': '12V 100Ah Deep Cycle Power Battery',
    'Yield Quantity': 1,
    'Labor Cost ($)': 18.50,
    'Instructions': 'Assemble cured positive and negative plate groups, fit separator envelopes, weld internal strap connections, cast case terminals, and seal with epoxy casing lid.',
    'Ingredient (Name or SKU)': 'Dual Terminal Brass Connector',
    'Ingredient Quantity': 2,
    'Ingredient Unit': 'pcs',
  },
  {
    'Recipe Name': 'Positive Lead Plate 12V Sub-Assembly (10x Batch)',
    'Finished Product (Name or SKU)': 'Positive Lead Plate 12V Sub-Assembly',
    'Yield Quantity': 10,
    'Labor Cost ($)': 6.00,
    'Instructions': 'Cast gravity lead grids from bullion ingot, apply active paste mixture with grey lead oxide powder, flash-dry and transfer to humidity curing chambers for 48 hours.',
    'Ingredient (Name or SKU)': 'Refined Lead Ingot 99.97%',
    'Ingredient Quantity': 5.0,
    'Ingredient Unit': 'kg',
  },
  {
    'Recipe Name': 'Positive Lead Plate 12V Sub-Assembly (10x Batch)',
    'Finished Product (Name or SKU)': 'Positive Lead Plate 12V Sub-Assembly',
    'Yield Quantity': 10,
    'Labor Cost ($)': 6.00,
    'Instructions': 'Cast gravity lead grids from bullion ingot, apply active paste mixture with grey lead oxide powder, flash-dry and transfer to humidity curing chambers for 48 hours.',
    'Ingredient (Name or SKU)': 'Lead Oxide Powder (Grey Oxide)',
    'Ingredient Quantity': 3.5,
    'Ingredient Unit': 'kg',
  },
];

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// 1. Generate Excel (.xlsx)
const worksheet = XLSX.utils.json_to_sheet(sampleRecipeRows);
worksheet['!cols'] = [
  { wch: 38 }, // Recipe Name
  { wch: 35 }, // Finished Product
  { wch: 15 }, // Yield Quantity
  { wch: 15 }, // Labor Cost
  { wch: 45 }, // Instructions
  { wch: 35 }, // Ingredient Name or SKU
  { wch: 18 }, // Ingredient Quantity
  { wch: 16 }, // Ingredient Unit
];

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, worksheet, 'Recipe BOMs');

const xlsxPath = path.join(publicDir, 'power_track_recipe_bom_template.xlsx');
XLSX.writeFile(workbook, xlsxPath);
console.log('Created:', xlsxPath);

// 2. Generate CSV (.csv)
const csvContent = XLSX.utils.sheet_to_csv(worksheet);
const csvPath = path.join(publicDir, 'power_track_recipe_bom_template.csv');
fs.writeFileSync(csvPath, csvContent, 'utf-8');
console.log('Created:', csvPath);
