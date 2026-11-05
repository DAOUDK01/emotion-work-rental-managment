import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type ContractJob } from '@prisma/client';
import { prisma } from '../../db.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { currentUserId } from '../../context.js';
import { invoiceMonthForContract, isoOut, serializeInvoice } from './service.js';

/**
 * Maintenance contracts with business customers (e.g. Ryde Finland fleet repairs)
 * and their per-vehicle job log. Jobs are billed monthly onto one draft invoice.
 * ADMIN read/write; ACCOUNTANT read (writes blocked globally).
 */
export const contractsRouter = Router();
contractsRouter.use(requireAuth('ADMIN', 'ACCOUNTANT'));

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const idParam = z.object({ id: z.coerce.number().int().positive() });
const jobParams = z.object({
  id: z.coerce.number().int().positive(),
  jobId: z.coerce.number().int().positive(),
});

const customerSelect = {
  select: { id: true, type: true, name: true, businessId: true, email: true, language: true },
} as const;

type ContractRow = Prisma.ContractGetPayload<{
  include: { customer: typeof customerSelect; _count: { select: { jobs: true } } };
}>;

function serializeContract(contract: ContractRow) {
  const { _count, ...rest } = contract;
  return {
    ...rest,
    startDate: isoOut(contract.startDate),
    endDate: contract.endDate ? isoOut(contract.endDate) : null,
    jobCount: _count.jobs,
  };
}

function serializeJob(job: ContractJob) {
  return {
    ...job,
    date: isoOut(job.date),
    hours: job.hours === null ? null : Number(job.hours),
    invoicedAt: job.invoicedAt ? job.invoicedAt.toISOString() : null,
  };
}

async function assertBusinessCustomer(customerId: number): Promise<void> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw badRequest('BAD_CUSTOMER', 'Customer not found');
  if (customer.type !== 'BUSINESS') {
    throw badRequest('NOT_BUSINESS', 'Contracts can only be made with business customers');
  }
}

function assertPeriod(startDate: string, endDate: string | null | undefined): void {
  if (endDate && endDate < startDate) {
    throw badRequest('BAD_PERIOD', 'Contract end date is before its start date');
  }
}

// ---------- contracts: list ----------
const ListQuery = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

