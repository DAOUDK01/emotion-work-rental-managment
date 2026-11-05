import { z } from 'zod';

/** 'YYYY-MM-DD' calendar-date strings (Europe/Helsinki business dates). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const InvoiceStatusEnum = z.enum(['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']);

/** Treat empty query-string values (`?status=&customerId=`) as "filter not set". */
const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;
const filter = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema);

/** `?overdue=true|1` — z.coerce.boolean would treat "false" as true, so map explicitly. */
const boolParam = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

// ---------------------------------------------------------------- queries

export const ListInvoicesQuery = z.object({
  status: filter(InvoiceStatusEnum.optional()),
  customerId: filter(z.coerce.number().int().positive().optional()),
  overdue: filter(boolParam.optional()),
  from: filter(isoDate.optional()),
  to: filter(isoDate.optional()),
  q: filter(z.string().trim().min(1).max(120).optional()),
  page: filter(z.coerce.number().int().min(1).default(1)),
  pageSize: filter(z.coerce.number().int().min(1).max(200).default(50)),
});
export type ListInvoicesQueryT = z.infer<typeof ListInvoicesQuery>;

export const OverdueQuery = z.object({
  page: filter(z.coerce.number().int().min(1).default(1)),
  pageSize: filter(z.coerce.number().int().min(1).max(200).default(50)),
});
export type OverdueQueryT = z.infer<typeof OverdueQuery>;

export const ListCreditNotesQuery = z.object({
  from: filter(isoDate.optional()),
  to: filter(isoDate.optional()),
  q: filter(z.string().trim().min(1).max(120).optional()),
  page: filter(z.coerce.number().int().min(1).default(1)),
  pageSize: filter(z.coerce.number().int().min(1).max(200).default(50)),
});
export type ListCreditNotesQueryT = z.infer<typeof ListCreditNotesQuery>;

export const PdfQuery = z.object({
  format: filter(z.enum(['a4', 'thermal']).default('a4')),
  width: filter(
    z.coerce
      .number()
      .int()
      .refine((w): w is 58 | 80 => w === 58 || w === 80, 'width must be 58 or 80')
      .default(80),
  ),
});
export type PdfQueryT = z.infer<typeof PdfQuery>;

export const IdParam = z.object({ id: z.coerce.number().int().positive() });

// ---------------------------------------------------------------- bodies

/** Quantities carry at most 2 decimals (DB column is Decimal(10,2)). */
const qtySchema = z
  .number()
  .positive()
  .max(100_000)
  .transform((q) => Math.round(q * 100) / 100)
  .refine((q) => q > 0, 'Quantity is too small');

/**
 * One invoice line: a product line (price/VAT default from the product — same as POS)
 * or a free-text line (description + unitPriceCents required).
 */
export const InvoiceLineInput = z
  .object({
    productId: z.number().int().positive().nullish(),
    description: z.string().trim().min(1).max(300).nullish(),
    qty: qtySchema,
    unitPriceCents: z.number().int().min(0).max(100_000_000).nullish(),
    discountCents: z.number().int().min(0).max(100_000_000).default(0),
    discountReason: z.string().trim().max(200).nullish(),
    vatRateBp: z.number().int().min(0).max(10000).nullish(),
    isLabour: z.boolean().default(false),
  })
  .refine((l) => l.productId != null || (l.description != null && l.description !== ''), {
    message: 'Each line needs a productId or a description',
  })
  .refine((l) => l.productId != null || l.unitPriceCents != null, {
    message: 'unitPriceCents is required for free-text lines',
  });
export type InvoiceLineInputT = z.infer<typeof InvoiceLineInput>;

export const CreateInvoiceSchema = z.object({
  customerId: z.number().int().positive(),
  modelId: z.number().int().positive().nullish(),
  unitId: z.number().int().positive().nullish(),
  rentalId: z.number().int().positive().nullish(),
  language: z.enum(['EN', 'FI']).optional(),
  issueDate: isoDate,
  deliveryDate: isoDate.nullish(),
  periodText: z.string().trim().min(1).max(120).nullish(),
  termsDays: z.number().int().min(0).max(365).optional(),
  dueDate: isoDate.optional(),
  notes: z.string().trim().max(2000).nullish(),
  lines: z.array(InvoiceLineInput).min(1).max(200),
});
export type CreateInvoiceBody = z.infer<typeof CreateInvoiceSchema>;

/** PUT body (DRAFT only): any subset; `lines`, when given, replaces ALL lines. */
export const UpdateInvoiceSchema = CreateInvoiceSchema.partial();
export type UpdateInvoiceBody = z.infer<typeof UpdateInvoiceSchema>;

export const SendInvoiceSchema = z.object({
  email: z.string().trim().email().max(200).optional(),
});
export type SendInvoiceBody = z.infer<typeof SendInvoiceSchema>;

export const AddPaymentSchema = z.object({
  date: isoDate,
  amountCents: z.number().int().min(1).max(100_000_000),
  methodId: z.number().int().positive().nullish(),
  receivedById: z.number().int().positive(),
  reference: z.string().trim().max(70).nullish(),
});
export type AddPaymentBody = z.infer<typeof AddPaymentSchema>;

export const CreditNoteSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  /** Absent = FULL credit (all lines, invoice CANCELLED + entry voided). */
  lines: z
    .array(z.object({ lineId: z.number().int().positive(), qty: qtySchema }))
    .min(1)
    .max(200)
    .optional(),
  restock: z.boolean().default(false),
});
export type CreditNoteBody = z.infer<typeof CreditNoteSchema>;

export const RemindSchema = z.object({
  email: z.string().trim().email().max(200).optional(),
});
export type RemindBody = z.infer<typeof RemindSchema>;
