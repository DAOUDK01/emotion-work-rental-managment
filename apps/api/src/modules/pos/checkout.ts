import type { Prisma } from '@prisma/client';
import { addVatToNet, incomeVat, roundHalfAwayFromZero, splitGross, todayInHelsinki } from '@emotionfix/shared';
import { nextNumber, prisma } from '../../db.js';
import { currentUserId } from '../../context.js';
import { AppError, badRequest, conflict, notFound } from '../../errors.js';
import { audit } from '../../services/audit.js';
import { createEntry, defaultVatInvoice } from '../../services/entries.js';
import type { CompleteSaleBody, RefundBody } from './schemas.js';
import { dominantVatRate, qtyToHundredths } from './totals.js';
import { assertDiscountCap, effectiveSaleTotals, toDbDate, toIsoDate } from './service.js';
import { lineBasisCents } from './totals.js';

/**
 * Completion and refunds — the two moments a POS sale touches money and stock.
 *
 * Complete: validates Σ payments − Σ change = sale total, moves stock (SALE),
 * writes the income Entry via createEntry (gross BEFORE discount = Σ base, discount
 * = line + cart discounts) and one Payment row per split. Payment rows store the
 * amount the holder actually KEEPS (tendered − change) so cash balances stay exact;
 * changeCents is kept on the row for the receipt.
 *
 * Refund: issues a credit note ('CN-YYYY-NNNN', NumberSequence CREDIT_NOTE), RETURN
 * movements when restocking, negative Payment rows, and a reversing NEGATIVE Entry
 * mirroring the original entry's VAT treatment — dashboards stay a pure Σ over
 * ACTIVE entries. The original entry is never voided by a refund.
 */

// ---------------------------------------------------------------- shared

async function assertPaymentRefs(
  payments: Array<{ receivedById: number; methodId?: number | null }>,
): Promise<void> {
  const receiverIds = [...new Set(payments.map((p) => p.receivedById))];
  const holders = await prisma.moneyHolder.findMany({
    where: { id: { in: receiverIds } },
    select: { id: true },
  });
  if (holders.length !== receiverIds.length) {
    throw badRequest('BAD_RECEIVED_BY', '"Amount received by" holder not found');
  }
  const methodIds = [...new Set(payments.flatMap((p) => (p.methodId != null ? [p.methodId] : [])))];
  if (methodIds.length > 0) {
    const methods = await prisma.paymentMethod.findMany({
      where: { id: { in: methodIds } },
      select: { id: true },
    });
    if (methods.length !== methodIds.length) {
      throw badRequest('BAD_PAYMENT_METHOD', 'Payment method not found');
    }
  }
}

// ---------------------------------------------------------------- complete

