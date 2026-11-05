import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../db.js';
import { AppError, badRequest, conflict, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { currentUserId } from '../../context.js';
import {
  CreateHandoverSchema,
  HandoverListQuerySchema,
  IdParamSchema,
  LedgerQuerySchema,
  VoidSchema,
} from './schemas.js';
import {
  buildLedger,
  computeBalances,
  currentHoldingCents,
  handoverInclude,
  serializeHandover,
} from './service.js';

/**
 * /cash — "Cash & settlements": who is holding how much of the company's money,
 * the merged receipt/handover ledger, and the handovers that settle balances.
 * Admin only; accountants get read access (their writes are blocked globally too).
 * Staff must not see the cash ledger at all.
 */
export const cashRouter = Router();
cashRouter.use(requireAuth('ADMIN', 'ACCOUNTANT'));

// ---------- GET /cash/balances ----------
cashRouter.get('/balances', async (_req, res, next) => {
  try {
    const { balances, alertAfterDays } = await computeBalances();
    res.json({ balances, alertAfterDays });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /cash/ledger?holderId=&from=&to= ----------
cashRouter.get('/ledger', validate({ query: LedgerQuerySchema }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof LedgerQuerySchema>;
    if (q.holderId !== undefined) {
      const holder = await prisma.moneyHolder.findUnique({ where: { id: q.holderId } });
      if (!holder) throw notFound('Money holder');
    }
    const allRows = await buildLedger({ holderId: q.holderId, from: q.from, to: q.to });
    const start = (q.page - 1) * q.pageSize;
    res.json({
      rows: allRows.slice(start, start + q.pageSize),
      total: allRows.length,
      page: q.page,
      pageSize: q.pageSize,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /cash/handovers ----------
cashRouter.get('/handovers', validate({ query: HandoverListQuerySchema }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof HandoverListQuerySchema>;
    const date: { gte?: Date; lte?: Date } = {};
    if (q.from) date.gte = new Date(`${q.from}T00:00:00Z`);
    if (q.to) date.lte = new Date(`${q.to}T00:00:00Z`);
    const where: Prisma.CashHandoverWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.holderId !== undefined
        ? { OR: [{ fromHolderId: q.holderId }, { toHolderId: q.holderId }] }
        : {}),
      ...(q.fromHolderId !== undefined ? { fromHolderId: q.fromHolderId } : {}),
      ...(q.toHolderId !== undefined ? { toHolderId: q.toHolderId } : {}),
      ...(q.from || q.to ? { date } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.cashHandover.findMany({
        where,
        include: handoverInclude,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.cashHandover.count({ where }),
    ]);
    res.json({ handovers: rows.map(serializeHandover), total, page: q.page, pageSize: q.pageSize });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /cash/handovers ----------
cashRouter.post(
  '/handovers',
  requireAuth('ADMIN'),
  validate({ body: CreateHandoverSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof CreateHandoverSchema>;
      if (body.fromHolderId === body.toHolderId) {
        throw badRequest('SAME_HOLDER', 'Cannot hand over money from a holder to itself');
      }
      const [fromHolder, toHolder] = await Promise.all([
        prisma.moneyHolder.findUnique({ where: { id: body.fromHolderId } }),
        prisma.moneyHolder.findUnique({ where: { id: body.toHolderId } }),
      ]);
      if (!fromHolder) throw badRequest('BAD_HOLDER', 'From-holder not found');
      if (!toHolder) throw badRequest('BAD_HOLDER', 'To-holder not found');

      const holdingCents = await currentHoldingCents(fromHolder);
      if (body.amountCents > holdingCents && body.force !== true) {
        throw new AppError(
          409,
          'OVERDRAWN',
          `${fromHolder.name} is only holding ${holdingCents} cents — handing over more needs force`,
          { holdingCents },
        );
      }

      const handover = await prisma.cashHandover.create({
        data: {
          date: new Date(`${body.date}T00:00:00Z`),
          fromHolderId: body.fromHolderId,
          toHolderId: body.toHolderId,
          amountCents: body.amountCents,
          note: body.note ?? null,
          createdById: currentUserId() ?? null,
        },
        include: handoverInclude,
      });
      const serialized = serializeHandover(handover);
      await audit('HANDOVER', 'cash_handovers', handover.id, undefined, serialized);

      const { balances } = await computeBalances();
      res.status(201).json({ handover: serialized, balances });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- POST /cash/handovers/:id/void ----------
cashRouter.post(
  '/handovers/:id/void',
  requireAuth('ADMIN'),
  validate({ params: IdParamSchema, body: VoidSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { reason } = req.body as z.infer<typeof VoidSchema>;
      const before = await prisma.cashHandover.findUnique({ where: { id }, include: handoverInclude });
      if (!before) throw notFound('Handover');
      if (before.status === 'VOID') throw conflict('ALREADY_VOID', 'Handover is already void');

      // Financial rows are never hard-deleted: VOID restores both holders' balances.
      const handover = await prisma.cashHandover.update({
        where: { id },
        data: { status: 'VOID' },
        include: handoverInclude,
      });
      const serialized = serializeHandover(handover);
      await audit('VOID', 'cash_handovers', id, serializeHandover(before), {
        ...serialized,
        voidReason: reason,
      });
      res.json({ handover: serialized });
    } catch (err) {
      next(err);
    }
  },
);
