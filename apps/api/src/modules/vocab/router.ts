import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';

/**
 * Editable business vocabulary (Settings screens): models, money holders ("Amount received by"),
 * payment methods, expense categories, unit prefixes, VAT rates, tax rates, partner salaries.
 * System rows (isSystem) can be renamed/deactivated but never deleted.
 */
export const vocabRouter = Router();
vocabRouter.use(requireAuth('ADMIN'));

const idParam = z.object({ id: z.coerce.number().int() });

// ---------- models ----------
const ModelSchema = z.object({
  code: z.string().min(2).max(40).regex(/^[A-Z0-9_]+$/, 'Use capital letters, numbers, underscore'),
  nameEn: z.string().min(1).max(80),
  nameFi: z.string().min(1).max(80),
  color: z.string().max(20).nullish(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

vocabRouter.get('/models', async (_req, res, next) => {
  try {
    res.json({ models: await prisma.businessModel.findMany({ orderBy: { sortOrder: 'asc' } }) });
  } catch (err) {
    next(err);
  }
});
vocabRouter.post('/models', validate({ body: ModelSchema }), async (req, res, next) => {
  try {
    const model = await prisma.businessModel.create({ data: req.body as z.infer<typeof ModelSchema> });
    await audit('CREATE', 'models', model.id, undefined, model);
    res.status(201).json({ model });
  } catch (err) {
    next(err);
  }
});
vocabRouter.put(
  '/models/:id',
  validate({ params: idParam, body: ModelSchema.partial().omit({ code: true }) }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const before = await prisma.businessModel.findUnique({ where: { id } });
      if (!before) throw notFound('Model');
      const model = await prisma.businessModel.update({ where: { id }, data: req.body as object });
      await audit('UPDATE', 'models', id, before, model);
      res.json({ model });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- money holders ("Amount received by" options) ----------
const HolderSchema = z.object({
  name: z.string().min(1).max(60),
  kind: z.enum(['PARTNER', 'COMPANY', 'CASHBOX', 'OTHER']).default('OTHER'),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

vocabRouter.get('/holders', async (_req, res, next) => {
  try {
    res.json({ holders: await prisma.moneyHolder.findMany({ orderBy: { sortOrder: 'asc' } }) });
  } catch (err) {
    next(err);
  }
});
vocabRouter.post('/holders', validate({ body: HolderSchema }), async (req, res, next) => {
  try {
    const holder = await prisma.moneyHolder.create({ data: req.body as z.infer<typeof HolderSchema> });
    await audit('CREATE', 'money_holders', holder.id, undefined, holder);
    res.status(201).json({ holder });
  } catch (err) {
    next(err);
  }
});
vocabRouter.put('/holders/:id', validate({ params: idParam, body: HolderSchema.partial() }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const before = await prisma.moneyHolder.findUnique({ where: { id } });
    if (!before) throw notFound('Money holder');
    const holder = await prisma.moneyHolder.update({ where: { id }, data: req.body as object });
    await audit('UPDATE', 'money_holders', id, before, holder);
    res.json({ holder });
  } catch (err) {
    next(err);
  }
});

// ---------- payment methods ----------
const MethodSchema = z.object({
  name: z.string().min(1).max(60),
  nameFi: z.string().max(60).nullish(),
  defaultVatInvoice: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

vocabRouter.get('/methods', async (_req, res, next) => {
  try {
    res.json({ methods: await prisma.paymentMethod.findMany({ orderBy: { sortOrder: 'asc' } }) });
  } catch (err) {
    next(err);
  }
});
vocabRouter.post('/methods', validate({ body: MethodSchema }), async (req, res, next) => {
  try {
    const method = await prisma.paymentMethod.create({ data: req.body as z.infer<typeof MethodSchema> });
    await audit('CREATE', 'payment_methods', method.id, undefined, method);
    res.status(201).json({ method });
  } catch (err) {
    next(err);
  }
});
vocabRouter.put('/methods/:id', validate({ params: idParam, body: MethodSchema.partial() }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const before = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!before) throw notFound('Payment method');
    const method = await prisma.paymentMethod.update({ where: { id }, data: req.body as object });
    await audit('UPDATE', 'payment_methods', id, before, method);
    res.json({ method });
  } catch (err) {
    next(err);
  }
});

// ---------- expense categories ----------
const CategorySchema = z.object({
  nameEn: z.string().min(1).max(80),
  nameFi: z.string().max(80).nullish(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

vocabRouter.get('/expense-categories', async (_req, res, next) => {
  try {
    res.json({
      categories: await prisma.expenseCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
    });
  } catch (err) {
    next(err);
  }
});
vocabRouter.post('/expense-categories', validate({ body: CategorySchema }), async (req, res, next) => {
  try {
    const category = await prisma.expenseCategory.create({
      data: req.body as z.infer<typeof CategorySchema>,
    });
    await audit('CREATE', 'expense_categories', category.id, undefined, category);
    res.status(201).json({ category });
  } catch (err) {
    next(err);
  }
});
vocabRouter.put(
  '/expense-categories/:id',
  validate({ params: idParam, body: CategorySchema.partial() }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const before = await prisma.expenseCategory.findUnique({ where: { id } });
      if (!before) throw notFound('Expense category');
      const category = await prisma.expenseCategory.update({ where: { id }, data: req.body as object });
      await audit('UPDATE', 'expense_categories', id, before, category);
      res.json({ category });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- unit prefixes ----------
const PrefixSchema = z.object({
  prefix: z.string().min(1).max(10).regex(/^[A-Z0-9]+$/, 'Capital letters and numbers only'),
  brandName: z.string().min(1).max(80),
  active: z.boolean().default(true),
});

vocabRouter.get('/unit-prefixes', async (_req, res, next) => {
  try {
    res.json({ prefixes: await prisma.unitPrefix.findMany({ orderBy: { prefix: 'asc' } }) });
  } catch (err) {
    next(err);
  }
});
vocabRouter.post('/unit-prefixes', validate({ body: PrefixSchema }), async (req, res, next) => {
  try {
    const prefix = await prisma.unitPrefix.create({ data: req.body as z.infer<typeof PrefixSchema> });
    await audit('CREATE', 'unit_prefixes', prefix.id, undefined, prefix);
    res.status(201).json({ prefix });
  } catch (err) {
    next(err);
  }
});
vocabRouter.put('/unit-prefixes/:id', validate({ params: idParam, body: PrefixSchema.partial() }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const before = await prisma.unitPrefix.findUnique({ where: { id } });
    if (!before) throw notFound('Unit prefix');
    const prefix = await prisma.unitPrefix.update({ where: { id }, data: req.body as object });
    await audit('UPDATE', 'unit_prefixes', id, before, prefix);
    res.json({ prefix });
  } catch (err) {
    next(err);
  }
});

// ---------- VAT rates (effective-dated; history must never break) ----------
const VatRateSchema = z.object({
  rateBp: z.number().int().min(0).max(10000),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string().max(80).nullish(),
  isDefault: z.boolean().default(true),
});

vocabRouter.get('/vat-rates', async (_req, res, next) => {
  try {
    const rates = await prisma.vatRate.findMany({ orderBy: [{ isDefault: 'desc' }, { validFrom: 'desc' }] });
    res.json({ rates: rates.map((r) => ({ ...r, validFrom: r.validFrom.toISOString().slice(0, 10) })) });
  } catch (err) {
    next(err);
  }
});
vocabRouter.post('/vat-rates', validate({ body: VatRateSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof VatRateSchema>;
    const rate = await prisma.vatRate.create({
      data: { ...body, validFrom: new Date(`${body.validFrom}T00:00:00Z`) },
    });
    await audit('CREATE', 'vat_rates', rate.id, undefined, rate);
    res.status(201).json({ rate });
  } catch (err) {
    next(err);
  }
});
vocabRouter.delete('/vat-rates/:id', validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const before = await prisma.vatRate.findUnique({ where: { id } });
    if (!before) throw notFound('VAT rate');
    const used = await prisma.entry.count({ where: { vatRateBp: before.rateBp } });
    if (used > 0) throw new AppError(409, 'RATE_IN_USE', 'This rate is used by existing entries; add a new rate with a later valid-from date instead');
    await prisma.vatRate.delete({ where: { id } });
    await audit('DELETE', 'vat_rates', id, before);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------- corporate tax rates ----------
const TaxRateSchema = z.object({
  rateBp: z.number().int().min(0).max(10000),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

vocabRouter.get('/tax-rates', async (_req, res, next) => {
  try {
    const rates = await prisma.taxRate.findMany({ orderBy: { validFrom: 'desc' } });
    res.json({ rates: rates.map((r) => ({ ...r, validFrom: r.validFrom.toISOString().slice(0, 10) })) });
  } catch (err) {
    next(err);
  }
});
vocabRouter.post('/tax-rates', validate({ body: TaxRateSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof TaxRateSchema>;
    const rate = await prisma.taxRate.create({
      data: { rateBp: body.rateBp, validFrom: new Date(`${body.validFrom}T00:00:00Z`) },
    });
    await audit('CREATE', 'tax_rates', rate.id, undefined, rate);
    res.status(201).json({ rate });
  } catch (err) {
    next(err);
  }
});

// ---------- partner salaries (effective-dated, shown as an expense in P&L) ----------
const SalarySchema = z.object({
  holderId: z.number().int(),
  monthlyCents: z.number().int().min(0),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(200).nullish(),
});

vocabRouter.get('/salaries', async (_req, res, next) => {
  try {
    const salaries = await prisma.salary.findMany({
      include: { holder: true },
      orderBy: [{ holderId: 'asc' }, { validFrom: 'desc' }],
    });
    res.json({
      salaries: salaries.map((s) => ({ ...s, validFrom: s.validFrom.toISOString().slice(0, 10) })),
    });
  } catch (err) {
    next(err);
  }
});
vocabRouter.post('/salaries', validate({ body: SalarySchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof SalarySchema>;
    const holder = await prisma.moneyHolder.findUnique({ where: { id: body.holderId } });
    if (!holder || holder.kind !== 'PARTNER') {
      throw new AppError(400, 'NOT_A_PARTNER', 'Salaries can only be set for partners');
    }
    const salary = await prisma.salary.create({
      data: { ...body, validFrom: new Date(`${body.validFrom}T00:00:00Z`) },
    });
    await audit('CREATE', 'salaries', salary.id, undefined, salary);
    res.status(201).json({ salary });
  } catch (err) {
    next(err);
  }
});
vocabRouter.delete('/salaries/:id', validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const before = await prisma.salary.findUnique({ where: { id } });
    if (!before) throw notFound('Salary');
    await prisma.salary.delete({ where: { id } });
    await audit('DELETE', 'salaries', id, before);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
