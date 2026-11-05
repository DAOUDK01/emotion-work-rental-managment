import type { Prisma } from '@prisma/client';
import { roundHalfAwayFromZero, todayInHelsinki, type ISODate } from '@emotionfix/shared';
import { nextNumber, prisma } from '../../db.js';
import { currentUserId, requestContext } from '../../context.js';
import { AppError, badRequest, conflict, notFound } from '../../errors.js';
import { audit } from '../../services/audit.js';
import { vatRateOn, type Tx } from '../../services/entries.js';
import type { AddLineBody, CreateSaleBody, ListSalesQuery, UpdateLineBody, UpdateSaleBody } from './schemas.js';
import {
  computeLineAmounts,
  distributeCartDiscount,
  vatByRate,
  type SaleTotals,
} from './totals.js';

/**
 * POS sales: PARKED (editable cart) → COMPLETED (money + stock + Entry) → REFUNDED
 * (fully credited) / VOID (a parked cart that was abandoned).
 *
 * While PARKED, sale lines are a shopping cart — they may be edited and hard-deleted.
 * From completion on, the sale is a financial record: never edited, never deleted,
 * only refunded via credit notes (see checkout.ts).
 */

// ---------------------------------------------------------------- dates

export const toDbDate = (iso: ISODate): Date => new Date(`${iso}T00:00:00Z`);
export const toIsoDate = (d: Date): ISODate => d.toISOString().slice(0, 10);

/** Reject syntactically valid but impossible dates ('2026-13-40') with a clean 400. */
export function assertRealDate(iso: string): void {
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) {
    throw badRequest('BAD_DATE', `Not a calendar date: ${iso}`);
  }
}

// ---------------------------------------------------------------- numbering

/** Receipt numbers: 'R-' + 6-digit gap-free sequence (R-000123). */
export function formatReceiptNumber(n: number): string {
  return `R-${String(n).padStart(6, '0')}`;
}

// ---------------------------------------------------------------- includes & serializers

