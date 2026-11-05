import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import {
  dashboardSummary,
  growthSeries,
  profitBridge,
  unitPerformance,
} from './service.js';
import { dashboardPdf, dashboardXlsx } from './export.js';

export const dashboardRouter = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const FiltersSchema = z.object({
  from: isoDate,
  to: isoDate,
  modelId: z.coerce.number().int().optional(),
  unitId: z.coerce.number().int().optional(),
  segment: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  receivedById: z.coerce.number().int().optional(),
});

/**
 * STAFF see operational numbers but not partner data (salaries, profit split).
 * Salaries stay inside the expense totals, just not itemised.
 */
function redactSummaryForStaff(s: Awaited<ReturnType<typeof dashboardSummary>>) {
  const salaries = s.expensesByType.find((e) => e.category === 'Salaries');
  const rest = s.expensesByType.filter((e) => e.category !== 'Salaries');
  if (salaries) {
    const other = rest.find((e) => e.category === 'Other');
    if (other) other.grossCents += salaries.grossCents;
    else rest.push({ category: 'Other', grossCents: salaries.grossCents });
  }
  return { ...s, kpis: { ...s.kpis, salariesCents: null }, expensesByType: rest };
}

dashboardRouter.get('/summary', requireAuth(), validate({ query: FiltersSchema }), async (req, res, next) => {
  try {
    const summary = await dashboardSummary(req.query as unknown as z.infer<typeof FiltersSchema>);
    res.json(req.user?.role === 'STAFF' ? redactSummaryForStaff(summary) : summary);
  } catch (err) {
    next(err);
  }
});

const GrowthSchema = z.object({
  granularity: z.enum(['weekly', 'monthly', 'yearly']).default('weekly'),
  count: z.coerce.number().int().min(2).max(24).default(4),
  endDate: isoDate.optional(),
  modelId: z.coerce.number().int().optional(),
  unitId: z.coerce.number().int().optional(),
  segment: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  receivedById: z.coerce.number().int().optional(),
  metric: z.enum(['gross', 'net', 'received']).default('gross'),
});

dashboardRouter.get('/growth', requireAuth(), validate({ query: GrowthSchema }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof GrowthSchema>;
    const { todayInHelsinki } = await import('@emotionfix/shared');
    const points = await growthSeries({
      granularity: q.granularity,
      count: q.count,
      endDate: q.endDate ?? todayInHelsinki(),
      modelId: q.modelId,
      unitId: q.unitId,
      segment: q.segment,
      receivedById: q.receivedById,
      metric: q.metric,
    });
    res.json({ points });
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get(
  '/compare-models',
  requireAuth(),
  validate({ query: GrowthSchema.omit({ modelId: true }) }),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof GrowthSchema>;
      const { todayInHelsinki } = await import('@emotionfix/shared');
      const endDate = q.endDate ?? todayInHelsinki();
      const models = await prisma.businessModel.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
      const series = await Promise.all(
        models.map(async (model) => ({
          model: { id: model.id, code: model.code, nameEn: model.nameEn, nameFi: model.nameFi, color: model.color },
          points: await growthSeries({
            granularity: q.granularity,
            count: q.count,
            endDate,
            modelId: model.id,
            metric: q.metric,
            segment: q.segment,
            receivedById: q.receivedById,
          }),
        })),
      );
      res.json({ series: series.filter((s) => s.points.some((p) => p.valueCents !== 0)) });
    } catch (err) {
      next(err);
    }
  },
);

dashboardRouter.get(
  '/unit-performance',
  requireAuth(),
  validate({ query: z.object({ from: isoDate, to: isoDate, segment: z.enum(['INDIVIDUAL', 'BUSINESS']).optional() }) }),
  async (req, res, next) => {
    try {
      res.json(
        await unitPerformance(req.query as unknown as { from: string; to: string; segment?: 'INDIVIDUAL' | 'BUSINESS' }),
      );
    } catch (err) {
      next(err);
    }
  },
);

dashboardRouter.get('/profit-bridge', requireAuth(), validate({ query: FiltersSchema }), async (req, res, next) => {
  try {
    const bridge = await profitBridge(req.query as unknown as z.infer<typeof FiltersSchema>);
    if (req.user?.role === 'STAFF') {
      res.json({
        rows: bridge.rows.map((r) => (r.label === 'Less: Salaries' ? { ...r, label: 'Less: Other' } : r)),
      });
      return;
    }
    res.json(bridge);
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get(
  '/export',
  // the export itemises salaries — partner data, not for STAFF
  requireAuth('ADMIN', 'ACCOUNTANT'),
  validate({ query: FiltersSchema.extend({ format: z.enum(['pdf', 'xlsx']).default('pdf') }) }),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as z.infer<typeof FiltersSchema> & { format: 'pdf' | 'xlsx' };
      await audit('EXPORT', 'dashboard', `${q.from}..${q.to}`, undefined, { format: q.format });
      if (q.format === 'xlsx') {
        const buf = await dashboardXlsx(q);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="dashboard-${q.from}-${q.to}.xlsx"`);
        res.send(buf);
      } else {
        const buf = await dashboardPdf(q);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="dashboard-${q.from}-${q.to}.pdf"`);
        res.send(buf);
      }
    } catch (err) {
      next(err);
    }
  },
);
