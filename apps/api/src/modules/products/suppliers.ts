import { Router } from 'express';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../db.js';
import { conflict, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import {
  CreateSupplierSchema,
  SupplierListQuery,
  UpdateSupplierSchema,
  idParam,
} from './schemas.js';

/**
 * Minimal supplier CRUD, mounted at /products/suppliers.
 * No deletes — suppliers are referenced by products and stock movements;
 * deactivate with `active: false` instead.
 */
export const suppliersRouter = Router();

const readRoles = requireAuth('ADMIN', 'STAFF', 'ACCOUNTANT');
const writeRoles = requireAuth('ADMIN', 'STAFF');

const supplierInclude = {
  _count: { select: { products: true } },
} satisfies Prisma.SupplierInclude;

type SupplierWithCount = Prisma.SupplierGetPayload<{ include: typeof supplierInclude }>;

function serializeSupplier(supplier: SupplierWithCount) {
  const { _count, ...rest } = supplier;
  return { ...rest, productCount: _count.products };
}

/** Unique-name races surface as a stable 409 instead of a raw Prisma error. */
function mapSupplierUnique(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return conflict('DUPLICATE_SUPPLIER', 'A supplier with this name already exists');
  }
  return err;
}

// ---------------------------------------------------------------- list

suppliersRouter.get('/', readRoles, validate({ query: SupplierListQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof SupplierListQuery>;
    const where: Prisma.SupplierWhereInput = {};
    if (query.active !== undefined) where.active = query.active;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { contact: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await Promise.all([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        include: supplierInclude,
        orderBy: { name: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    res.json({
      suppliers: rows.map(serializeSupplier),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- detail

suppliersRouter.get('/:id', readRoles, validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const supplier = await prisma.supplier.findUnique({ where: { id }, include: supplierInclude });
    if (!supplier) throw notFound('Supplier');
    res.json({ supplier: serializeSupplier(supplier) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- create

suppliersRouter.post('/', writeRoles, validate({ body: CreateSupplierSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof CreateSupplierSchema>;
    const clash = await prisma.supplier.findUnique({ where: { name: body.name } });
    if (clash) throw conflict('DUPLICATE_SUPPLIER', `Supplier "${body.name}" already exists`);
    const supplier = await prisma.supplier.create({
      data: {
        name: body.name,
        contact: body.contact || null,
        email: body.email || null,
        notes: body.notes || null,
        active: body.active,
      },
      include: supplierInclude,
    });
    await audit('CREATE', 'suppliers', supplier.id, undefined, supplier);
    res.status(201).json({ supplier: serializeSupplier(supplier) });
  } catch (err) {
    next(mapSupplierUnique(err));
  }
});

// ---------------------------------------------------------------- update

suppliersRouter.put(
  '/:id',
  writeRoles,
  validate({ params: idParam, body: UpdateSupplierSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as z.infer<typeof UpdateSupplierSchema>;
      const before = await prisma.supplier.findUnique({ where: { id } });
      if (!before) throw notFound('Supplier');
      if (body.name !== undefined && body.name !== before.name) {
        const clash = await prisma.supplier.findUnique({ where: { name: body.name } });
        if (clash && clash.id !== id) {
          throw conflict('DUPLICATE_SUPPLIER', `Supplier "${body.name}" already exists`);
        }
      }
      const data: Prisma.SupplierUpdateInput = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.contact !== undefined) data.contact = body.contact || null;
      if (body.email !== undefined) data.email = body.email || null;
      if (body.notes !== undefined) data.notes = body.notes || null;
      if (body.active !== undefined) data.active = body.active;

      const supplier = await prisma.supplier.update({ where: { id }, data, include: supplierInclude });
      await audit('UPDATE', 'suppliers', id, before, supplier);
      res.json({ supplier: serializeSupplier(supplier) });
    } catch (err) {
      next(mapSupplierUnique(err));
    }
  },
);
