import { Router } from 'express';
import { todayInHelsinki } from '@emotionfix/shared';
import { conflict } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  AddLineSchema,
  CompleteSaleSchema,
  CreateSaleSchema,
  ListSalesQuerySchema,
  ReceiptQuerySchema,
  RefundSchema,
  UpdateLineSchema,
  UpdateSaleSchema,
  ZReportQuerySchema,
  idParam,
  lineParams,
  type AddLineBody,
  type CompleteSaleBody,
  type CreateSaleBody,
  type ListSalesQuery,
  type ReceiptQuery,
  type RefundBody,
  type UpdateLineBody,
  type UpdateSaleBody,
  type ZReportQuery,
} from './schemas.js';
import {
  addLine,
  assertRealDate,
  createSale,
  deleteLine,
  listSales,
  loadSaleDetail,
  parkSale,
  serializeSaleDetail,
  updateLine,
  updateSale,
  voidParkedSale,
} from './service.js';
import { completeSale, refundSale } from './checkout.js';
import { buildZReport, zReportPdf } from './zreport.js';
import { loadCompany, receiptHtml, receiptPdf } from './receipt.js';

/**
 * /pos — the full point-of-sale flow (ADMIN + STAFF only; accountants have no POS
 * access). A sale is a PARKED cart until completion: lines and discounts are edited
 * freely, nothing touches money or stock. POST /:id/complete moves the stock, writes
 * the income Entry + Payment splits and freezes the sale; corrections afterwards go
 * through POST /:id/refund (credit note + reversing entry), never through edits.
 */
export const posRouter = Router();
posRouter.use(requireAuth('ADMIN', 'STAFF'));

/** Every write answers with the fresh full sale so the POS screen can re-render. */
async function saleResponse(id: number) {
  return serializeSaleDetail(await loadSaleDetail(id));
}

// ---------- POST /pos/sales — open a new PARKED sale (receipt number R-000123) ----------
posRouter.post('/sales', validate({ body: CreateSaleSchema }), async (req, res, next) => {
  try {
    const id = await createSale(req.body as CreateSaleBody);
    res.status(201).json({ sale: await saleResponse(id) });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /pos/sales?status=&date= — parked/held sales list (default PARKED) ----------
posRouter.get('/sales', validate({ query: ListSalesQuerySchema }), async (req, res, next) => {
  try {
    res.json(await listSales(req.query as unknown as ListSalesQuery));
  } catch (err) {
    next(err);
  }
});

// ---------- GET /pos/sales/:id → { sale: { …, lines, payments } } ----------
posRouter.get('/sales/:id', validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    res.json({ sale: await saleResponse(id) });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /pos/sales/:id/lines — add a line (product defaults or custom) ----------
posRouter.post(
  '/sales/:id/lines',
  validate({ params: idParam, body: AddLineSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      await addLine(id, req.body as AddLineBody);
      res.status(201).json({ sale: await saleResponse(id) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- PUT /pos/sales/:id/lines/:lineId — edit a line (e.g. scanned again: qty+1) ----------
posRouter.put(
  '/sales/:id/lines/:lineId',
  validate({ params: lineParams, body: UpdateLineSchema }),
  async (req, res, next) => {
    try {
      const { id, lineId } = req.params as unknown as { id: number; lineId: number };
      await updateLine(id, lineId, req.body as UpdateLineBody);
      res.json({ sale: await saleResponse(id) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- DELETE /pos/sales/:id/lines/:lineId — remove a cart line ----------
posRouter.delete('/sales/:id/lines/:lineId', validate({ params: lineParams }), async (req, res, next) => {
  try {
    const { id, lineId } = req.params as unknown as { id: number; lineId: number };
    await deleteLine(id, lineId);
    res.json({ sale: await saleResponse(id) });
  } catch (err) {
    next(err);
  }
});

// ---------- PUT /pos/sales/:id — cart discount / customer / unit / model / notes ----------
posRouter.put('/sales/:id', validate({ params: idParam, body: UpdateSaleSchema }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    await updateSale(id, req.body as UpdateSaleBody);
    res.json({ sale: await saleResponse(id) });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /pos/sales/:id/complete — payments + stock + Entry, sale → COMPLETED ----------
posRouter.post(
  '/sales/:id/complete',
  validate({ params: idParam, body: CompleteSaleSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const entryId = await completeSale(id, req.body as CompleteSaleBody);
      res.json({ sale: await saleResponse(id), entryId });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- POST /pos/sales/:id/park — explicit no-op hold (stays PARKED) ----------
posRouter.post('/sales/:id/park', validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    await parkSale(id);
    res.json({ sale: await saleResponse(id) });
  } catch (err) {
    next(err);
  }
});

// ---------- DELETE /pos/sales/:id — VOID a parked sale (never a hard delete) ----------
posRouter.delete('/sales/:id', validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    await voidParkedSale(id);
    res.json({ sale: await saleResponse(id) });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /pos/sales/:id/refund — credit note + restock + reversing entry ----------
posRouter.post(
  '/sales/:id/refund',
  validate({ params: idParam, body: RefundSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const result = await refundSale(id, req.body as RefundBody);
      res.json({
        creditNote: result.creditNote,
        receiptPdfUrl: `/api/pos/sales/${id}/receipt?format=pdf`,
        saleStatus: result.saleStatus,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- GET /pos/sales/:id/receipt?width=80|58&format=html|pdf ----------
posRouter.get(
  '/sales/:id/receipt',
  validate({ params: idParam, query: ReceiptQuerySchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const query = req.query as unknown as ReceiptQuery;
      const sale = await loadSaleDetail(id);
      if (sale.status === 'VOID') {
        throw conflict('SALE_VOID', 'A voided sale has no receipt');
      }
      const company = await loadCompany();
      if (query.format === 'pdf') {
        const pdf = await receiptPdf(sale, company);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="receipt-${sale.number}.pdf"`);
        res.send(pdf);
        return;
      }
      res.type('html').send(receiptHtml(sale, company, query.width === 58 ? 58 : 80));
    } catch (err) {
      next(err);
    }
  },
);

// ---------- GET /pos/z-report?date=&format=json|pdf — end-of-day summary ----------
posRouter.get('/z-report', validate({ query: ZReportQuerySchema }), async (req, res, next) => {
  try {
    const query = req.query as unknown as ZReportQuery;
    const date = query.date ?? todayInHelsinki();
    assertRealDate(date);
    const report = await buildZReport(date);
    if (query.format === 'pdf') {
      const pdf = await zReportPdf(report);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="z-report-${date}.pdf"`);
      res.send(pdf);
      return;
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});
