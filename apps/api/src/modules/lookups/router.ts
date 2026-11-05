import { Router } from 'express';
import { prisma } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { getSetting } from '../../services/settings.js';

/** Everything the web forms need to render their dropdowns, in one call. */
export const lookupsRouter = Router();

lookupsRouter.get('/', requireAuth(), async (_req, res, next) => {
  try {
    const [models, holders, methods, expenseCategories, unitPrefixes, vatRates, taxRates] =
      await Promise.all([
        prisma.businessModel.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
        prisma.moneyHolder.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
        prisma.paymentMethod.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
        prisma.expenseCategory.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } }),
        prisma.unitPrefix.findMany({ where: { active: true }, orderBy: { prefix: 'asc' } }),
        prisma.vatRate.findMany({ orderBy: [{ validFrom: 'desc' }] }),
        prisma.taxRate.findMany({ orderBy: { validFrom: 'desc' } }),
      ]);
    const vatDefaults = await getSetting<{ byHolder: Record<string, boolean> }>('vatDefaults', {
      byHolder: {},
    });
    res.json({
      models,
      holders,
      methods,
      expenseCategories,
      unitPrefixes,
      vatRates: vatRates.map((r) => ({ ...r, validFrom: r.validFrom.toISOString().slice(0, 10) })),
      taxRates: taxRates.map((r) => ({ ...r, validFrom: r.validFrom.toISOString().slice(0, 10) })),
      vatDefaults,
    });
  } catch (err) {
    next(err);
  }
});
