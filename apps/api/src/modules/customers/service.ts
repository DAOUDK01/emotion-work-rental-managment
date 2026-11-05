import type { Customer, CustomerType } from '@prisma/client';
import { isValidBusinessId } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import type { RoleName } from '../../middleware/auth.js';

/** Calendar-date column → 'YYYY-MM-DD' (dates travel as date strings in the API). */
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
export const isoDateOrNull = (d: Date | null): string | null => (d ? isoDate(d) : null);

/** Customer as the API returns it: `phone` exists on the payload for admins only. */
export type CustomerView = Omit<Customer, 'phone'> & { phone?: string | null };

/**
 * Role-aware serializer (GDPR): the `phone` FIELD — not just its value — is
 * stripped for every role except ADMIN, so STAFF/ACCOUNTANT responses never
 * carry personal phone numbers.
 */
export function serializeCustomer(customer: Customer, role: RoleName | undefined): CustomerView {
  const { phone, ...rest } = customer;
  if (role === 'ADMIN') return { ...rest, phone };
  return rest;
}

/**
 * Outstanding balance per customer = Σ grossCents of ACTIVE entries that still
 * wait for money (paymentStatus INVOICED or PENDING). Invoices create/update
 * their own Entry row, so summing entries alone counts every open euro exactly
 * once — no invoice remainder is added on top (that would double-count).
 */
export async function outstandingByCustomerIds(customerIds: number[]): Promise<Map<number, number>> {
  if (customerIds.length === 0) return new Map();
  const grouped = await prisma.entry.groupBy({
    by: ['customerId'],
    where: {
      customerId: { in: customerIds },
      status: 'ACTIVE',
      paymentStatus: { in: ['INVOICED', 'PENDING'] },
    },
    _sum: { grossCents: true },
  });
  const map = new Map<number, number>();
  for (const row of grouped) {
    if (row.customerId !== null) map.set(row.customerId, row._sum.grossCents ?? 0);
  }
  return map;
}

export async function outstandingCentsOf(customerId: number): Promise<number> {
  return (await outstandingByCustomerIds([customerId])).get(customerId) ?? 0;
}

/**
 * Warn-level Y-tunnus check (contract: accept the record, report validity).
 * Only meaningful for BUSINESS customers that actually carry a businessId;
 * undefined (field omitted from the JSON response) otherwise.
 */
export function businessIdValidity(
  type: CustomerType,
  businessId: string | null,
): boolean | undefined {
  if (type !== 'BUSINESS' || !businessId) return undefined;
  return isValidBusinessId(businessId);
}
