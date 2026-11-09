import { prisma } from '../db.js';
import type { Tx } from './entries.js';

/**
 * Received vs. outstanding money for income entries — ONE rule used everywhere
 * (customers, dashboard, reports, Google Sheet):
 *
 *  - PAID entry             → received = gross, outstanding = 0
 *  - INVOICED / PENDING     → received = Σ ACTIVE payments recorded against the entry
 *                             (part-payments), outstanding = gross − received
 *  - NOT_YET_BILLED         → nothing received, nothing outstanding yet
 *
 * Part-payments are ordinary Payment rows (entryId set), so the cash-holder ledger
 * ("Amount received by") counts them without any special case. Invoice payments
 * already carry the invoice's entryId, so part-paid invoices follow the same rule.
 */

export const OPEN_STATUSES = ['INVOICED', 'PENDING'] as const;

export type PaymentStatusName = 'PAID' | 'INVOICED' | 'PENDING' | 'NOT_YET_BILLED';

export function isOpenStatus(status: PaymentStatusName): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

/** Σ ACTIVE payment cents per entry id (only ids that have payments appear). */
export async function paidCentsByEntryIds(
  entryIds: number[],
  tx: Tx = prisma,
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (entryIds.length === 0) return map;
  const grouped = await tx.payment.groupBy({
    by: ['entryId'],
    where: { entryId: { in: entryIds }, status: 'ACTIVE' },
    _sum: { amountCents: true },
  });
  for (const row of grouped) {
    if (row.entryId !== null) map.set(row.entryId, row._sum.amountCents ?? 0);
  }
  return map;
}

/** Money already received on one entry, given the Σ of its ACTIVE payments. */
export function receivedCentsOf(
  e: { paymentStatus: PaymentStatusName; grossCents: number },
  paidCents: number,
): number {
  if (e.paymentStatus === 'PAID') return e.grossCents;
  if (isOpenStatus(e.paymentStatus)) return Math.min(paidCents, e.grossCents);
  return 0;
}

/** Money still owed on one entry, given the Σ of its ACTIVE payments. */
export function outstandingCentsOf(
  e: { paymentStatus: PaymentStatusName; grossCents: number },
  paidCents: number,
): number {
  if (!isOpenStatus(e.paymentStatus)) return 0;
  // negative rows (credit-note reversals) reduce what is owed
  if (e.grossCents < 0) return e.grossCents;
  return Math.max(0, e.grossCents - paidCents);
}

/**
 * Received/outstanding for a list of entries in one go (one payments query).
 * Payments on PAID entries are not needed, so only open entries are looked up.
 */
export async function withBalances<
  E extends { id: number; paymentStatus: PaymentStatusName; grossCents: number },
>(
  entries: E[],
  tx: Tx = prisma,
): Promise<Array<E & { receivedCents: number; outstandingCents: number }>> {
  const openIds = entries.filter((e) => isOpenStatus(e.paymentStatus)).map((e) => e.id);
  const paid = await paidCentsByEntryIds(openIds, tx);
  return entries.map((e) => {
    const p = paid.get(e.id) ?? 0;
    return {
      ...e,
      receivedCents: receivedCentsOf(e, p),
      outstandingCents: outstandingCentsOf(e, p),
    };
  });
}