export const saleListInclude = {
  model: { select: { id: true, code: true, nameEn: true, nameFi: true } },
  customer: { select: { id: true, name: true, type: true, language: true } },
  unit: { select: { id: true, code: true, brand: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.SaleInclude;
export type SaleListItem = Prisma.SaleGetPayload<{ include: typeof saleListInclude }>;

export const saleDetailInclude = {
  model: { select: { id: true, code: true, nameEn: true, nameFi: true } },
  customer: { select: { id: true, name: true, type: true, language: true } },
  unit: { select: { id: true, code: true, brand: true } },
  lines: {
    include: {
      product: { select: { id: true, sku: true, nameEn: true, nameFi: true, trackStock: true } },
    },
    orderBy: { id: 'asc' },
  },
  payments: {
    include: {
      method: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
    },
    orderBy: { id: 'asc' },
  },
  entry: {
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      vatInvoice: true,
      vatRateBp: true,
      grossCents: true,
      discountCents: true,
      vatCents: true,
      netCents: true,
    },
  },
  creditNotes: { orderBy: { id: 'asc' } },
} satisfies Prisma.SaleInclude;
export type SaleDetail = Prisma.SaleGetPayload<{ include: typeof saleDetailInclude }>;

/**
 * Effective (post-cart-discount) totals of a set of lines. The cart discount is
 * clamped to the line sum so serialisation can never throw on historical rows.
 */
export function effectiveSaleTotals(
  lines: Array<{ lineGrossCents: number; vatRateBp: number }>,
  cartDiscountCents: number,
): SaleTotals {
  const lineSum = lines.reduce((s, l) => s + l.lineGrossCents, 0);
  return distributeCartDiscount(lines, Math.min(cartDiscountCents, lineSum));
}

export function serializeSaleSummary(s: SaleListItem) {
  return {
    id: s.id,
    number: s.number,
    businessDate: toIsoDate(s.businessDate),
    status: s.status,
    model: s.model,
    customerId: s.customerId,
    customer: s.customer,
    unitId: s.unitId,
    unit: s.unit,
    cartDiscountCents: s.cartDiscountCents,
    cartDiscountReason: s.cartDiscountReason,
    totalGrossCents: s.totalGrossCents,
    totalVatCents: s.totalVatCents,
    totalNetCents: s.totalNetCents,
    lineCount: s._count.lines,
    notes: s.notes,
    completedAt: s.completedAt ? s.completedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}

export function serializeSaleDetail(s: SaleDetail) {
  const totals = effectiveSaleTotals(
    s.lines.map((l) => ({ lineGrossCents: l.lineGrossCents, vatRateBp: l.vatRateBp })),
    s.cartDiscountCents,
  );
  const lineDiscountCents = s.lines.reduce((sum, l) => sum + l.discountCents, 0);
  return {
    id: s.id,
    number: s.number,
    businessDate: toIsoDate(s.businessDate),
    status: s.status,
    model: s.model,
    customerId: s.customerId,
    customer: s.customer,
    unitId: s.unitId,
    unit: s.unit,
    cartDiscountCents: s.cartDiscountCents,
    cartDiscountReason: s.cartDiscountReason,
    lineDiscountCents,
    discountCents: lineDiscountCents + s.cartDiscountCents,
    totalGrossCents: s.totalGrossCents,
    totalVatCents: s.totalVatCents,
    totalNetCents: s.totalNetCents,
    notes: s.notes,
    completedAt: s.completedAt ? s.completedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    lines: s.lines.map((l, i) => ({
      id: l.id,
      productId: l.productId,
      product: l.product,
      description: l.description,
      qty: Number(l.qty),
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      discountReason: l.discountReason,
      vatRateBp: l.vatRateBp,
      lineGrossCents: l.lineGrossCents,
      lineVatCents: l.lineVatCents,
      lineNetCents: l.lineNetCents,
      isLabour: l.isLabour,
      /** This line's share of the cart discount + what the customer actually pays. */
      cartShareCents: totals.lines[i].cartShareCents,
      effectiveGrossCents: totals.lines[i].effectiveGrossCents,
    })),
    vatByRate: vatByRate(totals.lines),
    payments: s.payments.map((p) => ({
      id: p.id,
      date: toIsoDate(p.date),
      amountCents: p.amountCents,
      changeCents: p.changeCents,
      method: p.method,
      receivedBy: p.receivedBy,
      note: p.note,
      status: p.status,
    })),
    entry: s.entry,
    creditNotes: s.creditNotes.map((cn) => ({
      id: cn.id,
      number: cn.number,
      numberFormatted: cn.numberFormatted,
      issueDate: toIsoDate(cn.issueDate),
      reason: cn.reason,
      totalGrossCents: cn.totalGrossCents,
      totalVatCents: cn.totalVatCents,
      totalNetCents: cn.totalNetCents,
      restocked: cn.restocked,
      createdAt: cn.createdAt.toISOString(),
    })),
    refundedGrossCents: s.creditNotes.reduce((sum, cn) => sum + cn.totalGrossCents, 0),
  };
}

export async function loadSaleDetail(id: number): Promise<SaleDetail> {
  const sale = await prisma.sale.findUnique({ where: { id }, include: saleDetailInclude });
  if (!sale) throw notFound('Sale');
  return sale;
}

// ---------------------------------------------------------------- guards

type EditableSale = Prisma.SaleGetPayload<{ include: { lines: true } }>;

async function loadEditableSale(id: number): Promise<EditableSale> {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: { lines: { orderBy: { id: 'asc' } } },
  });
  if (!sale) throw notFound('Sale');
  if (sale.status !== 'PARKED') {
    throw conflict('SALE_NOT_EDITABLE', `Only parked sales can be edited (sale is ${sale.status})`);
  }
  return sale;
}

function assertStockQty(trackStock: boolean, qty: number): void {
  if (trackStock && !Number.isInteger(qty)) {
    throw badRequest('BAD_QTY', 'Stock-tracked products sell in whole quantities');
  }
}

/**
 * Staff discount permission: Σ line discounts + cart discount must stay within
 * the acting user's maxDiscountPct of the pre-discount subtotal (Σ base).
 */
export async function assertDiscountCap(
  db: Tx,
  baseSumCents: number,
  discountSumCents: number,
): Promise<void> {
  if (discountSumCents <= 0) return;
  let maxDiscountPct = 100;
  const userId = currentUserId();
  if (userId !== undefined) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { maxDiscountPct: true } });
    if (user) maxDiscountPct = user.maxDiscountPct;
  }
  const capCents = roundHalfAwayFromZero((baseSumCents * maxDiscountPct) / 100);
  if (discountSumCents > capCents) {
    throw new AppError(403, 'DISCOUNT_LIMIT', `Discounts exceed your limit of ${maxDiscountPct}% of the subtotal`, {
      maxDiscountPct,
      baseSumCents,
      discountSumCents,
      capCents,
    });
  }
}

