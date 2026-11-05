import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { currentUserId } from '../../context.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';

/**
 * Partner investments ledger. Rows are either PERSONAL (holderId = a PARTNER money
 * holder) or JOINT 50/50 (isJoint, no holder). Auto rows (auto=true) are derived from
 * an expense or a unit purchase and are maintained by those modules — they can never
 * be edited or voided here (409 AUTO_ROW). Manual rows (e.g. "Cash injected") have
 * full CRUD. Financial rows are never hard-deleted: void sets status VOID and the
 * reason is recorded in the audit trail (the table has no voidReason column).
 */
export const investmentsRouter = Router();
investmentsRouter.use(requireAuth('ADMIN', 'ACCOUNTANT')); // accountant writes are blocked globally

// ---------------------------------------------------------------- schemas

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE_RE, 'Expected YYYY-MM-DD');

const idParam = z.object({ id: z.coerce.number().int().positive() });

const INVESTMENT_CATEGORIES = ['UNITS', 'SPARE_PARTS', 'TOOLS', 'EXPENSES', 'CASH_INJECTED'] as const;

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  from: isoDate.optional(),
  to: isoDate.optional(),
  holderId: z.coerce.number().int().positive().optional(),
  category: z.enum(INVESTMENT_CATEGORIES).optional(),
  isJoint: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

const CreateInvestmentSchema = z.object({
  date: isoDate,
  holderId: z.number().int().positive().nullish(),
  isJoint: z.boolean().default(false),
  category: z.enum(INVESTMENT_CATEGORIES),
  amountCents: z.number().int().positive(),
  note: z.string().trim().max(500).nullish(),
  unitId: z.number().int().positive().nullish(),
  expenseId: z.number().int().positive().nullish(),
});

const UpdateInvestmentSchema = CreateInvestmentSchema.partial();

const VoidSchema = z.object({ reason: z.string().trim().min(1).max(500) });

// ---------------------------------------------------------------- helpers

const investmentInclude = {
  holder: { select: { id: true, name: true, kind: true } },
  expense: { select: { id: true, description: true, vendor: true, expenseDate: true } },
  unit: { select: { id: true, code: true, brand: true } },
} satisfies Prisma.InvestmentInclude;

type InvestmentWithRefs = Prisma.InvestmentGetPayload<{ include: typeof investmentInclude }>;

function serializeInvestment(i: InvestmentWithRefs) {
  return {
    ...i,
    date: i.date.toISOString().slice(0, 10),
    expense: i.expense
      ? {
          ...i.expense,
          expenseDate: i.expense.expenseDate ? i.expense.expenseDate.toISOString().slice(0, 10) : null,
        }
      : null,
  };
}

/**
 * Validate the holder/joint combination of a (manual) investment row:
 * joint rows carry no holder; personal rows need an existing PARTNER holder.
 */
async function resolveOwnership(
  holderId: number | null,
  isJoint: boolean,
): Promise<{ holderId: number | null; isJoint: boolean }> {
  if (isJoint) {
    if (holderId != null) {
      throw badRequest('JOINT_HAS_HOLDER', 'A joint investment cannot have a holder — omit holderId');
    }
    return { holderId: null, isJoint: true };
  }
  if (holderId == null) {
    throw badRequest('HOLDER_REQUIRED', 'Give a holderId, or set isJoint for a joint investment');
  }
  const holder = await prisma.moneyHolder.findUnique({ where: { id: holderId } });
  if (!holder) throw badRequest('BAD_HOLDER', 'Money holder not found');
  if (holder.kind !== 'PARTNER') {
    throw badRequest('NOT_A_PARTNER', 'Investments can only be recorded for partner holders');
  }
  return { holderId, isJoint: false };
}

async function assertUnitExists(unitId: number): Promise<void> {
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) throw badRequest('BAD_UNIT', 'Unit not found');
}

async function assertExpenseExists(expenseId: number): Promise<void> {
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense) throw badRequest('BAD_EXPENSE', 'Expense not found');
}

/** Load a row for PUT/void and refuse the auto rows that belong to an expense/unit. */
async function loadManualRow(id: number) {
  const row = await prisma.investment.findUnique({ where: { id } });
  if (!row) throw notFound('Investment');
  if (row.auto) throw conflict('AUTO_ROW', 'managed by its expense/unit');
  return row;
}

// ---------------------------------------------------------------- list

