import { z } from 'zod';

/**
 * Zod schemas for the /pos module.
 * Amounts are integer euro cents; dates are 'YYYY-MM-DD' strings; VAT rates are basis points.
 */

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** Treat empty query-string values (`?status=&date=`) as "not set" so defaults apply. */
const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;
const filter = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema);

export const idParam = z.object({ id: z.coerce.number().int().positive() });
export const lineParams = z.object({
  id: z.coerce.number().int().positive(),
  lineId: z.coerce.number().int().positive(),
});

/** Quantity with at most 2 decimals (SaleLine.qty is Decimal(10,2)). */
export const qtySchema = z
  .number()
  .positive()
  .max(99_999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'At most 2 decimal places');

export const SALE_STATUS = ['PARKED', 'COMPLETED', 'REFUNDED', 'VOID'] as const;
export type SaleStatusName = (typeof SALE_STATUS)[number];

// ---------------------------------------------------------------- sales

export const CreateSaleSchema = z.object({
  modelId: z.number().int().positive(),
  customerId: z.number().int().positive().nullish(),
  unitId: z.number().int().positive().nullish(),
  /** Z-report day; defaults to today (Europe/Helsinki). */
  businessDate: isoDate.optional(),
  notes: z.string().trim().max(2000).nullish(),
});
export type CreateSaleBody = z.infer<typeof CreateSaleSchema>;

export const ListSalesQuerySchema = z.object({
  status: filter(z.enum(SALE_STATUS).default('PARKED')),
  date: filter(isoDate.optional()),
  page: filter(z.coerce.number().int().min(1).default(1)),
  pageSize: filter(z.coerce.number().int().min(1).max(200).default(50)),
});
export type ListSalesQuery = z.infer<typeof ListSalesQuerySchema>;

export const UpdateSaleSchema = z.object({
  cartDiscountCents: z.number().int().min(0).optional(),
  /** Percentage alternative — converted to cents of the current line total; cents win when both sent. */
  cartDiscountPct: z.number().min(0).max(100).optional(),
  cartDiscountReason: z.string().trim().max(200).nullish(),
  customerId: z.number().int().positive().nullish(),
  unitId: z.number().int().positive().nullish(),
  modelId: z.number().int().positive().optional(),
  notes: z.string().trim().max(2000).nullish(),
});
export type UpdateSaleBody = z.infer<typeof UpdateSaleSchema>;

// ---------------------------------------------------------------- lines

const lineFields = {
  productId: z.number().int().positive().nullish(),
  description: z.string().trim().min(1).max(300).optional(),
  qty: qtySchema,
  unitPriceCents: z.number().int().min(0).optional(),
  discountCents: z.number().int().min(0).optional(),
  /** Percentage alternative — cents win when both sent. */
  discountPct: z.number().min(0).max(100).optional(),
  discountReason: z.string().trim().max(200).nullish(),
  vatRateBp: z.number().int().min(0).max(10000).optional(),
  isLabour: z.boolean().optional(),
};

export const AddLineSchema = z
  .object(lineFields)
  .refine((v) => v.productId != null || v.description !== undefined, {
    message: 'description is required for a custom line (no productId)',
    path: ['description'],
  })
  .refine((v) => v.productId != null || v.unitPriceCents !== undefined, {
    message: 'unitPriceCents is required for a custom line (no productId)',
    path: ['unitPriceCents'],
  });
export type AddLineBody = z.infer<typeof AddLineSchema>;

export const UpdateLineSchema = z.object({ ...lineFields, qty: qtySchema.optional() });
export type UpdateLineBody = z.infer<typeof UpdateLineSchema>;

// ---------------------------------------------------------------- complete / refund

const PaymentSplitSchema = z
  .object({
    methodId: z.number().int().positive().nullish(),
    receivedById: z.number().int().positive(),
    /** Amount tendered for this split (incl. any change to give back). */
    amountCents: z.number().int().min(1),
    /** Cash change given back to the customer out of this split. */
    changeCents: z.number().int().min(0).optional(),
  })
  .refine((p) => (p.changeCents ?? 0) <= p.amountCents, {
    message: 'Change cannot exceed the amount tendered',
    path: ['changeCents'],
  });

export const CompleteSaleSchema = z.object({
  payments: z.array(PaymentSplitSchema).min(1).max(10),
  /** Default: defaultVatInvoice(first receiver, first method). */
  vatInvoice: z.boolean().optional(),
  /** Allow overselling when stock is insufficient (OUT_OF_STOCK otherwise). */
  force: z.boolean().default(false),
});
export type CompleteSaleBody = z.infer<typeof CompleteSaleSchema>;

export const RefundSchema = z.object({
  lines: z
    .array(z.object({ lineId: z.number().int().positive(), qty: qtySchema }))
    .min(1)
    .max(100),
  reason: z.string().trim().min(1).max(500),
  restock: z.boolean(),
  refundPayments: z
    .array(
      z.object({
        methodId: z.number().int().positive().nullish(),
        receivedById: z.number().int().positive(),
        /** Positive amount paid back; stored as a negative Payment row. */
        amountCents: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(10),
});
export type RefundBody = z.infer<typeof RefundSchema>;

// ---------------------------------------------------------------- z-report / receipt

export const ZReportQuerySchema = z.object({
  date: filter(isoDate.optional()),
  format: filter(z.enum(['json', 'pdf']).default('json')),
});
export type ZReportQuery = z.infer<typeof ZReportQuerySchema>;

export const ReceiptQuerySchema = z.object({
  width: filter(
    z.coerce
      .number()
      .int()
      .refine((v) => v === 80 || v === 58, 'width must be 80 or 58')
      .default(80),
  ),
  format: filter(z.enum(['html', 'pdf']).default('html')),
  /** Accepted for contract compatibility; the PDF variant is always A4. */
  a4: filter(z.coerce.number().int().optional()),
});
export type ReceiptQuery = z.infer<typeof ReceiptQuerySchema>;