/**
 * Recompute and store the sale's cached totals from its lines. The cart discount
 * is clamped to the (new) line sum, so removing lines can never leave an
 * impossible discount behind.
 */
export async function recomputeSaleTotals(tx: Tx, saleId: number): Promise<SaleTotals> {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, select: { cartDiscountCents: true } });
  const lines = await tx.saleLine.findMany({
    where: { saleId },
    orderBy: { id: 'asc' },
    select: { lineGrossCents: true, vatRateBp: true },
  });
  const lineSum = lines.reduce((s, l) => s + l.lineGrossCents, 0);
  const cartDiscountCents = Math.min(sale.cartDiscountCents, lineSum);
  const totals = distributeCartDiscount(lines, cartDiscountCents);
  await tx.sale.update({
    where: { id: saleId },
    data: {
      cartDiscountCents,
      totalGrossCents: totals.totalGrossCents,
      totalVatCents: totals.totalVatCents,
      totalNetCents: totals.totalNetCents,
    },
  });
  return totals;
}

// ---------------------------------------------------------------- list / create

export async function listSales(q: ListSalesQuery) {
  const where: Prisma.SaleWhereInput = { status: q.status };
  if (q.date !== undefined) {
    assertRealDate(q.date);
    where.businessDate = toDbDate(q.date);
  }
  const [total, rows] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      include: saleListInclude,
      orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return { sales: rows.map(serializeSaleSummary), total, page: q.page, pageSize: q.pageSize };
}

async function assertSaleRefs(refs: {
  modelId?: number;
  customerId?: number | null;
  unitId?: number | null;
}): Promise<void> {
  if (refs.modelId !== undefined) {
    const model = await prisma.businessModel.findUnique({ where: { id: refs.modelId } });
    if (!model) throw badRequest('BAD_MODEL', 'Business model not found');
  }
  if (refs.customerId !== undefined && refs.customerId !== null) {
    const customer = await prisma.customer.findUnique({ where: { id: refs.customerId } });
    if (!customer) throw badRequest('BAD_CUSTOMER', 'Customer not found');
  }
  if (refs.unitId !== undefined && refs.unitId !== null) {
    const unit = await prisma.unit.findUnique({ where: { id: refs.unitId } });
    if (!unit) throw badRequest('BAD_UNIT', 'Unit not found');
  }
}

export async function createSale(body: CreateSaleBody): Promise<number> {
  await assertSaleRefs(body);
  const businessDate = body.businessDate ?? todayInHelsinki();
  assertRealDate(businessDate);

  const id = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'RECEIPT');
    const sale = await tx.sale.create({
      data: {
        number: formatReceiptNumber(number),
        businessDate: toDbDate(businessDate),
        modelId: body.modelId,
        customerId: body.customerId ?? null,
        unitId: body.unitId ?? null,
        status: 'PARKED',
        notes: body.notes ?? null,
        createdById: currentUserId() ?? null,
      },
    });
    return sale.id;
  });

  const created = await prisma.sale.findUnique({ where: { id } });
  await audit('CREATE', 'sales', id, undefined, created);
  return id;
}

// ---------------------------------------------------------------- lines

interface ResolvedLine {
  productId: number | null;
  description: string;
  qty: number;
  unitPriceCents: number;
  discountCents: number | null;
  discountPct: number | null;
  discountReason: string | null;
  vatRateBp: number;
  isLabour: boolean;
  trackStock: boolean;
}

/**
 * A lower price on a product line is an unrecorded discount that would bypass the staff
 * discount cap: staff must use the (capped, recorded) discount instead.
 */
function assertPriceOverrideAllowed(productPriceCents: number, requestedCents: number | undefined): void {
  if (requestedCents === undefined || requestedCents >= productPriceCents) return;
  if (requestContext.getStore()?.role === 'STAFF') {
    throw new AppError(
      403,
      'PRICE_OVERRIDE',
      'Staff cannot lower a product price — give a discount instead (it is recorded and capped)',
    );
  }
}

