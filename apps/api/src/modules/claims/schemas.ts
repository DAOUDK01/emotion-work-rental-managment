import { z } from 'zod';

/** 'YYYY-MM-DD' calendar-date strings (Europe/Helsinki business dates). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const ClaimStatusEnum = z.enum(['OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID']);

/** Treat empty query-string values (`?status=&q=`) as "filter not set". */
const blankToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;
const filter = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema);

/** Empty / whitespace-only strings from web forms become null (clears the field). */
const emptyToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** Optional free-text field: key missing → undefined (leave as is), '' → null (clear). */
const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().min(1).max(max).nullable()).optional();

const centsField = z.number().int().min(0).max(100_000_000);

export const ClaimIdParam = z.object({ id: z.coerce.number().int().positive() });

export const ListClaimsQuery = z.object({
  status: filter(ClaimStatusEnum.optional()),
  /** Case-insensitive search across caseNumber, company and description. */
  q: filter(z.string().trim().min(1).max(120).optional()),
  page: filter(z.coerce.number().int().min(1).default(1)),
  /** Capped at 200 (clamped, not rejected) per the list conventions. */
  pageSize: filter(
    z
      .coerce.number()
      .int()
      .min(1)
      .default(50)
      .transform((v) => Math.min(v, 200)),
  ),
});
export type ListClaimsQueryT = z.infer<typeof ListClaimsQuery>;

export const CreateClaimSchema = z.object({
  /** The warranty / insurance company the case is filed with. */
  company: z.string().trim().min(1, 'Company is required').max(200),
  customerId: z.number().int().positive().nullish(),
  unitId: z.number().int().positive().nullish(),
  productId: z.number().int().positive().nullish(),
  description: z.string().trim().min(1, 'Description is required').max(2000),
  status: ClaimStatusEnum.default('OPEN'),
  claimedCents: centsField.nullish(),
  approvedCents: centsField.nullish(),
  submittedAt: isoDate.nullish(),
  decidedAt: isoDate.nullish(),
  notes: optionalText(2000),
});
export type CreateClaimBody = z.infer<typeof CreateClaimSchema>;

/** PUT: any subset of the fields; status changes go through POST /claims/:id/status. */
export const UpdateClaimSchema = CreateClaimSchema.omit({ status: true }).partial();
export type UpdateClaimBody = z.infer<typeof UpdateClaimSchema>;

export const ClaimStatusSchema = z.object({
  status: ClaimStatusEnum,
  approvedCents: centsField.nullish(),
  decidedAt: isoDate.nullish(),
});
export type ClaimStatusBody = z.infer<typeof ClaimStatusSchema>;
