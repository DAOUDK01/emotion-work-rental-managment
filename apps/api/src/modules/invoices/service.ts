import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import {
  addDays,
  addVatToNet,
  formatEUR,
  formatFinnishReference,
  makeFinnishReference,
  splitGross,
  type ISODate,
} from '@emotionfix/shared';
import { nextNumber, prisma } from '../../db.js';
import { env } from '../../env.js';
import { AppError, badRequest, conflict, notFound } from '../../errors.js';
import { currentUserId } from '../../context.js';
import { logger } from '../../logger.js';
import { audit } from '../../services/audit.js';
import { queueEmail } from '../../services/email.js';
import { createEntry, vatRateOn, type Tx } from '../../services/entries.js';
import { getSetting } from '../../services/settings.js';
import type {
  AddPaymentBody,
  CreateInvoiceBody,
  InvoiceLineInputT,
  UpdateInvoiceBody,
} from './schemas.js';
import { buildInvoicePdf } from './pdf.js';

/**
 * Invoicing: DRAFT → SENT → PARTIALLY_PAID → PAID (CANCELLED only via credit note).
 * Numbers (gap-free NumberSequence 'INVOICE'), Finnish reference with check digit and
 * the per-line VAT math are fixed at creation; the income Entry is created when the
 * invoice is SENT — or, for an invoice made FROM a rental that already has an entry,
 * that rental entry is UPDATED to INVOICED (never a duplicate income row).
 */

// ---------------------------------------------------------------- settings

export interface CompanySetting {
  name: string;
  businessId: string;
  vatNumber: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  iban: string;
  bic: string;
}

export async function companySetting(): Promise<CompanySetting> {
  const raw = await getSetting<Partial<CompanySetting>>('company', {});
  return {
    name: raw.name ?? 'E Motion Works Oy',
    businessId: raw.businessId ?? '',
    vatNumber: raw.vatNumber ?? '',
    address: raw.address ?? '',
    postalCode: raw.postalCode ?? '',
    city: raw.city ?? '',
    country: raw.country ?? 'Finland',
    phone: raw.phone ?? '',
    email: raw.email ?? '',
    iban: raw.iban ?? '',
    bic: raw.bic ?? '',
  };
}

export interface InvoiceTexts {
  termsDaysDefault: number;
  lateInterestTextEn: string;
  lateInterestTextFi: string;
  footerEn: string;
  footerFi: string;
  reminderDays: number;
}

export async function invoiceTexts(): Promise<InvoiceTexts> {
  const raw = await getSetting<Partial<InvoiceTexts>>('invoice', {});
  return {
    termsDaysDefault: raw.termsDaysDefault ?? 14,
    lateInterestTextEn:
      raw.lateInterestTextEn ??
      'Late payment interest according to the Finnish Interest Act (korkolaki).',
    lateInterestTextFi: raw.lateInterestTextFi ?? 'Viivästyskorko korkolain mukaan.',
    footerEn: raw.footerEn ?? 'Thank you for your business!',
    footerFi: raw.footerFi ?? 'Kiitos!',
    reminderDays: raw.reminderDays ?? 7,
  };
}

// ---------------------------------------------------------------- shared helpers

export const toDbDate = (d: ISODate): Date => new Date(`${d}T00:00:00Z`);
export const fromDbDate = (d: Date): ISODate => d.toISOString().slice(0, 10);
export const isoOrNull = (d: Date | null): string | null => (d ? fromDbDate(d) : null);

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** "2026-0001" — year of the issue date + zero-padded sequential number. */
export function formatInvoiceNumber(issueDate: ISODate, number: number): string {
  return `${issueDate.slice(0, 4)}-${String(number).padStart(4, '0')}`;
}

/** Entry rows hold ONE VAT rate: use the rate carrying the largest gross share of the lines. */
export function dominantRateBp(lines: Array<{ vatRateBp: number; lineGrossCents: number }>): number {
  const byRate = new Map<number, number>();
  for (const line of lines) {
    byRate.set(line.vatRateBp, (byRate.get(line.vatRateBp) ?? 0) + Math.abs(line.lineGrossCents));
  }
  let best = 2550;
  let bestSum = -1;
  for (const [rate, sum] of byRate) {
    if (sum > bestSum || (sum === bestSum && rate > best)) {
      best = rate;
      bestSum = sum;
    }
  }
  return best;
}

