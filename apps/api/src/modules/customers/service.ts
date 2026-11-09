import type { Customer, CustomerType } from '@prisma/client';
import { isValidBusinessId } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import type { RoleName } from '../../middleware/auth.js';
import { OPEN_STATUSES, withBalances } from '../../services/balances.js';

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
 * Outstanding balance per customer = Σ what is still owed on ACTIVE entries that
 * wait for money (INVOICED or PENDING): the amount minus any part-payments already
 * received (services/balances.ts). Invoices create/update their own Entry row and
 * their payments carry that entry id, so every open euro is counted exactly once.
 */
export async function outstandingByCustomerIds(
  customerIds: number[],
): Promise<Map<number, number>> {
  if (customerIds.length === 0) return new Map();
  const open = await prisma.entry.findMany({
    where: {
      customerId: { in: customerIds },
      status: 'ACTIVE',
      paymentStatus: { in: [...OPEN_STATUSES] },
    },
    select: { id: true, customerId: true, grossCents: true, paymentStatus: true },
  });
  const map = new Map<number, number>();
  for (const e of await withBalances(open)) {
    if (e.customerId !== null)
      map.set(e.customerId, (map.get(e.customerId) ?? 0) + e.outstandingCents);
  }
  return map;
}

/**
 * Per-customer money by type (Rental, Repair & maintenance, Spare parts,
 * Miscellaneous, …): charged / received / still owed over all ACTIVE entries,
 * plus the open items that still wait for money (for "Record payment").
 */
export async function customerBalance(customerId: number) {
  const [models, entries] = await Promise.all([
    prisma.businessModel.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true, nameEn: true, nameFi: true },
    }),
    prisma.entry.findMany({
      where: { customerId, status: 'ACTIVE' },
      orderBy: [{ entryDate: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        entryDate: true,
        modelId: true,
        description: true,
        grossCents: true,
        paymentStatus: true,
        invoiceId: true,
        saleId: true,
        invoice: { select: { id: true, numberFormatted: true } },
        unit: { select: { code: true } },
      },
    }),
  ]);
  const balanced = await withBalances(entries);

  // the four everyday types are always listed; any other type only when it has money
  const ALWAYS = new Set(['RENTAL', 'REPAIR', 'SPARE_PARTS', 'MISC']);
  const byModel = models
    .map((m) => {
      const rows = balanced.filter((e) => e.modelId === m.id);
      return {
        model: m,
        chargedCents: rows.reduce((a, e) => a + e.grossCents, 0),
        receivedCents: rows.reduce((a, e) => a + e.receivedCents, 0),
        owedCents: rows.reduce((a, e) => a + e.outstandingCents, 0),
        items: rows.length,
      };
    })
    .filter((b) => ALWAYS.has(b.model.code) || b.items > 0);

  const modelById = new Map(models.map((m) => [m.id, m]));
  const openItems = balanced
    .filter((e) => e.outstandingCents > 0)
    .map((e) => ({
      entryId: e.id,
      date: isoDate(e.entryDate),
      model: modelById.get(e.modelId) ?? null,
      description: e.description,
      unitCode: e.unit?.code ?? null,
      grossCents: e.grossCents,
      receivedCents: e.receivedCents,
      owedCents: e.outstandingCents,
      paymentStatus: e.paymentStatus,
      // where "Record payment" goes: the invoice owns its payments, a sale cannot take one
      invoice: e.invoice,
      payable: e.saleId === null,
    }));

  return {
    byModel,
    openItems,
    totals: {
      chargedCents: byModel.reduce((a, b) => a + b.chargedCents, 0),
      receivedCents: byModel.reduce((a, b) => a + b.receivedCents, 0),
      owedCents: byModel.reduce((a, b) => a + b.owedCents, 0),
    },
  };
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