/** Product lines default price / VAT rate / description from the product card. */
async function resolveNewLine(body: AddLineBody): Promise<ResolvedLine> {
  if (body.productId != null) {
    const product = await prisma.product.findUnique({ where: { id: body.productId } });
    if (!product) throw badRequest('BAD_PRODUCT', 'Product not found');
    if (!product.active) throw badRequest('PRODUCT_INACTIVE', 'This product is inactive');
    assertPriceOverrideAllowed(product.priceCents, body.unitPriceCents);
    return {
      productId: product.id,
      description: body.description ?? product.nameEn,
      qty: body.qty,
      unitPriceCents: body.unitPriceCents ?? product.priceCents,
      discountCents: body.discountCents ?? null,
      discountPct: body.discountPct ?? null,
      discountReason: body.discountReason ?? null,
      vatRateBp: body.vatRateBp ?? product.vatRateBp,
      isLabour: body.isLabour ?? false,
      trackStock: product.trackStock,
    };
  }
  // Custom line — the zod schema guarantees description + price; keep the invariant explicit.
  if (!body.description) throw badRequest('LINE_DESCRIPTION_REQUIRED', 'A custom line needs a description');
  if (body.unitPriceCents === undefined) throw badRequest('LINE_PRICE_REQUIRED', 'A custom line needs a unit price');
  return {
    productId: null,
    description: body.description,
    qty: body.qty,
    unitPriceCents: body.unitPriceCents,
    discountCents: body.discountCents ?? null,
    discountPct: body.discountPct ?? null,
    discountReason: body.discountReason ?? null,
    vatRateBp: body.vatRateBp ?? (await vatRateOn(todayInHelsinki())),
    isLabour: body.isLabour ?? false,
    trackStock: false,
  };
}

export async function addLine(saleId: number, body: AddLineBody): Promise<number> {
  const sale = await loadEditableSale(saleId);
  const line = await resolveNewLine(body);
  assertStockQty(line.trackStock, line.qty);
  const amounts = computeLineAmounts(line);

  const baseSum =
    sale.lines.reduce((s, l) => s + l.lineGrossCents + l.discountCents, 0) + amounts.baseCents;
  const discountSum =
    sale.lines.reduce((s, l) => s + l.discountCents, 0) + amounts.discountCents + sale.cartDiscountCents;
  await assertDiscountCap(prisma, baseSum, discountSum);

  const lineId = await prisma.$transaction(async (tx) => {
    const created = await tx.saleLine.create({
      data: {
        saleId,
        productId: line.productId,
        description: line.description,
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        discountCents: amounts.discountCents,
        discountReason: line.discountReason,
        vatRateBp: line.vatRateBp,
        lineGrossCents: amounts.lineGrossCents,
        lineVatCents: amounts.lineVatCents,
        lineNetCents: amounts.lineNetCents,
        isLabour: line.isLabour,
      },
    });
    await recomputeSaleTotals(tx, saleId);
    return created.id;
  });

  const after = await prisma.saleLine.findUnique({ where: { id: lineId } });
  await audit('CREATE', 'sale_lines', lineId, undefined, after);
  return lineId;
}

export async function updateLine(saleId: number, lineId: number, body: UpdateLineBody): Promise<void> {
  const sale = await loadEditableSale(saleId);
  const line = sale.lines.find((l) => l.id === lineId);
  if (!line) throw notFound('Sale line');

  const productId = body.productId === undefined ? line.productId : body.productId;
  let description = body.description ?? line.description;
  let unitPriceCents = body.unitPriceCents ?? line.unitPriceCents;
  let vatRateBp = body.vatRateBp ?? line.vatRateBp;
  let trackStock = false;

  if (productId != null) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw badRequest('BAD_PRODUCT', 'Product not found');
    assertPriceOverrideAllowed(product.priceCents, body.unitPriceCents);
    if (productId !== line.productId) {
      if (!product.active) throw badRequest('PRODUCT_INACTIVE', 'This product is inactive');
      // Switching the product re-defaults everything the caller did not set explicitly.
      description = body.description ?? product.nameEn;
      unitPriceCents = body.unitPriceCents ?? product.priceCents;
      vatRateBp = body.vatRateBp ?? product.vatRateBp;
    }
    trackStock = product.trackStock;
  }

  const qty = body.qty ?? Number(line.qty);
  assertStockQty(trackStock, qty);

  // Cents win over %; with neither, the stored absolute discount is re-applied to the new base.
  const discountCents =
    body.discountCents !== undefined
      ? body.discountCents
      : body.discountPct !== undefined
        ? null
        : line.discountCents;
  const discountPct = body.discountCents === undefined && body.discountPct !== undefined ? body.discountPct : null;
  const discountReason = body.discountReason === undefined ? line.discountReason : body.discountReason;
  const isLabour = body.isLabour ?? line.isLabour;

  const amounts = computeLineAmounts({ qty, unitPriceCents, discountCents, discountPct, vatRateBp });

  const others = sale.lines.filter((l) => l.id !== lineId);
  const baseSum = others.reduce((s, l) => s + l.lineGrossCents + l.discountCents, 0) + amounts.baseCents;
  const discountSum =
    others.reduce((s, l) => s + l.discountCents, 0) + amounts.discountCents + sale.cartDiscountCents;
  await assertDiscountCap(prisma, baseSum, discountSum);

  await prisma.$transaction(async (tx) => {
    await tx.saleLine.update({
      where: { id: lineId },
      data: {
        productId,
        description,
        qty,
        unitPriceCents,
        discountCents: amounts.discountCents,
        discountReason,
        vatRateBp,
        lineGrossCents: amounts.lineGrossCents,
        lineVatCents: amounts.lineVatCents,
        lineNetCents: amounts.lineNetCents,
        isLabour,
      },
    });
    await recomputeSaleTotals(tx, saleId);
  });

  const after = await prisma.saleLine.findUnique({ where: { id: lineId } });
  await audit('UPDATE', 'sale_lines', lineId, line, after);
}

