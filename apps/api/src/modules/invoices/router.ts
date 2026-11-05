import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { todayInHelsinki, type ISODate } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  AddPaymentSchema,
  CreateInvoiceSchema,
  CreditNoteSchema,
  IdParam,
  ListCreditNotesQuery,
  ListInvoicesQuery,
  OverdueQuery,
  PdfQuery,
  RemindSchema,
  SendInvoiceSchema,
  UpdateInvoiceSchema,
  type AddPaymentBody,
  type CreateInvoiceBody,
  type CreditNoteBody,
  type ListCreditNotesQueryT,
  type ListInvoicesQueryT,
  type OverdueQueryT,
  type PdfQueryT,
  type RemindBody,
  type SendInvoiceBody,
  type UpdateInvoiceBody,
} from './schemas.js';
import {
  addInvoicePayment,
  companySetting,
  createInvoice,
  invoiceListInclude,
  invoicePdfFileName,
  invoiceTexts,
  loadInvoiceDetail,
  outstandingSum,
  queueInvoiceReminder,
  sendInvoice,
  serializeInvoice,
  serializeInvoiceDetail,
  toDbDate,
  updateInvoice,
} from './service.js';
import {
  createCreditNote,
  listCreditNotes,
  loadCreditNoteDetail,
  serializeCreditNote,
} from './credit-notes.js';
import { buildCreditNotePdf, buildInvoicePdf, invoiceThermalHtml } from './pdf.js';

/**
 * /invoices — DRAFT → SENT → PARTIALLY_PAID → PAID, CANCELLED only via credit note.
 * ADMIN and STAFF read/write; ACCOUNTANT reads (writes also blocked globally).
 *
 * Route order matters (Express matches top-down): /credit-notes and /overdue are
 * registered BEFORE /:id so they are never parsed as an invoice id.
 */
export const invoicesRouter = Router();
invoicesRouter.use(requireAuth());

// ---------------------------------------------------------------- list + sums

