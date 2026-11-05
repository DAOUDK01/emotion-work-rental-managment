import { Prisma } from '@prisma/client';
import {
  addDays,
  addMonths,
  makeFinnishReference,
  roundHalfAwayFromZero,
  splitGross,
  todayInHelsinki,
} from '@emotionfix/shared';
import { prisma, nextNumber } from '../../db.js';
import { AppError, conflict, notFound } from '../../errors.js';
import { audit } from '../../services/audit.js';
import { vatRateOn } from '../../services/entries.js';
import { getSetting } from '../../services/settings.js';
import { currentUserId } from '../../context.js';

/**
 * Monthly contract billing: collect the month's uninvoiced jobs and turn them
 * into ONE draft invoice, one line per repaired vehicle. Line maths follow the
 * invoice rule (splitGross on the amount AFTER discount — contract jobs carry
 * no discounts, so the job amount IS the line gross and must survive rounding
 * exactly: when hours × hourly price would drift from the agreed amount, the
 * line falls back to qty 1 × amount).
 */

export const isoOut = (d: Date): string => d.toISOString().slice(0, 10);

interface JobForLine {
  date: Date;
  vehicleRef: string;
  description: string;
  hours: Prisma.Decimal | null;
  amountCents: number;
}

export interface BuiltInvoiceLine {
  description: string;
  qty: number;
  unitPriceCents: number;
  discountCents: number;
  vatRateBp: number;
  lineGrossCents: number;
  lineVatCents: number;
  lineNetCents: number;
  isLabour: boolean;
  sortOrder: number;
}

/** One invoice line per contract job: "<date> <vehicleRef> — <description>". */
export function buildJobLine(job: JobForLine, vatRateBp: number, sortOrder: number): BuiltInvoiceLine {
  const hours = job.hours === null ? null : Number(job.hours);
  let qty = 1;
  let unitPriceCents = job.amountCents;
  if (hours !== null && hours > 0) {
    const perHour = roundHalfAwayFromZero(job.amountCents / hours);
    // keep qty×price === amount exactly; otherwise bill as a single line item
    if (roundHalfAwayFromZero(perHour * hours) === job.amountCents) {
      qty = hours;
      unitPriceCents = perHour;
    }
  }
  const split = splitGross(job.amountCents, vatRateBp);
  return {
    description: `${isoOut(job.date)} ${job.vehicleRef} — ${job.description}`,
    qty,
    unitPriceCents,
    discountCents: 0,
    vatRateBp,
    lineGrossCents: split.grossCents,
    lineVatCents: split.vatCents,
    lineNetCents: split.netCents,
    isLabour: hours !== null,
    sortOrder,
  };
}

const invoiceInclude = {
  lines: { orderBy: { sortOrder: 'asc' } },
  customer: {
    select: { id: true, type: true, name: true, businessId: true, email: true, language: true },
  },
  model: { select: { id: true, code: true, nameEn: true, nameFi: true } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export function serializeInvoice(invoice: InvoiceWithLines) {
  return {
    ...invoice,
    issueDate: isoOut(invoice.issueDate),
    deliveryDate: invoice.deliveryDate ? isoOut(invoice.deliveryDate) : null,
    dueDate: isoOut(invoice.dueDate),
    lines: invoice.lines.map((line) => ({ ...line, qty: Number(line.qty) })),
  };
}

/** Create the monthly DRAFT invoice for a contract. Throws 409 NO_JOBS when nothing to bill. */
export async function invoiceMonthForContract(contractId: number, month: string) {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { customer: true },
  });
  if (!contract) throw notFound('Contract');

  const monthStart = `${month}-01`;
  const nextMonthStart = addMonths(monthStart, 1);
  const jobs = await prisma.contractJob.findMany({
    where: {
      contractId,
      invoiceId: null,
      date: {
        gte: new Date(`${monthStart}T00:00:00Z`),
        lt: new Date(`${nextMonthStart}T00:00:00Z`),
      },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  if (jobs.length === 0) {
    throw conflict('NO_JOBS', `No uninvoiced contract jobs found for ${month}`);
  }

  const model = await prisma.businessModel.findUnique({ where: { code: 'CONTRACT' } });
  if (!model) {
    throw new AppError(500, 'CONTRACT_MODEL_MISSING', 'Business model CONTRACT is not seeded');
  }

  const today = todayInHelsinki();
  const vatRateBp = await vatRateOn(today);
  const termsDays = (await getSetting<{ termsDaysDefault?: number }>('invoice', {})).termsDaysDefault ?? 14;
  const dueDate = addDays(today, termsDays);

  const lines = jobs.map((job, index) => buildJobLine(job, vatRateBp, index));
  const totalGrossCents = lines.reduce((sum, line) => sum + line.lineGrossCents, 0);
  const totalVatCents = lines.reduce((sum, line) => sum + line.lineVatCents, 0);
  const totalNetCents = totalGrossCents - totalVatCents;
  const jobIds = jobs.map((job) => job.id);

  const { invoice, modelActivated } = await prisma.$transaction(async (tx) => {
    let activated = false;
    if (!model.active) {
      await tx.businessModel.update({ where: { id: model.id }, data: { active: true } });
      activated = true;
    }
    const number = await nextNumber(tx, 'INVOICE');
    const created = await tx.invoice.create({
      data: {
        number,
        numberFormatted: `${today.slice(0, 4)}-${String(number).padStart(4, '0')}`,
        customerId: contract.customerId,
        modelId: model.id,
        language: contract.customer.language,
        issueDate: new Date(`${today}T00:00:00Z`),
        dueDate: new Date(`${dueDate}T00:00:00Z`),
        termsDays,
        periodText: month,
        referenceNumber: makeFinnishReference(number),
        status: 'DRAFT',
        totalGrossCents,
        totalVatCents,
        totalNetCents,
        notes: `Contract: ${contract.name}`,
        createdById: currentUserId() ?? null,
        lines: { create: lines },
      },
      include: invoiceInclude,
    });
    await tx.contractJob.updateMany({
      where: { id: { in: jobIds } },
      data: { invoiceId: created.id, invoicedAt: new Date() },
    });
    return { invoice: created, modelActivated: activated };
  });

  await audit('CREATE', 'invoices', invoice.id, undefined, {
    ...invoice,
    createdFrom: { contractId, month, jobIds },
  });
  await audit('UPDATE', 'contract_jobs', null, { jobIds, invoiceId: null }, {
    jobIds,
    invoiceId: invoice.id,
    month,
  });
  if (modelActivated) {
    await audit('UPDATE', 'models', model.id, { active: false }, { active: true });
  }
  return invoice;
}
