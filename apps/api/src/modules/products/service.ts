import { Prisma } from '@prisma/client';
import type { BarcodeType, PrismaClient, StockMovement } from '@prisma/client';
import { isValidEan13 } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { currentUserId } from '../../context.js';
import { AppError, badRequest, conflict, notFound } from '../../errors.js';
import type { BarcodeInputValue, CreateProductInput, UpdateProductInput } from './schemas.js';

/**
 * Product catalogue rules:
 *  - stock on hand is NEVER stored: it is Σ StockMovement.qty, aggregated with one
 *    groupBy per request (no N+1); services (trackStock=false) report stockQty null
 *    and are excluded from valuation and low-stock
 *  - SKUs auto-generate as "P-" + zero-padded number (max existing numeric suffix + 1)
 *  - barcodes are globally unique; 13-digit codes must pass the EAN-13 checksum
 *    unless explicitly declared CODE128/OTHER (free-form)
 */

export type Db = Prisma.TransactionClient | PrismaClient;

// ---------------------------------------------------------------- includes & serialisation

export const productInclude = {
  supplier: { select: { id: true, name: true, active: true } },
  barcodes: { select: { id: true, barcode: true, type: true }, orderBy: { id: 'asc' } },
} satisfies Prisma.ProductInclude;

export type ProductWithRefs = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export const movementInclude = {
  product: { select: { id: true, sku: true, nameEn: true, trackStock: true } },
  supplier: { select: { id: true, name: true } },
  unit: { select: { id: true, code: true, brand: true } },
  saleLine: { select: { id: true, saleId: true } },
  expense: { select: { id: true, description: true } },
  creditNote: { select: { id: true, numberFormatted: true } },
} satisfies Prisma.StockMovementInclude;

export type MovementWithRefs = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

/**
 * Serialise a product with its computed stock block. `rawQty` is the summed
 * movement quantity; services get stockQty/stockValueCents null and never flag low.
 */
export function serializeProduct(product: ProductWithRefs, rawQty: number) {
  return {
    ...product,
    stockQty: product.trackStock ? rawQty : null,
    stockValueCents: product.trackStock ? rawQty * (product.costCents ?? 0) : null,
    lowStock: product.trackStock ? rawQty <= product.reorderLevel : false,
  };
}

export type SerializedProduct = ReturnType<typeof serializeProduct>;

// ---------------------------------------------------------------- stock on hand

/** Σ StockMovement.qty per product — ONE groupBy query for any number of products. */
export async function stockQtyMap(db: Db, productIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (productIds.length === 0) return map;
  const grouped = await db.stockMovement.groupBy({
    by: ['productId'],
    where: { productId: { in: productIds } },
    _sum: { qty: true },
  });
  for (const row of grouped) map.set(row.productId, row._sum.qty ?? 0);
  return map;
}

// ---------------------------------------------------------------- lookups & assertions

export async function getProductOrThrow(id: number): Promise<ProductWithRefs> {
  const product = await prisma.product.findUnique({ where: { id }, include: productInclude });
  if (!product) throw notFound('Product');
  return product;
}

export async function assertSupplierUsable(db: Db, supplierId: number): Promise<void> {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || !supplier.active) {
    throw badRequest('BAD_SUPPLIER', 'Supplier not found or inactive');
  }
}

// ---------------------------------------------------------------- SKU generation

const SKU_RE = /^P-(\d+)$/;

/** Next auto SKU: "P-" + 6-digit zero-padded (max existing numeric suffix + 1). */
export async function generateSku(db: Db): Promise<string> {
  const rows = await db.product.findMany({
    where: { sku: { startsWith: 'P-' } },
    select: { sku: true },
  });
  let max = 0;
  for (const row of rows) {
    const match = SKU_RE.exec(row.sku);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isSafeInteger(n)) max = Math.max(max, n);
  }
  return `P-${String(max + 1).padStart(6, '0')}`;
}

// ---------------------------------------------------------------- barcode rules

