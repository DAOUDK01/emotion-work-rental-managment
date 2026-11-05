import type { Prisma } from '@prisma/client';
import { roundHalfAwayFromZero, splitGross, todayInHelsinki } from '@emotionfix/shared';
import { nextNumber, prisma } from '../../db.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { currentUserId } from '../../context.js';
import { audit } from '../../services/audit.js';
import { voidEntry } from '../../services/entries.js';
import type { CreditNoteBody, ListCreditNotesQueryT } from './schemas.js';
import {
  dominantRateBp,
  fromDbDate,
  loadInvoiceDetail,
  sparePartsModelId,
  toDbDate,
  type InvoiceDetail,
} from './service.js';

/**
 * Credit notes — the ONLY way to reverse an issued invoice (financial rows are
 * never hard-deleted).
 *
 * - FULL credit (no `lines` in the body): credits every line, the invoice becomes
 *   CANCELLED, its entry is VOIDED (which also voids its payments — money returned).
 * - PARTIAL credit (`lines` given): a reversing NEGATIVE Entry (vatInvoice always
 *   true — a credit note is a VAT document) keeps dashboards a pure Σ over entries.
 *   The reversing entry lands in the same bucket the invoice ends in: INVOICED while
 *   money is still owed, PAID when the invoice ends up settled. Money already
 *   received beyond what remains due is paid back as a negative Payment row against
 *   the holder who received it.
 * - `restock: true` creates RETURN stock movements for tracked product lines.
 */

// ---------------------------------------------------------------- includes & serializers

export const creditNoteListInclude = {
  invoice: {
    select: { id: true, numberFormatted: true, customer: { select: { id: true, name: true } } },
  },
  sale: { select: { id: true, number: true } },
} satisfies Prisma.CreditNoteInclude;
export type CreditNoteListItem = Prisma.CreditNoteGetPayload<{ include: typeof creditNoteListInclude }>;

