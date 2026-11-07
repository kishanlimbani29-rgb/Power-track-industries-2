import * as XLSX from 'xlsx';

/**
 * Universally triggers a file download across desktop, mobile browsers, and iframes.
 * Uses delayed object URL revocation and fallback to Base64 Data URLs for restricted iframe environments.
 */
export function downloadBlob(blob: Blob, fileName: string) {
  try {
    const cleanFileName = fileName.replace(/[/\\?%*:|"<>]/g, '_');

    // Strategy 1: Internet Explorer / legacy Edge
    if (typeof (window.navigator as any)?.msSaveOrOpenBlob === 'function') {
      (window.navigator as any).msSaveOrOpenBlob(blob, cleanFileName);
      return;
    }

    // Strategy 2: Blob Object URL with DOM-attached anchor
    if (window.URL && typeof window.URL.createObjectURL === 'function') {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = cleanFileName;
      link.setAttribute('download', cleanFileName);
      link.setAttribute('target', '_self');
      link.rel = 'noopener noreferrer';
      link.style.position = 'fixed';
      link.style.left = '-9999px';
      link.style.top = '-9999px';
      link.style.opacity = '0';

      document.body.appendChild(link);

      // Trigger click event
      try {
        const evt = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
        });
        link.dispatchEvent(evt);
      } catch {
        link.click();
      }

      // Delay revocation significantly (10s) to allow mobile download managers to finish spooling
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
        window.URL.revokeObjectURL(url);
      }, 10000);
      return;
    }

    // Strategy 3: Fallback via FileReader Base64 Data URL
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = cleanFileName;
      link.setAttribute('download', cleanFileName);
      link.style.position = 'fixed';
      link.style.left = '-9999px';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
      }, 5000);
    };
    reader.readAsDataURL(blob);
  } catch (err) {
    console.error('Download blob execution error:', err);
  }
}

/**
 * Generates and downloads a genuine, validated .xlsx Excel workbook directly in memory.
 * Features:
 * - Empty dataset guard (prevents corrupted .xlsx files)
 * - Safe Excel worksheet naming (strips illegal characters, max 31 chars)
 * - Dynamic column width auto-calculation
 * - Correct binary MIME type (no charset parameter which corrupts Android downloads)
 */
export function downloadExcelFile(
  data: (Record<string, any> | any[])[],
  fileName: string,
  sheetName: string = 'Sheet1'
) {
  try {
    // 1. Guard against null or empty datasets
    let exportData = data;
    if (!exportData || exportData.length === 0) {
      exportData = [{ 'Export Notice': 'No records available to export for this selection' }];
    }

    // 2. Build worksheet
    let ws: XLSX.WorkSheet;
    if (Array.isArray(exportData[0])) {
      ws = XLSX.utils.aoa_to_sheet(exportData as any[][]);
    } else {
      ws = XLSX.utils.json_to_sheet(exportData as Record<string, any>[]);
    }

    // 3. Auto-calculate comfortable column widths so numbers and names are not cut off
    if (!Array.isArray(exportData[0])) {
      const firstRow = exportData[0] as Record<string, any>;
      const keys = Object.keys(firstRow);
      const colWidths = keys.map((key) => {
        let maxLen = key.length;
        for (let i = 0; i < Math.min(exportData.length, 100); i++) {
          const val = (exportData[i] as any)?.[key];
          if (val !== null && val !== undefined) {
            const strVal = String(val);
            if (strVal.length > maxLen) maxLen = strVal.length;
          }
        }
        return { wch: Math.min(Math.max(maxLen + 3, 10), 45) };
      });
      ws['!cols'] = colWidths;
    }

    // 4. Sanitize sheet name: Excel restricts sheet names to 31 chars, no \ / ? * [ ] :
    const safeSheetName = (sheetName || 'Sheet1')
      .replace(/[\\/*?:[\]]/g, '')
      .trim()
      .slice(0, 31) || 'Sheet1';

    // 5. Build workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName);

    // 6. Generate binary array buffer
    const excelBuffer = XLSX.write(wb, {
      bookType: 'xlsx',
      type: 'array',
      compression: true,
    });

    // 7. Binary MIME type for OpenXML spreadsheet (MUST NOT have charset=UTF-8)
    const blob = new Blob([excelBuffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    // 8. Clean filename with extension
    const cleanBaseName = fileName.replace(/\.xlsx$/i, '').trim();
    const finalName = `${cleanBaseName || 'export'}.xlsx`;

    downloadBlob(blob, finalName);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('powertrack_download_started', {
          detail: { fileName: finalName, format: 'xlsx' },
        })
      );
    }
  } catch (err) {
    console.error('Failed to generate Excel file:', err);
  }
}

/**
 * Generates and downloads a CSV file with UTF-8 BOM (\uFEFF)
 * so Microsoft Excel and spreadsheet tools render non-ASCII symbols correctly.
 */
export function downloadCSVFile(csvContent: string, fileName: string) {
  try {
    // \uFEFF is the UTF-8 Byte Order Mark (BOM)
    const blob = new Blob(['\uFEFF' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const cleanBaseName = fileName.replace(/\.csv$/i, '').trim();
    const finalName = `${cleanBaseName || 'export'}.csv`;
    downloadBlob(blob, finalName);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('powertrack_download_started', {
          detail: { fileName: finalName, format: 'csv' },
        })
      );
    }
  } catch (err) {
    console.error('Failed to generate CSV file:', err);
  }
}
