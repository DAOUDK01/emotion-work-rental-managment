import type { Prisma } from '@prisma/client';
import { addDays, addMonths, incomeVat, todayInHelsinki, type ISODate } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { AppError, badRequest, conflict, notFound } from '../../errors.js';
import { currentUserId } from '../../context.js';
import { audit } from '../../services/audit.js';
import {
  createEntry,
  defaultVatInvoice,
  type Tx,
  vatRateOn,
  voidEntry,
} from '../../services/entries.js';
import type { CreateRentalBody, UpdateRentalBody } from './schemas.js';

/**
 * Rentals: one row per rental period. The linked Entry is the financial truth
 * (gross after discount, VAT split, payment status, "Amount received by") and is
 * created/updated TOGETHER with the rental inside one prisma.$transaction.
 * `rental.amountCents` is the agreed rent BEFORE discount, as entered.
 */

// ---------------------------------------------------------------- includes & shapes

export const rentalInclude = {
  unit: { select: { id: true, code: true, brand: true, status: true } },
  customer: { select: { id: true, name: true, type: true } },
  entry: {
    include: {
      receivedBy: { select: { id: true, name: true } },
      paymentMethod: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.RentalInclude;

export type RentalWithRefs = Prisma.RentalGetPayload<{ include: typeof rentalInclude }>;

export const rentalDetailInclude = {
  ...rentalInclude,
  attachments: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
  },
  children: { include: rentalInclude, orderBy: { startDate: 'asc' } },
} satisfies Prisma.RentalInclude;

export type RentalDetail = Prisma.RentalGetPayload<{ include: typeof rentalDetailInclude }>;

const toDbDate = (d: ISODate): Date => new Date(`${d}T00:00:00Z`);
const fromDbDate = (d: Date): ISODate => d.toISOString().slice(0, 10);
const isoOrNull = (d: Date | null): string | null => (d ? fromDbDate(d) : null);

function serializeEntry(e: NonNullable<RentalWithRefs['entry']>) {
  return {
    id: e.id,
    entryDate: fromDbDate(e.entryDate),
    description: e.description,
    grossCents: e.grossCents,
    discountCents: e.discountCents,
    discountReason: e.discountReason,
    vatInvoice: e.vatInvoice,
    vatRateBp: e.vatRateBp,
    vatCents: e.vatCents,
    netCents: e.netCents,
    paymentStatus: e.paymentStatus,
    paymentMethod: e.paymentMethod,
    receivedBy: e.receivedBy,
    source: e.source,
    status: e.status,
    voidReason: e.voidReason,
  };
}

/** List/summary shape — paymentStatus / receivedBy / vatInvoice come from the linked entry. */
export function serializeRental(r: RentalWithRefs) {
  return {
    id: r.id,
    unit: { id: r.unit.id, code: r.unit.code, brand: r.unit.brand },
    customer: r.customer,
    customerName: r.customerName,
    handOverDate: isoOrNull(r.handOverDate),
    startDate: fromDbDate(r.startDate),
    endDate: isoOrNull(r.endDate),
    periodText: r.periodText,
    amountCents: r.amountCents,
    depositCents: r.depositCents,
    recurring: r.recurring,
    parentId: r.parentId,
    agreementSigned: r.agreementSigned,
    notes: r.notes,
    paymentStatus: r.entry?.paymentStatus ?? null,
    receivedBy: r.entry?.receivedBy ?? null,
    vatInvoice: r.entry?.vatInvoice ?? false,
    entryId: r.entry?.id ?? null,
    needsReview: r.needsReview,
    reviewReason: r.reviewReason,
    source: r.source,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

export function serializeRentalDetail(r: RentalDetail) {
  return {
    ...serializeRental(r),
    entry: r.entry ? serializeEntry(r.entry) : null,
    attachments: r.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
    })),
    children: r.children.map(serializeRental),
  };
}

// ---------------------------------------------------------------- period helpers

/** "01.09 TO 30.09" — the period format used in the client's records and on invoices. */
export function formatPeriodText(start: ISODate, end: ISODate): string {
  const fmt = (d: ISODate) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return `${fmt(start)} TO ${fmt(end)}`;
}

/** Last day of the implied one-month period starting at `start` (open-ended rentals). */
export function impliedPeriodEnd(start: ISODate): ISODate {
  return addDays(addMonths(start, 1), -1);
}

export interface NextPeriod {
  startDate: ISODate;
  endDate: ISODate | null;
  periodText: string;
}

/** Next period = startDate+1 month to endDate+1 month (or an open +1 month span). */
export function computeNextPeriod(startDate: ISODate, endDate: ISODate | null): NextPeriod {
  const nextStart = addMonths(startDate, 1);
  const nextEnd = endDate ? addMonths(endDate, 1) : null;
  return {
    startDate: nextStart,
    endDate: nextEnd,
    periodText: formatPeriodText(nextStart, nextEnd ?? impliedPeriodEnd(nextStart)),
  };
}

// ---------------------------------------------------------------- internals

async function rentalModelId(tx: Tx): Promise<number> {
  const model = await tx.businessModel.findUnique({ where: { code: 'RENTAL' } });
  if (!model) throw new AppError(500, 'MODEL_MISSING', 'Business model RENTAL is not seeded');
  return model.id;
}

function entryDescription(unitCode: string, periodText: string | null): string {
  return periodText ? `Rental ${unitCode} ${periodText}` : `Rental ${unitCode}`;
}

async function assertRentableUnit(unitId: number) {
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) throw notFound('Unit');
  if (!unit.active || unit.status === 'SOLD' || unit.status === 'DISPOSED') {
    throw badRequest('UNIT_NOT_RENTABLE', `Unit ${unit.code} can no longer be rented out`);
  }
  return unit;
}