export async function sparePartsModelId(tx: Tx): Promise<number> {
  const model = await tx.businessModel.findUnique({ where: { code: 'SPARE_PARTS' } });
  if (!model) throw new AppError(500, 'MODEL_MISSING', 'Business model SPARE_PARTS is not seeded');
  return model.id;
}

/** Σ credit-note gross of an invoice — credit notes permanently reduce what is due. */
export async function creditedCentsOf(tx: Tx, invoiceId: number): Promise<number> {
  const agg = await tx.creditNote.aggregate({
    where: { invoiceId },
    _sum: { totalGrossCents: true },
  });
  return agg._sum.totalGrossCents ?? 0;
}

// ---------------------------------------------------------------- includes & serializers

export const invoiceListInclude = {
  customer: { select: { id: true, name: true, type: true } },
  model: { select: { id: true, code: true, nameEn: true, nameFi: true } },
  unit: { select: { id: true, code: true, brand: true } },
  creditNotes: { select: { totalGrossCents: true } },
} satisfies Prisma.InvoiceInclude;

/** What the customer still owes: total − credit notes − payments (never negative). */
export function outstandingOf(inv: {
  totalGrossCents: number;
  paidCents: number;
  creditNotes: Array<{ totalGrossCents: number }>;
}): number {
  const credited = inv.creditNotes.reduce((s, cn) => s + cn.totalGrossCents, 0);
  return Math.max(0, inv.totalGrossCents - credited - inv.paidCents);
}

/** Outstanding across a set of invoices (list/overdue sums), credit notes subtracted. */
export async function outstandingSum(where: Prisma.InvoiceWhereInput): Promise<number> {
  const [agg, credits] = await Promise.all([
    prisma.invoice.aggregate({ where, _sum: { totalGrossCents: true, paidCents: true } }),
    prisma.creditNote.aggregate({ where: { invoice: { is: where } }, _sum: { totalGrossCents: true } }),
  ]);
  return Math.max(
    0,
    (agg._sum.totalGrossCents ?? 0) - (agg._sum.paidCents ?? 0) - (credits._sum.totalGrossCents ?? 0),
  );
}
export type InvoiceListItem = Prisma.InvoiceGetPayload<{ include: typeof invoiceListInclude }>;

export const invoiceDetailInclude = {
  customer: true,
  model: { select: { id: true, code: true, nameEn: true, nameFi: true } },
  unit: { select: { id: true, code: true, brand: true } },
  rental: { include: { entry: true } },
  lines: {
    include: {
      product: { select: { id: true, sku: true, nameEn: true, nameFi: true, trackStock: true } },
    },
    orderBy: { sortOrder: 'asc' },
  },
  payments: {
    include: {
      method: { select: { id: true, name: true } },
      receivedBy: { select: { id: true, name: true } },
    },
    orderBy: { id: 'asc' },
  },
  creditNotes: { orderBy: { id: 'asc' } },
  entry: {
    include: {
      receivedBy: { select: { id: true, name: true } },
      paymentMethod: { select: { id: true, name: true } },
    },
  },
  attachments: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
  },
} satisfies Prisma.InvoiceInclude;
export type InvoiceDetail = Prisma.InvoiceGetPayload<{ include: typeof invoiceDetailInclude }>;

/** OVERDUE is derived, never stored: an unpaid, sent invoice past its due date. */
export function isInvoiceOverdue(
  status: InvoiceListItem['status'],
  dueDate: Date,
  today: ISODate,
): boolean {
  return (status === 'SENT' || status === 'PARTIALLY_PAID') && fromDbDate(dueDate) < today;
}

export function serializeInvoice(inv: InvoiceListItem | InvoiceDetail, today: ISODate) {
  const open = inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID';
  return {
    id: inv.id,
    number: inv.number,
    numberFormatted: inv.numberFormatted,
    customer: { id: inv.customer.id, name: inv.customer.name, type: inv.customer.type },
    model: inv.model,
    unit: inv.unit,
    rentalId: inv.rentalId,
    language: inv.language,
    issueDate: fromDbDate(inv.issueDate),
    deliveryDate: isoOrNull(inv.deliveryDate),
    periodText: inv.periodText,
    dueDate: fromDbDate(inv.dueDate),
    termsDays: inv.termsDays,
    referenceNumber: inv.referenceNumber,
    referenceNumberFormatted: formatFinnishReference(inv.referenceNumber),
    status: inv.status,
    isOverdue: isInvoiceOverdue(inv.status, inv.dueDate, today),
    totalGrossCents: inv.totalGrossCents,
    totalVatCents: inv.totalVatCents,
    totalNetCents: inv.totalNetCents,
    paidCents: inv.paidCents,
    outstandingCents: open ? outstandingOf(inv) : 0,
    notes: inv.notes,
    sentAt: inv.sentAt ? inv.sentAt.toISOString() : null,
    emailedTo: inv.emailedTo,
    createdAt: inv.createdAt.toISOString(),
  };
}