export async function completeSale(saleId: number, body: CompleteSaleBody): Promise<number> {
  await assertPaymentRefs(body.payments);
  const first = body.payments[0];
  const vatInvoice =
    body.vatInvoice ?? (await defaultVatInvoice(first.receivedById, first.methodId ?? null));

  const result = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: { lines: { include: { product: true }, orderBy: { id: 'asc' } } },
    });
    if (!sale) throw notFound('Sale');
    if (sale.status === 'VOID') throw conflict('SALE_VOID', 'A voided sale cannot be completed');
    if (sale.status !== 'PARKED') throw conflict('ALREADY_COMPLETED', 'The sale is already completed');
    if (sale.lines.length === 0) throw badRequest('NO_LINES', 'The sale has no lines');

    const totals = effectiveSaleTotals(sale.lines, sale.cartDiscountCents, sale.pricesExclVat);
    const got = body.payments.reduce((s, p) => s + p.amountCents - (p.changeCents ?? 0), 0);
    if (got !== totals.totalGrossCents) {
      throw badRequest('PAYMENT_MISMATCH', 'Payments minus change must equal the sale total', {
        expectedCents: totals.totalGrossCents,
        gotCents: got,
      });
    }

    const baseSum = sale.lines.reduce(
      (s, l) => s + lineBasisCents(l, sale.pricesExclVat) + l.discountCents,
      0,
    );
    const lineDiscounts = sale.lines.reduce((s, l) => s + l.discountCents, 0);
    await assertDiscountCap(tx, baseSum, lineDiscounts + sale.cartDiscountCents);

    const businessDate = toIsoDate(sale.businessDate);
    // Lines are non-empty here, so the fallback rate is never used.
    const rateBp = dominantVatRate(totals.lines, 2550);

    // ---- stock: SALE movements for tracked products (409 OUT_OF_STOCK unless forced)
    const tracked = sale.lines.flatMap((l) =>
      l.productId != null && l.product != null && l.product.trackStock
        ? [{ lineId: l.id, productId: l.productId, product: l.product, qty: Math.round(Number(l.qty)) }]
        : [],
    );
    if (tracked.length > 0) {
      const needByProduct = new Map<number, number>();
      const productById = new Map<number, (typeof tracked)[number]['product']>();
      for (const t of tracked) {
        if (t.qty <= 0) continue;
        needByProduct.set(t.productId, (needByProduct.get(t.productId) ?? 0) + t.qty);
        productById.set(t.productId, t.product);
      }
      const ids = [...needByProduct.keys()];
      const grouped = ids.length
        ? await tx.stockMovement.groupBy({
            by: ['productId'],
            where: { productId: { in: ids } },
            _sum: { qty: true },
          })
        : [];
      const onHand = new Map(grouped.map((g) => [g.productId, g._sum.qty ?? 0]));
      const insufficient: Array<{
        productId: number;
        sku: string;
        nameEn: string;
        requestedQty: number;
        availableQty: number;
      }> = [];
      for (const [productId, need] of needByProduct) {
        const have = onHand.get(productId) ?? 0;
        if (have < need) {
          const product = productById.get(productId);
          insufficient.push({
            productId,
            sku: product?.sku ?? '',
            nameEn: product?.nameEn ?? '',
            requestedQty: need,
            availableQty: have,
          });
        }
      }
      if (insufficient.length > 0 && !body.force) {
        throw new AppError(409, 'OUT_OF_STOCK', 'Not enough stock for one or more lines', {
          products: insufficient,
        });
      }
      for (const t of tracked) {
        if (t.qty <= 0) continue;
        await tx.stockMovement.create({
          data: {
            productId: t.productId,
            type: 'SALE',
            qty: -t.qty,
            saleLineId: t.lineId,
            createdById: currentUserId() ?? null,
          },
        });
      }
    }

    // The Entry is always VAT-inclusive. For an excl.-VAT sale, gross before discount is
    // every line base with its VAT added, and the discount is whatever brings that down
    // to the exact sale total.
    const entryGrossBefore = sale.pricesExclVat
      ? sale.lines.reduce(
          (s, l) => s + addVatToNet(l.lineNetCents + l.discountCents, l.vatRateBp).grossCents,
          0,
        )
      : baseSum;
    const entryDiscount = sale.pricesExclVat
      ? Math.max(0, entryGrossBefore - totals.totalGrossCents)
      : lineDiscounts + sale.cartDiscountCents;

    // ---- the income Entry (gross BEFORE discount = Σ base; one VAT rate = dominant)
    const entry = await createEntry(tx, {
      entryDate: businessDate,
      modelId: sale.modelId,
      unitId: sale.unitId,
      customerId: sale.customerId,
      description: `POS sale ${sale.number}`,
      grossBeforeDiscountCents: entryGrossBefore,
      discountCents: entryDiscount,
      discountReason: sale.cartDiscountReason,
      vatInvoice,
      vatRateBp: rateBp,
      paymentStatus: 'PAID',
      paymentMethodId: first.methodId ?? null,
      receivedById: first.receivedById,
      source: 'POS',
      saleId: sale.id,
    });
    // A sale can mix VAT rates: store the exact per-line VAT, not one recomputed at the
    // dominant rate, so the VAT report reconciles to the cent with the receipts.
    if (vatInvoice && entry.vatCents !== totals.totalVatCents) {
      await tx.entry.update({
        where: { id: entry.id },
        data: { vatCents: totals.totalVatCents, netCents: entry.grossCents - totals.totalVatCents },
      });
    }

    // ---- payments: createEntry wrote ONE row for the full amount — reshape it into
    // the first split, then add the remaining splits.
    const firstPayment = await tx.payment.findFirst({
      where: { entryId: entry.id },
      orderBy: { id: 'asc' },
    });
    if (firstPayment) {
      await tx.payment.update({
        where: { id: firstPayment.id },
        data: {
          amountCents: first.amountCents - (first.changeCents ?? 0),
          changeCents: first.changeCents ?? null,
        },
      });
    }
    for (const p of body.payments.slice(1)) {
      await tx.payment.create({
        data: {
          date: toDbDate(businessDate),
          amountCents: p.amountCents - (p.changeCents ?? 0),
          methodId: p.methodId ?? null,
          receivedById: p.receivedById,
          entryId: entry.id,
          saleId: sale.id,
          changeCents: p.changeCents ?? null,
          createdById: currentUserId() ?? null,
        },
      });
    }

    // ---- discounts-given report: one row PER discounted line + one for the cart
    // (createEntry wrote a single aggregate row — replace it with the breakdown).
    await tx.discountRecord.deleteMany({ where: { entryId: entry.id } });
    const date = toDbDate(businessDate);
    for (const l of sale.lines) {
      if (l.discountCents <= 0) continue;
      await tx.discountRecord.create({
        data: {
          date,
          amountCents: l.discountCents,
          reason: l.discountReason,
          modelId: sale.modelId,
          entryId: entry.id,
          saleId: sale.id,
        },
      });
    }
    if (sale.cartDiscountCents > 0) {
      await tx.discountRecord.create({
        data: {
          date,
          amountCents: sale.cartDiscountCents,
          reason: sale.cartDiscountReason,
          modelId: sale.modelId,
          entryId: entry.id,
          saleId: sale.id,
        },
      });
    }

    await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        totalGrossCents: totals.totalGrossCents,
        totalVatCents: totals.totalVatCents,
        totalNetCents: totals.totalNetCents,
      },
    });

    return { entryId: entry.id, saleNumber: sale.number, totalGrossCents: totals.totalGrossCents };
  });

  await audit(
    'UPDATE',
    'sales',
    saleId,
    { status: 'PARKED' },
    {
      status: 'COMPLETED',
      entryId: result.entryId,
      totalGrossCents: result.totalGrossCents,
      payments: body.payments.length,
    },
  );
  await audit('CREATE', 'entries', result.entryId, undefined, {
    saleId,
    saleNumber: result.saleNumber,
    grossCents: result.totalGrossCents,
    paymentStatus: 'PAID',
  });
  return result.entryId;
}

