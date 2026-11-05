import type { Customer } from '@prisma/client';
import { prisma } from '../../db.js';
import { AppError, notFound } from '../../errors.js';

/**
 * GDPR data portability + right-to-erasure logic.
 *
 * Export: one self-contained JSON document with everything the system holds
 * about one customer (profile, rentals, invoices with their lines, income
 * entries and money received). Dates travel as 'YYYY-MM-DD', timestamps as
 * full ISO strings, money as integer cents.
 *
 * Erasure: personal fields are anonymised in place; financial rows are kept
 * untouched because the Finnish Bookkeeping Act (1336/1997) requires a 6-year
 * retention of accounting material — the customer record survives only as
 * "Erased customer #<id>" so those rows still reconcile.
 */

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const isoDateOrNull = (d: Date | null): string | null => (d ? isoDate(d) : null);
const isoTime = (d: Date): string => d.toISOString();
const isoTimeOrNull = (d: Date | null): string | null => (d ? isoTime(d) : null);

// ------------------------------------------------------------------ export

export async function buildCustomerExport(customerId: number) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw notFound('Customer');

  const [rentals, invoices, entries, payments] = await prisma.$transaction([
    prisma.rental.findMany({
      where: { customerId },
      orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
      include: { unit: { select: { id: true, code: true, brand: true, modelName: true } } },
    }),
    prisma.invoice.findMany({
      where: { customerId },
      orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
      include: { lines: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
    }),
    prisma.entry.findMany({
      where: { customerId },
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      include: {
        model: { select: { id: true, code: true, nameEn: true, nameFi: true } },
        unit: { select: { id: true, code: true, brand: true } },
        paymentMethod: { select: { id: true, name: true } },
      },
    }),
    // Payment has no customerId — money reaches a customer through their entry,
    // invoice or POS sale, so collect payments over all three link paths.
    prisma.payment.findMany({
      where: {
        OR: [
          { entry: { is: { customerId } } },
          { invoice: { is: { customerId } } },
          { sale: { is: { customerId } } },
        ],
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: {
        method: { select: { id: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
      },
    }),
  ]);

  return {
    exportedAt: isoTime(new Date()),
    customer: {
      ...customer,
      createdAt: isoTime(customer.createdAt),
      updatedAt: isoTime(customer.updatedAt),
    },
    rentals: rentals.map((r) => ({
      ...r,
      handOverDate: isoDateOrNull(r.handOverDate),
      startDate: isoDate(r.startDate),
      endDate: isoDateOrNull(r.endDate),
      createdAt: isoTime(r.createdAt),
      updatedAt: isoTime(r.updatedAt),
    })),
    invoices: invoices.map((inv) => ({
      ...inv,
      issueDate: isoDate(inv.issueDate),
      deliveryDate: isoDateOrNull(inv.deliveryDate),
      dueDate: isoDate(inv.dueDate),
      sentAt: isoTimeOrNull(inv.sentAt),
      createdAt: isoTime(inv.createdAt),
      updatedAt: isoTime(inv.updatedAt),
      lines: inv.lines.map((line) => ({ ...line, qty: Number(line.qty) })),
    })),
    entries: entries.map((e) => ({
      ...e,
      entryDate: isoDate(e.entryDate),
      createdAt: isoTime(e.createdAt),
      updatedAt: isoTime(e.updatedAt),
    })),
    payments: payments.map((p) => ({
      ...p,
      date: isoDate(p.date),
      createdAt: isoTime(p.createdAt),
    })),
  };
}

// ------------------------------------------------------------------ erasure

/** Personal Customer columns cleared by an erasure (order = audit trail order). */
const PERSONAL_FIELDS = [
  'name',
  'businessId',
  'email',
  'phone',
  'address',
  'postalCode',
  'city',
  'notes',
] as const;

export interface EraseResult {
  customer: Customer;
  /** Names of the fields that actually held a value — stored in the audit log
   *  INSTEAD of the values themselves (the trail must not re-save erased data). */
  erasedFields: string[];
}

export async function eraseCustomer(customerId: number): Promise<EraseResult> {
  return prisma.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id: customerId } });
    if (!before) throw notFound('Customer');

    // Refuse while money is still open: ACTIVE entries waiting for payment
    // (INVOICED/PENDING — the authoritative outstanding measure) or invoices
    // not settled yet (DRAFT included: an un-issued invoice to an erased
    // customer would be unusable — cancel or finish billing first).
    const [openEntries, unpaidInvoices] = await Promise.all([
      tx.entry.aggregate({
        where: {
          customerId,
          status: 'ACTIVE',
          paymentStatus: { in: ['INVOICED', 'PENDING'] },
        },
        _count: { _all: true },
        _sum: { grossCents: true },
      }),
      tx.invoice.count({
        where: { customerId, status: { in: ['DRAFT', 'SENT', 'PARTIALLY_PAID'] } },
      }),
    ]);
    if (openEntries._count._all > 0 || unpaidInvoices > 0) {
      throw new AppError(
        409,
        'HAS_OUTSTANDING',
        'Customer still has an outstanding balance or open invoices — settle, void or cancel them before erasure',
        {
          openEntries: openEntries._count._all,
          outstandingCents: openEntries._sum.grossCents ?? 0,
          unpaidInvoices,
        },
      );
    }

    const erasedFields = PERSONAL_FIELDS.filter((field) => {
      const value = before[field];
      return typeof value === 'string' && value.trim() !== '';
    });

    const customer = await tx.customer.update({
      where: { id: customerId },
      data: {
        name: `Erased customer #${customerId}`,
        businessId: null,
        email: null,
        phone: null,
        address: null,
        postalCode: null,
        city: null,
        notes: null,
        archived: true,
      },
    });

    // Copies of the personal data elsewhere: name snapshots on the customer's own
    // rentals/entries, and the before/after JSON of this customer's audit rows.
    // The audit row itself (who did what, when) stays — only the content is redacted.
    await tx.entry.updateMany({ where: { customerId, customerName: { not: null } }, data: { customerName: null } });
    await tx.rental.updateMany({ where: { customerId, customerName: { not: null } }, data: { customerName: null } });
    await tx.auditLog.updateMany({
      where: { entity: 'customers', entityId: String(customerId) },
      data: { before: { redacted: 'GDPR erasure' }, after: { redacted: 'GDPR erasure' } },
    });

    return { customer, erasedFields: [...erasedFields] };
  });
}