export function serializeInvoiceDetail(inv: InvoiceDetail, today: ISODate) {
  return {
    ...serializeInvoice(inv, today),
    rental: inv.rental
      ? {
          id: inv.rental.id,
          periodText: inv.rental.periodText,
          startDate: fromDbDate(inv.rental.startDate),
          endDate: isoOrNull(inv.rental.endDate),
          entryId: inv.rental.entry?.id ?? null,
        }
      : null,
    lines: inv.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      product: l.product
        ? { id: l.product.id, sku: l.product.sku, nameEn: l.product.nameEn, nameFi: l.product.nameFi }
        : null,
      description: l.description,
      qty: Number(l.qty),
      unitPriceCents: l.unitPriceCents,
      discountCents: l.discountCents,
      discountReason: l.discountReason,
      vatRateBp: l.vatRateBp,
      lineGrossCents: l.lineGrossCents,
      lineVatCents: l.lineVatCents,
      lineNetCents: l.lineNetCents,
      isLabour: l.isLabour,
      sortOrder: l.sortOrder,
    })),
    payments: inv.payments.map((p) => ({
      id: p.id,
      date: fromDbDate(p.date),
      amountCents: p.amountCents,
      method: p.method,
      receivedBy: p.receivedBy,
      reference: p.reference,
      note: p.note,
      status: p.status,
      createdAt: p.createdAt.toISOString(),
    })),
    creditNotes: inv.creditNotes.map((cn) => ({
      id: cn.id,
      number: cn.number,
      numberFormatted: cn.numberFormatted,
      issueDate: fromDbDate(cn.issueDate),
      reason: cn.reason,
      totalGrossCents: cn.totalGrossCents,
      totalVatCents: cn.totalVatCents,
      totalNetCents: cn.totalNetCents,
      restocked: cn.restocked,
      createdAt: cn.createdAt.toISOString(),
    })),
    entry: inv.entry
      ? {
          id: inv.entry.id,
          entryDate: fromDbDate(inv.entry.entryDate),
          description: inv.entry.description,
          grossCents: inv.entry.grossCents,
          discountCents: inv.entry.discountCents,
          vatInvoice: inv.entry.vatInvoice,
          vatRateBp: inv.entry.vatRateBp,
          vatCents: inv.entry.vatCents,
          netCents: inv.entry.netCents,
          paymentStatus: inv.entry.paymentStatus,
          paymentMethod: inv.entry.paymentMethod,
          receivedBy: inv.entry.receivedBy,
          status: inv.entry.status,
          voidReason: inv.entry.voidReason,
        }
      : null,
    attachments: inv.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export async function loadInvoiceDetail(id: number): Promise<InvoiceDetail> {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: invoiceDetailInclude });
  if (!invoice) throw notFound('Invoice');
  return invoice;
}

// ---------------------------------------------------------------- line math

export interface ComputedLine {
  productId: number | null;
  description: string;
  qty: number;
  unitPriceCents: number;
  discountCents: number;
  discountReason: string | null;
  vatRateBp: number;
  lineGrossCents: number;
  lineVatCents: number;
  lineNetCents: number;
  isLabour: boolean;
  sortOrder: number;
}

export interface ComputedTotals {
  totalGrossCents: number;
  totalVatCents: number;
  totalNetCents: number;
  discountCents: number;
}

const round = (v: number): number => (v < 0 ? -Math.round(Math.abs(v)) : Math.round(v));

/**
 * Line math identical to POS: base = qty × unit price (rounded half away from zero,
 * per line), the per-line discount reduces the base BEFORE VAT, then splitGross.
 * Invoices have NO cart-level discount.
 */