// ---------------------------------------------------------------- refund

type RefundSale = Prisma.SaleGetPayload<{
  include: { lines: { include: { product: true } }; entry: true };
}>;
type RefundLine = RefundSale['lines'][number];

interface RefundItem {
  line: RefundLine;
  qtyH: number;
  refundGross: number;
  vatCents: number;
  netCents: number;
}

/** Lines refund against a pool keyed by what the customer bought, so several partial
 *  refunds can never hand back more quantity or money than was sold. */
const keyOf = (l: {
  productId: number | null;
  description: string;
  unitPriceCents: number;
  vatRateBp: number;
}): string => `${l.productId ?? 'x'}|${l.unitPriceCents}|${l.vatRateBp}|${l.description}`;

export interface RefundResponse {
  creditNote: {
    id: number;
    number: number;
    numberFormatted: string;
    saleId: number;
    saleNumber: string;
    issueDate: string;
    reason: string;
    totalGrossCents: number;
    totalVatCents: number;
    totalNetCents: number;
    restocked: boolean;
    reversingEntryId: number;
    lines: Array<{
      id: number;
      productId: number | null;
      description: string;
      qty: number;
      unitPriceCents: number;
      vatRateBp: number;
      lineGrossCents: number;
      lineVatCents: number;
      lineNetCents: number;
    }>;
    createdAt: string;
  };
  saleStatus: 'COMPLETED' | 'REFUNDED';
}

