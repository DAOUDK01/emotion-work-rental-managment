import { z } from 'zod';

/**
 * Zod schemas for the /entries module (the quick-entry backbone).
 * Amounts are integer euro cents; dates are 'YYYY-MM-DD' strings.
 */

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** Query-string boolean: accepts true/false/1/0. */
const boolParam = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const PAYMENT_STATUS = ['PAID', 'INVOICED', 'PENDING', 'NOT_YET_BILLED'] as const;
export const ENTRY_SOURCE = ['POS', 'WEB', 'WHATSAPP', 'IMPORT', 'SYSTEM'] as const;

export const ListEntriesQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  modelId: z.coerce.number().int().positive().optional(),
  unitId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  receivedById: z.coerce.number().int().positive().optional(),
  paymentStatus: z.enum(PAYMENT_STATUS).optional(),
  vatInvoice: boolParam.optional(),
  source: z.enum(ENTRY_SOURCE).optional(),
  needsReview: boolParam.optional(),
  /** Extra (not in the contract line, additive): show only ACTIVE or only VOID rows. */
  status: z.enum(['ACTIVE', 'VOID']).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListEntriesQuery = z.infer<typeof ListEntriesQuerySchema>;

export const CreateEntrySchema = z.object({
  entryDate: isoDate,
  modelId: z.number().int().positive(),
  unitId: z.number().int().positive().nullish(),
  customerId: z.number().int().positive().nullish(),
  customerName: z.string().trim().max(200).nullish(),
  description: z.string().trim().max(2000).nullish(),
  /** Gross amount BEFORE discount, integer cents (VAT-inclusive when a VAT invoice is issued). */
  grossBeforeDiscountCents: z.number().int().min(0),
  discountCents: z.number().int().min(0).default(0),
  discountReason: z.string().trim().max(200).nullish(),
  /** Default: shared defaultVatInvoice(receivedById, paymentMethodId). */
  vatInvoice: z.boolean().optional(),
  /** Default: vatRateOn(entryDate). */
  vatRateBp: z.number().int().min(0).max(10000).optional(),
  labourCents: z.number().int().min(0).nullish(),
  partsCents: z.number().int().min(0).nullish(),
  paymentStatus: z.enum(PAYMENT_STATUS),
  /** Part-payment received now on a PENDING/INVOICED entry (cents); the rest stays owed. */
  paidNowCents: z.number().int().min(0).nullish(),
  paymentMethodId: z.number().int().positive().nullish(),
  receivedById: z.number().int().positive().nullish(),
  needsReview: z.boolean().optional(),
  reviewReason: z.string().trim().max(500).nullish(),
});
export type CreateEntryBody = z.infer<typeof CreateEntrySchema>;

/** PUT body: any subset of the POST fields. undefined = keep, null = clear (nullable fields).
 *  Part-payments after creation go through POST /entries/:id/payments, not PUT. */
export const UpdateEntrySchema = CreateEntrySchema.omit({ paidNowCents: true }).partial();
export type UpdateEntryBody = z.infer<typeof UpdateEntrySchema>;

export const VoidEntrySchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type VoidEntryBody = z.infer<typeof VoidEntrySchema>;

export const MarkPaidSchema = z.object({
  receivedById: z.number().int().positive(),
  paymentMethodId: z.number().int().positive().nullish(),
  /** Day the money arrived; defaults to today (Europe/Helsinki). */
  date: isoDate.optional(),
});
export type MarkPaidBody = z.infer<typeof MarkPaidSchema>;

/** POST /entries/:id/payments — record (part of) the money still owed on an open entry. */
export const RecordPaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  receivedById: z.number().int().positive(),
  paymentMethodId: z.number().int().positive().nullish(),
  /** Day the money arrived; defaults to today (Europe/Helsinki). */
  date: isoDate.optional(),
});
export type RecordPaymentBody = z.infer<typeof RecordPaymentSchema>;

/**
 * Live form preview — pure computation, no DB writes.
 * All amounts are integer CENTS. Preferred names: grossCents, discountCents, vatInvoice, rateBp.
 * The contract's shorthand spellings gross / discount are accepted as aliases (also cents).
 */
export const PreviewQuerySchema = z
  .object({
    grossCents: z.coerce.number().int().min(0).optional(),
    gross: z.coerce.number().int().min(0).optional(),
    discountCents: z.coerce.number().int().min(0).optional(),
    discount: z.coerce.number().int().min(0).optional(),
    vatInvoice: boolParam.optional(),
    rateBp: z.coerce.number().int().min(0).max(10000).optional(),
  })
  .refine((v) => v.grossCents !== undefined || v.gross !== undefined, {
    message: 'grossCents (integer cents) is required',
    path: ['grossCents'],
  });
export type PreviewQuery = z.infer<typeof PreviewQuerySchema>;