export async function computeLines(
  inputs: InvoiceLineInputT[],
  issueDate: ISODate,
  language: 'EN' | 'FI',
): Promise<{ lines: ComputedLine[]; totals: ComputedTotals }> {
  const defaultRate = await vatRateOn(issueDate);
  const productIds = [
    ...new Set(inputs.flatMap((l) => (l.productId != null ? [l.productId] : []))),
  ];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } } })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const lines: ComputedLine[] = [];
  let totalGross = 0;
  let totalVat = 0;
  let totalNet = 0;
  let totalDiscount = 0;

  inputs.forEach((input, i) => {
    let description = input.description ?? null;
    let unitPrice = input.unitPriceCents ?? null;
    let rate = input.vatRateBp ?? null;
    let productId: number | null = null;

    if (input.productId != null) {
      const product = productById.get(input.productId);
      if (!product) {
        throw badRequest('BAD_PRODUCT', `Line ${i + 1}: product ${input.productId} not found`);
      }
      productId = product.id;
      description = description ?? (language === 'FI' ? (product.nameFi ?? product.nameEn) : product.nameEn);
      // product cards are priced without VAT; invoice lines are VAT-inclusive
      unitPrice = unitPrice ?? addVatToNet(product.priceCents, product.vatRateBp).grossCents;
      rate = rate ?? product.vatRateBp;
    }
    // The zod schema guarantees these; keep the checks so the invariant can never drift.
    if (!description) throw badRequest('LINE_DESCRIPTION_REQUIRED', `Line ${i + 1}: description missing`);
    if (unitPrice == null) throw badRequest('LINE_PRICE_REQUIRED', `Line ${i + 1}: unit price missing`);

    const rateBp = rate ?? defaultRate;
    const base = round(input.qty * unitPrice);
    if (input.discountCents > base) {
      throw badRequest(
        'DISCOUNT_EXCEEDS_AMOUNT',
        `Line ${i + 1}: discount is larger than the line amount`,
      );
    }
    const gross = base - input.discountCents;
    const vat = splitGross(gross, rateBp);

    lines.push({
      productId,
      description,
      qty: input.qty,
      unitPriceCents: unitPrice,
      discountCents: input.discountCents,
      discountReason: input.discountReason ?? null,
      vatRateBp: rateBp,
      lineGrossCents: gross,
      lineVatCents: vat.vatCents,
      lineNetCents: vat.netCents,
      isLabour: input.isLabour,
      sortOrder: i,
    });
    totalGross += gross;
    totalVat += vat.vatCents;
    totalNet += vat.netCents;
    totalDiscount += input.discountCents;
  });

  return {
    lines,
    totals: {
      totalGrossCents: totalGross,
      totalVatCents: totalVat,
      totalNetCents: totalNet,
      discountCents: totalDiscount,
    },
  };
}

// ---------------------------------------------------------------- create / update (DRAFT)

async function assertRefsExist(body: {
  modelId?: number | null;
  unitId?: number | null;
}): Promise<void> {
  if (body.modelId != null) {
    const model = await prisma.businessModel.findUnique({ where: { id: body.modelId } });
    if (!model) throw notFound('Business model');
  }
  if (body.unitId != null) {
    const unit = await prisma.unit.findUnique({ where: { id: body.unitId } });
    if (!unit) throw notFound('Unit');
  }
}

async function loadRentalForInvoice(rentalId: number) {
  const rental = await prisma.rental.findUnique({ where: { id: rentalId } });
  if (!rental) throw notFound('Rental');
  if (rental.status === 'VOID') throw conflict('RENTAL_VOID', 'Cannot invoice a voided rental');
  return rental;
}

export async function createInvoice(body: CreateInvoiceBody): Promise<number> {
  const customer = await prisma.customer.findUnique({ where: { id: body.customerId } });
  if (!customer) throw notFound('Customer');
  await assertRefsExist(body);
  const rental = body.rentalId != null ? await loadRentalForInvoice(body.rentalId) : null;

  const language: 'EN' | 'FI' = body.language ?? customer.language;
  const texts = await invoiceTexts();
  const termsDays = body.termsDays ?? texts.termsDaysDefault;
  const dueDate = body.dueDate ?? addDays(body.issueDate, termsDays);
  if (dueDate < body.issueDate) {
    throw badRequest('BAD_DUE_DATE', 'Due date is before the issue date');
  }
  const { lines, totals } = await computeLines(body.lines, body.issueDate, language);

  const id = await prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, 'INVOICE');
    const invoice = await tx.invoice.create({
      data: {
        number,
        numberFormatted: formatInvoiceNumber(body.issueDate, number),
        customerId: body.customerId,
        modelId: body.modelId ?? null,
        unitId: body.unitId ?? rental?.unitId ?? null,
        rentalId: body.rentalId ?? null,
        language,
        issueDate: toDbDate(body.issueDate),
        deliveryDate: body.deliveryDate ? toDbDate(body.deliveryDate) : null,
        periodText: body.periodText ?? rental?.periodText ?? null,
        dueDate: toDbDate(dueDate),
        termsDays,
        // reference base = year + zero-padded sequence (e.g. 20260001): always >= 3 digits
        // as the 7-3-1 standard requires, and unique across years
        referenceNumber: makeFinnishReference(
          `${body.issueDate.slice(0, 4)}${String(number).padStart(4, '0')}`,
        ),
        status: 'DRAFT',
        totalGrossCents: totals.totalGrossCents,
        totalVatCents: totals.totalVatCents,
        totalNetCents: totals.totalNetCents,
        notes: body.notes ?? null,
        createdById: currentUserId() ?? null,
        lines: { create: lines },
      },
    });
    return invoice.id;
  });

  const created = await prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
  await audit('CREATE', 'invoices', id, undefined, created);
  return id;
}