export async function deleteLine(saleId: number, lineId: number): Promise<void> {
  const sale = await loadEditableSale(saleId);
  const line = sale.lines.find((l) => l.id === lineId);
  if (!line) throw notFound('Sale line');

  // A parked sale is a cart, not a financial record — its lines may be hard-deleted.
  await prisma.$transaction(async (tx) => {
    await tx.saleLine.delete({ where: { id: lineId } });
    await recomputeSaleTotals(tx, saleId);
  });
  await audit('DELETE', 'sale_lines', lineId, line);
}

// ---------------------------------------------------------------- sale header update / park / void

export async function updateSale(saleId: number, body: UpdateSaleBody): Promise<void> {
  const sale = await loadEditableSale(saleId);
  await assertSaleRefs(body);

  const lineSum = sale.lines.reduce((s, l) => s + l.lineGrossCents, 0);
  let cartDiscountCents = sale.cartDiscountCents;
  if (body.cartDiscountCents !== undefined) {
    cartDiscountCents = body.cartDiscountCents;
  } else if (body.cartDiscountPct !== undefined) {
    cartDiscountCents = roundHalfAwayFromZero((lineSum * body.cartDiscountPct) / 100);
  }
  if (cartDiscountCents > lineSum) {
    throw badRequest('CART_DISCOUNT_EXCEEDS_TOTAL', 'Cart discount is larger than the sum of the lines', {
      cartDiscountCents,
      lineTotalCents: lineSum,
    });
  }

  const baseSum = sale.lines.reduce((s, l) => s + l.lineGrossCents + l.discountCents, 0);
  const discountSum = sale.lines.reduce((s, l) => s + l.discountCents, 0) + cartDiscountCents;
  await assertDiscountCap(prisma, baseSum, discountSum);

  await prisma.$transaction(async (tx) => {
    await tx.sale.update({
      where: { id: saleId },
      data: {
        cartDiscountCents,
        cartDiscountReason: body.cartDiscountReason === undefined ? undefined : body.cartDiscountReason,
        customerId: body.customerId === undefined ? undefined : body.customerId,
        unitId: body.unitId === undefined ? undefined : body.unitId,
        modelId: body.modelId ?? undefined,
        notes: body.notes === undefined ? undefined : body.notes,
      },
    });
    await recomputeSaleTotals(tx, saleId);
  });

  const after = await prisma.sale.findUnique({ where: { id: saleId } });
  await audit('UPDATE', 'sales', saleId, sale, after);
}

/** Explicit no-op: keeps an edited sale PARKED (the POS "hold" button). */
export async function parkSale(saleId: number): Promise<void> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } });
  if (!sale) throw notFound('Sale');
  if (sale.status !== 'PARKED') {
    throw conflict('SALE_NOT_EDITABLE', `Only parked sales can be re-parked (sale is ${sale.status})`);
  }
}

/** DELETE /pos/sales/:id — a parked cart is abandoned by voiding it, never by hard-deleting. */
export async function voidParkedSale(saleId: number): Promise<void> {
  const sale = await prisma.sale.findUnique({ where: { id: saleId } });
  if (!sale) throw notFound('Sale');
  if (sale.status === 'VOID') throw conflict('ALREADY_VOID', 'The sale is already void');
  if (sale.status !== 'PARKED') {
    throw conflict('SALE_COMPLETED', 'Completed sales are corrected with a refund, not deleted');
  }
  await prisma.sale.update({ where: { id: saleId }, data: { status: 'VOID' } });
  await audit('VOID', 'sales', saleId, { status: sale.status }, { status: 'VOID' });
}
