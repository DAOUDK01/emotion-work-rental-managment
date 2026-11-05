import { z } from 'zod';

/** Empty / whitespace-only strings from web forms become null (clears the field). */
const emptyToNull = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/** Optional free-text field: key missing → undefined (leave as is), '' → null (clear). */
const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().min(1).max(max).nullable()).optional();

export const CustomerIdParam = z.object({ id: z.coerce.number().int().positive() });

export const ListCustomersQuery = z.object({
  /** Case-insensitive search across name, email and businessId. */
  q: z.preprocess(emptyToNull, z.string().trim().max(200).nullable()).optional(),
  type: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  /** Tri-state: 'true' → archived only, 'false' → active only, absent → everyone. */
  archived: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  /** Capped at 200 (clamped, not rejected) per the list conventions. */
  pageSize: z
    .coerce.number()
    .int()
    .min(1)
    .default(50)
    .transform((v) => Math.min(v, 200)),
});

export const CreateCustomerSchema = z.object({
  type: z.enum(['INDIVIDUAL', 'BUSINESS']),
  name: z.string().trim().min(1, 'Name is required').max(200),
  /** Y-tunnus. Checked warn-level with shared isValidBusinessId — never rejected here. */
  businessId: optionalText(40),
  email: z
    .preprocess(emptyToNull, z.string().trim().email('Invalid email address').max(200).nullable())
    .optional(),
  /** Personal data (GDPR) — stored for everyone, returned to admins only. */
  phone: optionalText(40),
  address: optionalText(300),
  postalCode: optionalText(20),
  city: optionalText(100),
  /** Column is NOT NULL (default 'FI'): '' or missing leaves the stored/default value. */
  country: z
    .preprocess(
      emptyToNull,
      z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/, 'Use a 2-letter ISO country code, e.g. FI')
        .transform((s) => s.toUpperCase())
        .nullable(),
    )
    .transform((v) => v ?? undefined)
    .optional(),
  language: z.enum(['EN', 'FI']).optional(),
  notes: optionalText(2000),
});

export const UpdateCustomerSchema = CreateCustomerSchema.partial();

export const ArchiveSchema = z.object({ archived: z.boolean() });

export type ListCustomersQueryT = z.infer<typeof ListCustomersQuery>;
export type CreateCustomerT = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerT = z.infer<typeof UpdateCustomerSchema>;
export type ArchiveT = z.infer<typeof ArchiveSchema>;
