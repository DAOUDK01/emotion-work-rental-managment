import ExcelJS from 'exceljs';
import type { Response } from 'express';

/**
 * Excel exports via ExcelJS. Money columns take cents and are written as
 * euro numbers with a 2-decimal format so the accountant can sum them.
 */

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
  money?: boolean; // value given in cents -> written as euros
  date?: boolean; // value "YYYY-MM-DD"
}

export function createWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'E Motion Works Oy';
  wb.created = new Date();
  return wb;
}

export function addTableSheet(
  wb: ExcelJS.Workbook,
  name: string,
  columns: SheetColumn[],
  rows: Array<Record<string, unknown>>,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? Math.max(12, c.header.length + 4),
  }));
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2545' } };
  headerRow.alignment = { vertical: 'middle' };
  for (const row of rows) {
    const out: Record<string, unknown> = {};
    for (const c of columns) {
      let v = row[c.key];
      if (c.money && typeof v === 'number') v = v / 100;
      out[c.key] = v ?? '';
    }
    ws.addRow(out);
  }
  columns.forEach((c, idx) => {
    if (c.money) ws.getColumn(idx + 1).numFmt = '#,##0.00';
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

export async function workbookBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

export function sendXlsx(res: Response, fileName: string): (buf: Buffer) => void {
  return (buf: Buffer) => {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buf);
  };
}