/** On create: a freshly rented unit goes ON_RENT — but only from AVAILABLE. */
async function occupyUnit(tx: Tx, unitId: number): Promise<void> {
  const unit = await tx.unit.findUnique({ where: { id: unitId } });
  if (unit && unit.status === 'AVAILABLE') {
    await tx.unit.update({ where: { id: unitId }, data: { status: 'ON_RENT' } });
  }
}

/**
 * After a rental stops covering a unit (void / unit swap): set the unit back to
 * AVAILABLE — only when it is currently ON_RENT and no other ACTIVE rental covers today.
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

async function segmentFor(customerId: number | null): Promise<'INDIVIDUAL' | 'BUSINESS'> {
  if (!customerId) return 'INDIVIDUAL';
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw badRequest('BAD_CUSTOMER', 'Customer not found');
  return customer.type;
}

// ---------------------------------------------------------------- create

export async function createRental(
  body: CreateRentalBody,
  source: 'WEB' | 'SYSTEM',
): Promise<number> {
  const unit = await assertRentableUnit(body.unitId);
  if (body.endDate && body.endDate < body.startDate) {
    throw badRequest('BAD_PERIOD', 'End date is before start date');
  }
  const vatInvoice =
    body.vatInvoice ?? (await defaultVatInvoice(body.receivedById, body.paymentMethodId));
  const vatRateBp = body.vatRateBp ?? (await vatRateOn(body.startDate));
  const periodText =
    body.periodText ??
    formatPeriodText(body.startDate, body.endDate ?? impliedPeriodEnd(body.startDate));

  const rentalId = await prisma.$transaction(async (tx) => {
    const modelId = await rentalModelId(tx);
    const rental = await tx.rental.create({
      data: {
        unitId: body.unitId,
        customerId: body.customerId ?? null,
        customerName: body.customerName ?? null,
        handOverDate: body.handOverDate ? toDbDate(body.handOverDate) : null,
        startDate: toDbDate(body.startDate),
        endDate: body.endDate ? toDbDate(body.endDate) : null,
        periodText,
        amountCents: body.amountCents,
        depositCents: body.depositCents,
        recurring: body.recurring,
        agreementSigned: body.agreementSigned,
        notes: body.notes ?? null,
        source,
        createdById: currentUserId() ?? null,
      },
    });
    await createEntry(tx, {
      entryDate: body.startDate,
      modelId,
      unitId: body.unitId,
      customerId: body.customerId ?? null,
      customerName: body.customerName ?? null,
      description: entryDescription(unit.code, periodText),
      grossBeforeDiscountCents: body.amountCents,
      discountCents: body.discountCents,
      discountReason: body.discountReason ?? null,
      vatInvoice,
      vatRateBp,
      paymentStatus: body.paymentStatus,
      paymentMethodId: body.paymentMethodId ?? null,
      receivedById: body.receivedById ?? null,
      source,
      rentalId: rental.id,
    });
    await occupyUnit(tx, body.unitId);
    return rental.id;
  });

  const created = await prisma.rental.findUnique({ where: { id: rentalId }, include: { entry: true } });
  await audit('CREATE', 'rentals', rentalId, undefined, created);
  return rentalId;
}

// ---------------------------------------------------------------- update

export async function updateRental(id: number, body: UpdateRentalBody): Promise<void> {
  const rental = await prisma.rental.findUnique({
    where: { id },
    include: { entry: true, unit: true },
  });
  if (!rental) throw notFound('Rental');
  if (rental.status === 'VOID') throw conflict('RENTAL_VOID', 'A voided rental cannot be edited');
  const entry = rental.entry;
  // Once invoiced, the invoice owns the income row: money changes go through the invoice
  // (payments, credit notes). Descriptive fields stay editable.
  if (entry?.invoiceId != null) {
    const financial = [
      'unitId', 'customerId', 'customerName', 'startDate', 'amountCents', 'discountCents',
      'discountReason', 'vatInvoice', 'vatRateBp', 'paymentStatus', 'paymentMethodId', 'receivedById',
    ] as const;
    const touched = financial.filter((k) => (body as Record<string, unknown>)[k] !== undefined);
    if (touched.length > 0) {
      throw conflict(
        'LINKED_ENTRY',
        `This rental is invoiced — change ${touched.join(', ')} through the invoice (payments or a credit note)`,
      );
    }
  }

  // ---- merge rental fields (absent key = keep stored value)
  const unitId = body.unitId ?? rental.unitId;
  let unitCode = rental.unit.code;
  if (unitId !== rental.unitId) {
    unitCode = (await assertRentableUnit(unitId)).code;
  }
  const origStart = fromDbDate(rental.startDate);
  const origEnd = rental.endDate ? fromDbDate(rental.endDate) : null;
  const startDate = body.startDate ?? origStart;
  const endDate = body.endDate === undefined ? origEnd : body.endDate;
  if (endDate && endDate < startDate) throw badRequest('BAD_PERIOD', 'End date is before start date');
  const datesChanged = startDate !== origStart || endDate !== origEnd;

  const customerId = body.customerId === undefined ? rental.customerId : body.customerId;
  const customerName = body.customerName === undefined ? rental.customerName : body.customerName;
  const amountCents = body.amountCents ?? rental.amountCents;
  const periodText =
    body.periodText !== undefined
      ? body.periodText
      : datesChanged
        ? formatPeriodText(startDate, endDate ?? impliedPeriodEnd(startDate))
        : rental.periodText;

  // ---- merge financial (entry) fields and recompute — the entry is the financial truth
  const discountCents = body.discountCents ?? entry?.discountCents ?? 0;
  const discountReason =
    body.discountReason === undefined ? (entry?.discountReason ?? null) : body.discountReason;
  const receivedById =
    body.receivedById === undefined ? (entry?.receivedById ?? null) : body.receivedById;
  const paymentMethodId =
    body.paymentMethodId === undefined ? (entry?.paymentMethodId ?? null) : body.paymentMethodId;
  const vatInvoice =
    body.vatInvoice ??
    entry?.vatInvoice ??
    (await defaultVatInvoice(receivedById, paymentMethodId));
  const vatRateBp = body.vatRateBp ?? entry?.vatRateBp ?? (await vatRateOn(startDate));
  const paymentStatus = body.paymentStatus ?? entry?.paymentStatus ?? 'NOT_YET_BILLED';

  const grossCents = amountCents - discountCents;
  if (grossCents < 0) {
    throw badRequest('DISCOUNT_EXCEEDS_AMOUNT', 'Discount is larger than the amount');
  }
  if (paymentStatus === 'PAID' && !receivedById) {
    throw badRequest('RECEIVED_BY_REQUIRED', '"Amount received by" is required for received money');
  }
  const vat = incomeVat(grossCents, vatRateBp, vatInvoice);
  const segment = await segmentFor(customerId);
  const description = entryDescription(unitCode, periodText);

  await prisma.$transaction(async (tx) => {
    await tx.rental.update({
      where: { id },
      data: {
        unitId,
        customerId,
        customerName,
        handOverDate:
          body.handOverDate === undefined
            ? undefined
            : body.handOverDate
              ? toDbDate(body.handOverDate)
              : null,
        startDate: toDbDate(startDate),
        endDate: endDate ? toDbDate(endDate) : null,
        periodText,
        amountCents,
        depositCents: body.depositCents,
        recurring: body.recurring,
        agreementSigned: body.agreementSigned,
        notes: body.notes === undefined ? undefined : body.notes,
      },
    });

    if (entry) {
      await tx.entry.update({
        where: { id: entry.id },
        data: {
          entryDate: toDbDate(startDate),
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
          paymentStatus,
          paymentMethodId,
          receivedById,
          segment,
        },
      });

      // discounts given: delete + recreate for this entry so date/amount/reason stay in sync
      await tx.discountRecord.deleteMany({ where: { entryId: entry.id } });
      if (discountCents > 0) {
        await tx.discountRecord.create({
          data: {
            date: toDbDate(startDate),
            amountCents: discountCents,
            reason: discountReason,
            modelId: entry.modelId,
            entryId: entry.id,
          },
        });
      }

      // payments (received-money ledger) follow the entry's payment status
      const activePayments = await tx.payment.findMany({
        where: { entryId: entry.id, status: 'ACTIVE' },
        orderBy: { id: 'asc' },
      });
      if (paymentStatus === 'PAID') {
        if (!receivedById) {
          throw badRequest('RECEIVED_BY_REQUIRED', '"Amount received by" is required for received money');
        }
        if (activePayments.length === 0) {
          await tx.payment.create({
            data: {
              date: toDbDate(startDate),
              amountCents: grossCents,
              methodId: paymentMethodId,
              receivedById,
              entryId: entry.id,
              createdById: currentUserId() ?? null,
            },
          });
        } else {
          await tx.payment.update({
            where: { id: activePayments[0].id },
            data: { amountCents: grossCents, receivedById, methodId: paymentMethodId },
          });
        }
      } else if (entry.paymentStatus === 'PAID') {
        await tx.payment.updateMany({
          where: { entryId: entry.id, status: 'ACTIVE' },
          data: { status: 'VOID' },
        });
      }
    } else {
      // Legacy anomaly (rental without a ledger row): restore the Rental+Entry invariant.
      await createEntry(tx, {
        entryDate: startDate,
        modelId: await rentalModelId(tx),
        unitId,
        customerId,
        customerName,
        description,
        grossBeforeDiscountCents: amountCents,
        discountCents,
        discountReason,
        vatInvoice,
        vatRateBp,
        paymentStatus,
        paymentMethodId,
        receivedById,
        source: 'WEB',
        rentalId: id,
      });
    }

    // unit swap: keep both unit statuses truthful
    if (unitId !== rental.unitId) {
      await occupyUnit(tx, unitId);
      await releaseUnitIfIdle(tx, rental.unitId, id);
    }
  });

  const after = await prisma.rental.findUnique({ where: { id }, include: { entry: true } });
  await audit('UPDATE', 'rentals', id, rental, after);
}

// ---------------------------------------------------------------- void

export async function voidRental(id: number, reason: string): Promise<void> {
  const rental = await prisma.rental.findUnique({ where: { id }, include: { entry: true } });
  if (!rental) throw notFound('Rental');
  if (rental.status === 'VOID') throw conflict('ALREADY_VOID', 'Rental is already voided');
  if (rental.entry?.invoiceId != null && rental.entry.status === 'ACTIVE') {
    throw conflict('LINKED_ENTRY', 'This rental is invoiced — cancel it with a credit note on the invoice');
  }

  await prisma.$transaction(async (tx) => {
    await tx.rental.update({ where: { id }, data: { status: 'VOID' } });
    if (rental.entry) await voidEntry(tx, rental.entry.id, reason);
    await releaseUnitIfIdle(tx, rental.unitId, id);
  });

  await audit('VOID', 'rentals', id, rental, { status: 'VOID', reason });
}

// ---------------------------------------------------------------- generate next period

export async function generateNextRental(
  id: number,
  source: 'WEB' | 'SYSTEM',
): Promise<number> {
  const original = await prisma.rental.findUnique({
    where: { id },
    include: { entry: true, unit: true },
  });
  if (!original) throw notFound('Rental');
  if (original.status === 'VOID') {
    throw conflict('RENTAL_VOID', 'Cannot generate the next period from a voided rental');
  }
  if (
    !original.unit.active ||
    original.unit.status === 'SOLD' ||
    original.unit.status === 'DISPOSED'
  ) {
    throw badRequest(
      'UNIT_NOT_RENTABLE',
      `Unit ${original.unit.code} can no longer be rented out — turn off recurring or void the rental`,
    );
  }

  const next = computeNextPeriod(
    fromDbDate(original.startDate),
    original.endDate ? fromDbDate(original.endDate) : null,
  );
  const seriesRootId = original.parentId ?? original.id;
  const vatInvoice = original.entry?.vatInvoice ?? false;
  const vatRateBp = await vatRateOn(next.startDate);

  const createdId = await prisma.$transaction(async (tx) => {
    const duplicate = await tx.rental.findFirst({
      where: {
        status: 'ACTIVE',
        startDate: toDbDate(next.startDate),
        OR: [{ parentId: seriesRootId }, { id: seriesRootId }],
      },
      select: { id: true },
    });
    if (duplicate) {
      throw conflict(
        'PERIOD_EXISTS',
        `A rental for the period starting ${next.startDate} already exists in this series`,
      );
    }
    const modelId = await rentalModelId(tx);
    const rental = await tx.rental.create({
      data: {
        unitId: original.unitId,
        customerId: original.customerId,
        customerName: original.customerName,
        startDate: toDbDate(next.startDate),
        endDate: next.endDate ? toDbDate(next.endDate) : null,
        periodText: next.periodText,
        amountCents: original.amountCents,
        depositCents: 0, // the deposit is held once per series, on the first period
        recurring: original.recurring,
        parentId: seriesRootId,
        agreementSigned: original.agreementSigned,
        source,
        createdById: currentUserId() ?? null,
      },
    });
    await createEntry(tx, {
      entryDate: next.startDate,
      modelId,
      unitId: original.unitId,
      customerId: original.customerId,
      customerName: original.customerName,
      description: entryDescription(original.unit.code, next.periodText),
      grossBeforeDiscountCents: original.amountCents,
      discountCents: 0,
      vatInvoice,
      vatRateBp,
      paymentStatus: 'NOT_YET_BILLED',
      source,
      rentalId: rental.id,
    });
    await occupyUnit(tx, original.unitId);
    return rental.id;
  });

  const created = await prisma.rental.findUnique({ where: { id: createdId }, include: { entry: true } });
  await audit('CREATE', 'rentals', createdId, undefined, created);
  return createdId;
}
