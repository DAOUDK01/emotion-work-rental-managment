import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { paybackPct } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { AppError, badRequest, conflict, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { createEntry, defaultVatInvoice, vatRateOn } from '../../services/entries.js';
import {
  type ListQuery,
  ListQuerySchema,
  type SellInput,
  SellSchema,
  UNIT_CATEGORIES,
  type UnitCreateInput,
  UnitCreateSchema,
  type UnitUpdateInput,
  UnitUpdateSchema,
  type VoidInput,
  VoidSchema,
  idParam,
} from './schemas.js';
import {
  collectUnitTotals,
  computeFinancials,
  createUnit,
  serializeUnit,
  subtractPartsFromPayback,
  toIsoDate,
  updateUnit,
} from './service.js';

/**
 * Units (scooters / e-bikes / mopeds): register, list with payback figures,
 * compare categories, sell (creates the UNIT_SALES income entry) and archive.
 */
export const unitsRouter = Router();

const readRoles = requireAuth('ADMIN', 'STAFF', 'ACCOUNTANT');
const writeRoles = requireAuth('ADMIN', 'STAFF');

async function assertHolderExists(id: number | null | undefined, field: string): Promise<void> {
  if (id == null) return;
  const holder = await prisma.moneyHolder.findUnique({ where: { id } });
  if (!holder) throw badRequest('BAD_HOLDER', `Money holder for "${field}" not found`);
}

async function assertPaymentMethodExists(id: number | null | undefined): Promise<void> {
  if (id == null) return;
  const method = await prisma.paymentMethod.findUnique({ where: { id } });
  if (!method) throw badRequest('BAD_PAYMENT_METHOD', 'Payment method not found');
}

// ---------- list ----------
unitsRouter.get('/', readRoles, validate({ query: ListQuerySchema }), async (req, res, next) => {
  try {
    const query = req.query as unknown as ListQuery;
    const where: Prisma.UnitWhereInput = {};
    if (!query.includeInactive) where.active = true;
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { brand: { contains: query.q, mode: 'insensitive' } },
        { modelName: { contains: query.q, mode: 'insensitive' } },
        { legacyName: { contains: query.q, mode: 'insensitive' } },
        { sellerName: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [total, units] = await Promise.all([
      prisma.unit.count({ where }),
      prisma.unit.findMany({
        where,
        include: { owner: true, paidBy: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const financials = await computeFinancials(units);
    res.json({
      units: units.map((u) => serializeUnit(u, financials.get(u.id)!)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- compare categories ----------
unitsRouter.get('/compare', readRoles, async (_req, res, next) => {
  try {
    const units = await prisma.unit.findMany({
      where: { active: true },
      select: { id: true, category: true, status: true, purchaseCents: true, soldCents: true },
    });
    const totals = await collectUnitTotals(units.map((u) => u.id));
    const subtractParts = await subtractPartsFromPayback();

    type Category = (typeof UNIT_CATEGORIES)[number];
    interface Row {
      unitCount: number;
      costCents: number;
      earnedCents: number;
      paybackBaseCents: number;
    }
    const byCat = new Map<Category, Row>();
    for (const u of units) {
      const row =
        byCat.get(u.category) ??
        ({ unitCount: 0, costCents: 0, earnedCents: 0, paybackBaseCents: 0 } satisfies Row);
      const t = totals.get(u.id) ?? { earnedCents: 0, partsCents: 0 };
      row.unitCount += 1;
      row.costCents += u.purchaseCents ?? 0;
      row.earnedCents += t.earnedCents;
      row.paybackBaseCents += t.earnedCents - (subtractParts ? t.partsCents : 0);
      byCat.set(u.category, row);
    }
    const byCategory = UNIT_CATEGORIES.filter((c) => byCat.has(c)).map((category) => {
      const row = byCat.get(category)!;
      return {
        category,
        unitCount: row.unitCount,
        costCents: row.costCents,
        earnedCents: row.earnedCents,
        paybackPct: paybackPct(row.paybackBaseCents, row.costCents > 0 ? row.costCents : null),
      };
    });
    res.json({ byCategory });
  } catch (err) {
    next(err);
  }
});

// ---------- detail ----------
unitsRouter.get('/:id', readRoles, validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const unit = await prisma.unit.findUnique({
      where: { id },
      include: {
        owner: true,
        paidBy: true,
        soldToCustomer: { select: { id: true, name: true } },
        entries: {
          orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
          take: 20,
          include: {
            model: { select: { id: true, code: true, nameEn: true, nameFi: true } },
            customer: { select: { id: true, name: true } },
            paymentMethod: { select: { id: true, name: true } },
            receivedBy: { select: { id: true, name: true } },
          },
        },
        attachments: {
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
          orderBy: { id: 'desc' },
        },
      },
    });
    if (!unit) throw notFound('Unit');
    const financials = await computeFinancials([unit]);
    res.json({
      unit: {
        ...serializeUnit(unit, financials.get(id)!),
        soldToCustomer: unit.soldToCustomer,
        entries: unit.entries.map((e) => ({ ...e, entryDate: toIsoDate(e.entryDate) })),
        attachments: unit.attachments,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- create ----------
unitsRouter.post('/', writeRoles, validate({ body: UnitCreateSchema }), async (req, res, next) => {
  try {
    const body = req.body as UnitCreateInput;
    await assertHolderExists(body.ownerId, 'ownerId');
    await assertHolderExists(body.paidById, 'paidById');
    if (body.codeOverride != null) {
      const clash = await prisma.unit.findUnique({ where: { code: body.codeOverride } });
      if (clash) throw conflict('DUPLICATE', `Unit code "${body.codeOverride}" is already in use`);
    }
    const { unit, investment } = await createUnit(body);
    await audit('CREATE', 'units', unit.id, undefined, unit);
    if (investment) await audit('CREATE', 'investments', investment.id, undefined, investment);
    const financials = await computeFinancials([unit]);
    res.status(201).json({ unit: serializeUnit(unit, financials.get(unit.id)!) });
  } catch (err) {
    next(err);
  }
});

// ---------- update ----------
unitsRouter.put(
  '/:id',
  writeRoles,
  validate({ params: idParam, body: UnitUpdateSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as UnitUpdateInput;
      const before = await prisma.unit.findUnique({ where: { id } });
      if (!before) throw notFound('Unit');
      await assertHolderExists(body.ownerId, 'ownerId');
      await assertHolderExists(body.paidById, 'paidById');
      if (body.codeOverride != null && body.codeOverride !== before.code) {
        const clash = await prisma.unit.findUnique({ where: { code: body.codeOverride } });
        if (clash && clash.id !== id) {
          throw conflict('DUPLICATE', `Unit code "${body.codeOverride}" is already in use`);
        }
      }
      const { unit, deletedInvestments, createdInvestment } = await updateUnit(before, body);
      await audit('UPDATE', 'units', id, before, unit);
      for (const inv of deletedInvestments) await audit('DELETE', 'investments', inv.id, inv);
      if (createdInvestment) {
        await audit('CREATE', 'investments', createdInvestment.id, undefined, createdInvestment);
      }
      const financials = await computeFinancials([unit]);
      res.json({ unit: serializeUnit(unit, financials.get(id)!) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- sell ----------
unitsRouter.post(
  '/:id/sell',
  writeRoles,
  validate({ params: idParam, body: SellSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as SellInput;
      const before = await prisma.unit.findUnique({ where: { id } });
      if (!before) throw notFound('Unit');
      if (!before.active) throw conflict('UNIT_INACTIVE', 'Unit is archived');
      if (before.status === 'SOLD') throw conflict('ALREADY_SOLD', 'Unit is already sold');
      await assertHolderExists(body.receivedById, 'receivedById');
      await assertPaymentMethodExists(body.paymentMethodId);

      const model = await prisma.businessModel.findUnique({ where: { code: 'UNIT_SALES' } });
      if (!model) throw new AppError(500, 'MODEL_MISSING', 'Business model UNIT_SALES is not configured');

      const vatInvoice =
        body.vatInvoice ?? (await defaultVatInvoice(body.receivedById, body.paymentMethodId ?? null));
      const vatRateBp = await vatRateOn(body.soldDate);

      const { unit, entry } = await prisma.$transaction(async (tx) => {
        const createdEntry = await createEntry(tx, {
          entryDate: body.soldDate,
          modelId: model.id,
          unitId: id,
          customerId: body.buyerCustomerId ?? null,
          customerName: body.buyerName ?? null,
          description: `Unit ${before.code} sold`,
          grossBeforeDiscountCents: body.soldCents,
          vatInvoice,
          vatRateBp,
          paymentStatus: 'PAID',
          paymentMethodId: body.paymentMethodId ?? null,
          receivedById: body.receivedById,
          source: 'WEB',
        });
        const updatedUnit = await tx.unit.update({
          where: { id },
          data: {
            status: 'SOLD',
            soldCents: body.soldCents,
            soldDate: new Date(`${body.soldDate}T00:00:00Z`),
            soldToCustomerId: body.buyerCustomerId ?? null,
          },
          include: { owner: true, paidBy: true },
        });
        return { unit: updatedUnit, entry: createdEntry };
      });

      await audit('UPDATE', 'units', id, before, unit);
      await audit('CREATE', 'entries', entry.id, undefined, entry);
      const financials = await computeFinancials([unit]);
      const serialized = serializeUnit(unit, financials.get(id)!);
      res.json({
        unit: serialized,
        entry: { ...entry, entryDate: toIsoDate(entry.entryDate) },
        saleProfitCents: serialized.saleProfitCents,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- void (archive — active:false; financial history stays) ----------
unitsRouter.post(
  '/:id/void',
  requireAuth('ADMIN'),
  validate({ params: idParam, body: VoidSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { reason } = req.body as VoidInput;
      const before = await prisma.unit.findUnique({
        where: { id },
        include: { owner: true, paidBy: true },
      });
      if (!before) throw notFound('Unit');
      if (!before.active) {
        // Already archived — idempotent, no second audit row.
        const financials = await computeFinancials([before]);
        res.json({ unit: serializeUnit(before, financials.get(id)!) });
        return;
      }
      const unit = await prisma.unit.update({
        where: { id },
        data: { active: false },
        include: { owner: true, paidBy: true },
      });
      await audit('VOID', 'units', id, before, { ...unit, voidReason: reason });
      const financials = await computeFinancials([unit]);
      res.json({ unit: serializeUnit(unit, financials.get(id)!) });
    } catch (err) {
      next(err);
    }
  },
);
