import { Router } from 'express';
import { type z } from 'zod';
import type { Prisma } from '@prisma/client';
import { todayInHelsinki } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { currentUserId } from '../../context.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { vatRateOn } from '../../services/entries.js';
import {
  CreateExpenseSchema,
  ExpenseListQuery,
  UpdateExpenseSchema,
  VoidSchema,
  idParam,
} from './schemas.js';
import {
  type DesiredStock,
  computeReclaimable,
  expenseInclude,
  findDuplicateClusters,
  findDuplicatesOf,
  isoOrNull,
  rebuildAutoInvestments,
  serializeExpense,
  stockEffectOf,
  syncStockMovements,
  unitCostFor,
} from './service.js';

/**
 * Purchases & running costs. Every write recomputes the reclaimable-VAT snapshot,
 * keeps the derived partner/joint Investment row in sync and (for stock purchases)
 * receives the goods via a PURCHASE stock movement. Financial rows are never
 * hard-deleted: void sets status VOID, reverses stock and voids auto investments.
 */
export const expensesRouter = Router();
expensesRouter.use(requireAuth('ADMIN', 'STAFF', 'ACCOUNTANT'));

const AMOUNT_MISSING = 'Amount missing';

async function assertCategoryUsable(categoryId: number) {
  const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!category || !category.active) {
    throw badRequest('BAD_CATEGORY', 'Expense category not found or inactive');
  }
  return category;
}

async function assertHolderExists(holderId: number): Promise<void> {
  const holder = await prisma.moneyHolder.findUnique({ where: { id: holderId } });
  if (!holder) throw badRequest('BAD_HOLDER', '"Paid by" money holder not found');
}

async function assertUnitExists(unitId: number): Promise<void> {
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) throw badRequest('BAD_UNIT', 'Unit not found');
}

async function assertProductForStock(productId: number, receivesStock: boolean): Promise<void> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw badRequest('BAD_PRODUCT', 'Product not found');
  if (receivesStock && !product.trackStock) {
    throw badRequest('NOT_STOCK_TRACKED', 'This product does not track stock');
  }
}

// ---------------------------------------------------------------- list

