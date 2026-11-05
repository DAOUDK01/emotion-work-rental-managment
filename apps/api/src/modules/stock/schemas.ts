import { z } from 'zod';

/**
 * Zod schemas for the /stock module.
 * Quantities are integer pieces (signed where documented); costs are integer cents.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE_RE, 'Expected YYYY-MM-DD');

export const ReceiveSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().int().min(1),
  unitCostCents: z.number().int().min(0).nullish(),
  supplierId: z.number().int().positive().nullish(),
  shippingCents: z.number().int().min(0).nullish(),
  customsCents: z.number().int().min(0).nullish(),
  importVatCents: z.number().int().min(0).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const AdjustSchema = z.object({
  productId: z.number().int().positive(),
  qty: z
    .number()
    .int()
    .refine((v) => v !== 0, 'Adjustment quantity cannot be zero'),
  // Presence is enforced in the handler so a missing reason is a stable 400 REASON_REQUIRED.
  reason: z.string().trim().max(500).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const RepairUseSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().int().min(1),
  unitId: z.number().int().positive().nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const MovementListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  productId: z.coerce.number().int().positive().optional(),
  type: z
    .enum(['PURCHASE', 'SALE', 'RETURN', 'ADJUSTMENT', 'REPAIR_USE', 'TRANSFER', 'IMPORT'])
    .optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
