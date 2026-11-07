// Tiny dependency-free PDF writer for invoices, purchase orders and credit/debit notes.
// Uses the built-in Helvetica fonts, so it works offline and inside the Android APK.
// The rupee sign is not in the built-in font, so amounts are printed as "Rs. 1,234.00".

import { downloadBlob } from './fileDownload';

type Align = 'left' | 'right' | 'center';
interface TextOp {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  bold?: boolean;
  align?: Align;
  gray?: boolean;
}
interface LineOp {
  kind: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width?: number;
  gray?: boolean;
}
interface RectOp {
  kind: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill: number; // 0..1 gray
}
type Op = TextOp | LineOp | RectOp;

const PAGE_W = 595.28; // A4 in points
const PAGE_H = 841.89;
const MARGIN = 40;

// Helvetica widths (per 1000 em) for ASCII 32..126 — used for right/center alignment & wrapping.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const HELVB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Keep only characters the built-in font can print. */
export function pdfSafe(s: string): string {
  return String(s ?? '')
    .replace(/₹\s?/g, 'Rs. ')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/×/g, 'x')
    .replace(/→/g, '->')
    .replace(/[^\x20-\x7E]/g, '');
}

export function textWidth(text: string, size: number, bold = false): number {
  const w = bold ? HELVB : HELV;
  let sum = 0;
  for (const ch of pdfSafe(text)) {
    const c = ch.charCodeAt(0);
    sum += w[c - 32] ?? 556;
  }
  return (sum * size) / 1000;
}

function wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (textWidth(test, size, bold) <= maxWidth || !cur) cur = test;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