export interface NormalizedBarcode {
  barcode: string;
  type: BarcodeType;
}

/**
 * Validate and type a batch of barcodes:
 *  - explicit EAN13, or an untyped 13-digit code, must pass the checksum (400 BAD_EAN13)
 *  - explicit CODE128 / OTHER are free-form
 *  - the same code twice in one request is a 409 DUPLICATE_BARCODE
 */
export function normalizeBarcodes(inputs: BarcodeInputValue[]): NormalizedBarcode[] {
  const out: NormalizedBarcode[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    const barcode = input.barcode.trim();
    if (seen.has(barcode)) {
      throw new AppError(409, 'DUPLICATE_BARCODE', `Barcode "${barcode}" appears twice in the request`, {
        conflicts: [{ barcode, product: null }],
      });
    }
    seen.add(barcode);
    let type: BarcodeType;
    if (input.type === 'EAN13' || (input.type === undefined && /^\d{13}$/.test(barcode))) {
      if (!isValidEan13(barcode)) {
        throw badRequest('BAD_EAN13', `"${barcode}" is not a valid EAN-13 barcode (checksum failed)`);
      }
      type = 'EAN13';
    } else {
      type = input.type ?? 'OTHER';
    }
    out.push({ barcode, type });
  }
  return out;
}

/** Barcodes are globally unique — 409 DUPLICATE_BARCODE names the product that owns the clash. */
export async function assertBarcodesAvailable(
  db: Db,
  codes: string[],
  excludeProductId?: number,
): Promise<void> {
  if (codes.length === 0) return;
  const clashes = await db.productBarcode.findMany({
    where: {
      barcode: { in: codes },
      ...(excludeProductId !== undefined ? { productId: { not: excludeProductId } } : {}),
    },
    include: { product: { select: { id: true, sku: true, nameEn: true } } },
  });
  if (clashes.length > 0) {
    const first = clashes[0];
    throw new AppError(
      409,
      'DUPLICATE_BARCODE',
      `Barcode "${first.barcode}" already belongs to ${first.product.sku} — ${first.product.nameEn}`,
      { conflicts: clashes.map((c) => ({ barcode: c.barcode, type: c.type, product: c.product })) },
    );
  }
}

// ---------------------------------------------------------------- unique-violation mapping

function uniqueTarget(err: unknown): string | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return null;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.map(String).join(',');
  return typeof target === 'string' ? target : 'unknown';
}

/**
 * Run `fn`, translating unique-constraint races into stable API errors.
 * When the SKU was auto-generated, a sku collision (concurrent creates) retries
 * up to 3 times with a freshly generated number.
 */
export async function withUniqueRetry<T>(autoSku: boolean, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const target = uniqueTarget(err);
      if (target === null) throw err;
      if (target.includes('sku')) {
        if (autoSku && attempt < 3) continue;
        throw conflict('DUPLICATE_SKU', 'SKU is already in use');
      }
      if (target.includes('barcode')) {
        throw new AppError(409, 'DUPLICATE_BARCODE', 'Barcode is already in use by another product');
      }
      throw conflict('DUPLICATE', 'Unique constraint violated');
    }
  }
}

// ---------------------------------------------------------------- create / update

export interface CreateProductResult {
  product: ProductWithRefs;
  movement: StockMovement | null;
}

