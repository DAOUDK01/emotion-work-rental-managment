import bwipjs from 'bwip-js';
import type { TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import { AppError } from '../../errors.js';
import { buildPdf, pdfMoney } from '../../services/pdf.js';

/**
 * Shelf/price label sheets: the barcode is rendered once with bwip-js
 * (Code128 PNG), embedded as a data-URL image and repeated `qty` times
 * in a 3-per-row A4 grid. Every label shows name, gross price and barcode.
 */

const COLUMNS = 3;

export interface LabelSheetSpec {
  sku: string;
  name: string;
  priceCents: number;
  barcodeText: string;
  qty: number;
}

export async function buildLabelsPdf(spec: LabelSheetSpec): Promise<Buffer> {
  let png: Buffer;
  try {
    png = await bwipjs.toBuffer({
      bcid: 'code128',
      text: spec.barcodeText,
      scale: 3,
      height: 10,
      includetext: true,
    });
  } catch (err) {
    throw new AppError(400, 'LABEL_RENDER_FAILED', `Cannot render "${spec.barcodeText}" as Code128`, {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  const barcodeDataUrl = `data:image/png;base64,${png.toString('base64')}`;

  const labelCell = (): TableCell => ({
    stack: [
      { text: spec.name, fontSize: 8, bold: true, alignment: 'center', margin: [0, 0, 0, 2] },
      { text: pdfMoney(spec.priceCents), fontSize: 10, bold: true, alignment: 'center', margin: [0, 0, 0, 4] },
      { image: 'barcode', fit: [150, 48], alignment: 'center' },
    ],
    margin: [4, 8, 4, 8],
  });

  const body: TableCell[][] = [];
  for (let i = 0; i < spec.qty; i += COLUMNS) {
    const row: TableCell[] = [];
    for (let c = 0; c < COLUMNS; c += 1) {
      row.push(i + c < spec.qty ? labelCell() : { text: '' });
    }
    body.push(row);
  }

  const doc: TDocumentDefinitions = {
    pageMargins: [20, 20, 20, 20],
    info: { title: `Labels ${spec.sku}` },
    images: { barcode: barcodeDataUrl },
    content: [
      {
        table: { widths: ['*', '*', '*'], body },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#cccccc',
          vLineColor: () => '#cccccc',
        },
      },
    ],
  };
  return buildPdf(doc);
}
