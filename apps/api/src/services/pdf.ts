import PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { formatEUR } from '@emotionfix/shared';

/**
 * PDF generation via pdfmake (pure JS — no headless Chromium, per startup budget).
 * Fonts: pdfmake's bundled Roboto (loaded from its virtual file system).
 * Use buildPdf(docDefinition) -> Buffer, then res.setHeader('Content-Type','application/pdf').
 */

let printer: PdfPrinter | null = null;

async function getPrinter(): Promise<PdfPrinter> {
  if (printer) return printer;
  const mod: any = await import('pdfmake/build/vfs_fonts.js');
  const vfs: Record<string, string> =
    mod?.pdfMake?.vfs ?? mod?.default?.pdfMake?.vfs ?? mod?.vfs ?? mod?.default?.vfs ?? mod?.default ?? mod;
  const font = (name: string): Buffer => {
    const b64 = vfs[name];
    if (!b64) throw new Error(`pdfmake font missing from vfs: ${name}`);
    return Buffer.from(b64, 'base64');
  };
  printer = new PdfPrinter({
    Roboto: {
      normal: font('Roboto-Regular.ttf'),
      bold: font('Roboto-Medium.ttf'),
      italics: font('Roboto-Italic.ttf'),
      bolditalics: font('Roboto-MediumItalic.ttf'),
    },
  });
  return printer;
}

export async function buildPdf(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  const p = await getPrinter();
  const doc = p.createPdfKitDocument({
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    ...docDefinition,
  });
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

/** Money for PDFs: "1 234,50 €" (fi) / "€1,234.50" (en). */
export function pdfMoney(cents: number, locale: 'fi' | 'en' = 'en'): string {
  return formatEUR(cents, locale).replace(/ /g, ' ');
}

const COLORS = {
  navy: '#0b2545',
  teal: '#2a9d8f',
  green: '#2e7d32',
  red: '#c62828',
  grey: '#9e9e9e',
  lightGrey: '#eeeeee',
};
export const PDF_COLORS = COLORS;

/**
 * Simple horizontal bar chart as an SVG string (pdfmake {svg}) WITH value labels —
 * charts must always show the numbers.
 */
export function hBarChartSvg(
  rows: Array<{ label: string; value: number; display: string; color?: string }>,
  opts?: { width?: number; barHeight?: number; negativeColor?: string },
): string {
  const width = opts?.width ?? 460;
  const barHeight = opts?.barHeight ?? 16;
  const gap = 10;
  const labelWidth = 130;
  const valueWidth = 80;
  const chartWidth = width - labelWidth - valueWidth;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const height = rows.length * (barHeight + gap) + 4;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  rows.forEach((r, i) => {
    const y = i * (barHeight + gap) + 2;
    const w = Math.max(2, Math.round((Math.abs(r.value) / maxAbs) * chartWidth));
    const color = r.color ?? (r.value < 0 ? (opts?.negativeColor ?? COLORS.red) : COLORS.navy);
    svg += `<text x="${labelWidth - 6}" y="${y + barHeight - 4}" font-size="9" font-family="Helvetica" text-anchor="end" fill="#333">${esc(r.label)}</text>`;
    svg += `<rect x="${labelWidth}" y="${y}" width="${w}" height="${barHeight}" rx="2" fill="${color}"/>`;
    svg += `<text x="${labelWidth + w + 5}" y="${y + barHeight - 4}" font-size="9" font-family="Helvetica" fill="#111">${esc(r.display)}</text>`;
  });
  return svg + '</svg>';
}

/** Vertical bars with value labels on top (trend/growth charts in PDFs). */
export function vBarChartSvg(
  points: Array<{ label: string; value: number; display: string; subLabel?: string }>,
  opts?: { width?: number; height?: number; color?: string },
): string {
  const width = opts?.width ?? 460;
  const height = opts?.height ?? 150;
  const bottom = 26;
  const top = 16;
  const n = Math.max(1, points.length);
  const slot = width / n;
  const barWidth = Math.min(44, slot * 0.6);
  const maxAbs = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  points.forEach((p, i) => {
    const h = Math.max(2, Math.round((Math.abs(p.value) / maxAbs) * (height - bottom - top - 14)));
    const x = i * slot + (slot - barWidth) / 2;
    const y = height - bottom - h;
    const color = p.value < 0 ? COLORS.red : (opts?.color ?? COLORS.navy);
    svg += `<rect x="${x.toFixed(1)}" y="${y}" width="${barWidth.toFixed(1)}" height="${h}" rx="2" fill="${color}"/>`;
    svg += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${y - 4}" font-size="8.5" font-family="Helvetica" text-anchor="middle" fill="#111">${esc(p.display)}</text>`;
    svg += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${height - bottom + 12}" font-size="8.5" font-family="Helvetica" text-anchor="middle" fill="#333">${esc(p.label)}</text>`;
    if (p.subLabel) {
      svg += `<text x="${(x + barWidth / 2).toFixed(1)}" y="${height - bottom + 23}" font-size="8" font-family="Helvetica" text-anchor="middle" fill="${p.subLabel.startsWith('-') || p.subLabel.startsWith('−') ? COLORS.red : COLORS.green}">${esc(p.subLabel)}</text>`;
    }
  });
  return svg + '</svg>';
}

/** Standard report header block (company name from settings is passed in). */
export function pdfHeader(companyName: string, title: string, subtitle?: string) {
  return [
    { text: companyName, fontSize: 14, bold: true, color: COLORS.navy },
    { text: title, fontSize: 11, bold: true, margin: [0, 6, 0, 0] as [number, number, number, number] },
    ...(subtitle ? [{ text: subtitle, fontSize: 9, color: '#555', margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
    { canvas: [{ type: 'line' as const, x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1, lineColor: COLORS.lightGrey }], margin: [0, 0, 0, 10] as [number, number, number, number] },
  ];
}
