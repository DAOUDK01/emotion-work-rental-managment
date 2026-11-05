import { Router, type Response } from 'express';
import { z } from 'zod';
import { compareISO, parseFlexibleDate, todayInHelsinki } from '@emotionfix/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { sendXlsx } from '../../services/excel.js';
import {
  cashLedgerReport,
  discountsReport,
  inventoryReport,
  outstandingReport,
  pnlReport,
  salesReport,
  zReportsReport,
} from './service.js';
import {
  cashLedgerXlsx,
  discountsXlsx,
  inventoryXlsx,
  outstandingXlsx,
  pnlXlsx,
  salesXlsx,
  zreportsXlsx,
} from './xlsx.js';
import {
  cashLedgerPdf,
  discountsPdf,
  inventoryPdf,
  outstandingPdf,
  pnlPdf,
  salesPdf,
  zreportsPdf,
} from './pdf.js';
import { buildAccountantPack } from './pack.js';

/**
 * /reports — business reports over the ledgers (all roles), every report also as
 * `?format=pdf|xlsx` file export, plus the monthly accountant pack.
 * The cash-ledger report and the accountant pack (it contains the handover ledger)
 * are ADMIN + ACCOUNTANT only: staff must never see cash-ledger data (CONVENTIONS).
 * Every export writes an EXPORT audit row naming the report.
 */
export const reportsRouter = Router();

const anyRole = requireAuth();
const noStaff = requireAuth('ADMIN', 'ACCOUNTANT');

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => parseFlexibleDate(v) === v, 'Not a real calendar date');

const formatParam = z.enum(['pdf', 'xlsx']).optional();

const rangeCheck = {
  check: (q: { from: string; to: string }) => compareISO(q.from, q.to) <= 0,
  opts: { message: '"from" must not be after "to"', path: ['from'] },
};

const RangeQuery = z.object({ from: isoDate, to: isoDate, format: formatParam }).refine(rangeCheck.check, rangeCheck.opts);

const SalesQuery = z
  .object({
    groupBy: z.enum(['model', 'unit', 'customer', 'product', 'receivedBy']).default('model'),
    from: isoDate,
    to: isoDate,
    format: formatParam,
  })
  .refine(rangeCheck.check, rangeCheck.opts);

const PnlQuery = z
  .object({ from: isoDate, to: isoDate, modelId: z.coerce.number().int().positive().optional(), format: formatParam })
  .refine(rangeCheck.check, rangeCheck.opts);

const FormatOnlyQuery = z.object({ format: formatParam });

const MonthQuery = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
});

function sendPdf(res: Response, fileName: string): (buf: Buffer) => void {
  return (buf: Buffer) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buf);
  };
}

/** Audit the export (report name + parameters), then send the file. */
async function exportFile(
  res: Response,
  report: string,
  format: 'pdf' | 'xlsx',
  baseName: string,
  params: Record<string, unknown>,
  build: () => Promise<Buffer>,
): Promise<void> {
  await audit('EXPORT', 'reports', report, undefined, { ...params, format });
  const buf = await build();
  if (format === 'xlsx') sendXlsx(res, `${baseName}.xlsx`)(buf);
  else sendPdf(res, `${baseName}.pdf`)(buf);
}

// ---------- GET /reports/sales?groupBy=&from=&to=[&format=] ----------
reportsRouter.get('/sales', anyRole, validate({ query: SalesQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof SalesQuery>;
    const report = await salesReport(q.groupBy, q.from, q.to);
    if (!q.format) {
      res.json(report);
      return;
    }
    await exportFile(
      res,
      'sales',
      q.format,
      `sales-by-${q.groupBy}-${q.from}-${q.to}`,
      { groupBy: q.groupBy, from: q.from, to: q.to, rows: report.rows.length },
      () => (q.format === 'xlsx' ? salesXlsx(report) : salesPdf(report)),
    );
  } catch (err) {
    next(err);
  }
});

// ---------- GET /reports/pnl?from=&to=[&modelId=&format=] ----------
reportsRouter.get('/pnl', anyRole, validate({ query: PnlQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof PnlQuery>;
    const report = await pnlReport(q.from, q.to, q.modelId);
    if (!q.format) {
      res.json(report);
      return;
    }
    await exportFile(
      res,
      'pnl',
      q.format,
      `pnl-${q.from}-${q.to}`,
      { from: q.from, to: q.to, modelId: q.modelId ?? null, netProfitCents: report.netProfitCents },
      () => (q.format === 'xlsx' ? pnlXlsx(report) : pnlPdf(report)),
    );
  } catch (err) {
    next(err);
  }
});

