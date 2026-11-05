import { z } from 'zod';

/** Zod schemas for the WhatsApp module (webhook payloads are parsed defensively, not here). */

export const idParam = z.object({ id: z.coerce.number().int().positive() });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const InboxQuery = z.object({
  status: z.enum(['RECEIVED', 'SAVED', 'REJECTED', 'ERROR', 'UNDONE']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type InboxQueryType = z.infer<typeof InboxQuery>;

export const RejectSchema = z.object({ reason: z.string().min(1).max(500) });

export const SimulateSchema = z.object({
  from: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{5,15}$/, 'Use an E.164 phone number like +358401234567'),
  text: z.string().min(1).max(4096),
});