expensesRouter.get('/', validate({ query: ExpenseListQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof ExpenseListQuery>;
    const where: Prisma.ExpenseWhereInput = {};
    if (query.from || query.to) {
      where.expenseDate = {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T00:00:00Z`) } : {}),
      };
    }
    if (query.categoryId !== undefined) where.categoryId = query.categoryId;
    if (query.paidById !== undefined) where.paidById = query.paidById;
    if (query.unitId !== undefined) where.unitId = query.unitId;
    if (query.needsReview !== undefined) where.needsReview = query.needsReview;
    if (query.q) {
      where.OR = [
        { description: { contains: query.q, mode: 'insensitive' } },
        { vendor: { contains: query.q, mode: 'insensitive' } },
        { notes: { contains: query.q, mode: 'insensitive' } },
        { purchasedFor: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [rows, total, sums] = await Promise.all([
      prisma.expense.findMany({
        where,
        include: expenseInclude,
        orderBy: [{ expenseDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({
        where: { ...where, status: 'ACTIVE' },
        _sum: { grossCents: true, reclaimableVatCents: true },
      }),
    ]);

    res.json({
      expenses: rows.map(serializeExpense),
      total,
      page: query.page,
      pageSize: query.pageSize,
      sums: {
        grossCents: sums._sum.grossCents ?? 0,
        reclaimableVatCents: sums._sum.reclaimableVatCents ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- duplicates report

expensesRouter.get('/duplicates', async (_req, res, next) => {
  try {
    const groups = await findDuplicateClusters();
    res.json({ groups, total: groups.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- create

expensesRouter.post('/', validate({ body: CreateExpenseSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof CreateExpenseSchema>;
    const category = await assertCategoryUsable(body.categoryId);
    if (body.paidById != null) await assertHolderExists(body.paidById);
    if (body.unitId != null) await assertUnitExists(body.unitId);

    const stockQty = body.stockQty ?? 0;
    if (stockQty > 0 && body.productId == null) {
      throw badRequest('STOCK_NEEDS_PRODUCT', 'stockQty requires a productId');
    }
    if (body.productId != null) await assertProductForStock(body.productId, stockQty > 0);

    const expenseDate = body.expenseDate ?? null;
    const vatRateBp = body.vatRateBp ?? (await vatRateOn(expenseDate ?? todayInHelsinki()));
    const grossCents = body.grossCents ?? null;
    const reclaimableVatCents = computeReclaimable({
      grossCents,
      vatRateBp,
      hasValidReceipt: body.hasValidReceipt,
      businessUsePct: body.businessUsePct,
    });

    const desired: DesiredStock | null =
      body.productId != null && stockQty > 0
        ? { productId: body.productId, qty: stockQty, unitCostCents: unitCostFor(grossCents, stockQty) }
        : null;

    const result = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          expenseDate: expenseDate ? new Date(`${expenseDate}T00:00:00Z`) : null,
          categoryId: body.categoryId,
          description: body.description,
          vendor: body.vendor || null,
          qtyText: body.qtyText || null,
          grossCents,
          vatRateBp,
          hasValidReceipt: body.hasValidReceipt,
          businessUsePct: body.businessUsePct,
          reclaimableVatCents,
          paidById: body.paidById ?? null,
          jointReinvested: body.jointReinvested,
          unitId: body.unitId ?? null,
          productId: body.productId ?? null,
          purchasedFor: body.purchasedFor || null,
          notes: body.notes || null,
          needsReview: grossCents == null,
          reviewReason: grossCents == null ? AMOUNT_MISSING : null,
          source: 'WEB',
          createdById: currentUserId() ?? null,
        },
      });
      const movements = await syncStockMovements(tx, expense.id, desired, 'Expense updated');
      const investments = await rebuildAutoInvestments(tx, { ...expense, category });
      const full = await tx.expense.findUniqueOrThrow({
        where: { id: expense.id },
        include: expenseInclude,
      });
      return { expense: full, movements, investments };
    });

    await audit('CREATE', 'expenses', result.expense.id, undefined, result.expense);
    for (const m of result.movements) await audit('CREATE', 'stock_movements', m.id, undefined, m);
    for (const i of result.investments.created) await audit('CREATE', 'investments', i.id, undefined, i);

    const duplicates = await findDuplicatesOf(result.expense);
    res.status(201).json({ expense: serializeExpense(result.expense), duplicates });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- update

expensesRouter.put(
  '/:id',
  validate({ params: idParam, body: UpdateExpenseSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as z.infer<typeof UpdateExpenseSchema>;
      const before = await prisma.expense.findUnique({ where: { id }, include: { category: true } });
      if (!before) throw notFound('Expense');
      if (before.status === 'VOID') throw conflict('EXPENSE_VOID', 'Cannot edit a voided expense');

      let category = before.category;
      if (body.categoryId !== undefined && body.categoryId !== before.categoryId) {
        category = await assertCategoryUsable(body.categoryId);
      }
      if (body.paidById != null && body.paidById !== before.paidById) {
        await assertHolderExists(body.paidById);
      }
      if (body.unitId != null && body.unitId !== before.unitId) {
        await assertUnitExists(body.unitId);
      }

      const merged = {
        expenseDate: body.expenseDate === undefined ? isoOrNull(before.expenseDate) : body.expenseDate ?? null,
        categoryId: body.categoryId ?? before.categoryId,
        description: body.description ?? before.description,
        vendor: body.vendor === undefined ? before.vendor : body.vendor || null,
        qtyText: body.qtyText === undefined ? before.qtyText : body.qtyText || null,
        grossCents: body.grossCents === undefined ? before.grossCents : body.grossCents,
        vatRateBp: body.vatRateBp ?? before.vatRateBp,
        hasValidReceipt: body.hasValidReceipt ?? before.hasValidReceipt,
        businessUsePct: body.businessUsePct ?? before.businessUsePct,
        paidById: body.paidById === undefined ? before.paidById : body.paidById,
        jointReinvested: body.jointReinvested ?? before.jointReinvested,
        unitId: body.unitId === undefined ? before.unitId : body.unitId,
        productId: body.productId === undefined ? before.productId : body.productId,
        purchasedFor: body.purchasedFor === undefined ? before.purchasedFor : body.purchasedFor || null,
        notes: body.notes === undefined ? before.notes : body.notes || null,
      };

      // Desired stock effect: an explicit stockQty wins; otherwise keep the quantity
      // already received for this expense (carried over to a changed product).
      const currentNet = await stockEffectOf(prisma, id);
      const currentQtyTotal = [...currentNet.values()].reduce((a, b) => a + b, 0);
      const explicitQty = body.stockQty !== undefined;
      const desiredQty = explicitQty ? body.stockQty ?? 0 : Math.max(0, currentQtyTotal);
      let desired: DesiredStock | null = null;
      if (merged.productId == null) {
        if (explicitQty && desiredQty > 0) {
          throw badRequest('STOCK_NEEDS_PRODUCT', 'stockQty requires a productId');
        }
      } else if (desiredQty > 0) {
        await assertProductForStock(merged.productId, true);
        desired = {
          productId: merged.productId,
          qty: desiredQty,
          unitCostCents: unitCostFor(merged.grossCents, desiredQty),
        };
      } else if (merged.productId !== before.productId) {
        await assertProductForStock(merged.productId, false);
      }

      const reclaimableVatCents = computeReclaimable({
        grossCents: merged.grossCents,
        vatRateBp: merged.vatRateBp,
        hasValidReceipt: merged.hasValidReceipt,
        businessUsePct: merged.businessUsePct,
      });

      let needsReview = before.needsReview;
      let reviewReason = before.reviewReason;
      if (merged.grossCents == null) {
        needsReview = true;
        reviewReason = reviewReason ?? AMOUNT_MISSING;
      } else if (before.reviewReason === AMOUNT_MISSING) {
        needsReview = false;
        reviewReason = null;
      }

      const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.expense.update({
          where: { id },
          data: {
            expenseDate: merged.expenseDate ? new Date(`${merged.expenseDate}T00:00:00Z`) : null,
            categoryId: merged.categoryId,
            description: merged.description,
            vendor: merged.vendor,
            qtyText: merged.qtyText,
            grossCents: merged.grossCents,
            vatRateBp: merged.vatRateBp,
            hasValidReceipt: merged.hasValidReceipt,
            businessUsePct: merged.businessUsePct,
            reclaimableVatCents,
            paidById: merged.paidById,
            jointReinvested: merged.jointReinvested,
            unitId: merged.unitId,
            productId: merged.productId,
            purchasedFor: merged.purchasedFor,
            notes: merged.notes,
            needsReview,
            reviewReason,
          },
        });
        const movements = await syncStockMovements(tx, id, desired, 'Expense updated');
        const investments = await rebuildAutoInvestments(tx, { ...updated, category });
        const full = await tx.expense.findUniqueOrThrow({ where: { id }, include: expenseInclude });
        return { expense: full, movements, investments };
      });

      await audit('UPDATE', 'expenses', id, before, result.expense);
      for (const m of result.movements) await audit('CREATE', 'stock_movements', m.id, undefined, m);
      for (const i of result.investments.deleted) await audit('DELETE', 'investments', i.id, i, undefined);
      for (const i of result.investments.created) await audit('CREATE', 'investments', i.id, undefined, i);

      res.json({ expense: serializeExpense(result.expense) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- void

expensesRouter.post(
  '/:id/void',
  validate({ params: idParam, body: VoidSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { reason } = req.body as z.infer<typeof VoidSchema>;
      const before = await prisma.expense.findUnique({ where: { id } });
      if (!before) throw notFound('Expense');
      if (before.status === 'VOID') throw conflict('ALREADY_VOID', 'Expense is already voided');

      const result = await prisma.$transaction(async (tx) => {
        const expense = await tx.expense.update({
          where: { id },
          data: { status: 'VOID', voidReason: reason },
          include: expenseInclude,
        });
        const voidedInvestments = await tx.investment.findMany({
          where: { expenseId: id, auto: true, status: 'ACTIVE' },
        });
        if (voidedInvestments.length > 0) {
          await tx.investment.updateMany({
            where: { id: { in: voidedInvestments.map((i) => i.id) } },
            data: { status: 'VOID' },
          });
        }
        const movements = await syncStockMovements(tx, id, null, 'Expense voided');
        return { expense, voidedInvestments, movements };
      });

      await audit('VOID', 'expenses', id, before, result.expense);
      for (const i of result.voidedInvestments) {
        await audit('VOID', 'investments', i.id, i, { ...i, status: 'VOID', reason });
      }
      for (const m of result.movements) await audit('CREATE', 'stock_movements', m.id, undefined, m);

      res.json({ expense: serializeExpense(result.expense) });
    } catch (err) {
      next(err);
    }
  },
);