// ---------- GET /reports/discounts?from=&to=[&format=] ----------
reportsRouter.get('/discounts', anyRole, validate({ query: RangeQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof RangeQuery>;
    const report = await discountsReport(q.from, q.to);
    if (!q.format) {
      res.json(report);
      return;
    }
    await exportFile(
      res,
      'discounts',
      q.format,
      `discounts-${q.from}-${q.to}`,
      { from: q.from, to: q.to, count: report.count, totalCents: report.totalCents },
      () => (q.format === 'xlsx' ? discountsXlsx(report) : discountsPdf(report)),
    );
  } catch (err) {
    next(err);
  }
});

// ---------- GET /reports/outstanding[?format=] ----------
reportsRouter.get('/outstanding', anyRole, validate({ query: FormatOnlyQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof FormatOnlyQuery>;
    const report = await outstandingReport();
    if (!q.format) {
      res.json(report);
      return;
    }
    const asOf = todayInHelsinki();
    await exportFile(
      res,
      'outstanding',
      q.format,
      `outstanding-${asOf}`,
      { asOf, customers: report.rows.length, totalCents: report.totalCents },
      () => (q.format === 'xlsx' ? outstandingXlsx(report) : outstandingPdf(report, asOf)),
    );
  } catch (err) {
    next(err);
  }
});

// ---------- GET /reports/inventory[?format=] ----------
reportsRouter.get('/inventory', anyRole, validate({ query: FormatOnlyQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof FormatOnlyQuery>;
    const report = await inventoryReport();
    if (!q.format) {
      res.json(report);
      return;
    }
    const asOf = todayInHelsinki();
    await exportFile(
      res,
      'inventory',
      q.format,
      `inventory-${asOf}`,
      { asOf, products: report.totals.products, valueCents: report.totals.valueCents },
      () => (q.format === 'xlsx' ? inventoryXlsx(report) : inventoryPdf(report, asOf)),
    );
  } catch (err) {
    next(err);
  }
});

// ---------- GET /reports/cash-ledger?from=&to=[&format=]  (no STAFF) ----------
reportsRouter.get('/cash-ledger', noStaff, validate({ query: RangeQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof RangeQuery>;
    const report = await cashLedgerReport(q.from, q.to);
    if (!q.format) {
      res.json(report);
      return;
    }
    await exportFile(
      res,
      'cash-ledger',
      q.format,
      `cash-ledger-${q.from}-${q.to}`,
      { from: q.from, to: q.to, handovers: report.handovers.length },
      () => (q.format === 'xlsx' ? cashLedgerXlsx(report) : cashLedgerPdf(report)),
    );
  } catch (err) {
    next(err);
  }
});

// ---------- GET /reports/zreports?from=&to=[&format=] ----------
reportsRouter.get('/zreports', anyRole, validate({ query: RangeQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof RangeQuery>;
    const report = await zReportsReport(q.from, q.to);
    if (!q.format) {
      res.json(report);
      return;
    }
    await exportFile(
      res,
      'zreports',
      q.format,
      `zreports-${q.from}-${q.to}`,
      { from: q.from, to: q.to, days: report.rows.length, salesCount: report.totals.salesCount },
      () => (q.format === 'xlsx' ? zreportsXlsx(report) : zreportsPdf(report)),
    );
  } catch (err) {
    next(err);
  }
});

// ---------- GET /reports/accountant-pack?month=YYYY-MM  (always xlsx; no STAFF) ----------
reportsRouter.get('/accountant-pack', noStaff, validate({ query: MonthQuery }), async (req, res, next) => {
  try {
    const { month } = req.query as unknown as z.infer<typeof MonthQuery>;
    const pack = await buildAccountantPack(month);
    await audit('EXPORT', 'reports', 'accountant-pack', undefined, {
      month,
      from: pack.from,
      to: pack.to,
      format: 'xlsx',
      ...pack.counts,
    });
    sendXlsx(res, `accountant-${month}.xlsx`)(pack.buffer);
  } catch (err) {
    next(err);
  }
});
