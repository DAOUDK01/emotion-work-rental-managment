import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { todayInHelsinki } from '@emotionfix/shared';
import type { z } from 'zod';
import { prisma } from '../../db.js';
import { notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import {
  ArchiveSchema,
  CreateCustomerSchema,
  CustomerIdParam,
  ListCustomersQuery,
  UpdateCustomerSchema,
} from './schemas.js';
import {
  businessIdValidity,
  isoDate,
  isoDateOrNull,
  outstandingByCustomerIds,
  outstandingCentsOf,
  serializeCustomer,
} from './service.js';

/**
 * Customer register (individuals and business customers).
 * Reads: ADMIN, STAFF, ACCOUNTANT. Writes: ADMIN, STAFF (accountant writes are
 * additionally blocked globally). `phone` is GDPR-restricted personal data and
 * is returned to ADMIN only — the serializer strips the field for other roles.
 * Customers are never deleted — they are archived (POST /:id/archive).
 */
export const customersRouter = Router();
customersRouter.use(requireAuth()); // every signed-in role may read
const requireWriter = requireAuth('ADMIN', 'STAFF');

// ---------- GET /customers?q=&type=&archived=&page=&pageSize= ----------
customersRouter.get('/', validate({ query: ListCustomersQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof ListCustomersQuery>;

    const where: Prisma.CustomerWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.archived !== undefined) where.archived = query.archived === 'true';
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
        { businessId: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await prisma.$transaction([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          _count: {
            select: {
              rentals: { where: { status: 'ACTIVE' } }, // voided rentals don't count
              invoices: true, // cancelled invoices remain real documents and stay counted
            },
          },
        },
      }),
    ]);
    const outstanding = await outstandingByCustomerIds(rows.map((c) => c.id));

    res.json({
      customers: rows.map((row) => {
        const { _count, ...customer } = row;
        return {
          ...serializeCustomer(customer, req.user?.role),
          outstandingCents: outstanding.get(customer.id) ?? 0,
          rentalCount: _count.rentals,
          invoiceCount: _count.invoices,
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /customers/:id → customer + last 20 rentals/invoices/entries ----------
customersRouter.get('/:id', validate({ params: CustomerIdParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };

    const [customer, outstandingCents] = await Promise.all([
      prisma.customer.findUnique({
        where: { id },
        include: {
          rentals: {
            orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
            take: 20,
            select: {
              id: true,
              unit: { select: { id: true, code: true, brand: true } },
              handOverDate: true,
              startDate: true,
              endDate: true,
              periodText: true,
              amountCents: true,
              depositCents: true,
              recurring: true,
              agreementSigned: true,
              notes: true,
              status: true,
              entry: { select: { id: true, paymentStatus: true, vatInvoice: true } },
            },
          },
          invoices: {
            orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
            take: 20,
            select: {
              id: true,
              number: true,
              numberFormatted: true,
              issueDate: true,
              dueDate: true,
              status: true,
              referenceNumber: true,
              totalGrossCents: true,
              totalVatCents: true,
              totalNetCents: true,
              paidCents: true,
            },
          },
          entries: {
            orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
            take: 20,
            select: {
              id: true,
              entryDate: true,
              model: { select: { id: true, code: true, nameEn: true, nameFi: true } },
              unit: { select: { id: true, code: true, brand: true } },
              description: true,
              grossCents: true,
              discountCents: true,
              vatInvoice: true,
              vatRateBp: true,
              vatCents: true,
              netCents: true,
              paymentStatus: true,
              status: true,
              source: true,
            },
          },
        },
      }),
      outstandingCentsOf(id),
    ]);
    if (!customer) throw notFound('Customer');

    const { rentals, invoices, entries, ...plain } = customer;
    const today = todayInHelsinki();
    res.json({
      customer: serializeCustomer(plain, req.user?.role),
      rentals: rentals.map((r) => ({
        ...r,
        handOverDate: isoDateOrNull(r.handOverDate),
        startDate: isoDate(r.startDate),
        endDate: isoDateOrNull(r.endDate),
      })),
      invoices: invoices.map((inv) => {
        const dueDate = isoDate(inv.dueDate);
        return {
          ...inv,
          issueDate: isoDate(inv.issueDate),
          dueDate,
          // OVERDUE is derived, never stored (conventions)
          overdue: (inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID') && dueDate < today,
        };
      }),
      entries: entries.map((e) => ({ ...e, entryDate: isoDate(e.entryDate) })),
      outstandingCents,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- POST /customers ----------
customersRouter.post('/', requireWriter, validate({ body: CreateCustomerSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof CreateCustomerSchema>;
    const customer = await prisma.customer.create({ data: body });
    await audit('CREATE', 'customers', customer.id, undefined, customer);
    res.status(201).json({
      customer: serializeCustomer(customer, req.user?.role),
      // warn-level: present only for BUSINESS customers with a businessId
      // (undefined is dropped from the JSON for everyone else)
      businessIdValid: businessIdValidity(customer.type, customer.businessId),
    });
  } catch (err) {
    next(err);
  }
});

// ---------- PUT /customers/:id ----------
customersRouter.put(
  '/:id',
  requireWriter,
  validate({ params: CustomerIdParam, body: UpdateCustomerSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as z.infer<typeof UpdateCustomerSchema>;
      const before = await prisma.customer.findUnique({ where: { id } });
      if (!before) throw notFound('Customer');
      const customer = await prisma.customer.update({ where: { id }, data: body });
      await audit('UPDATE', 'customers', id, before, customer);
      res.json({
        customer: serializeCustomer(customer, req.user?.role),
        businessIdValid: businessIdValidity(customer.type, customer.businessId),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- POST /customers/:id/archive { archived } ----------
customersRouter.post(
  '/:id/archive',
  requireWriter,
  validate({ params: CustomerIdParam, body: ArchiveSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { archived } = req.body as z.infer<typeof ArchiveSchema>;
      const before = await prisma.customer.findUnique({ where: { id } });
      if (!before) throw notFound('Customer');
      const customer = await prisma.customer.update({ where: { id }, data: { archived } });
      await audit('UPDATE', 'customers', id, before, customer);
      res.json({ customer: serializeCustomer(customer, req.user?.role) });
    } catch (err) {
      next(err);
    }
  },
);