export async function refundSale(saleId: number, body: RefundBody): Promise<RefundResponse> {
  await assertPaymentRefs(body.refundPayments);
  const today = todayInHelsinki();

  const result = await prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: { lines: { include: { product: true }, orderBy: { id: 'asc' } }, entry: true },
    });
    if (!sale) throw notFound('Sale');
    if (sale.status === 'PARKED') throw conflict('NOT_COMPLETED', 'Only completed sales can be refunded');
    if (sale.status === 'VOID') throw conflict('SALE_VOID', 'A voided sale cannot be refunded');
    if (sale.status === 'REFUNDED') throw conflict('ALREADY_REFUNDED', 'The sale is already fully refunded');
    const entry = sale.entry;
    if (!entry) throw conflict('SALE_ENTRY_MISSING', 'The sale has no income entry — it cannot be refunded');
    if (entry.status === 'VOID') throw conflict('ENTRY_VOID', "The sale's income entry is voided");

    // Effective (post-cart-discount) per-line values — exactly what the customer paid.
    const totals = effectiveSaleTotals(sale.lines, sale.cartDiscountCents, sale.pricesExclVat);
    const lineIndexById = new Map(sale.lines.map((l, i) => [l.id, i]));

    // What is still refundable, pooled by key across earlier credit notes.
    const stateByKey = new Map<string, { remainingQtyH: number; remainingGrossCents: number }>();
    sale.lines.forEach((l, i) => {
      const key = keyOf(l);
      const state = stateByKey.get(key) ?? { remainingQtyH: 0, remainingGrossCents: 0 };
      state.remainingQtyH += qtyToHundredths(Number(l.qty));
      state.remainingGrossCents += totals.lines[i].effectiveGrossCents;
      stateByKey.set(key, state);
    });
    const previousLines = await tx.creditNoteLine.findMany({
      where: { creditNote: { saleId: sale.id } },
    });
    for (const prev of previousLines) {
      const state = stateByKey.get(keyOf(prev));
      if (!state) continue;
      state.remainingQtyH -= Math.round(Number(prev.qty) * 100);
      state.remainingGrossCents -= prev.lineGrossCents;
    }

    // Merge duplicate lineIds in the request, then compute each refund share.
    const requested = new Map<number, number>();
    for (const r of body.lines) {
      requested.set(r.lineId, (requested.get(r.lineId) ?? 0) + qtyToHundredths(r.qty));
    }
    const items: RefundItem[] = [];
    for (const [lineId, qtyH] of requested) {
      const idx = lineIndexById.get(lineId);
      if (idx === undefined) {
        throw badRequest('BAD_LINE', `Line ${lineId} does not belong to this sale`);
      }
      const line = sale.lines[idx];
      const eff = totals.lines[idx];
      const state = stateByKey.get(keyOf(line));
      if (!state || qtyH > state.remainingQtyH) {
        throw badRequest('REFUND_EXCEEDS_QTY', `Line "${line.description}" has less quantity left to refund`, {
          lineId,
          requestedQty: qtyH / 100,
          remainingQty: Math.max(0, state?.remainingQtyH ?? 0) / 100,
        });
      }
      if (body.restock && line.productId != null && line.product?.trackStock && qtyH % 100 !== 0) {
        throw badRequest('BAD_QTY', 'Stock-tracked products restock in whole quantities');
      }
      const lineQtyH = qtyToHundredths(Number(line.qty));
      // Proportional share, capped by what is left; the LAST refund of a key takes the
      // exact remainder so a fully refunded sale always sums to the cent.
      const share =
        qtyH === state.remainingQtyH
          ? state.remainingGrossCents
          : Math.min(
              roundHalfAwayFromZero((eff.effectiveGrossCents * qtyH) / lineQtyH),
              state.remainingGrossCents,
            );
      const refundGross = Math.max(0, share);
      state.remainingQtyH -= qtyH;
      state.remainingGrossCents -= refundGross;
      const split = splitGross(refundGross, line.vatRateBp);
      items.push({ line, qtyH, refundGross, vatCents: split.vatCents, netCents: split.netCents });
    }

    const cnGross = items.reduce((s, it) => s + it.refundGross, 0);
    const cnVat = items.reduce((s, it) => s + it.vatCents, 0);
    if (cnGross <= 0) {
      throw badRequest('NOTHING_TO_REFUND', 'The selected lines have nothing left to refund');
    }
    const paySum = body.refundPayments.reduce((s, p) => s + p.amountCents, 0);
    if (paySum !== cnGross) {
      throw badRequest('PAYMENT_MISMATCH', 'Refund payments must equal the refunded amount', {
        expectedCents: cnGross,
        gotCents: paySum,
      });
    }

    // ---- credit note ('CN-' + year + 4-digit gap-free sequence)
    const number = await nextNumber(tx, 'CREDIT_NOTE');
    const numberFormatted = `CN-${today.slice(0, 4)}-${String(number).padStart(4, '0')}`;
    const creditNote = await tx.creditNote.create({
      data: {
        number,
        numberFormatted,
        saleId: sale.id,
        issueDate: toDbDate(today),
        reason: body.reason,
        totalGrossCents: cnGross,
        totalVatCents: cnVat,
        totalNetCents: cnGross - cnVat,
        restocked: body.restock,
        createdById: currentUserId() ?? null,
        lines: {
          create: items.map((it) => ({
            productId: it.line.productId,
            description: it.line.description,
            qty: it.qtyH / 100,
            unitPriceCents: it.line.unitPriceCents,
            vatRateBp: it.line.vatRateBp,
            lineGrossCents: it.refundGross,
            lineVatCents: it.vatCents,
            lineNetCents: it.netCents,
          })),
        },
      },
      include: { lines: true },
    });

    // ---- RETURN movements for restocked, stock-tracked products
    if (body.restock) {
      for (const it of items) {
        if (it.line.productId == null || it.line.product?.trackStock !== true) continue;
        const qty = Math.round(it.qtyH / 100);
        if (qty <= 0) continue;
        await tx.stockMovement.create({
          data: {
            productId: it.line.productId,
            type: 'RETURN',
            qty,
            saleLineId: it.line.id,
            creditNoteId: creditNote.id,
            createdById: currentUserId() ?? null,
          },
        });
      }
    }

    // ---- reversing NEGATIVE entry, mirroring the original entry's VAT treatment with the
    // exact per-line VAT of the refunded lines (rates may be mixed) — no dominant-rate re-split
    const reversedVat = entry.vatInvoice
      ? { grossCents: -cnGross, vatCents: -cnVat, netCents: -(cnGross - cnVat) }
      : incomeVat(-cnGross, entry.vatRateBp, false);
    const reversing = await tx.entry.create({
      data: {
        entryDate: toDbDate(today),
        modelId: sale.modelId,
        unitId: sale.unitId,
        customerId: sale.customerId,
        description: `Credit note ${numberFormatted} for ${sale.number}`,
        grossCents: reversedVat.grossCents,
        discountCents: 0,
        vatInvoice: entry.vatInvoice,
        vatRateBp: entry.vatRateBp,
        vatCents: reversedVat.vatCents,
        netCents: reversedVat.netCents,
        paymentStatus: 'PAID',
        paymentMethodId: body.refundPayments[0].methodId ?? null,
        receivedById: body.refundPayments[0].receivedById,
        segment: entry.segment,
        source: 'POS',
        createdById: currentUserId() ?? null,
      },
    });

    // ---- money handed back: negative Payment rows against each refunding holder
    for (const p of body.refundPayments) {
      await tx.payment.create({
        data: {
          date: toDbDate(today),
          amountCents: -p.amountCents,
          methodId: p.methodId ?? null,
          receivedById: p.receivedById,
          entryId: reversing.id,
          saleId: sale.id,
          note: `Refund ${numberFormatted}`,
          createdById: currentUserId() ?? null,
        },
      });
    }

    // ---- fully refunded? (full-quantity refunds sum exactly to the sale total)
    const refundedAgg = await tx.creditNote.aggregate({
      where: { saleId: sale.id },
      _sum: { totalGrossCents: true },
    });
    const fullyRefunded = (refundedAgg._sum.totalGrossCents ?? 0) >= sale.totalGrossCents;
    if (fullyRefunded) {
      await tx.sale.update({ where: { id: sale.id }, data: { status: 'REFUNDED' } });
    }

    return { creditNote, reversingEntryId: reversing.id, fullyRefunded, saleNumber: sale.number };
  });

  await audit('CREATE', 'credit_notes', result.creditNote.id, undefined, {
    numberFormatted: result.creditNote.numberFormatted,
    saleId,
    totalGrossCents: result.creditNote.totalGrossCents,
    restocked: result.creditNote.restocked,
    reason: body.reason,
  });
  await audit('CREATE', 'entries', result.reversingEntryId, undefined, {
    saleId,
    creditNoteId: result.creditNote.id,
    grossCents: -result.creditNote.totalGrossCents,
  });
  if (result.fullyRefunded) {
    await audit('UPDATE', 'sales', saleId, { status: 'COMPLETED' }, { status: 'REFUNDED' });
  }

  const cn = result.creditNote;
  return {
    creditNote: {
      id: cn.id,
      number: cn.number,
      numberFormatted: cn.numberFormatted,
      saleId,
      saleNumber: result.saleNumber,
      issueDate: today,
      reason: cn.reason,
      totalGrossCents: cn.totalGrossCents,
      totalVatCents: cn.totalVatCents,
      totalNetCents: cn.totalNetCents,
      restocked: cn.restocked,
      reversingEntryId: result.reversingEntryId,
      lines: cn.lines.map((l) => ({
        id: l.id,
        productId: l.productId,
        description: l.description,
        qty: Number(l.qty),
        unitPriceCents: l.unitPriceCents,
        vatRateBp: l.vatRateBp,
        lineGrossCents: l.lineGrossCents,
        lineVatCents: l.lineVatCents,
        lineNetCents: l.lineNetCents,
      })),
      createdAt: cn.createdAt.toISOString(),
    },
    saleStatus: result.fullyRefunded ? 'REFUNDED' : 'COMPLETED',
  };
}