export async function updateInvoice(id: number, body: UpdateInvoiceBody): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { lines: true, customer: true },
  });
  if (!invoice) throw notFound('Invoice');
  if (invoice.status !== 'DRAFT') {
    throw conflict('NOT_DRAFT', 'Only draft invoices can be edited — issue a credit note instead');
  }

  let customer = invoice.customer;
  if (body.customerId != null && body.customerId !== invoice.customerId) {
    const found = await prisma.customer.findUnique({ where: { id: body.customerId } });
    if (!found) throw notFound('Customer');
    customer = found;
  }
  await assertRefsExist(body);
  const rental =
    body.rentalId != null && body.rentalId !== invoice.rentalId
      ? await loadRentalForInvoice(body.rentalId)
      : null;

  const issueDate = body.issueDate ?? fromDbDate(invoice.issueDate);
  const termsDays = body.termsDays ?? invoice.termsDays;
  const dueDate =
    body.dueDate ??
    (body.issueDate !== undefined || body.termsDays !== undefined
      ? addDays(issueDate, termsDays)
      : fromDbDate(invoice.dueDate));
  if (dueDate < issueDate) throw badRequest('BAD_DUE_DATE', 'Due date is before the issue date');
  const language: 'EN' | 'FI' = body.language ?? invoice.language;

  const recomputed = body.lines ? await computeLines(body.lines, issueDate, language) : null;

  await prisma.$transaction(async (tx) => {
    if (recomputed) {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoiceLine.createMany({
        data: recomputed.lines.map((l) => ({ ...l, invoiceId: id })),
      });
    }
    await tx.invoice.update({
      where: { id },
      data: {
        // the sequential number never changes; the year prefix follows the issue date
        numberFormatted: formatInvoiceNumber(issueDate, invoice.number),
        customerId: body.customerId ?? undefined,
        modelId: body.modelId === undefined ? undefined : body.modelId,
        unitId: body.unitId === undefined ? (rental ? rental.unitId : undefined) : body.unitId,
        rentalId: body.rentalId === undefined ? undefined : body.rentalId,
        language,
        issueDate: toDbDate(issueDate),
        deliveryDate:
          body.deliveryDate === undefined
            ? undefined
            : body.deliveryDate
              ? toDbDate(body.deliveryDate)
              : null,
        periodText: body.periodText === undefined ? undefined : body.periodText,
        dueDate: toDbDate(dueDate),
        termsDays,
        notes: body.notes === undefined ? undefined : body.notes,
        ...(recomputed
          ? {
              totalGrossCents: recomputed.totals.totalGrossCents,
              totalVatCents: recomputed.totals.totalVatCents,
              totalNetCents: recomputed.totals.totalNetCents,
            }
          : {}),
      },
    });
  });

  const after = await prisma.invoice.findUnique({ where: { id }, include: { lines: true } });
  await audit('UPDATE', 'invoices', id, invoice, after);
  void customer; // customer looked up purely for validation
}

// ---------------------------------------------------------------- send

export function invoiceSubject(language: 'EN' | 'FI', numberFormatted: string, companyName: string): string {
  return `${language === 'FI' ? 'Lasku' : 'Invoice'} ${numberFormatted} — ${companyName}`;
}

export function reminderTag(numberFormatted: string): string {
  return `[Reminder ${numberFormatted}]`;
}

