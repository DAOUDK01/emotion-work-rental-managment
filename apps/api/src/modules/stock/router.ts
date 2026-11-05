import { Router } from 'express';
import type { Prisma, Product } from '@prisma/client';
import type { z } from 'zod';
import { addDays, roundHalfAwayFromZero } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { currentUserId } from '../../context.js';
import { badRequest } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import {
  movementInclude,
  productInclude,
  serializeProduct,
  stockQtyMap,
  type SerializedProduct,
} from '../products/service.js';
import { AdjustSchema, MovementListQuery, ReceiveSchema, RepairUseSchema } from './schemas.js';

/**
 * Stock on hand is NEVER stored — it is always Σ StockMovement.qty per product.
 * This module writes movements (goods receiving with landed cost, counted
 * adjustments, parts used in repairs) and reports on them (movement log,
 * low-stock list, stock valuation). Movements are append-only: corrections
 * are new opposite movements, never edits.
 */
export const stockRouter = Router();

const readRoles = requireAuth('ADMIN', 'STAFF', 'ACCOUNTANT');
const writeRoles = requireAuth('ADMIN', 'STAFF');

async function getTrackedProduct(productId: number): Promise<Product> {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw badRequest('BAD_PRODUCT', 'Product not found');
  if (!product.trackStock) {
    throw badRequest('NOT_STOCK_TRACKED', 'This product does not track stock (service item)');
  }
  return product;
}

async function serializedProductWithQty(productId: number): Promise<SerializedProduct> {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    include: productInclude,
  });
  const qty = (await stockQtyMap(prisma, [productId])).get(productId) ?? 0;
  return serializeProduct(product, qty);
}

/**
 * Landed per-unit cost of a goods receipt:
 * (qty × unitCost + shipping + customs + import VAT) / qty, rounded half away
 * from zero. Null when no cost information was given at all.
 */
function landedUnitCostCents(input: {
  qty: number;
  unitCostCents?: number | null;
  shippingCents?: number | null;
  customsCents?: number | null;
  importVatCents?: number | null;
}): number | null {
  const extrasCents =
    (input.shippingCents ?? 0) + (input.customsCents ?? 0) + (input.importVatCents ?? 0);
  if (input.unitCostCents == null && extrasCents === 0) return null;
  return roundHalfAwayFromZero((input.qty * (input.unitCostCents ?? 0) + extrasCents) / input.qty);
}

// ---------------------------------------------------------------- receive (goods in)