contractsRouter.get('/', validate({ query: ListQuery }), async (req, res, next) => {
  try {
    const { q, customerId, active, page, pageSize } = req.query as unknown as z.infer<typeof ListQuery>;
    const where: Prisma.ContractWhereInput = {};
    if (customerId) where.customerId = customerId;
    if (active !== undefined) where.active = active;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const [contracts, total] = await Promise.all([
      prisma.contract.findMany({
        where,
        include: { customer: customerSelect, _count: { select: { jobs: true } } },
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.contract.count({ where }),
    ]);
    res.json({ contracts: contracts.map(serializeContract), total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

// ---------- contracts: detail ----------
contractsRouter.get('/:id', validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const contract = await prisma.contract.findUnique({
      where: { id },
      include: { customer: customerSelect, _count: { select: { jobs: true } } },
    });
    if (!contract) throw notFound('Contract');
    const [recentJobs, uninvoiced] = await Promise.all([
      prisma.contractJob.findMany({
        where: { contractId: id },
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: 20,
      }),
      prisma.contractJob.aggregate({
        where: { contractId: id, invoiceId: null },
        _sum: { amountCents: true },
        _count: true,
      }),
    ]);
    res.json({
      contract: {
        ...serializeContract(contract),
        jobs: recentJobs.map(serializeJob),
        uninvoicedCents: uninvoiced._sum.amountCents ?? 0,
        uninvoicedJobCount: uninvoiced._count,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ---------- contracts: create ----------
const ContractCreateSchema = z.object({
  customerId: z.number().int().positive(),
  name: z.string().trim().min(1).max(200),
  terms: z.string().max(10000).nullish(),
  ratesJson: z.record(z.number().int().min(0)).nullish(),
  startDate: isoDate,
  endDate: isoDate.nullish(),
  active: z.boolean().default(true),
});

contractsRouter.post(
  '/',
  requireAuth('ADMIN'),
  validate({ body: ContractCreateSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof ContractCreateSchema>;
      await assertBusinessCustomer(body.customerId);
      assertPeriod(body.startDate, body.endDate);
      const contract = await prisma.contract.create({
        data: {
          customerId: body.customerId,
          name: body.name,
          terms: body.terms ?? null,
          ratesJson: body.ratesJson == null ? Prisma.DbNull : (body.ratesJson as Prisma.InputJsonValue),
          startDate: new Date(`${body.startDate}T00:00:00Z`),
          endDate: body.endDate ? new Date(`${body.endDate}T00:00:00Z`) : null,
          active: body.active,
        },
        include: { customer: customerSelect, _count: { select: { jobs: true } } },
      });
      await audit('CREATE', 'contracts', contract.id, undefined, contract);
      res.status(201).json({ contract: serializeContract(contract) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- contracts: update ----------
const ContractUpdateSchema = ContractCreateSchema.partial();

contractsRouter.put(
  '/:id',
  requireAuth('ADMIN'),
  validate({ params: idParam, body: ContractUpdateSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as z.infer<typeof ContractUpdateSchema>;
      const before = await prisma.contract.findUnique({ where: { id } });
      if (!before) throw notFound('Contract');
      if (body.customerId !== undefined) await assertBusinessCustomer(body.customerId);

      const startDate = body.startDate ?? isoOut(before.startDate);
      const endDate =
        body.endDate !== undefined ? body.endDate : before.endDate ? isoOut(before.endDate) : null;
      assertPeriod(startDate, endDate);

      const data: Prisma.ContractUncheckedUpdateInput = {};
      if (body.customerId !== undefined) data.customerId = body.customerId;
      if (body.name !== undefined) data.name = body.name;
      if (body.terms !== undefined) data.terms = body.terms;
      if (body.ratesJson !== undefined) {
        data.ratesJson = body.ratesJson == null ? Prisma.DbNull : (body.ratesJson as Prisma.InputJsonValue);
      }
      if (body.startDate !== undefined) data.startDate = new Date(`${body.startDate}T00:00:00Z`);
      if (body.endDate !== undefined) {
        data.endDate = body.endDate ? new Date(`${body.endDate}T00:00:00Z`) : null;
      }
      if (body.active !== undefined) data.active = body.active;

      const contract = await prisma.contract.update({
        where: { id },
        data,
        include: { customer: customerSelect, _count: { select: { jobs: true } } },
      });
      await audit('UPDATE', 'contracts', id, before, contract);
      res.json({ contract: serializeContract(contract) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- jobs: list ----------
const JobListQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  invoiced: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

contractsRouter.get(
  '/:id/jobs',
  validate({ params: idParam, query: JobListQuery }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { from, to, invoiced, page, pageSize } = req.query as unknown as z.infer<typeof JobListQuery>;
      const contract = await prisma.contract.findUnique({ where: { id } });
      if (!contract) throw notFound('Contract');

      const where: Prisma.ContractJobWhereInput = { contractId: id };
      if (from || to) {
        where.date = {
          ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
          ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}),
        };
      }
      if (invoiced !== undefined) where.invoiceId = invoiced ? { not: null } : null;

      const [jobs, total] = await Promise.all([
        prisma.contractJob.findMany({
          where,
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.contractJob.count({ where }),
      ]);
      res.json({ jobs: jobs.map(serializeJob), total, page, pageSize });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- jobs: create ----------
const JobCreateSchema = z.object({
  date: isoDate,
  vehicleRef: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  hours: z.number().positive().max(9999.99).nullish(),
  amountCents: z.number().int().min(0),
});

contractsRouter.post(
  '/:id/jobs',
  requireAuth('ADMIN'),
  validate({ params: idParam, body: JobCreateSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as z.infer<typeof JobCreateSchema>;
      const contract = await prisma.contract.findUnique({ where: { id } });
      if (!contract) throw notFound('Contract');

      const job = await prisma.contractJob.create({
        data: {
          contractId: id,
          date: new Date(`${body.date}T00:00:00Z`),
          vehicleRef: body.vehicleRef,
          description: body.description,
          hours: body.hours ?? null,
          amountCents: body.amountCents,
          createdById: currentUserId() ?? null,
        },
      });
      await audit('CREATE', 'contract_jobs', job.id, undefined, job);
      res.status(201).json({ job: serializeJob(job) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- jobs: update (only while uninvoiced) ----------
const JobUpdateSchema = JobCreateSchema.partial();

contractsRouter.put(
  '/:id/jobs/:jobId',
  requireAuth('ADMIN'),
  validate({ params: jobParams, body: JobUpdateSchema }),
  async (req, res, next) => {
    try {
      const { id, jobId } = req.params as unknown as { id: number; jobId: number };
      const body = req.body as z.infer<typeof JobUpdateSchema>;
      const before = await prisma.contractJob.findFirst({ where: { id: jobId, contractId: id } });
      if (!before) throw notFound('Contract job');
      if (before.invoiceId !== null) {
        throw conflict('ALREADY_INVOICED', 'This job is already on an invoice and can no longer be changed');
      }

      const data: Prisma.ContractJobUncheckedUpdateInput = {};
      if (body.date !== undefined) data.date = new Date(`${body.date}T00:00:00Z`);
      if (body.vehicleRef !== undefined) data.vehicleRef = body.vehicleRef;
      if (body.description !== undefined) data.description = body.description;
      if (body.hours !== undefined) data.hours = body.hours;
      if (body.amountCents !== undefined) data.amountCents = body.amountCents;

      const job = await prisma.contractJob.update({ where: { id: jobId }, data });
      await audit('UPDATE', 'contract_jobs', jobId, before, job);
      res.json({ job: serializeJob(job) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- jobs: void (= delete; a job only becomes a financial record once invoiced) ----------
const VoidSchema = z.object({ reason: z.string().trim().min(1).max(500).optional() });

contractsRouter.post(
  '/:id/jobs/:jobId/void',
  requireAuth('ADMIN'),
  validate({ params: jobParams, body: VoidSchema }),
  async (req, res, next) => {
    try {
      const { id, jobId } = req.params as unknown as { id: number; jobId: number };
      const { reason } = req.body as z.infer<typeof VoidSchema>;
      const before = await prisma.contractJob.findFirst({ where: { id: jobId, contractId: id } });
      if (!before) throw notFound('Contract job');
      if (before.invoiceId !== null) {
        throw conflict('ALREADY_INVOICED', 'This job is already billed — credit the invoice instead');
      }
      await prisma.contractJob.delete({ where: { id: jobId } });
      await audit('DELETE', 'contract_jobs', jobId, before, { reason: reason ?? null });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- monthly billing ----------
const InvoiceMonthSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'),
});

contractsRouter.post(
  '/:id/invoice-month',
  requireAuth('ADMIN'),
  validate({ params: idParam, body: InvoiceMonthSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { month } = req.body as z.infer<typeof InvoiceMonthSchema>;
      const invoice = await invoiceMonthForContract(id, month);
      res.status(201).json({ invoice: serializeInvoice(invoice) });
    } catch (err) {
      next(err);
    }
  },
);