const esc = (s: string) => pdfSafe(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Simple page builder with a moving cursor (top-down coordinates). */
export class PdfDoc {
  pages: Op[][] = [[]];
  y = MARGIN;
  readonly left = MARGIN;
  readonly right = PAGE_W - MARGIN;
  readonly width = PAGE_W - 2 * MARGIN;

  private get ops() {
    return this.pages[this.pages.length - 1];
  }

  newPage() {
    this.pages.push([]);
    this.y = MARGIN;
  }

  ensure(space: number) {
    if (this.y + space > PAGE_H - MARGIN) this.newPage();
  }

  text(x: number, y: number, text: string, size = 10, opts: { bold?: boolean; align?: Align; gray?: boolean } = {}) {
    this.ops.push({ kind: 'text', x, y, text, size, ...opts });
  }

  line(x1: number, y1: number, x2: number, y2: number, width = 0.6, gray = true) {
    this.ops.push({ kind: 'line', x1, y1, x2, y2, width, gray });
  }

  rect(x: number, y: number, w: number, h: number, fill = 0.94) {
    this.ops.push({ kind: 'rect', x, y, w, h, fill });
  }

  /** Paragraph at the cursor; returns height used. */
  para(text: string, size = 10, opts: { bold?: boolean; gray?: boolean; x?: number; width?: number } = {}) {
    const x = opts.x ?? this.left;
    const lines = wrap(text, size, opts.width ?? this.right - x, opts.bold);
    for (const l of lines) {
      this.ensure(size + 4);
      this.text(x, this.y + size, l, size, opts);
      this.y += size + 4;
    }
  }

  gap(h: number) {
    this.y += h;
  }

  /**
   * Table with header row. cols: width fractions + alignment.
   * Rows wrap their first column if needed and break across pages (header repeated).
   */
  table(cols: { title: string; frac: number; align?: Align }[], rows: string[][], size = 9) {
    const xs: number[] = [];
    let acc = this.left;
    for (const c of cols) {
      xs.push(acc);
      acc += c.frac * this.width;
    }
    const drawHeader = () => {
      this.ensure(22);
      this.rect(this.left, this.y, this.width, 18, 0.92);
      cols.forEach((c, i) => {
        const w = c.frac * this.width;
        const x = c.align === 'right' ? xs[i] + w - 4 : c.align === 'center' ? xs[i] + w / 2 : xs[i] + 4;
        this.text(x, this.y + 12.5, c.title, size, { bold: true, align: c.align });
      });
      this.y += 18;
    };
    drawHeader();
    for (const r of rows) {
      const firstLines = wrap(r[0] ?? '', size, cols[0].frac * this.width - 8);
      const h = Math.max(1, firstLines.length) * (size + 3) + 6;
      if (this.y + h > PAGE_H - MARGIN) {
        this.newPage();
        drawHeader();
      }
      cols.forEach((c, i) => {
        const w = c.frac * this.width;
        if (i === 0) {
          firstLines.forEach((l, k) => this.text(xs[0] + 4, this.y + size + 3 + k * (size + 3), l, size));
        } else {
          const x = c.align === 'right' ? xs[i] + w - 4 : c.align === 'center' ? xs[i] + w / 2 : xs[i] + 4;
          this.text(x, this.y + size + 3, r[i] ?? '', size, { align: c.align });
        }
      });
      this.y += h;
      this.line(this.left, this.y, this.right, this.y, 0.4);
    }
  }

  /** Label / value rows aligned to the right side (totals box). */
  totals(rows: { label: string; value: string; bold?: boolean }[], size = 10) {
    const boxW = 230;
    const x = this.right - boxW;
    for (const r of rows) {
      this.ensure(size + 8);
      if (r.bold) this.line(x, this.y + 1, this.right, this.y + 1, 0.8, false);
      this.text(x + 4, this.y + size + 3, r.label, size, { bold: r.bold });
      this.text(this.right - 4, this.y + size + 3, r.value, size, { bold: r.bold, align: 'right' });
      this.y += size + 7;
    }
  }

  toBlob(): Blob {
    const objects: string[] = [];
    const add = (body: string) => {
      objects.push(body);
      return objects.length; // object number
    };
    const fontReg = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const pagesObjIndex = add('PAGES_PLACEHOLDER');
    const pageNums: number[] = [];
    this.pages.forEach((ops, pi) => {
      let content = '';
      for (const op of ops) {
        if (op.kind === 'rect') {
          content += `${op.fill} g ${op.x.toFixed(2)} ${(PAGE_H - op.y - op.h).toFixed(2)} ${op.w.toFixed(2)} ${op.h.toFixed(2)} re f 0 g\n`;
        } else if (op.kind === 'line') {
          content += `${op.gray ? '0.75 G' : '0 G'} ${(op.width ?? 0.6).toFixed(2)} w ${op.x1.toFixed(2)} ${(PAGE_H - op.y1).toFixed(2)} m ${op.x2.toFixed(2)} ${(PAGE_H - op.y2).toFixed(2)} l S 0 G\n`;
        } else {
          let x = op.x;
          const w = textWidth(op.text, op.size, op.bold);
          if (op.align === 'right') x -= w;
          if (op.align === 'center') x -= w / 2;
          content += `BT ${op.gray ? '0.4 g ' : ''}/${op.bold ? 'F2' : 'F1'} ${op.size} Tf ${x.toFixed(2)} ${(PAGE_H - op.y).toFixed(2)} Td (${esc(op.text)}) Tj ${op.gray ? '0 g ' : ''}ET\n`;
        }
      }
      // page number footer
      const footer = `Page ${pi + 1} of ${this.pages.length}`;
      content += `BT 0.5 g /F1 8 Tf ${(PAGE_W - MARGIN - textWidth(footer, 8)).toFixed(2)} 20 Td (${footer}) Tj 0 g ET\n`;
      const contentObj = add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
      const pageObj = add(
        `<< /Type /Page /Parent ${pagesObjIndex} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentObj} 0 R >>`
      );
      pageNums.push(pageObj);
    });
    objects[pagesObjIndex - 1] = `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageNums.length} >>`;
    const catalog = add(`<< /Type /Catalog /Pages ${pagesObjIndex} 0 R >>`);

    let out = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
    // All characters are ASCII, so string length == byte length.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }
}

export const pdfMoney = (n: number) =>
  'Rs. ' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pdfDate = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Share the PDF with the phone's share sheet (WhatsApp, Gmail…), or download it if sharing isn't available. */
export async function shareOrDownloadPdf(blob: Blob, fileName: string, title: string, mode: 'share' | 'download') {
  const name = fileName.replace(/[/\\?%*:|"<>]/g, '_');
  if (mode === 'share') {
    try {
      const file = new File([blob], name, { type: 'application/pdf' });
      const nav = navigator as any;
      if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
        await nav.share({ files: [file], title });
        return 'shared' as const;
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'cancelled' as const;
      // fall through to download
    }
  }
  downloadBlob(blob, name);
  window.dispatchEvent(new CustomEvent('powertrack_download_started', { detail: { fileName: name, format: 'pdf' } }));
  return 'downloaded' as const;
}