/** Simple HTML body for the invoice / reminder email (EN/FI per invoice.language). */
export function invoiceEmailHtml(
  inv: InvoiceDetail,
  company: CompanySetting,
  texts: InvoiceTexts,
  kind: 'invoice' | 'reminder',
): string {
  const fi = inv.language === 'FI';
  const locale = fi ? 'fi' : 'en';
  const dmy = (d: Date): string => {
    const iso = fromDbDate(d);
    return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
  };
  const outstanding = outstandingOf(inv);
  const intro =
    kind === 'invoice'
      ? fi
        ? `Ohessa lasku ${inv.numberFormatted}.`
        : `Please find attached invoice ${inv.numberFormatted}.`
      : fi
        ? `Maksumuistutus: lasku ${inv.numberFormatted} on avoinna.`
        : `Payment reminder: invoice ${inv.numberFormatted} is still open.`;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#555">${label}</td><td style="padding:2px 0"><strong>${value}</strong></td></tr>`;
  const rows = [
    row(fi ? 'Laskun numero' : 'Invoice number', escapeHtml(inv.numberFormatted)),
    row(fi ? 'Päiväys' : 'Invoice date', dmy(inv.issueDate)),
    row(fi ? 'Eräpäivä' : 'Due date', dmy(inv.dueDate)),
    row(fi ? 'Viitenumero' : 'Reference number', formatFinnishReference(inv.referenceNumber)),
    row(fi ? 'Summa' : 'Amount', formatEUR(inv.totalGrossCents, locale)),
    ...(kind === 'reminder'
      ? [row(fi ? 'Avoinna' : 'Outstanding', formatEUR(outstanding, locale))]
      : []),
    ...(company.iban ? [row('IBAN', escapeHtml(company.iban))] : []),
    ...(company.bic ? [row('BIC', escapeHtml(company.bic))] : []),
  ].join('');
  const footer = fi ? texts.footerFi : texts.footerEn;
  return (
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">` +
    `<p>${fi ? 'Hei' : 'Hello'} ${escapeHtml(inv.customer.name)},</p>` +
    `<p>${escapeHtml(intro)}</p>` +
    `<table style="border-collapse:collapse">${rows}</table>` +
    `<p>${escapeHtml(fi ? texts.lateInterestTextFi : texts.lateInterestTextEn)}</p>` +
    `<p>${escapeHtml(footer)}</p>` +
    `<p style="color:#555">${escapeHtml(company.name)}${company.phone ? ` · ${escapeHtml(company.phone)}` : ''}${company.email ? ` · ${escapeHtml(company.email)}` : ''}</p>` +
    `</div>`
  );
}

/** Write a rendered PDF under UPLOAD_DIR and register it as an Attachment of the invoice. */
export async function storeInvoicePdfAttachment(
  buffer: Buffer,
  fileName: string,
  invoiceId: number,
): Promise<{ id: number }> {
  const uploadDir = path.resolve(env.UPLOAD_DIR);
  fs.mkdirSync(uploadDir, { recursive: true });
  const diskName = `${crypto.randomUUID()}.pdf`;
  fs.writeFileSync(path.join(uploadDir, diskName), buffer);
  const attachment = await prisma.attachment.create({
    data: {
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: buffer.length,
      path: diskName,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      uploadedById: currentUserId() ?? null,
      invoiceId,
    },
  });
  return { id: attachment.id };
}

export function invoicePdfFileName(language: 'EN' | 'FI', numberFormatted: string): string {
  return `${language === 'FI' ? 'Lasku' : 'Invoice'}-${numberFormatted}.pdf`;
}

/**
 * SENT: creates the income Entry (vatInvoice ALWAYS true — an invoice IS a VAT invoice).
 * CRITICAL rental linkage: an invoice made FROM a rental that already has an ACTIVE
 * entry UPDATES that entry (INVOICED + invoiceId + amounts synced) — never a duplicate.
 * Then renders the PDF, stores it as an Attachment and queues the email when an
 * address is known.
 */
