import { Router } from 'express';
import { z } from 'zod';
import { parseFlexibleDate } from '@emotionfix/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { sendXlsx } from '../../services/excel.js';
import { buildVatReport, vatReportXlsx } from './service.js';
import { vatReportPdf } from './pdf.js';

/**
 * /vat (all roles) — the VAT position of a period:
 *   GET /vat/report?from=&to=                 JSON report (cards, by-model, every line, notes)
 *   GET /vat/export?from=&to=&format=pdf|xlsx accountant export (xlsx lists EVERY line; pdf = summary)
 */
export const vatRouter = Router();
vatRouter.use(requireAuth());

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => parseFlexibleDate(v) === v, 'Not a real calendar date');

const rangeCheck = {
  check: (q: { from: string; to: string }) => q.from <= q.to,
  opts: { message: '"from" must not be after "to"', path: ['from'] },
};

const ReportQuerySchema = z.object({ from: isoDate, to: isoDate }).refine(rangeCheck.check, rangeCheck.opts);

const ExportQuerySchema = z
  .object({ from: isoDate, to: isoDate, format: z.enum(['pdf', 'xlsx']).default('xlsx') })
  .refine(rangeCheck.check, rangeCheck.opts);

// ---------- report ----------
vatRouter.get('/report', validate({ query: ReportQuerySchema }), async (req, res, next) => {
  try {
    const { from, to } = req.query as unknown as z.infer<typeof ReportQuerySchema>;
    res.json(await buildVatReport(from, to));
  } catch (err) {
    next(err);
  }
});

// ---------- export (xlsx default: the accountant export lists EVERY line) ----------
vatRouter.get('/export', validate({ query: ExportQuerySchema }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof ExportQuerySchema>;
    const report = await buildVatReport(q.from, q.to);
    await audit('EXPORT', 'vat', `${q.from}..${q.to}`, undefined, {
      format: q.format,
      collectedCents: report.cards.collectedCents,
      reclaimableCents: report.cards.reclaimableCents,
      payableCents: report.cards.payableCents,
      nonVatIncomeCents: report.cards.nonVatIncomeCents,
      incomeLines: report.incomeLines.length,
      purchaseLines: report.purchaseLines.length,
      undatedExpenses: report.undatedNote?.count ?? 0,
    });
    if (q.format === 'pdf') {
      const buf = await vatReportPdf(report, q.from, q.to);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="vat-report-${q.from}-${q.to}.pdf"`);
      res.send(buf);
    } else {
      const buf = await vatReportXlsx(report, q.from, q.to);
      sendXlsx(res, `vat-report-${q.from}-${q.to}.xlsx`)(buf);
    }
  } catch (err) {
    next(err);
  }
});
