import type { Prisma, PrismaClient } from '@prisma/client';
import { incomeVat, type ISODate } from '@emotionfix/shared';
import { prisma } from '../db.js';
import { badRequest } from '../errors.js';
import { getSetting } from './settings.js';
import { currentUserId } from '../context.js';

/**
 * THE income ledger. Every euro of income — POS sale, invoice, rental period,
 * quick entry, WhatsApp entry, import — becomes exactly one Entry row here.
 * This service centralises the business rules:
 *  - VAT split from gross (or non-VAT income when no VAT invoice was issued)
 *  - discounts are recorded in the discounts table (VAT is on the price AFTER discount)
 *  - a PAID entry gets a Payment row against "Amount received by" (the no-escape rule)
 *  - customer segment snapshot for dashboard filters
 */

export type Tx = Prisma.TransactionClient | PrismaClient;

export interface CreateEntryInput {
  entryDate: ISODate;
  modelId: number;
  unitId?: number | null;
  customerId?: number | null;
  customerName?: string | null;
  description?: string | null;
  /** Gross amount BEFORE discount, in cents. */
  grossBeforeDiscountCents: number;
  discountCents?: number;
  discountReason?: string | null;
  vatInvoice: boolean;
  vatRateBp: number;
  labourCents?: number | null;
  partsCents?: number | null;
  paymentStatus: 'PAID' | 'INVOICED' | 'PENDING' | 'NOT_YET_BILLED';
  paymentMethodId?: number | null;
  receivedById?: number | null;
  source: 'POS' | 'WEB' | 'WHATSAPP' | 'IMPORT' | 'SYSTEM';
  saleId?: number | null;
  rentalId?: number | null;
  invoiceId?: number | null;
  whatsappMessageId?: number | null;
  importBatchId?: number | null;
  needsReview?: boolean;
  reviewReason?: string | null;
}

export async function createEntry(tx: Tx, input: CreateEntryInput) {
  const discount = input.discountCents ?? 0;
  if (discount < 0) throw badRequest('BAD_DISCOUNT', 'Discount cannot be negative');
  const grossAfterDiscount = input.grossBeforeDiscountCents - discount;
  if (grossAfterDiscount < 0) {
    throw badRequest('DISCOUNT_EXCEEDS_AMOUNT', 'Discount is larger than the amount');
  }
  // Every income needs "Amount received by" when money was actually received.
  if (input.paymentStatus === 'PAID' && !input.receivedById) {
    throw badRequest('RECEIVED_BY_REQUIRED', '"Amount received by" is required for received money');
  }

  const vat = incomeVat(grossAfterDiscount, input.vatRateBp, input.vatInvoice);

  let segment: 'INDIVIDUAL' | 'BUSINESS' = 'INDIVIDUAL';
  if (input.customerId) {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw badRequest('BAD_CUSTOMER', 'Customer not found');
    segment = customer.type;
  }

  const entry = await tx.entry.create({
    data: {
      entryDate: new Date(`${input.entryDate}T00:00:00Z`),
      modelId: input.modelId,
      unitId: input.unitId ?? null,
      customerId: input.customerId ?? null,
      customerName: input.customerName ?? null,
      description: input.description ?? null,
      grossCents: grossAfterDiscount,
      discountCents: discount,
      discountReason: input.discountReason ?? null,
      vatInvoice: input.vatInvoice,
      vatRateBp: input.vatRateBp,
      vatCents: vat.vatCents,
      netCents: vat.netCents,
      labourCents: input.labourCents ?? null,
      partsCents: input.partsCents ?? null,
      paymentStatus: input.paymentStatus,
      paymentMethodId: input.paymentMethodId ?? null,
      receivedById: input.receivedById ?? null,
      segment,
      source: input.source,
      saleId: input.saleId ?? null,
      rentalId: input.rentalId ?? null,
      invoiceId: input.invoiceId ?? null,
      whatsappMessageId: input.whatsappMessageId ?? null,
      importBatchId: input.importBatchId ?? null,
      needsReview: input.needsReview ?? false,
      reviewReason: input.reviewReason ?? null,
      createdById: currentUserId() ?? null,
    },
  });

  if (discount > 0) {
    await tx.discountRecord.create({
      data: {
        date: entry.entryDate,
        amountCents: discount,
        reason: input.discountReason ?? null,
        modelId: input.modelId,
        entryId: entry.id,
        saleId: input.saleId ?? null,
        invoiceId: input.invoiceId ?? null,
      },
    });
  }

  // Money actually received -> ledger row for the holder ("no escape point").
  if (input.paymentStatus === 'PAID' && input.receivedById) {
    await tx.payment.create({
      data: {
        date: entry.entryDate,
        amountCents: grossAfterDiscount,
        methodId: input.paymentMethodId ?? null,
        receivedById: input.receivedById,
        entryId: entry.id,
        saleId: input.saleId ?? null,
        invoiceId: input.invoiceId ?? null,
        createdById: currentUserId() ?? null,
      },
    });
  }

  return entry;
}

/** Void an entry (financial rows are never hard-deleted). Voids its payments too. */
export async function voidEntry(tx: Tx, entryId: number, reason: string) {
  const entry = await tx.entry.findUnique({ where: { id: entryId } });
  if (!entry) throw badRequest('NOT_FOUND', 'Entry not found');
  if (entry.status === 'VOID') return entry;
  const updated = await tx.entry.update({
    where: { id: entryId },
    data: { status: 'VOID', voidReason: reason },
  });
  await tx.payment.updateMany({ where: { entryId }, data: { status: 'VOID' } });
  await tx.discountRecord.deleteMany({ where: { entryId } });
  return updated;
}

/**
 * Default for the "VAT invoice issued?" flag:
 * primarily by WHO received the money (setting vatDefaults.byHolder,
 * e.g. Company Account -> Yes, Cash -> No), then by payment method default.
 * The user can always change it; the accountant confirms the treatment.
 */
export async function defaultVatInvoice(
  receivedById?: number | null,
  paymentMethodId?: number | null,
): Promise<boolean> {
  const defaults = await getSetting<{ byHolder: Record<string, boolean> }>('vatDefaults', {
    byHolder: {},
  });
  if (receivedById) {
    const holder = await prisma.moneyHolder.findUnique({ where: { id: receivedById } });
    if (holder && holder.name in defaults.byHolder) return defaults.byHolder[holder.name];
  }
  if (paymentMethodId) {
    const method = await prisma.paymentMethod.findUnique({ where: { id: paymentMethodId } });
    if (method) return method.defaultVatInvoice;
  }
  return false;
}

/** The VAT rate (basis points) valid on a date, from the effective-dated default series. */
export async function vatRateOn(date: ISODate): Promise<number> {
  const rate = await prisma.vatRate.findFirst({
    where: { isDefault: true, validFrom: { lte: new Date(`${date}T00:00:00Z`) } },
    orderBy: { validFrom: 'desc' },
  });
  return rate?.rateBp ?? 2550;
}

/** Corporate tax rate (basis points) valid on a date. */
export async function taxRateOn(date: ISODate): Promise<number> {
  const rate = await prisma.taxRate.findFirst({
    where: { validFrom: { lte: new Date(`${date}T00:00:00Z`) } },
    orderBy: { validFrom: 'desc' },
  });
  return rate?.rateBp ?? 2000;
}
