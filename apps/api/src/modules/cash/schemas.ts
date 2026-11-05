import { z } from 'zod';

/** Zod schemas for the /cash module ("Cash & settlements"). */

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Query params arrive as strings; treat `?holderId=&from=` (empty values) as "not given". */
function blankAsUndefined<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return z.preprocess((v) => (v === '' ? undefined : v), schema) as z.ZodEffects<T>;
}

export const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });

const pagination = {
  page: blankAsUndefined(z.coerce.number().int().min(1).default(1)),
  pageSize: blankAsUndefined(z.coerce.number().int().min(1).max(200).default(50)),
};

const optionalId = blankAsUndefined(z.coerce.number().int().positive().optional());
const optionalDate = blankAsUndefined(isoDate.optional());

export const LedgerQuerySchema = z.object({
  holderId: optionalId,
  from: optionalDate,
  to: optionalDate,
  ...pagination,
});

export const HandoverListQuerySchema = z.object({
  holderId: optionalId,
  fromHolderId: optionalId,
  toHolderId: optionalId,
  from: optionalDate,
  to: optionalDate,
  status: blankAsUndefined(z.enum(['ACTIVE', 'VOID']).optional()),
  ...pagination,
});

export const CreateHandoverSchema = z.object({
  date: isoDate,
  fromHolderId: z.number().int().positive(),
  toHolderId: z.number().int().positive(),
  amountCents: z.number().int().positive('Handover amount must be positive'),
  note: z.string().max(500).nullish(),
  /** Set true to allow handing over more than the holder currently holds (OVERDRAWN warning). */
  force: z.boolean().optional(),
});

export const VoidSchema = z.object({ reason: z.string().min(1).max(500) });
