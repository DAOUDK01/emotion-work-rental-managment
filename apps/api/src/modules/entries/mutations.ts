import { incomeVat, todayInHelsinki } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { currentUserId } from '../../context.js';
import { audit } from '../../services/audit.js';
import { voidEntry, type Tx } from '../../services/entries.js';
import { isOpenStatus, paidCentsByEntryIds } from '../../services/balances.js';
import type { MarkPaidBody, RecordPaymentBody, UpdateEntryBody } from './schemas.js';
import {
  assertRefs,
  getEntryWithRefs,
  toDbDate,
  toIsoDate,
  type EntryWithRefs,
} from './service.js';

/**
 * Mutations on existing entries: update (full recompute), void, mark-paid.
 * Sale/invoice-linked entries are read-only here (409 LINKED_ENTRY) — those documents
 * own their income row. Rental-linked entries ARE editable (the quick-entry screen is
 * where rental income gets corrected); the rental's agreed rent follows the entry.
 * Payments sync exactly like the rentals module: PAID needs "Amount received by" and an
 * ACTIVE Payment row; leaving PAID voids the payment rows; amount changes update them.
 */

type PaymentStatusName = 'PAID' | 'INVOICED' | 'PENDING' | 'NOT_YET_BILLED';

// ------------------------------------------------------------------
// shared internals
// ------------------------------------------------------------------

/** Customer segment snapshot for dashboard filters (re-read on every write). */
async function segmentFor(tx: Tx, customerId: number | null): Promise<'INDIVIDUAL' | 'BUSINESS'> {
  if (!customerId) return 'INDIVIDUAL';
  const customer = await tx.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw badRequest('BAD_CUSTOMER', 'Customer not found');
  return customer.type;
}

interface SyncPaymentsArgs {
  entryId: number;
  previousStatus: PaymentStatusName;
  paymentStatus: PaymentStatusName;
  /** Gross AFTER discount — the amount of money actually received. */
  grossCents: number;
  receivedById: number | null;
  paymentMethodId: number | null;
  /** Day ('YYYY-MM-DD') used when a NEW payment row has to be created. */
  paymentDate: string;
}

/**
 * Keep the money-received ledger in step with the entry's payment status
 * (same rules as the rentals module):
 *  - PAID with no ACTIVE payment  -> create one against "Amount received by"
 *  - open -> PAID after part-payments -> create one payment for the remainder only
 *  - PAID with an ACTIVE payment  -> update amount / receiver / method in place
 *    (paid in several parts: only the last instalment absorbs an amount change)
 *  - leaving PAID                 -> void the ACTIVE payment rows (never hard-delete)
 */
async function syncPayments(tx: Tx, args: SyncPaymentsArgs): Promise<void> {
  const active = await tx.payment.findMany({
    where: { entryId: args.entryId, status: 'ACTIVE' },
    orderBy: { id: 'asc' },
  });
  if (args.paymentStatus === 'PAID') {
    if (!args.receivedById) {
      throw badRequest(
        'RECEIVED_BY_REQUIRED',
        '"Amount received by" is required for received money',
      );
    }
    if (active.length === 0) {
      await tx.payment.create({
        data: {
          date: toDbDate(args.paymentDate),
          amountCents: args.grossCents,
          methodId: args.paymentMethodId,
          receivedById: args.receivedById,
          entryId: args.entryId,
          createdById: currentUserId() ?? null,
        },
      });
    } else if (args.previousStatus !== 'PAID') {
      // Part-paid entry becomes fully paid: book only the remainder; the earlier
      // instalments keep their own receiver, method and date.
      const received = active.reduce((acc, p) => acc + p.amountCents, 0);
      const remainder = args.grossCents - received;
      if (remainder < 0) {
        throw badRequest(
          'AMOUNT_BELOW_PAID',
          'More money was already received than the amount of this entry',
        );
      }
      if (remainder > 0) {
        await tx.payment.create({
          data: {
            date: toDbDate(args.paymentDate),
            amountCents: remainder,
            methodId: args.paymentMethodId,
            receivedById: args.receivedById,
            entryId: args.entryId,
            createdById: currentUserId() ?? null,
          },
        });
      }
    } else if (active.length === 1) {
      await tx.payment.update({
        where: { id: active[0].id },
        data: {
          amountCents: args.grossCents,
          receivedById: args.receivedById,
          methodId: args.paymentMethodId,
        },
      });
    } else {
      // Paid in parts: earlier instalments stay as received; only the last one absorbs
      // an amount change so the payments still add up to the entry total.
      const last = active[active.length - 1];
      const earlier = active.slice(0, -1).reduce((acc, p) => acc + p.amountCents, 0);
      const lastAmount = args.grossCents - earlier;
      if (lastAmount <= 0) {
        throw badRequest(
          'AMOUNT_BELOW_PAID',
          'The new amount is not more than what was already received in earlier part-payments',
        );
      }
      if (lastAmount !== last.amountCents) {
        await tx.payment.update({ where: { id: last.id }, data: { amountCents: lastAmount } });
      }
    }
  } else if (args.previousStatus === 'PAID' && active.length > 0) {
    await tx.payment.updateMany({
      where: { entryId: args.entryId, status: 'ACTIVE' },
      data: { status: 'VOID' },
    });
  }
}