export const creditNoteDetailInclude = {
  invoice: { include: { customer: true } },
  sale: { include: { customer: true } },
  lines: {
    include: { product: { select: { id: true, sku: true, nameEn: true, nameFi: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.CreditNoteInclude;
export type CreditNoteDetail = Prisma.CreditNoteGetPayload<{ include: typeof creditNoteDetailInclude }>;

export function serializeCreditNoteSummary(cn: CreditNoteListItem | CreditNoteDetail) {
  return {
    id: cn.id,
    number: cn.number,
    numberFormatted: cn.numberFormatted,
    invoice: cn.invoice
      ? {
          id: cn.invoice.id,
          numberFormatted: cn.invoice.numberFormatted,
          customer: { id: cn.invoice.customer.id, name: cn.invoice.customer.name },
        }
      : null,
    sale: cn.sale ? { id: cn.sale.id, number: cn.sale.number } : null,
    issueDate: fromDbDate(cn.issueDate),
    reason: cn.reason,
    totalGrossCents: cn.totalGrossCents,
    totalVatCents: cn.totalVatCents,
    totalNetCents: cn.totalNetCents,
    restocked: cn.restocked,
    createdAt: cn.createdAt.toISOString(),
  };
}

export function serializeCreditNote(cn: CreditNoteDetail) {
  return {
    ...serializeCreditNoteSummary(cn),
    lines: cn.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      product: l.product
        ? { id: l.product.id, sku: l.product.sku, nameEn: l.product.nameEn, nameFi: l.product.nameFi }
        : null,
      description: l.description,
      qty: Number(l.qty),
      unitPriceCents: l.unitPriceCents,
      vatRateBp: l.vatRateBp,
      lineGrossCents: l.lineGrossCents,
      lineVatCents: l.lineVatCents,
      lineNetCents: l.lineNetCents,
    })),
  };
}

export async function loadCreditNoteDetail(id: number): Promise<CreditNoteDetail> {
  const cn = await prisma.creditNote.findUnique({ where: { id }, include: creditNoteDetailInclude });
  if (!cn) throw notFound('Credit note');
  return cn;
}

// ---------------------------------------------------------------- list

export async function listCreditNotes(q: ListCreditNotesQueryT) {
  const and: Prisma.CreditNoteWhereInput[] = [];
  if (q.from) and.push({ issueDate: { gte: toDbDate(q.from) } });
  if (q.to) and.push({ issueDate: { lte: toDbDate(q.to) } });
  if (q.q) {
    and.push({
      OR: [
        { numberFormatted: { contains: q.q, mode: 'insensitive' } },
        { reason: { contains: q.q, mode: 'insensitive' } },
        { invoice: { is: { numberFormatted: { contains: q.q, mode: 'insensitive' } } } },
        { invoice: { is: { customer: { is: { name: { contains: q.q, mode: 'insensitive' } } } } } },
      ],
    });
  }
  const where: Prisma.CreditNoteWhereInput = and.length ? { AND: and } : {};
  const [total, rows] = await Promise.all([
    prisma.creditNote.count({ where }),
    prisma.creditNote.findMany({
      where,
      include: creditNoteListInclude,
      orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
  ]);
  return {
    creditNotes: rows.map(serializeCreditNoteSummary),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

// ---------------------------------------------------------------- create

interface CreditedLine {
  invoiceLine: InvoiceDetail['lines'][number];
  qty: number;
  grossCents: number;
  vatCents: number;
  netCents: number;
}

/** Fair share of the line gross for a partial quantity, rounded half away from zero. */
function partialGross(line: InvoiceDetail['lines'][number], qty: number): number {
  const origH = Math.round(Number(line.qty) * 100);
  const qtyH = Math.round(qty * 100);
  if (qtyH === origH) return line.lineGrossCents;
  return roundHalfAwayFromZero((line.lineGrossCents * qtyH) / origH);
}

export async function createCreditNote(invoiceId: number, body: CreditNoteBody): Promise<number> {
  const invoice = await loadInvoiceDetail(invoiceId);
  if (invoice.status === 'DRAFT') {
    throw conflict('NOT_SENT', 'Draft invoices are edited or deleted, not credited');
  }
  if (invoice.status === 'CANCELLED') {
    throw conflict('INVOICE_CANCELLED', 'The invoice is already cancelled');
  }

  const previousCredited = invoice.creditNotes.reduce((sum, cn) => sum + cn.totalGrossCents, 0);
  const full = body.lines === undefined;
  if (full && previousCredited > 0) {
    throw conflict(
      'ALREADY_CREDITED',
      'Partial credit notes exist for this invoice — credit the remaining lines explicitly',
    );
  }

  // ---- credited lines + totals
  const credited: CreditedLine[] = [];
  if (full) {
    for (const line of invoice.lines) {
      credited.push({
        invoiceLine: line,
        qty: Number(line.qty),
        grossCents: line.lineGrossCents,
        vatCents: line.lineVatCents,
        netCents: line.lineNetCents,
      });
    }
  } else {
    const byId = new Map(invoice.lines.map((l) => [l.id, l]));
    // Quantity already credited on earlier notes. CreditNoteLine has no invoiceLineId,
    // so identical invoice lines (same product/description/price/rate) share one pool.
    const lineKey = (l: { productId: number | null; description: string; unitPriceCents: number; vatRateBp: number }) =>
      `${l.productId ?? ''}|${l.description}|${l.unitPriceCents}|${l.vatRateBp}`;
    const creditNoteLines = await prisma.creditNoteLine.findMany({
      where: { creditNote: { invoiceId } },
      select: { productId: true, description: true, unitPriceCents: true, vatRateBp: true, qty: true },
    });
    const creditedH = new Map<string, number>();
    for (const cl of creditNoteLines) {
      creditedH.set(lineKey(cl), (creditedH.get(lineKey(cl)) ?? 0) + Math.round(Number(cl.qty) * 100));
    }
    const invoicedH = new Map<string, number>();
    for (const l of invoice.lines) {
      invoicedH.set(lineKey(l), (invoicedH.get(lineKey(l)) ?? 0) + Math.round(Number(l.qty) * 100));
    }
    for (const sel of body.lines ?? []) {
      const line = byId.get(sel.lineId);
      if (!line) {
        throw badRequest('BAD_LINE', `Line ${sel.lineId} does not belong to invoice ${invoice.numberFormatted}`);
      }
      if (credited.some((c) => c.invoiceLine.id === line.id)) {
        throw badRequest('DUPLICATE_LINE', `Line ${sel.lineId} appears twice in the credit note`);
      }
      if (Math.round(sel.qty * 100) > Math.round(Number(line.qty) * 100)) {
        throw badRequest('BAD_QTY', `Line ${sel.lineId}: cannot credit more than the invoiced quantity`);
      }
      const key = lineKey(line);
      const remainingH = (invoicedH.get(key) ?? 0) - (creditedH.get(key) ?? 0);
      if (Math.round(sel.qty * 100) > remainingH) {
        throw conflict(
          'ALREADY_CREDITED',
          `Line ${sel.lineId}: only ${(Math.max(0, remainingH) / 100).toString()} left to credit`,
        );
      }
      creditedH.set(key, (creditedH.get(key) ?? 0) + Math.round(sel.qty * 100));
      const grossCents = partialGross(line, sel.qty);
      const split = splitGross(grossCents, line.vatRateBp);
      credited.push({ invoiceLine: line, qty: sel.qty, grossCents, vatCents: split.vatCents, netCents: split.netCents });
    }
  }

  const totalGross = credited.reduce((s, c) => s + c.grossCents, 0);
  const totalVat = credited.reduce((s, c) => s + c.vatCents, 0);
  const totalNet = credited.reduce((s, c) => s + c.netCents, 0);
  if (!full && totalGross <= 0) {
    throw badRequest('NOTHING_TO_CREDIT', 'The selected lines amount to nothing');
  }
  if (previousCredited + totalGross > invoice.totalGrossCents) {
    throw conflict('CREDIT_EXCEEDS_INVOICE', 'Credit notes would exceed the invoice total');
  }

  const today = todayInHelsinki();
  const issueDb = toDbDate(today);
  const rate = dominantRateBp(credited.map((c) => ({ vatRateBp: c.invoiceLine.vatRateBp, lineGrossCents: c.grossCents })));
  const entry = invoice.entry && invoice.entry.status === 'ACTIVE' ? invoice.entry : null;

  // ---- final invoice state (computed up-front; the transaction only writes)
  const creditedTotal = previousCredited + totalGross;
  let finalStatus: 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' = full
    ? 'CANCELLED'
    : invoice.status === 'PAID'
      ? 'PAID'
      : invoice.status; // SENT | PARTIALLY_PAID
  if (!full && (invoice.status === 'SENT' || invoice.status === 'PARTIALLY_PAID')) {
    const dueAfter = invoice.totalGrossCents - creditedTotal;
    if (invoice.paidCents > 0 && invoice.paidCents >= dueAfter) finalStatus = 'PAID';
    else if (invoice.paidCents === 0 && dueAfter <= 0) finalStatus = 'CANCELLED';
  }

  // Who received this invoice's money (for refunds and PAID-bucket accounting).
  let receiverId: number | null = entry?.receivedById ?? null;
  if (receiverId == null && invoice.paidCents > 0) {
    const lastPayment = await prisma.payment.findFirst({
      where: { invoiceId, status: 'ACTIVE', amountCents: { gt: 0 } },
      orderBy: { id: 'desc' },
      select: { receivedById: true },
    });
    receiverId = lastPayment?.receivedById ?? null;
  }

  // Money received beyond what remains due flows back to the customer.
  const dueAfterCredit = Math.max(0, invoice.totalGrossCents - creditedTotal);
  const refundCents =
    !full && receiverId != null
      ? Math.min(totalGross, Math.max(0, invoice.paidCents - dueAfterCredit))
      : 0;

  const cnId = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'CREDIT_NOTE');
    const numberFormatted = `CN-${today.slice(0, 4)}-${String(number).padStart(4, '0')}`;

    const cn = await tx.creditNote.create({
      data: {
        number,
        numberFormatted,
        invoiceId,
        issueDate: issueDb,
        reason: body.reason,
        totalGrossCents: totalGross,
        totalVatCents: totalVat,
        totalNetCents: totalNet,
        restocked: body.restock,
        createdById: currentUserId() ?? null,
        lines: {
          create: credited.map((c) => ({
            productId: c.invoiceLine.productId,
            description: c.invoiceLine.description,
            qty: c.qty,
            unitPriceCents: c.invoiceLine.unitPriceCents,
            vatRateBp: c.invoiceLine.vatRateBp,
            lineGrossCents: c.grossCents,
            lineVatCents: c.vatCents,
            lineNetCents: c.netCents,
          })),
        },
      },
    });

    // ---- restock: RETURN movements for tracked product lines (stock = Σ movements)
    if (body.restock) {
      for (const c of credited) {
        if (c.invoiceLine.productId == null || !c.invoiceLine.product?.trackStock) continue;
        const moveQty = roundHalfAwayFromZero(c.qty);
        if (moveQty <= 0) continue;
        await tx.stockMovement.create({
          data: {
            productId: c.invoiceLine.productId,
            type: 'RETURN',
            qty: moveQty,
            creditNoteId: cn.id,
            notes: `Credit note ${numberFormatted} for invoice ${invoice.numberFormatted}`,
            createdById: currentUserId() ?? null,
          },
        });
      }
    }

    if (full) {
      // FULL credit: invoice CANCELLED + entry voided (voids its payments too).
      if (entry) await voidEntry(tx, entry.id, `Credit note ${numberFormatted}: ${body.reason}`);
      await tx.payment.updateMany({
        where: { invoiceId, status: 'ACTIVE' },
        data: { status: 'VOID' },
      });
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'CANCELLED', paidCents: 0 },
      });
      return cn.id;
    }

    // PARTIAL credit: reversing negative entry (vatInvoice ALWAYS true).
    const reversingStatus: 'PAID' | 'INVOICED' =
      finalStatus === 'PAID' && receiverId != null ? 'PAID' : 'INVOICED';
    // exact per-line VAT of the credited lines (rates may be mixed), never a dominant-rate re-split
    const reversing = await tx.entry.create({
      data: {
        entryDate: issueDb,
        modelId: entry?.modelId ?? invoice.modelId ?? (await sparePartsModelId(tx)),
        unitId: invoice.unitId,
        customerId: invoice.customerId,
        description: `Credit note ${numberFormatted} for invoice ${invoice.numberFormatted}`,
        grossCents: -totalGross,
        discountCents: 0,
        vatInvoice: true,
        vatRateBp: rate,
        vatCents: -totalVat,
        netCents: -totalNet,
        paymentStatus: reversingStatus,
        paymentMethodId: entry?.paymentMethodId ?? null,
        receivedById: reversingStatus === 'PAID' ? receiverId : null,
        segment: invoice.customer.type,
        source: 'WEB',
        createdById: currentUserId() ?? null,
      },
    });

    // Refund of over-received money: negative Payment against the receiving holder.
    if (refundCents > 0 && receiverId != null) {
      await tx.payment.create({
        data: {
          date: issueDb,
          amountCents: -refundCents,
          methodId: entry?.paymentMethodId ?? null,
          receivedById: receiverId,
          entryId: reversing.id,
          invoiceId,
          note: `Refund — credit note ${numberFormatted}`,
          createdById: currentUserId() ?? null,
        },
      });
    }

    // The original entry follows the invoice into PAID when the credit settles it.
    if (entry && finalStatus === 'PAID' && entry.paymentStatus !== 'PAID' && receiverId != null) {
      await tx.entry.update({
        where: { id: entry.id },
        data: { paymentStatus: 'PAID', receivedById: receiverId },
      });
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: finalStatus, paidCents: invoice.paidCents - refundCents },
    });
    return cn.id;
  });

  const created = await prisma.creditNote.findUnique({ where: { id: cnId }, include: { lines: true } });
  await audit('CREATE', 'credit_notes', cnId, undefined, created);
  if (entry && full) {
    await audit('VOID', 'entries', entry.id, { status: 'ACTIVE' }, {
      status: 'VOID',
      voidReason: `Credit note for invoice ${invoice.numberFormatted}: ${body.reason}`,
    });
  }
  await audit(
    'UPDATE',
    'invoices',
    invoiceId,
    { status: invoice.status, paidCents: invoice.paidCents },
    {
      status: full ? 'CANCELLED' : finalStatus,
      paidCents: full ? 0 : invoice.paidCents - refundCents,
      creditNoteId: cnId,
    },
  );
  return cnId;
}
