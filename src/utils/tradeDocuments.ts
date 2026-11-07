import { Purchase, PurchaseReturn, Sale, SalesReturn } from '../types/inventory';
import { PdfDoc, pdfDate, pdfMoney } from './tradePdf';
import { moneyPosition } from './tradeMath';

const BUSINESS = 'Power Track Industries (PTI)';

function header(pdf: PdfDoc, title: string, number: string, date: string) {
  pdf.text(pdf.left, pdf.y + 20, BUSINESS, 20, { bold: true });
  pdf.text(pdf.right, pdf.y + 14, title, 13, { bold: true, align: 'right' });
  pdf.text(pdf.right, pdf.y + 30, `No. ${number}`, 10, { align: 'right' });
  pdf.text(pdf.right, pdf.y + 44, `Date: ${date}`, 10, { align: 'right', gray: true });
  pdf.y += 56;
  pdf.line(pdf.left, pdf.y, pdf.right, pdf.y, 1.2, false);
  pdf.gap(14);
}

function party(pdf: PdfDoc, label: string, p: { name: string; phone?: string; gstin?: string; address?: string }, extra: string[] = []) {
  const startY = pdf.y;
  pdf.text(pdf.left, pdf.y + 9, label.toUpperCase(), 8, { bold: true, gray: true });
  pdf.y += 14;
  pdf.para(p.name, 12, { bold: true, width: pdf.width / 2 });
  if (p.address) pdf.para(p.address, 9, { width: pdf.width / 2, gray: true });
  if (p.phone) pdf.para(`Phone: ${p.phone}`, 9, { width: pdf.width / 2 });
  const leftEnd = pdf.y;
  let y = startY + 9;
  for (const e of extra) {
    pdf.text(pdf.right, y, e, 9, { align: 'right' });
    y += 13;
  }
  pdf.y = Math.max(leftEnd, y);
  pdf.gap(12);
}

function footer(pdf: PdfDoc, lines: string[]) {
  pdf.gap(18);
  for (const l of lines) pdf.para(l, 8, { gray: true });
  pdf.gap(26);
  pdf.ensure(30);
  pdf.line(pdf.right - 160, pdf.y, pdf.right, pdf.y, 0.6, false);
  pdf.text(pdf.right - 80, pdf.y + 12, 'Authorised signatory', 8, { align: 'center', gray: true });
  pdf.y += 16;
}

export function saleInvoicePdf(sale: Sale): Blob {
  const pdf = new PdfDoc();
  header(pdf, 'SALE INVOICE', sale.invoiceNumber, pdfDate(sale.createdAt));
  const extra: string[] = [];
  if (sale.vehicleNumber) extra.push(`Vehicle: ${sale.vehicleNumber}`);
  if (sale.trackingNumber) extra.push(`LR / Tracking: ${sale.trackingNumber}`);
  extra.push(`Status: ${sale.status.toUpperCase()}`);
  party(pdf, 'Bill to', sale.customer, extra);
  pdf.table(
    [
      { title: 'Item', frac: 0.44 },
      { title: 'Qty', frac: 0.14, align: 'right' },
      { title: 'Rate', frac: 0.14, align: 'right' },
      { title: 'Disc', frac: 0.10, align: 'right' },
      { title: 'Amount', frac: 0.18, align: 'right' },
    ],
    sale.lines.map((l) => [
      l.itemName + (l.sku ? ` (${l.sku})` : ''),
      `${l.quantity} ${l.unit}`,
      pdfMoney(l.rate).replace('Rs. ', ''),
      l.discountPct ? `${l.discountPct}%` : '-',
      pdfMoney(l.amount).replace('Rs. ', ''),
    ])
  );
  pdf.gap(10);
  const pos = moneyPosition(sale);
  const rows = [
    { label: 'Subtotal', value: pdfMoney(sale.subtotal) },
    { label: 'Invoice total', value: pdfMoney(sale.grandTotal), bold: true },
  ];
  if (sale.returnsTotal) rows.push({ label: 'Less: returns (credit notes)', value: `- ${pdfMoney(sale.returnsTotal)}` });
  if (sale.amountPaid) rows.push({ label: 'Paid', value: `- ${pdfMoney(sale.amountPaid - (sale.refundedTotal || 0))}` });
  rows.push({ label: pos.balance >= 0 ? 'Balance due' : 'Refund due', value: pdfMoney(Math.abs(pos.balance)), bold: true });
  pdf.totals(rows);
  footer(pdf, [
    sale.notes ? `Notes: ${sale.notes}` : '',
    'Goods once sold are subject to the terms agreed with the customer. This is a computer-generated invoice.',
  ].filter(Boolean));
  return pdf.toBlob();
}