/**
 * After a rental stops covering a unit (its income row was voided): set the unit back
 * to AVAILABLE — only when it is currently ON_RENT and no other ACTIVE rental covers today.
 */
async function releaseUnitIfIdle(tx: Tx, unitId: number, excludeRentalId: number): Promise<void> {
  const unit = await tx.unit.findUnique({ where: { id: unitId } });
  if (!unit || unit.status !== 'ON_RENT') return;
  const today = toDbDate(todayInHelsinki());
  const covering = await tx.rental.findFirst({
    where: {
      unitId,
      status: 'ACTIVE',
      id: { not: excludeRentalId },
      startDate: { lte: today },
      OR: [{ endDate: null }, { endDate: { gte: today } }],
    },
    select: { id: true },
  });
  if (!covering) {
    await tx.unit.update({ where: { id: unitId }, data: { status: 'AVAILABLE' } });
  }
}

// ------------------------------------------------------------------
// update — full recompute (409 LINKED_ENTRY when sale/invoice-linked)
// ------------------------------------------------------------------

export async function updateEntry(id: number, body: UpdateEntryBody): Promise<EntryWithRefs> {
  const before = await prisma.entry.findUnique({ where: { id }, include: { rental: true } });
  if (!before) throw notFound('Entry');
  if (before.status === 'VOID') throw conflict('ENTRY_VOID', 'A voided entry cannot be edited');
  if (before.saleId !== null || before.invoiceId !== null) {
    throw conflict('LINKED_ENTRY', 'This entry belongs to a sale or an invoice — edit it there');
  }

  // Merge: absent key = keep the stored value; null = clear (nullable fields only).
  const entryDate = body.entryDate ?? toIsoDate(before.entryDate);
  const modelId = body.modelId ?? before.modelId;
  const unitId = body.unitId === undefined ? before.unitId : body.unitId;
  const customerId = body.customerId === undefined ? before.customerId : body.customerId;
  const customerName = body.customerName === undefined ? before.customerName : body.customerName;
  const description = body.description === undefined ? before.description : body.description;
  const grossBeforeDiscountCents =
    body.grossBeforeDiscountCents ?? before.grossCents + before.discountCents;
  const discountCents = body.discountCents ?? before.discountCents;
  const discountReason =
    body.discountReason === undefined ? before.discountReason : body.discountReason;
  const vatInvoice = body.vatInvoice ?? before.vatInvoice;
  const vatRateBp = body.vatRateBp ?? before.vatRateBp;
  const labourCents = body.labourCents === undefined ? before.labourCents : body.labourCents;
  const partsCents = body.partsCents === undefined ? before.partsCents : body.partsCents;
  const paymentStatus: PaymentStatusName = body.paymentStatus ?? before.paymentStatus;
  const paymentMethodId =
    body.paymentMethodId === undefined ? before.paymentMethodId : body.paymentMethodId;
  const receivedById = body.receivedById === undefined ? before.receivedById : body.receivedById;
  const needsReview = body.needsReview ?? before.needsReview;
  const reviewReason = body.reviewReason === undefined ? before.reviewReason : body.reviewReason;

  // Recompute the money columns — discounts reduce the base BEFORE the VAT split.
  const grossCents = grossBeforeDiscountCents - discountCents;
  if (grossCents < 0) {
    throw badRequest('DISCOUNT_EXCEEDS_AMOUNT', 'Discount is larger than the amount');
  }
  if (paymentStatus === 'PAID' && !receivedById) {
    throw badRequest('RECEIVED_BY_REQUIRED', '"Amount received by" is required for received money');
  }
  const vat = incomeVat(grossCents, vatRateBp, vatInvoice);

  // A part-paid entry that stays open cannot drop below what was already received.
  if (
    paymentStatus !== 'PAID' &&
    before.paymentStatus === paymentStatus &&
    isOpenStatus(paymentStatus)
  ) {
    const paidSoFar = (await paidCentsByEntryIds([id])).get(id) ?? 0;
    if (paidSoFar > grossCents) {
      throw badRequest(
        'AMOUNT_BELOW_PAID',
        `The amount cannot be lower than the ${(paidSoFar / 100).toFixed(2)} € already received`,
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Validate only the references the caller actually changed.
    await assertRefs(tx, {
      modelId: body.modelId,
      unitId: body.unitId,
      paymentMethodId: body.paymentMethodId,
      receivedById: body.receivedById,
    });
    const segment = await segmentFor(tx, customerId);

    const entry = await tx.entry.update({
      where: { id },
      data: {
        entryDate: toDbDate(entryDate),
        modelId,
        unitId,
        customerId,
        customerName,
        description,
        grossCents,
        discountCents,
        discountReason,
        vatInvoice,
        vatRateBp,
        vatCents: vat.vatCents,
        netCents: vat.netCents,
        labourCents,
        partsCents,
        paymentStatus,
        paymentMethodId,
        receivedById,
        segment,
        needsReview,
        reviewReason,
      },
    });

    // Discounts given: delete + recreate so date/amount/reason/model stay in sync.
    await tx.discountRecord.deleteMany({ where: { entryId: id } });
    if (discountCents > 0) {
      await tx.discountRecord.create({
        data: {
          date: toDbDate(entryDate),
          amountCents: discountCents,
          reason: discountReason,
          modelId,
          entryId: id,
        },
      });
    }

    await syncPayments(tx, {
      entryId: id,
      previousStatus: before.paymentStatus,
      paymentStatus,
      grossCents,
      receivedById,
      paymentMethodId,
      paymentDate: entryDate,
    });

    // Rental-linked rows stay editable here; the rental's agreed rent (amount BEFORE
    // discount) follows the entry so the two screens never disagree.
    if (before.rental && before.rental.amountCents !== grossBeforeDiscountCents) {
      await tx.rental.update({
        where: { id: before.rental.id },
        data: { amountCents: grossBeforeDiscountCents },
      });
    }

    return entry;
  });

  await audit('UPDATE', 'entries', id, before, updated);
  return getEntryWithRefs(id);
}

// ------------------------------------------------------------------
// void — financial rows are never hard-deleted
// ------------------------------------------------------------------

export async function voidEntryById(id: number, reason: string): Promise<EntryWithRefs> {
  const before = await prisma.entry.findUnique({ where: { id }, include: { rental: true } });
  if (!before) throw notFound('Entry');
  if (before.status === 'VOID') throw conflict('ALREADY_VOID', 'Entry is already voided');
  if (before.saleId !== null || before.invoiceId !== null) {
    throw conflict(
      'LINKED_ENTRY',
      'This entry belongs to a sale or an invoice — void it there (refund / credit note)',
    );
  }

  // A rental and its income row live or die together (mirror of POST /rentals/:id/void).
  const rental = before.rental;
  const voidRentalToo = rental !== null && rental.status === 'ACTIVE';

  await prisma.$transaction(async (tx) => {
    await voidEntry(tx, id, reason);
    if (rental && voidRentalToo) {
      await tx.rental.update({ where: { id: rental.id }, data: { status: 'VOID' } });
      await releaseUnitIfIdle(tx, rental.unitId, rental.id);
    }
  });

  await audit('VOID', 'entries', id, before, { status: 'VOID', voidReason: reason });
  if (rental && voidRentalToo) {
    await audit('VOID', 'rentals', rental.id, rental, { status: 'VOID', reason });
  }
  return getEntryWithRefs(id);
}

// ------------------------------------------------------------------
// mark-paid — status PAID + Payment ledger row ("no escape point")
// ------------------------------------------------------------------

export async function markEntryPaid(id: number, body: MarkPaidBody): Promise<EntryWithRefs> {
  const before = await prisma.entry.findUnique({ where: { id } });
  if (!before) throw notFound('Entry');
  if (before.status === 'VOID')
    throw conflict('ENTRY_VOID', 'A voided entry cannot be marked paid');
  if (before.saleId !== null || before.invoiceId !== null) {
    throw conflict(
      'LINKED_ENTRY',
      'This entry belongs to a sale or an invoice — record the payment there',
    );
  }
  if (before.paymentStatus === 'PAID') {
    throw conflict('ALREADY_PAID', 'Entry is already marked as paid');
  }

  const paymentDate = body.date ?? todayInHelsinki();
  const paymentMethodId =
    body.paymentMethodId === undefined ? before.paymentMethodId : body.paymentMethodId;

  const updated = await prisma.$transaction(async (tx) => {
    await assertRefs(tx, {
      receivedById: body.receivedById,
      paymentMethodId: body.paymentMethodId,
    });
    const entry = await tx.entry.update({
      where: { id },
      data: { paymentStatus: 'PAID', receivedById: body.receivedById, paymentMethodId },
    });
    await syncPayments(tx, {
      entryId: id,
      previousStatus: before.paymentStatus,
      paymentStatus: 'PAID',
      grossCents: before.grossCents,
      receivedById: body.receivedById,
      paymentMethodId,
      paymentDate,
    });
    return entry;
  });

  await audit('UPDATE', 'entries', id, before, updated);
  return getEntryWithRefs(id);
}

// ------------------------------------------------------------------
// record payment — part (or all) of the money still owed on an open entry
// ------------------------------------------------------------------

/**
 * A customer pays part of an open item (e.g. €100 of a €125 tyre change now, €25
 * next week). Each instalment is its own Payment against "Amount received by";
 * the entry turns PAID once the instalments cover the whole amount.
 * Invoice-linked entries take payments on the invoice (POST /invoices/:id/payments).
 */
export async function recordEntryPayment(
  id: number,
  body: RecordPaymentBody,
): Promise<EntryWithRefs> {
  const before = await prisma.entry.findUnique({ where: { id } });
  if (!before) throw notFound('Entry');
  if (before.status === 'VOID') throw conflict('ENTRY_VOID', 'A voided entry cannot take payments');
  if (before.saleId !== null || before.invoiceId !== null) {
    throw conflict(
      'LINKED_ENTRY',
      'This entry belongs to a sale or an invoice — record the payment there',
    );
  }
  if (!isOpenStatus(before.paymentStatus)) {
    throw conflict(
      before.paymentStatus === 'PAID' ? 'ALREADY_PAID' : 'NOT_BILLED',
      before.paymentStatus === 'PAID'
        ? 'Entry is already fully paid'
        : 'Entry is not billed yet — set it to pending or invoiced first',
    );
  }

  const paymentDate = body.date ?? todayInHelsinki();
  const paymentMethodId = body.paymentMethodId ?? null;

  let paymentId = 0;
  const updated = await prisma.$transaction(async (tx) => {
    await assertRefs(tx, {
      receivedById: body.receivedById,
      paymentMethodId: body.paymentMethodId,
    });
    const paidSoFar = (await paidCentsByEntryIds([id], tx)).get(id) ?? 0;
    const remaining = before.grossCents - paidSoFar;
    if (body.amountCents > remaining) {
      throw badRequest(
        'OVERPAYMENT',
        `The payment is more than the ${(remaining / 100).toFixed(2)} € still owed on this entry`,
        { remainingCents: remaining },
      );
    }
    const payment = await tx.payment.create({
      data: {
        date: toDbDate(paymentDate),
        amountCents: body.amountCents,
        methodId: paymentMethodId,
        receivedById: body.receivedById,
        entryId: id,
        createdById: currentUserId() ?? null,
      },
    });
    paymentId = payment.id;
    const fullyPaid = body.amountCents === remaining;
    return tx.entry.update({
      where: { id },
      data: fullyPaid
        ? { paymentStatus: 'PAID', receivedById: body.receivedById, paymentMethodId }
        : {},
    });
  });

  await audit('CREATE', 'payments', paymentId, undefined, { entryId: id, ...body });
  await audit('UPDATE', 'entries', id, before, updated);
  return getEntryWithRefs(id);
}
