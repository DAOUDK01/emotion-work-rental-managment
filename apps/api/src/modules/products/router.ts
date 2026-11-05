import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { internalProductCode, parseInternalProductCode, todayInHelsinki } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { vatRateOn } from '../../services/entries.js';
import {
  BarcodeInput,
  CreateProductSchema,
  LabelQuery,
  ProductListQuery,
  UpdateProductSchema,
  barcodeParams,
  codeParam,
  idParam,
} from './schemas.js';
import {
  assertBarcodesAvailable,
  assertSupplierUsable,
  createProduct,
  getProductOrThrow,
  movementInclude,
  normalizeBarcodes,
  productInclude,
  serializeProduct,
  stockQtyMap,
  updateProduct,
  withUniqueRetry,
} from './service.js';
import { buildLabelsPdf } from './pdf.js';
import { suppliersRouter } from './suppliers.js';

/**
 * Product catalogue (spare parts, accessories and labour/service items),
 * barcodes (scan lookup + Code128 label sheets) and suppliers.
 * Stock quantities are always computed from movements — see ./service.ts.
 */
export const productsRouter = Router();

const readRoles = requireAuth('ADMIN', 'STAFF', 'ACCOUNTANT');
const writeRoles = requireAuth('ADMIN', 'STAFF');

// Static /suppliers prefix must be registered before the /:id routes.
productsRouter.use('/suppliers', suppliersRouter);

// ---------------------------------------------------------------- list

productsRouter.get('/', readRoles, validate({ query: ProductListQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof ProductListQuery>;
    const where: Prisma.ProductWhereInput = {};
    if (query.active !== undefined) where.active = query.active;
    if (query.category) where.category = { equals: query.category, mode: 'insensitive' };
    if (query.q) {
      where.OR = [
        { sku: { contains: query.q, mode: 'insensitive' } },
        { nameEn: { contains: query.q, mode: 'insensitive' } },
        { nameFi: { contains: query.q, mode: 'insensitive' } },
        { brand: { contains: query.q, mode: 'insensitive' } },
        { compatibleUnits: { contains: query.q, mode: 'insensitive' } },
        { barcodes: { some: { barcode: { contains: query.q, mode: 'insensitive' } } } },
      ];
    }

    if (query.lowStock !== undefined) {
      // lowStock is computed from movements, so filter + paginate in memory
      // (still a single groupBy over the candidates — no N+1).
      const candidates = await prisma.product.findMany({
        where: { ...where, ...(query.lowStock ? { trackStock: true } : {}) },
        include: productInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const qtys = await stockQtyMap(
        prisma,
        candidates.map((p) => p.id),
      );
      const filtered = candidates
        .map((p) => serializeProduct(p, qtys.get(p.id) ?? 0))
        .filter((p) => p.lowStock === query.lowStock);
      const start = (query.page - 1) * query.pageSize;
      res.json({
        products: filtered.slice(start, start + query.pageSize),
        total: filtered.length,
        page: query.page,
        pageSize: query.pageSize,
      });
      return;
    }

    const [total, rows] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include: productInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const qtys = await stockQtyMap(
      prisma,
      rows.map((p) => p.id),
    );
    res.json({
      products: rows.map((p) => serializeProduct(p, qtys.get(p.id) ?? 0)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- barcode scan lookup

productsRouter.get('/barcode/:code', readRoles, validate({ params: codeParam }), async (req, res, next) => {
  try {
    const { code } = req.params as unknown as { code: string };
    const match = await prisma.productBarcode.findUnique({
      where: { barcode: code },
      select: { productId: true },
    });
    let productId = match?.productId ?? null;
    if (productId === null) productId = parseInternalProductCode(code);
    const product =
      productId === null
        ? null
        : await prisma.product.findUnique({ where: { id: productId }, include: productInclude });
    if (!product) throw new AppError(404, 'UNKNOWN_BARCODE', `No product matches "${code}"`);
    const qty = (await stockQtyMap(prisma, [product.id])).get(product.id) ?? 0;
    res.json({ product: serializeProduct(product, qty) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- label PDF

productsRouter.get(
  '/:id/label',
  readRoles,
  validate({ params: idParam, query: LabelQuery }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { qty } = req.query as unknown as z.infer<typeof LabelQuery>;
      const product = await getProductOrThrow(id);
      const barcodeText = product.barcodes[0]?.barcode ?? internalProductCode(product.id);
      const pdf = await buildLabelsPdf({
        sku: product.sku,
        name: product.nameEn,
        priceCents: product.priceCents,
        barcodeText,
        qty,
      });
      const safeSku = product.sku.replace(/[^A-Za-z0-9._-]+/g, '_');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="labels-${safeSku}.pdf"`);
      res.send(pdf);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- barcode management

productsRouter.post(
  '/:id/barcodes',
  writeRoles,
  validate({ params: idParam, body: BarcodeInput }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as z.infer<typeof BarcodeInput>;
      await getProductOrThrow(id);
      const [normalized] = normalizeBarcodes([body]);
      await assertBarcodesAvailable(prisma, [normalized.barcode]);
      const barcode = await withUniqueRetry(false, () =>
        prisma.productBarcode.create({
          data: { productId: id, barcode: normalized.barcode, type: normalized.type },
        }),
      );
      await audit('CREATE', 'product_barcodes', barcode.id, undefined, barcode);
      res.status(201).json({ barcode });
    } catch (err) {
      next(err);
    }
  },
);

productsRouter.delete(
  '/:id/barcodes/:barcodeId',
  writeRoles,
  validate({ params: barcodeParams }),
  async (req, res, next) => {
    try {
      const { id, barcodeId } = req.params as unknown as { id: number; barcodeId: number };
      const row = await prisma.productBarcode.findUnique({ where: { id: barcodeId } });
      if (!row || row.productId !== id) throw notFound('Barcode');
      await prisma.productBarcode.delete({ where: { id: barcodeId } });
      await audit('DELETE', 'product_barcodes', barcodeId, row);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- detail

productsRouter.get('/:id', readRoles, validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const product = await getProductOrThrow(id);
    const [qtys, movements] = await Promise.all([
      stockQtyMap(prisma, [id]),
      prisma.stockMovement.findMany({
        where: { productId: id },
        include: movementInclude,
        orderBy: { id: 'desc' },
        take: 50,
      }),
    ]);
    res.json({ product: serializeProduct(product, qtys.get(id) ?? 0), movements });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- create

productsRouter.post('/', writeRoles, validate({ body: CreateProductSchema }), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof CreateProductSchema>;
    if (body.supplierId != null) await assertSupplierUsable(prisma, body.supplierId);
    const vatRateBp = body.vatRateBp ?? (await vatRateOn(todayInHelsinki()));

    const { product, movement } = await createProduct(body, vatRateBp);
    await audit('CREATE', 'products', product.id, undefined, product);
    if (movement) await audit('CREATE', 'stock_movements', movement.id, undefined, movement);

    res.status(201).json({ product: serializeProduct(product, movement?.qty ?? 0) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- update

productsRouter.put(
  '/:id',
  writeRoles,
  validate({ params: idParam, body: UpdateProductSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as z.infer<typeof UpdateProductSchema>;
      const before = await getProductOrThrow(id);
      if (body.supplierId != null && body.supplierId !== before.supplierId) {
        await assertSupplierUsable(prisma, body.supplierId);
      }

      const product = await updateProduct(before, body);
      await audit('UPDATE', 'products', id, before, product);

      const qty = (await stockQtyMap(prisma, [id])).get(id) ?? 0;
      res.json({ product: serializeProduct(product, qty) });
    } catch (err) {
      next(err);
    }
  },
);