export function purchaseOrderPdf(po: Purchase, showPrices: boolean): Blob {
  const pdf = new PdfDoc();
  header(pdf, 'PURCHASE ORDER', po.poNumber, pdfDate(po.createdAt));
  const extra = [`Status: ${po.status.replace('_', ' ').toUpperCase()}`];
  if (po.expectedDate) extra.unshift(`Expected: ${pdfDate(po.expectedDate)}`);
  party(pdf, 'Supplier', po.supplier, extra);
  if (showPrices) {
    pdf.table(
      [
        { title: 'Item', frac: 0.44 },
        { title: 'Ordered', frac: 0.14, align: 'right' },
        { title: 'Received', frac: 0.14, align: 'right' },
        { title: 'Rate', frac: 0.14, align: 'right' },
        { title: 'Amount', frac: 0.14, align: 'right' },
      ],
      po.lines.map((l) => [
        l.itemName + (l.sku ? ` (${l.sku})` : ''),
        `${l.quantity} ${l.unit}`,
        `${(po.receivedQty || {})[l.itemId] || 0}`,
        pdfMoney(l.rate).replace('Rs. ', ''),
        pdfMoney(l.amount).replace('Rs. ', ''),
      ])
    );
    pdf.gap(10);
    pdf.totals([
      { label: 'Subtotal', value: pdfMoney(po.subtotal) },
      { label: 'Order total', value: pdfMoney(po.grandTotal), bold: true },
    ]);
  } else {
    pdf.table(
      [
        { title: 'Item', frac: 0.6 },
        { title: 'Ordered', frac: 0.2, align: 'right' },
        { title: 'Received', frac: 0.2, align: 'right' },
      ],
      po.lines.map((l) => [l.itemName, `${l.quantity} ${l.unit}`, `${(po.receivedQty || {})[l.itemId] || 0}`])
    );
  }
  footer(pdf, [po.notes ? `Notes: ${po.notes}` : '', 'Please quote the PO number on your invoice and delivery challan.'].filter(Boolean));
  return pdf.toBlob();
}

function noteTable(pdf: PdfDoc, lines: SalesReturn['lines']) {
  pdf.table(
    [
      { title: 'Item', frac: 0.46 },
      { title: 'Qty', frac: 0.18, align: 'right' },
      { title: 'Rate', frac: 0.18, align: 'right' },
      { title: 'Amount', frac: 0.18, align: 'right' },
    ],
    lines.map((l) => [
      l.itemName,
      `${l.quantity} ${l.unit}`,
      pdfMoney(l.rate).replace('Rs. ', ''),
      pdfMoney(l.amount).replace('Rs. ', ''),
    ])
  );
}

export function salesReturnPdf(ret: SalesReturn, sale?: Sale): Blob {
  const pdf = new PdfDoc();
  header(pdf, 'CREDIT NOTE', ret.returnNumber, pdfDate(ret.date || ret.createdAt));
  party(pdf, 'Customer', sale?.customer || { name: ret.customerName }, [
    `Against invoice: ${ret.invoiceNumber}`,
    `Reason: ${ret.reason}`,
    `Condition: ${ret.condition === 'good' ? 'Good - back to stock' : 'Damaged'}`,
  ]);
  noteTable(pdf, ret.lines);
  pdf.gap(10);
  pdf.totals([{ label: 'Credit note total', value: pdfMoney(ret.total), bold: true }]);
  footer(pdf, [ret.notes ? `Notes: ${ret.notes}` : '', 'This amount is credited to the customer against the invoice above.'].filter(Boolean));
  return pdf.toBlob();
}

export function purchaseReturnPdf(ret: PurchaseReturn, po?: Purchase): Blob {
  const pdf = new PdfDoc();
  header(pdf, 'DEBIT NOTE', ret.returnNumber, pdfDate(ret.date || ret.createdAt));
  const extra = [`Against PO: ${ret.poNumber}`, `Reason: ${ret.reason}`];
  if (ret.vehicleNumber) extra.push(`Vehicle / LR: ${ret.vehicleNumber}`);
  party(pdf, 'Supplier', po?.supplier || { name: ret.supplierName }, extra);
  noteTable(pdf, ret.lines);
  pdf.gap(10);
  pdf.totals([{ label: 'Debit note total', value: pdfMoney(ret.total), bold: true }]);
  footer(pdf, [ret.notes ? `Notes: ${ret.notes}` : '', 'Goods returned to the supplier. This amount is debited to the supplier.'].filter(Boolean));
  return pdf.toBlob();
}
