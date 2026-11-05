import { z } from 'zod';

/** Zod schemas for the /expenses module. Amounts are integer cents, dates are YYYY-MM-DD. */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE_RE, 'Expected YYYY-MM-DD');

export const idParam = z.object({ id: z.coerce.number().int().positive() });

const boolQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const ExpenseListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  from: isoDate.optional(),
  to: isoDate.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  paidById: z.coerce.number().int().positive().optional(),
  unitId: z.coerce.number().int().positive().optional(),
  needsReview: boolQuery,
  q: z.string().trim().max(200).optional(),
});

export const CreateExpenseSchema = z.object({
  expenseDate: isoDate.nullish(),
  categoryId: z.number().int().positive(),
  description: z.string().trim().min(1).max(500),
  vendor: z.string().trim().max(200).nullish(),
  qtyText: z.string().trim().max(100).nullish(),
  grossCents: z.number().int().min(0).nullish(),
  vatRateBp: z.number().int().min(0).max(10000).optional(),
  hasValidReceipt: z.boolean().default(false),
  businessUsePct: z.number().int().min(0).max(100).default(100),
  paidById: z.number().int().positive().nullish(),
  jointReinvested: z.boolean().default(false),
  unitId: z.number().int().positive().nullish(),
  productId: z.number().int().positive().nullish(),
  stockQty: z.number().int().positive().nullish(),
  purchasedFor: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const UpdateExpenseSchema = CreateExpenseSchema.partial();

export const VoidSchema = z.object({ reason: z.string().trim().min(1).max(500) });