export async function createProduct(
  input: CreateProductInput,
  vatRateBp: number,
): Promise<CreateProductResult> {
  const initialStock = input.initialStock ?? 0;
  if (initialStock > 0 && !input.trackStock) {
    throw badRequest('NOT_STOCK_TRACKED', 'Opening stock needs a stock-tracked product');
  }
  const barcodes = normalizeBarcodes(input.barcodes ?? []);

  return withUniqueRetry(input.sku == null, () =>
    prisma.$transaction(async (tx) => {
      const sku = input.sku ?? (await generateSku(tx));
      if (input.sku != null) {
        const clash = await tx.product.findUnique({ where: { sku }, select: { id: true } });
        if (clash) throw conflict('DUPLICATE_SKU', `SKU "${sku}" is already in use`);
      }
      await assertBarcodesAvailable(
        tx,
        barcodes.map((b) => b.barcode),
      );

      const created = await tx.product.create({
        data: {
          sku,
          nameEn: input.nameEn,
          nameFi: input.nameFi || null,
          category: input.category || null,
          brand: input.brand || null,
          compatibleUnits: input.compatibleUnits || null,
          costCents: input.costCents ?? null,
          priceCents: input.priceCents,
          wholesaleCents: input.wholesaleCents ?? null,
          vatRateBp,
          trackStock: input.trackStock,
          reorderLevel: input.reorderLevel,
          location: input.location || null,
          supplierId: input.supplierId ?? null,
          active: input.active,
        },
      });

      if (barcodes.length > 0) {
        await tx.productBarcode.createMany({
          data: barcodes.map((b) => ({ productId: created.id, barcode: b.barcode, type: b.type })),
        });
      }

      let movement: StockMovement | null = null;
      if (initialStock > 0) {
        movement = await tx.stockMovement.create({
          data: {
            productId: created.id,
            type: 'IMPORT',
            qty: initialStock,
            unitCostCents: input.costCents ?? null,
            notes: 'Opening stock',
            createdById: currentUserId() ?? null,
          },
        });
      }

      const product = await tx.product.findUniqueOrThrow({
        where: { id: created.id },
        include: productInclude,
      });
      return { product, movement };
    }),
  );
}

export async function updateProduct(
  before: ProductWithRefs,
  input: UpdateProductInput,
): Promise<ProductWithRefs> {
  const barcodes = input.barcodes === undefined ? null : normalizeBarcodes(input.barcodes);

  return withUniqueRetry(false, () =>
    prisma.$transaction(async (tx) => {
      if (input.sku !== undefined && input.sku !== before.sku) {
        const clash = await tx.product.findUnique({ where: { sku: input.sku }, select: { id: true } });
        if (clash && clash.id !== before.id) {
          throw conflict('DUPLICATE_SKU', `SKU "${input.sku}" is already in use`);
        }
      }
      if (barcodes) {
        await assertBarcodesAvailable(
          tx,
          barcodes.map((b) => b.barcode),
          before.id,
        );
      }

      const data: Prisma.ProductUncheckedUpdateInput = {};
      if (input.sku !== undefined) data.sku = input.sku;
      if (input.nameEn !== undefined) data.nameEn = input.nameEn;
      if (input.nameFi !== undefined) data.nameFi = input.nameFi || null;
      if (input.category !== undefined) data.category = input.category || null;
      if (input.brand !== undefined) data.brand = input.brand || null;
      if (input.compatibleUnits !== undefined) data.compatibleUnits = input.compatibleUnits || null;
      if (input.costCents !== undefined) data.costCents = input.costCents ?? null;
      if (input.priceCents !== undefined) data.priceCents = input.priceCents;
      if (input.wholesaleCents !== undefined) data.wholesaleCents = input.wholesaleCents ?? null;
      if (input.vatRateBp !== undefined) data.vatRateBp = input.vatRateBp;
      if (input.trackStock !== undefined) data.trackStock = input.trackStock;
      if (input.reorderLevel !== undefined) data.reorderLevel = input.reorderLevel;
      if (input.location !== undefined) data.location = input.location || null;
      if (input.supplierId !== undefined) data.supplierId = input.supplierId ?? null;
      if (input.active !== undefined) data.active = input.active;

      await tx.product.update({ where: { id: before.id }, data });

      if (barcodes) {
        await tx.productBarcode.deleteMany({ where: { productId: before.id } });
        if (barcodes.length > 0) {
          await tx.productBarcode.createMany({
            data: barcodes.map((b) => ({ productId: before.id, barcode: b.barcode, type: b.type })),
          });
        }
      }

      return tx.product.findUniqueOrThrow({ where: { id: before.id }, include: productInclude });
    }),
  );
}
