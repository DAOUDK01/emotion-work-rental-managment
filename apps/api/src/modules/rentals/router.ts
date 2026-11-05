import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import { notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  CreateRentalSchema,
  IdParam,
  ListRentalsQuery,
  UpdateRentalSchema,
  VoidRentalSchema,
  type CreateRentalBody,
  type ListRentalsQueryT,
  type UpdateRentalBody,
  type VoidRentalBody,
} from './schemas.js';
import {
  createRental,
  generateNextRental,
  rentalDetailInclude,
  rentalInclude,
  serializeRental,
  serializeRentalDetail,
  updateRental,
  voidRental,
} from './service.js';

/**
 * /rentals — one row per rental period. The linked Entry is the financial truth
 * (payment status, "Amount received by", VAT, discounts); rental and entry are
 * always written together inside one transaction (see service.ts).
 * Reads: ADMIN, STAFF, ACCOUNTANT. Writes: ADMIN, STAFF (accountant writes are
 * additionally blocked globally). Rentals are never deleted — POST /:id/void.
 */
export const rentalsRouter = Router();
rentalsRouter.use(requireAuth()); // every signed-in role may read
const requireWriter = requireAuth('ADMIN', 'STAFF');

const toDbDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

/** Full detail shape ({ rental } with entry + attachments + child rentals). */
async function loadRentalDetail(id: number) {
  const rental = await prisma.rental.findUnique({ where: { id }, include: rentalDetailInclude });
  if (!rental) throw notFound('Rental');
  return serializeRentalDetail(rental);
}

// ---------- GET /rentals?status=&paymentStatus=&unitId=&customerId=&from=&to=&q= ----------
rentalsRouter.get('/', validate({ query: ListRentalsQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as ListRentalsQueryT;

    const where: Prisma.RentalWhereInput = {};
    if (query.status) where.status = query.status;
    // paymentStatus / receivedBy / vatInvoice live on the linked entry (financial truth)
    if (query.paymentStatus) where.entry = { is: { paymentStatus: query.paymentStatus } };
    if (query.unitId) where.unitId = query.unitId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.from || query.to) {
      where.startDate = {
        ...(query.from ? { gte: toDbDate(query.from) } : {}),
        ...(query.to ? { lte: toDbDate(query.to) } : {}),
      };
    }
    if (query.q) {
      where.OR = [
        { customerName: { contains: query.q, mode: 'insensitive' } },
        { periodText: { contains: query.q, mode: 'insensitive' } },
        { notes: { contains: query.q, mode: 'insensitive' } },
        { unit: { is: { code: { contains: query.q, mode: 'insensitive' } } } },
        { customer: { is: { name: { contains: query.q, mode: 'insensitive' } } } },
      ];
    }

    const [total, rows] = await prisma.$transaction([
      prisma.rental.count({ where }),
      prisma.rental.findMany({
        where,
        include: rentalInclude,
        orderBy: [{ startDate: 'desc' }, { id: 'desc' }], // newest first
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    res.json({
      rentals: rows.map(serializeRental),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /rentals/:id → { rental } with entry + attachments + child rentals ----------
rentalsRouter.get('/:id', validate({ params: IdParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    res.json({ rental: await loadRentalDetail(id) });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /rentals — transaction: Rental + Entry (+ Payment when PAID) ----------
rentalsRouter.post('/', requireWriter, validate({ body: CreateRentalSchema }), async (req, res, next) => {
  try {
    const body = req.body as CreateRentalBody;
    const id = await createRental(body, 'WEB');
    res.status(201).json({ rental: await loadRentalDetail(id) });
  } catch (err) {
    next(err);
  }
});

// ---------- PUT /rentals/:id — financial changes rewrite the linked entry in place ----------
rentalsRouter.put(
  '/:id',
  requireWriter,
  validate({ params: IdParam, body: UpdateRentalSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as UpdateRentalBody;
      await updateRental(id, body);
      res.json({ rental: await loadRentalDetail(id) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- POST /rentals/:id/generate-next → next period (409 PERIOD_EXISTS guard) ----------
rentalsRouter.post(
  '/:id/generate-next',
  requireWriter,
  validate({ params: IdParam }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const nextId = await generateNextRental(id, 'WEB');
      res.status(201).json({ rental: await loadRentalDetail(nextId) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- POST /rentals/:id/void { reason } — void rental + entry, never hard-delete ----------
rentalsRouter.post(
  '/:id/void',
  requireWriter,
  validate({ params: IdParam, body: VoidRentalSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { reason } = req.body as VoidRentalBody;
      await voidRental(id, reason);
      res.json({ rental: await loadRentalDetail(id) });
    } catch (err) {
      next(err);
    }
  },
);
