import { z } from 'zod';

/** Calendar date 'YYYY-MM-DD' that must exist on the calendar (2026-02-31 is rejected). */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((d) => {
    const dt = new Date(`${d}T12:00:00Z`);
    return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === d;
  }, 'Not a real calendar date');

export const UNIT_CATEGORIES = ['E_SCOOTER', 'E_BIKE', 'MOPED'] as const;
export const UNIT_STATUSES = [
  'AVAILABLE',
  'ON_RENT',
  'WAITING_PARTS',
  'IN_REPAIR',
  'SOLD',
  'DISPOSED',
] as const;

export const idParam = z.object({ id: z.coerce.number().int().positive() });

/** `?includeInactive=true|1` → true; anything else (missing, '', 'false', '0') → false. */
const boolQuery = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => v === true || v === 'true' || v === '1');

export const ListQuerySchema = z.object({
  status: z.enum(UNIT_STATUSES).optional(),
  category: z.enum(UNIT_CATEGORIES).optional(),
  q: z.string().trim().max(100).optional(),
  includeInactive: boolQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// Cents stay well inside Postgres Int4 (±2.1 billion = €21 million).
const cents = z.number().int().min(0).max(2_000_000_000);

const UnitBodySchema = z.object({
  brand: z.string().trim().min(1).max(80),
  modelName: z.string().trim().max(80).nullish(),
  category: z.enum(UNIT_CATEGORIES),
  inclusions: z.string().trim().max(300).nullish(),
  purchaseDate: isoDate.nullish(),
  sellerName: z.string().trim().max(120).nullish(),
  purchaseCents: cents.nullish(),
  ownerId: z.number().int().positive().nullish(),
  paidById: z.number().int().positive().nullish(),
  status: z.enum(UNIT_STATUSES).optional(),
  notes: z.string().trim().max(2000).nullish(),
  codeOverride: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Code may contain letters, numbers, ". _ -"')
    .nullish(),
});

export const UnitCreateSchema = UnitBodySchema;
export const UnitUpdateSchema = UnitBodySchema.partial();

export const SellSchema = z.object({
  soldCents: cents,
  soldDate: isoDate,
  buyerCustomerId: z.number().int().positive().nullish(),
  buyerName: z.string().trim().max(120).nullish(),
  receivedById: z.number().int().positive(),
  paymentMethodId: z.number().int().positive().nullish(),
  vatInvoice: z.boolean().optional(),
});

export const VoidSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export type ListQuery = z.infer<typeof ListQuerySchema>;
export type UnitCreateInput = z.infer<typeof UnitCreateSchema>;
export type UnitUpdateInput = z.infer<typeof UnitUpdateSchema>;
export type SellInput = z.infer<typeof SellSchema>;
export type VoidInput = z.infer<typeof VoidSchema>;
