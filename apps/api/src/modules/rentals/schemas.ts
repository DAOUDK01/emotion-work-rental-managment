import { z } from 'zod';

/** 'YYYY-MM-DD' calendar-date strings (Europe/Helsinki business dates). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const PaymentStatusEnum = z.enum(['PAID', 'INVOICED', 'PENDING', 'NOT_YET_BILLED']);

/** Treat empty query-string values (`?status=&unitId=`) as "filter not set". */
const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;
const filter = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema);

export const ListRentalsQuery = z.object({
  status: filter(z.enum(['ACTIVE', 'VOID']).optional()),
  paymentStatus: filter(PaymentStatusEnum.optional()),
  unitId: filter(z.coerce.number().int().positive().optional()),
  customerId: filter(z.coerce.number().int().positive().optional()),
  from: filter(isoDate.optional()),
  to: filter(isoDate.optional()),
  q: filter(z.string().trim().min(1).max(120).optional()),
  page: filter(z.coerce.number().int().min(1).default(1)),
  pageSize: filter(z.coerce.number().int().min(1).max(200).default(50)),
});
export type ListRentalsQueryT = z.infer<typeof ListRentalsQuery>;

export const CreateRentalSchema = z.object({
  unitId: z.number().int().positive(),
  customerId: z.number().int().positive().nullish(),
  customerName: z.string().trim().min(1).max(120).nullish(),
  handOverDate: isoDate.nullish(),
  startDate: isoDate,
  endDate: isoDate.nullish(),
  periodText: z.string().trim().min(1).max(60).nullish(),
  /** Rent for the period BEFORE discount (cents). The entry stores gross after discount. */
  amountCents: z.number().int().min(0).max(100_000_000),
  depositCents: z.number().int().min(0).max(100_000_000).default(0),
  discountCents: z.number().int().min(0).max(100_000_000).default(0),
  discountReason: z.string().trim().max(200).nullish(),
  vatInvoice: z.boolean().optional(),
  vatRateBp: z.number().int().min(0).max(10000).optional(),
  paymentStatus: PaymentStatusEnum,
  paymentMethodId: z.number().int().positive().nullish(),
  receivedById: z.number().int().positive().nullish(),
  recurring: z.boolean().default(false),
  agreementSigned: z.boolean().default(false),
  notes: z.string().trim().max(2000).nullish(),
});
export type CreateRentalBody = z.infer<typeof CreateRentalSchema>;

/** PUT body: any subset; absent keys keep the stored value, explicit null clears a nullable field. */
export const UpdateRentalSchema = CreateRentalSchema.partial();
export type UpdateRentalBody = z.infer<typeof UpdateRentalSchema>;

export const VoidRentalSchema = z.object({ reason: z.string().trim().min(1).max(500) });
export type VoidRentalBody = z.infer<typeof VoidRentalSchema>;

export const IdParam = z.object({ id: z.coerce.number().int().positive() });