export async function sendInvoice(
  id: number,
  emailOverride?: string,
): Promise<{ emailQueued: boolean }> {
  const invoice = await loadInvoiceDetail(id);
  if (invoice.status === 'CANCELLED') {
    throw conflict('INVOICE_CANCELLED', 'A cancelled invoice cannot be sent');
  }
  if (invoice.status !== 'DRAFT' || invoice.entry) {
    throw conflict('ALREADY_SENT', 'The invoice was already sent');
  }
  if (invoice.lines.length === 0) throw badRequest('NO_LINES', 'The invoice has no lines');

  const rate = dominantRateBp(invoice.lines);
  const discountTotal = invoice.lines.reduce((sum, l) => sum + l.discountCents, 0);
  const to = emailOverride ?? invoice.customer.email ?? null;

  // Render the PDF BEFORE mutating: a rendering failure must not leave a half-sent invoice.
  const [company, texts] = await Promise.all([companySetting(), invoiceTexts()]);
  const pdf = await buildInvoicePdf(invoice, company, texts);

  await prisma.$transaction(async (tx) => {
    const rentalEntry = invoice.rental?.entry ?? null;
    if (rentalEntry && rentalEntry.status === 'ACTIVE') {
      if (rentalEntry.invoiceId != null) {
        throw conflict('RENTAL_ALREADY_INVOICED', 'The rental is already linked to another invoice');
      }
      if (rentalEntry.paymentStatus === 'PAID') {
        throw conflict('RENTAL_ALREADY_PAID', 'The rental income is already received — nothing to invoice');
      }
      // exact per-line VAT from the invoice (it may mix rates), never a dominant-rate recompute
      await tx.entry.update({
        where: { id: rentalEntry.id },
        data: {
          paymentStatus: 'INVOICED',
          invoiceId: id,
          customerId: invoice.customerId,
          segment: invoice.customer.type,
          grossCents: invoice.totalGrossCents,
          discountCents: discountTotal,
          vatInvoice: true,
          vatRateBp: rate,
          vatCents: invoice.totalVatCents,
          netCents: invoice.totalNetCents,
        },
      });
      // discounts-given report follows the entry: delete + recreate
      await tx.discountRecord.deleteMany({ where: { entryId: rentalEntry.id } });
      if (discountTotal > 0) {
        await tx.discountRecord.create({
          data: {
            date: rentalEntry.entryDate,
            amountCents: discountTotal,
            reason: null,
            modelId: rentalEntry.modelId,
            entryId: rentalEntry.id,
            invoiceId: id,
          },
        });
      }
    } else {
      const modelId = invoice.modelId ?? (await sparePartsModelId(tx));
      const created = await createEntry(tx, {
        entryDate: fromDbDate(invoice.issueDate),
        modelId,
        unitId: invoice.unitId,
        customerId: invoice.customerId,
        description: `Invoice ${invoice.numberFormatted}`,
        grossBeforeDiscountCents: invoice.totalGrossCents + discountTotal,
        discountCents: discountTotal,
        vatInvoice: true, // an invoice is ALWAYS a VAT invoice
        vatRateBp: rate,
        paymentStatus: 'INVOICED',
        source: 'WEB',
        invoiceId: id,
        // restore the rental↔entry invariant only when no entry row (even a VOID one) holds the slot
        rentalId: invoice.rentalId != null && !rentalEntry ? invoice.rentalId : null,
      });
      // exact per-line VAT from the invoice (it may mix rates), never a dominant-rate recompute
      if (created.vatCents !== invoice.totalVatCents) {
        await tx.entry.update({
          where: { id: created.id },
          data: { vatCents: invoice.totalVatCents, netCents: invoice.totalNetCents },
        });
      }
    }
    await tx.invoice.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date(), emailedTo: to },
    });
  });

  // Post-commit: store the PDF + queue the email. Failures are logged, never fatal —
  // the invoice is SENT and the PDF can always be reprinted via GET /invoices/:id/pdf.
  let emailQueued = false;
  try {
    const attachment = await storeInvoicePdfAttachment(
      pdf,
      invoicePdfFileName(invoice.language, invoice.numberFormatted),
      id,
    );
    if (to) {
      await queueEmail({
        to,
        subject: invoiceSubject(invoice.language, invoice.numberFormatted, company.name),
        bodyHtml: invoiceEmailHtml(invoice, company, texts, 'invoice'),
        attachmentId: attachment.id,
      });
      emailQueued = true;
    }
  } catch (err) {
    logger.error({ err, invoiceId: id }, 'invoice send: storing PDF / queueing email failed');
  }

  await audit('SEND', 'invoices', id, { status: 'DRAFT' }, { status: 'SENT', emailedTo: to, emailQueued });
  return { emailQueued };
}

// ---------------------------------------------------------------- payments