stockRouter.post('/receive', writeRoles, validate({ body: ReceiveSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof ReceiveSchema>;
    const product = await getTrackedProduct(body.productId);
    if (body.supplierId != null) {
      const supplier = await prisma.supplier.findUnique({ where: { id: body.supplierId } });
      if (!supplier) throw badRequest('BAD_SUPPLIER', 'Supplier not found');
    }
    const landedCents = landedUnitCostCents(body);

    const movement = await prisma.$transaction(async (tx) => {
      const created = await tx.stockMovement.create({
        data: {
          productId: body.productId,
          type: 'PURCHASE',
          qty: body.qty,
          unitCostCents: landedCents,
          shippingCents: body.shippingCents ?? null,
          customsCents: body.customsCents ?? null,
          importVatCents: body.importVatCents ?? null,
          supplierId: body.supplierId ?? null,
          notes: body.notes || null,
          createdById: currentUserId() ?? null,
        },
        include: movementInclude,
      });
      if (landedCents != null && landedCents !== product.costCents) {
        await tx.product.update({ where: { id: body.productId }, data: { costCents: landedCents } });
      }
      return created;
    });

    await audit('CREATE', 'stock_movements', movement.id, undefined, movement);
    if (landedCents != null && landedCents !== product.costCents) {
      await audit(
        'UPDATE',
        'products',
        product.id,
        { costCents: product.costCents },
        { costCents: landedCents },
      );
    }
    res.status(201).json({ movement, product: await serializedProductWithQty(body.productId) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- adjust (counted correction)

stockRouter.post('/adjust', writeRoles, validate({ body: AdjustSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof AdjustSchema>;
    const reason = body.reason?.trim();
    if (!reason) throw badRequest('REASON_REQUIRED', 'A reason is required for stock adjustments');
    await getTrackedProduct(body.productId);

    const movement = await prisma.stockMovement.create({
      data: {
        productId: body.productId,
        type: 'ADJUSTMENT',
        qty: body.qty,
        reason,
        notes: body.notes || null,
        createdById: currentUserId() ?? null,
      },
      include: movementInclude,
    });
    await audit('CREATE', 'stock_movements', movement.id, undefined, movement);
    res.status(201).json({ movement, product: await serializedProductWithQty(body.productId) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- repair use (parts into a unit)

stockRouter.post('/repair-use', writeRoles, validate({ body: RepairUseSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof RepairUseSchema>;
    const product = await getTrackedProduct(body.productId);
    if (body.unitId != null) {
      const unit = await prisma.unit.findUnique({ where: { id: body.unitId } });
      if (!unit) throw badRequest('BAD_UNIT', 'Unit not found');
    }

    const movement = await prisma.stockMovement.create({
      data: {
        productId: body.productId,
        type: 'REPAIR_USE',
        qty: -body.qty,
        // Cost snapshot at the time of use — unit payback subtracts |qty| × this.
        unitCostCents: product.costCents ?? null,
        unitId: body.unitId ?? null,
        notes: body.notes || null,
        createdById: currentUserId() ?? null,
      },
      include: movementInclude,
    });
    await audit('CREATE', 'stock_movements', movement.id, undefined, movement);
    res.status(201).json({ movement, product: await serializedProductWithQty(body.productId) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- movement log

stockRouter.get('/movements', readRoles, validate({ query: MovementListQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof MovementListQuery>;
    const where: Prisma.StockMovementWhereInput = {};
    if (query.productId !== undefined) where.productId = query.productId;
    if (query.type !== undefined) where.type = query.type;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to ? { lt: new Date(`${addDays(query.to, 1)}T00:00:00Z`) } : {}),
      };
    }
    const [total, movements] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        include: movementInclude,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    res.json({ movements, total, page: query.page, pageSize: query.pageSize });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- low stock

stockRouter.get('/low', readRoles, async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { trackStock: true, active: true },
      include: productInclude,
      orderBy: { nameEn: 'asc' },
    });
    const qtys = await stockQtyMap(
      prisma,
      products.map((p) => p.id),
    );
    const low = products
      .map((p) => serializeProduct(p, qtys.get(p.id) ?? 0))
      .filter((p) => p.lowStock);
    // Most critical first: largest shortfall below the reorder level on top.
    low.sort((a, b) => (a.stockQty ?? 0) - a.reorderLevel - ((b.stockQty ?? 0) - b.reorderLevel));
    res.json({ products: low, total: low.length });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- stock valuation

stockRouter.get('/value', readRoles, async (_req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: { trackStock: true },
      select: { id: true, category: true, costCents: true },
    });
    const qtys = await stockQtyMap(
      prisma,
      products.map((p) => p.id),
    );

    interface CategoryRow {
      category: string;
      productCount: number;
      qty: number;
      valueCents: number;
    }
    const byCat = new Map<string, CategoryRow>();
    let totalCents = 0;
    for (const p of products) {
      const qty = qtys.get(p.id) ?? 0;
      if (qty === 0) continue;
      const valueCents = qty * (p.costCents ?? 0);
      totalCents += valueCents;
      const key = p.category?.trim() || 'Uncategorised';
      const row = byCat.get(key) ?? { category: key, productCount: 0, qty: 0, valueCents: 0 };
      row.productCount += 1;
      row.qty += qty;
      row.valueCents += valueCents;
      byCat.set(key, row);
    }
    const byCategory = [...byCat.values()].sort(
      (a, b) => b.valueCents - a.valueCents || a.category.localeCompare(b.category),
    );
    res.json({ totalCents, byCategory });
  } catch (err) {
    next(err);
  }
});