/** The filterable where-clause shared by the list rows and the sums aggregates. */
function buildListWhere(q: ListInvoicesQueryT, today: ISODate): Prisma.InvoiceWhereInput {
  const and: Prisma.InvoiceWhereInput[] = [];
  if (q.status) and.push({ status: q.status });
  if (q.customerId) and.push({ customerId: q.customerId });
  if (q.from) and.push({ issueDate: { gte: toDbDate(q.from) } });
  if (q.to) and.push({ issueDate: { lte: toDbDate(q.to) } });
  // OVERDUE is derived: open (SENT/PARTIALLY_PAID) and past the due date.
  if (q.overdue === true) {
    and.push({ status: { in: ['SENT', 'PARTIALLY_PAID'] }, dueDate: { lt: toDbDate(today) } });
  }
  if (q.overdue === false) {
    and.push({
      OR: [{ status: { notIn: ['SENT', 'PARTIALLY_PAID'] } }, { dueDate: { gte: toDbDate(today) } }],
    });
  }
  if (q.q) {
    and.push({
      OR: [
        { numberFormatted: { contains: q.q, mode: 'insensitive' } },
        { referenceNumber: { contains: q.q } },
        { notes: { contains: q.q, mode: 'insensitive' } },
        { customer: { is: { name: { contains: q.q, mode: 'insensitive' } } } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

invoicesRouter.get('/', validate({ query: ListInvoicesQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as ListInvoicesQueryT;
    const today = todayInHelsinki();
    const where = buildListWhere(q, today);
    const openWhere: Prisma.InvoiceWhereInput = {
      AND: [where, { status: { in: ['SENT', 'PARTIALLY_PAID'] } }],
    };
    const overdueWhere: Prisma.InvoiceWhereInput = {
      AND: [where, { status: { in: ['SENT', 'PARTIALLY_PAID'] }, dueDate: { lt: toDbDate(today) } }],
    };

    const [total, rows, allAgg, openOutstanding, overdueOutstanding] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        include: invoiceListInclude,
        orderBy: [{ issueDate: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.invoice.aggregate({
        where,
        _sum: { totalGrossCents: true, totalVatCents: true, totalNetCents: true, paidCents: true },
      }),
      outstandingSum(openWhere),
      outstandingSum(overdueWhere),
    ]);

    res.json({
      invoices: rows.map((inv) => serializeInvoice(inv, today)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      sums: {
        grossCents: allAgg._sum.totalGrossCents ?? 0,
        vatCents: allAgg._sum.totalVatCents ?? 0,
        netCents: allAgg._sum.totalNetCents ?? 0,
        paidCents: allAgg._sum.paidCents ?? 0,
        outstandingCents: openOutstanding,
        overdueCents: overdueOutstanding,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- credit notes (BEFORE /:id)

invoicesRouter.get('/credit-notes', validate({ query: ListCreditNotesQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as ListCreditNotesQueryT;
    res.json(await listCreditNotes(q));
  } catch (err) {
    next(err);
  }
});

invoicesRouter.get('/credit-notes/:id/pdf', validate({ params: IdParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const cn = await loadCreditNoteDetail(id);
    const [company, texts] = await Promise.all([companySetting(), invoiceTexts()]);
    const pdf = await buildCreditNotePdf(cn, company, texts);
    const lang = cn.invoice?.language ?? 'EN';
    const fileName = `${lang === 'FI' ? 'Hyvityslasku' : 'CreditNote'}-${cn.numberFormatted}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- overdue (BEFORE /:id)

invoicesRouter.get('/overdue', validate({ query: OverdueQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as OverdueQueryT;
    const today = todayInHelsinki();
    const where: Prisma.InvoiceWhereInput = {
      status: { in: ['SENT', 'PARTIALLY_PAID'] },
      dueDate: { lt: toDbDate(today) },
    };
    const [total, rows, agg] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        include: invoiceListInclude,
        // deviation from the "newest first" default: most-overdue first is the actionable order
        orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      outstandingSum(where),
    ]);
    res.json({
      invoices: rows.map((inv) => serializeInvoice(inv, today)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      sums: {
        outstandingCents: agg,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- create / read / update

invoicesRouter.post(
  '/',
  requireAuth('ADMIN', 'STAFF'),
  validate({ body: CreateInvoiceSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as CreateInvoiceBody;
      const id = await createInvoice(body);
      res.status(201).json({ invoice: serializeInvoiceDetail(await loadInvoiceDetail(id), todayInHelsinki()) });
    } catch (err) {
      next(err);
    }
  },
);

invoicesRouter.get('/:id', validate({ params: IdParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    res.json({ invoice: serializeInvoiceDetail(await loadInvoiceDetail(id), todayInHelsinki()) });
  } catch (err) {
    next(err);
  }
});

invoicesRouter.put(
  '/:id',
  requireAuth('ADMIN', 'STAFF'),
  validate({ params: IdParam, body: UpdateInvoiceSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as UpdateInvoiceBody;
      await updateInvoice(id, body);
      res.json({ invoice: serializeInvoiceDetail(await loadInvoiceDetail(id), todayInHelsinki()) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- send

invoicesRouter.post(
  '/:id/send',
  requireAuth('ADMIN', 'STAFF'),
  validate({ params: IdParam, body: SendInvoiceSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as SendInvoiceBody;
      const { emailQueued } = await sendInvoice(id, body.email);
      res.json({
        invoice: serializeInvoiceDetail(await loadInvoiceDetail(id), todayInHelsinki()),
        emailQueued,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- payments

invoicesRouter.post(
  '/:id/payments',
  requireAuth('ADMIN', 'STAFF'),
  validate({ params: IdParam, body: AddPaymentSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as AddPaymentBody;
      await addInvoicePayment(id, body);
      res.status(201).json({
        invoice: serializeInvoiceDetail(await loadInvoiceDetail(id), todayInHelsinki()),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- credit note

invoicesRouter.post(
  '/:id/credit-note',
  requireAuth('ADMIN', 'STAFF'),
  validate({ params: IdParam, body: CreditNoteSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as CreditNoteBody;
      const cnId = await createCreditNote(id, body);
      res.status(201).json({
        creditNote: serializeCreditNote(await loadCreditNoteDetail(cnId)),
        invoice: serializeInvoiceDetail(await loadInvoiceDetail(id), todayInHelsinki()),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- documents (reprint always allowed)

invoicesRouter.get(
  '/:id/pdf',
  validate({ params: IdParam, query: PdfQuery }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const q = req.query as unknown as PdfQueryT;
      const invoice = await loadInvoiceDetail(id);
      const [company, texts] = await Promise.all([companySetting(), invoiceTexts()]);
      if (q.format === 'thermal') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(invoiceThermalHtml(invoice, company, texts, q.width));
        return;
      }
      const pdf = await buildInvoicePdf(invoice, company, texts);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${invoicePdfFileName(invoice.language, invoice.numberFormatted)}"`,
      );
      res.send(pdf);
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- reminder

invoicesRouter.post(
  '/:id/remind',
  requireAuth('ADMIN', 'STAFF'),
  validate({ params: IdParam, body: RemindSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as RemindBody;
      const { to } = await queueInvoiceReminder(id, body.email);
      res.json({ ok: true, to });
    } catch (err) {
      next(err);
    }
  },
);