export async function addInvoicePayment(id: number, body: AddPaymentBody): Promise<void> {
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { entry: true } });
  if (!invoice) throw notFound('Invoice');
  if (invoice.status === 'DRAFT') {
    throw conflict('NOT_SENT', 'Send the invoice before recording payments');
  }
  if (invoice.status === 'CANCELLED') {
    throw conflict('INVOICE_CANCELLED', 'A cancelled invoice cannot receive payments');
  }
  if (invoice.status === 'PAID') {
    throw conflict('ALREADY_PAID', 'The invoice is already fully paid');
  }
  const holder = await prisma.moneyHolder.findUnique({ where: { id: body.receivedById } });
  if (!holder) throw badRequest('BAD_HOLDER', '"Amount received by" holder not found');
  if (body.methodId != null) {
    const method = await prisma.paymentMethod.findUnique({ where: { id: body.methodId } });
    if (!method) throw badRequest('BAD_METHOD', 'Payment method not found');
  }

  let paidCents = 0;
  let fullyPaid = false;
  const paymentId = await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction and increment atomically: concurrent payments
    // must not overwrite each other's paidCents.
    const fresh = await tx.invoice.findUniqueOrThrow({ where: { id } });
    // Credit notes permanently reduce what is due, so "fully paid" accounts for them.
    const creditedCents = await creditedCentsOf(tx, id);
    const remaining = fresh.totalGrossCents - creditedCents - fresh.paidCents;
    if (body.amountCents > remaining) {
      throw badRequest(
        'OVERPAYMENT',
        `The payment is more than the ${(remaining / 100).toFixed(2)} € still open on this invoice`,
        { remainingCents: remaining },
      );
    }
    paidCents = fresh.paidCents + body.amountCents;
    fullyPaid = paidCents >= fresh.totalGrossCents - creditedCents;

    const payment = await tx.payment.create({
      data: {
        date: toDbDate(body.date),
        amountCents: body.amountCents,
        methodId: body.methodId ?? null,
        receivedById: body.receivedById,
        invoiceId: id,
        entryId: invoice.entry?.id ?? null,
        reference: body.reference ?? null,
        createdById: currentUserId() ?? null,
      },
    });
    await tx.invoice.update({
      where: { id },
      data: { paidCents: { increment: body.amountCents }, status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID' },
    });
    // entry.paymentStatus follows; the last payment's receiver lands on the entry when fully paid
    if (invoice.entry && invoice.entry.status === 'ACTIVE') {
      await tx.entry.update({
        where: { id: invoice.entry.id },
        data: fullyPaid
          ? { paymentStatus: 'PAID', receivedById: body.receivedById }
          : { paymentStatus: 'INVOICED' },
      });
    }
    return payment.id;
  });

  await audit('CREATE', 'payments', paymentId, undefined, { invoiceId: id, ...body });
  await audit(
    'UPDATE',
    'invoices',
    id,
    { paidCents: invoice.paidCents, status: invoice.status },
    { paidCents, status: fullyPaid ? 'PAID' : 'PARTIALLY_PAID' },
  );
}

// ---------------------------------------------------------------- reminders

/**
 * Queue a reminder email for an open (SENT / PARTIALLY_PAID) invoice. The subject
 * starts with the machine tag `[Reminder <numberFormatted>]` — the daily overdue job
 * checks EmailOutbox for that tag to avoid repeat reminders inside the window.
 */
export async function queueInvoiceReminder(id: number, emailOverride?: string): Promise<{ to: string }> {
  const invoice = await loadInvoiceDetail(id);
  if (invoice.status !== 'SENT' && invoice.status !== 'PARTIALLY_PAID') {
    throw conflict('NOT_OPEN', 'Only sent, unpaid invoices can be reminded');
  }
  const to = emailOverride ?? invoice.customer.email ?? invoice.emailedTo;
  if (!to) {
    throw badRequest('NO_EMAIL', 'The customer has no email address — pass { email } or add one');
  }
  const [company, texts] = await Promise.all([companySetting(), invoiceTexts()]);

  // Attach the newest stored invoice PDF; render (and store) one when none exists yet.
  let attachment = await prisma.attachment.findFirst({
    where: { invoiceId: id, mimeType: 'application/pdf' },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  if (!attachment) {
    const pdf = await buildInvoicePdf(invoice, company, texts);
    attachment = await storeInvoicePdfAttachment(
      pdf,
      invoicePdfFileName(invoice.language, invoice.numberFormatted),
      id,
    );
  }

  const subject = `${reminderTag(invoice.numberFormatted)} ${invoiceSubject(invoice.language, invoice.numberFormatted, company.name)}`;
  await queueEmail({
    to,
    subject,
    bodyHtml: invoiceEmailHtml(invoice, company, texts, 'reminder'),
    attachmentId: attachment.id,
  });
  await audit('SEND', 'invoices', id, undefined, { reminder: true, to, subject });
  return { to };
}