investmentsRouter.get('/', validate({ query: ListQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof ListQuery>;
    const where: Prisma.InvestmentWhereInput = {};
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T00:00:00Z`) } : {}),
      };
    }
    if (query.holderId !== undefined) where.holderId = query.holderId;
    if (query.category !== undefined) where.category = query.category;
    if (query.isJoint !== undefined) where.isJoint = query.isJoint;

    // Sums cover the ACTIVE rows of the filtered set (AND keeps the user's own
    // isJoint/holderId filters intact instead of overwriting them).
    const activeWhere: Prisma.InvestmentWhereInput = { AND: [where, { status: 'ACTIVE' }] };

    const [rows, total, byHolderRaw, jointAgg] = await Promise.all([
      prisma.investment.findMany({
        where,
        include: investmentInclude,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.investment.count({ where }),
      prisma.investment.groupBy({
        by: ['holderId'],
        where: { AND: [activeWhere, { isJoint: false, holderId: { not: null } }] },
        _sum: { amountCents: true },
      }),
      prisma.investment.aggregate({
        where: { AND: [activeWhere, { isJoint: true }] },
        _sum: { amountCents: true },
      }),
    ]);

    const holderIds = byHolderRaw
      .map((g) => g.holderId)
      .filter((id): id is number => id != null);
    const holders =
      holderIds.length > 0
        ? await prisma.moneyHolder.findMany({
            where: { id: { in: holderIds } },
            select: { id: true, name: true, kind: true },
          })
        : [];
    const holderById = new Map(holders.map((h) => [h.id, h]));
    const byHolder = byHolderRaw
      .flatMap((g) => {
        const holder = g.holderId != null ? holderById.get(g.holderId) : undefined;
        return holder ? [{ holder, totalCents: g._sum.amountCents ?? 0 }] : [];
      })
      .sort((a, b) => a.holder.name.localeCompare(b.holder.name));

    res.json({
      investments: rows.map(serializeInvestment),
      total,
      page: query.page,
      pageSize: query.pageSize,
      sums: {
        byHolder,
        jointCents: jointAgg._sum.amountCents ?? 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- create (manual rows)

investmentsRouter.post('/', validate({ body: CreateInvestmentSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof CreateInvestmentSchema>;
    const ownership = await resolveOwnership(body.holderId ?? null, body.isJoint);
    if (body.unitId != null) await assertUnitExists(body.unitId);
    if (body.expenseId != null) await assertExpenseExists(body.expenseId);

    const investment = await prisma.investment.create({
      data: {
        date: new Date(`${body.date}T00:00:00Z`),
        holderId: ownership.holderId,
        isJoint: ownership.isJoint,
        category: body.category,
        amountCents: body.amountCents,
        note: body.note || null,
        unitId: body.unitId ?? null,
        expenseId: body.expenseId ?? null,
        auto: false,
        source: 'WEB',
        createdById: currentUserId() ?? null,
      },
      include: investmentInclude,
    });

    await audit('CREATE', 'investments', investment.id, undefined, investment);
    res.status(201).json({ investment: serializeInvestment(investment) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- update (manual rows)

investmentsRouter.put(
  '/:id',
  validate({ params: idParam, body: UpdateInvestmentSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as z.infer<typeof UpdateInvestmentSchema>;
      const before = await loadManualRow(id);
      if (before.status === 'VOID') {
        throw conflict('INVESTMENT_VOID', 'Cannot edit a voided investment');
      }

      const isJoint = body.isJoint ?? before.isJoint;
      // Switching to joint clears the holder unless the same request also sets one
      // (which resolveOwnership then rejects as contradictory).
      const holderProvided = body.holderId !== undefined;
      const holderId = holderProvided ? body.holderId ?? null : isJoint ? null : before.holderId;
      const ownership = await resolveOwnership(holderId, isJoint);

      const unitId = body.unitId === undefined ? before.unitId : body.unitId;
      if (unitId != null && unitId !== before.unitId) await assertUnitExists(unitId);
      const expenseId = body.expenseId === undefined ? before.expenseId : body.expenseId;
      if (expenseId != null && expenseId !== before.expenseId) await assertExpenseExists(expenseId);

      const investment = await prisma.investment.update({
        where: { id },
        data: {
          date: body.date !== undefined ? new Date(`${body.date}T00:00:00Z`) : before.date,
          holderId: ownership.holderId,
          isJoint: ownership.isJoint,
          category: body.category ?? before.category,
          amountCents: body.amountCents ?? before.amountCents,
          note: body.note === undefined ? before.note : body.note || null,
          unitId,
          expenseId,
        },
        include: investmentInclude,
      });

      await audit('UPDATE', 'investments', id, before, investment);
      res.json({ investment: serializeInvestment(investment) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- void (manual rows)

investmentsRouter.post(
  '/:id/void',
  validate({ params: idParam, body: VoidSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { reason } = req.body as z.infer<typeof VoidSchema>;
      const before = await loadManualRow(id);
      if (before.status === 'VOID') throw conflict('ALREADY_VOID', 'Investment is already voided');

      const investment = await prisma.investment.update({
        where: { id },
        data: { status: 'VOID' },
        include: investmentInclude,
      });

      // The investments table has no voidReason column — the reason lives in the audit trail.
      await audit('VOID', 'investments', id, before, { ...investment, voidReason: reason });
      res.json({ investment: serializeInvestment(investment) });
    } catch (err) {
      next(err);
    }
  },
);
