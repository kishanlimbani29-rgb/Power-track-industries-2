import { Recipe, InventoryItem } from '../types/inventory';
import { PdfDoc, pdfDate, pdfMoney, pdfSafe, shareOrDownloadPdf } from './tradePdf';
import { getAvailableStockForIngredient } from './itemResolver';

export interface BomPdfOptions {
  recipe: Recipe;
  items: InventoryItem[];
  finishedItem?: InventoryItem | null;
  canViewCostPerUnit: boolean;
  mode?: 'download' | 'share';
}

const fmtQty = (n: number) => {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? num.toLocaleString('en-IN') : num.toLocaleString('en-IN', { maximumFractionDigits: 3 });
};

export async function generateBomPdf({
  recipe,
  items,
  finishedItem,
  canViewCostPerUnit,
  mode = 'download',
}: BomPdfOptions) {
  const doc = new PdfDoc();
  const unitLabel = finishedItem?.unit || 'pc';
  const yieldQty = Number(recipe.yieldQuantity) > 0 ? Number(recipe.yieldQuantity) : 1;
  const ingredients = recipe.ingredients || [];

  // Header Banner
  doc.text(doc.left, doc.y + 16, 'POWER TRACK INDUSTRIES', 15, { bold: true });
  doc.text(doc.right, doc.y + 14, 'BILL OF MATERIALS (BOM)', 11, { bold: true, align: 'right', gray: true });
  doc.y += 22;
  doc.text(doc.left, doc.y + 10, 'Brand: Welten  |  Battery Manufacturing & Production', 9, { gray: true });
  doc.text(doc.right, doc.y + 10, `Date: ${pdfDate(new Date().toISOString())}`, 9, { align: 'right', gray: true });
  doc.y += 16;
  doc.line(doc.left, doc.y, doc.right, doc.y, 1, false);
  doc.gap(14);

  // BOM Title & Output Summary Box
  doc.rect(doc.left, doc.y, doc.width, 46, 0.95);
  doc.text(doc.left + 10, doc.y + 16, pdfSafe(recipe.name), 13, { bold: true });
  doc.text(
    doc.left + 10,
    doc.y + 32,
    `Output Product: ${pdfSafe(finishedItem?.name || recipe.finishedItemName || '-')}   |   1 batch = ${fmtQty(yieldQty)} ${pdfSafe(unitLabel)}   |   ${ingredients.length} materials`,
    9,
    { gray: true }
  );
  doc.y += 58;

  // Materials Table
  let totalBatchMaterialCost = 0;

  const tableRows = ingredients.map((ing) => {
    const { item: raw, totalAvailable } = getAvailableStockForIngredient(items, ing);
    const qtyPerBatch = Number(ing.quantity) || 0;
    const unit = raw?.unit || ing.unit || '';
    const unitCost = Number(raw?.unitCost) || 0;
    const lineCost = qtyPerBatch * unitCost;
    totalBatchMaterialCost += lineCost;

    const nameText = `${pdfSafe(raw ? raw.name : ing.rawItemName)} (${pdfSafe(unit)})`;
    const qtyText = `${fmtQty(qtyPerBatch)} ${pdfSafe(unit)}`;
    const stockText = `${fmtQty(totalAvailable)} ${pdfSafe(unit)}`;

    if (canViewCostPerUnit) {
      return [nameText, qtyText, stockText, pdfMoney(lineCost)];
    }
    return [nameText, qtyText, stockText];
  });

  if (canViewCostPerUnit) {
    doc.table(
      [
        { title: 'MATERIAL', frac: 0.44, align: 'left' },
        { title: 'QTY / BATCH', frac: 0.18, align: 'right' },
        { title: 'STOCK', frac: 0.18, align: 'right' },
        { title: 'COST', frac: 0.2, align: 'right' },
      ],
      tableRows,
      9
    );
  } else {
    doc.table(
      [
        { title: 'MATERIAL', frac: 0.56, align: 'left' },
        { title: 'QTY / BATCH', frac: 0.22, align: 'right' },
        { title: 'STOCK', frac: 0.22, align: 'right' },
      ],
      tableRows,
      9
    );
  }

  // Cost Totals (only if user has cost permission)
  if (canViewCostPerUnit) {
    doc.gap(14);
    const materialPerBattery = totalBatchMaterialCost / yieldQty;
    const laborPerBatch = Number(recipe.laborCost) || 0;
    const laborPerBattery = laborPerBatch / yieldQty;

    const totalRows: { label: string; value: string; bold?: boolean }[] = [
      { label: 'Material cost / battery', value: pdfMoney(materialPerBattery), bold: laborPerBatch <= 0 },
    ];
    if (laborPerBatch > 0) {
      totalRows.push({ label: 'Labour cost / battery', value: pdfMoney(laborPerBattery) });
      totalRows.push({
        label: 'Total cost / battery',
        value: pdfMoney(materialPerBattery + laborPerBattery),
        bold: true,
      });
    }
    doc.totals(totalRows, 10);
  }

  // Assembly / Manufacturing Notes
  if (recipe.instructions && recipe.instructions.trim()) {
    doc.gap(14);
    doc.ensure(36);
    doc.text(doc.left, doc.y + 10, 'Manufacturing Instructions:', 9.5, { bold: true });
    doc.y += 15;
    doc.para(recipe.instructions.trim(), 9, { gray: true });
  }

  const blob = doc.toBlob();
  const safeSlug = recipe.name.trim().replace(/\s+/g, '_') || 'BOM';
  return shareOrDownloadPdf(blob, `BOM_${safeSlug}.pdf`, `BOM - ${recipe.name}`, mode);
}
