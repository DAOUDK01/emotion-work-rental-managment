import { incomeVat, todayInHelsinki } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { currentUserId } from '../../context.js';
import { audit } from '../../services/audit.js';
import { voidEntry, type Tx } from '../../services/entries.js';
import type { MarkPaidBody, UpdateEntryBody } from './schemas.js';
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
 *  - PAID with an ACTIVE payment  -> update amount / receiver / method in place
 *  - leaving PAID                 -> void the ACTIVE payment rows (never hard-delete)
 */
async function syncPayments(tx: Tx, args: SyncPaymentsArgs): Promise<void> {
  const active = await tx.payment.findMany({
    where: { entryId: args.entryId, status: 'ACTIVE' },
    orderBy: { id: 'asc' },
  });
  if (args.paymentStatus === 'PAID') {
    if (!args.receivedById) {
      throw badRequest('RECEIVED_BY_REQUIRED', '"Amount received by" is required for received money');
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
    } else {
      await tx.payment.update({
        where: { id: active[0].id },
        data: {
          amountCents: args.grossCents,
          receivedById: args.receivedById,
          methodId: args.paymentMethodId,
        },
      });
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
  if (before.status === 'VOID') throw conflict('ENTRY_VOID', 'A voided entry cannot be marked paid');
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
