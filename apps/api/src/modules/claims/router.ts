import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { todayInHelsinki } from '@emotionfix/shared';
import { prisma, nextNumber } from '../../db.js';
import { badRequest, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { currentUserId } from '../../context.js';

/**
 * Warranty / insurance claims (case files towards warranty & insurance companies).
 * Case numbers are sequential: WC-<year>-0001 via the CLAIM number sequence.
 * ADMIN + STAFF read/write; ACCOUNTANT read (writes blocked globally).
 */
export const claimsRouter = Router();
claimsRouter.use(requireAuth('ADMIN', 'STAFF', 'ACCOUNTANT'));

const CLAIM_STATUSES = ['OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'] as const;
const DECIDED_STATUSES = new Set<string>(['APPROVED', 'REJECTED', 'PAID']);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const idParam = z.object({ id: z.coerce.number().int().positive() });

const claimInclude = {
  customer: {
    select: { id: true, type: true, name: true, businessId: true, email: true, language: true },
  },
  unit: {
    select: { id: true, code: true, brand: true, modelName: true, category: true, status: true },
  },
  product: { select: { id: true, sku: true, nameEn: true, nameFi: true, brand: true } },
  attachments: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
  },
} satisfies Prisma.WarrantyClaimInclude;

type ClaimWithRefs = Prisma.WarrantyClaimGetPayload<{ include: typeof claimInclude }>;

const dateOut = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

function serializeClaim(claim: ClaimWithRefs) {
  return {
    ...claim,
    submittedAt: dateOut(claim.submittedAt),
    decidedAt: dateOut(claim.decidedAt),
  };
}

/** Validate the referenced customer/unit/product ids before writing. */
async function assertClaimRefs(refs: {
  customerId?: number | null;
  unitId?: number | null;
  productId?: number | null;
}): Promise<void> {
  if (refs.customerId != null) {
    const customer = await prisma.customer.findUnique({ where: { id: refs.customerId } });
    if (!customer) throw badRequest('BAD_CUSTOMER', 'Customer not found');
  }
  if (refs.unitId != null) {
    const unit = await prisma.unit.findUnique({ where: { id: refs.unitId } });
    if (!unit) throw badRequest('BAD_UNIT', 'Unit not found');
  }
  if (refs.productId != null) {
    const product = await prisma.product.findUnique({ where: { id: refs.productId } });
    if (!product) throw badRequest('BAD_PRODUCT', 'Product not found');
  }
}

// ---------- list ----------
const ListQuery = z.object({
  status: z.enum(CLAIM_STATUSES).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

claimsRouter.get('/', validate({ query: ListQuery }), async (req, res, next) => {
  try {
    const { status, q, page, pageSize } = req.query as unknown as z.infer<typeof ListQuery>;
    const where: Prisma.WarrantyClaimWhereInput = {};
    if (status) where.status = status;
    if (q) {
      where.OR = [
        { caseNumber: { contains: q, mode: 'insensitive' } },
        { company: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [claims, total] = await Promise.all([
      prisma.warrantyClaim.findMany({
        where,
        include: claimInclude,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.warrantyClaim.count({ where }),
    ]);
    res.json({ claims: claims.map(serializeClaim), total, page, pageSize });
  } catch (err) {
    next(err);
  }
});

// ---------- detail ----------
claimsRouter.get('/:id', validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const claim = await prisma.warrantyClaim.findUnique({ where: { id }, include: claimInclude });
    if (!claim) throw notFound('Claim');
    res.json({ claim: serializeClaim(claim) });
  } catch (err) {
    next(err);
  }
});

// ---------- create ----------
const ClaimCreateSchema = z.object({
  company: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(4000),
  customerId: z.number().int().positive().nullish(),
  unitId: z.number().int().positive().nullish(),
  productId: z.number().int().positive().nullish(),
  claimedCents: z.number().int().min(0).nullish(),
  submittedAt: isoDate.nullish(),
  notes: z.string().max(4000).nullish(),
  status: z.enum(CLAIM_STATUSES).default('OPEN'),
});

claimsRouter.post(
  '/',
  requireAuth('ADMIN', 'STAFF'),
  validate({ body: ClaimCreateSchema }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof ClaimCreateSchema>;
      await assertClaimRefs(body);
      const year = todayInHelsinki().slice(0, 4);
      const claim = await prisma.$transaction(async (tx) => {
        const n = await nextNumber(tx, 'CLAIM');
        return tx.warrantyClaim.create({
          data: {
            caseNumber: `WC-${year}-${String(n).padStart(4, '0')}`,
            company: body.company,
            description: body.description,
            customerId: body.customerId ?? null,
            unitId: body.unitId ?? null,
            productId: body.productId ?? null,
            claimedCents: body.claimedCents ?? null,
            submittedAt: body.submittedAt ? new Date(`${body.submittedAt}T00:00:00Z`) : null,
            notes: body.notes ?? null,
            status: body.status,
            createdById: currentUserId() ?? null,
          },
          include: claimInclude,
        });
      });
      await audit('CREATE', 'warranty_claims', claim.id, undefined, claim);
      res.status(201).json({ claim: serializeClaim(claim) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- update (status changes go through /:id/status) ----------
const ClaimUpdateSchema = z.object({
  company: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().min(1).max(4000).optional(),
  customerId: z.number().int().positive().nullish(),
  unitId: z.number().int().positive().nullish(),
  productId: z.number().int().positive().nullish(),
  claimedCents: z.number().int().min(0).nullish(),
  approvedCents: z.number().int().min(0).nullish(),
  submittedAt: isoDate.nullish(),
  decidedAt: isoDate.nullish(),
  notes: z.string().max(4000).nullish(),
});

claimsRouter.put(
  '/:id',
  requireAuth('ADMIN', 'STAFF'),
  validate({ params: idParam, body: ClaimUpdateSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as z.infer<typeof ClaimUpdateSchema>;
      const before = await prisma.warrantyClaim.findUnique({ where: { id } });
      if (!before) throw notFound('Claim');
      await assertClaimRefs(body);

      const data: Prisma.WarrantyClaimUncheckedUpdateInput = {};
      if (body.company !== undefined) data.company = body.company;
      if (body.description !== undefined) data.description = body.description;
      if (body.customerId !== undefined) data.customerId = body.customerId;
      if (body.unitId !== undefined) data.unitId = body.unitId;
      if (body.productId !== undefined) data.productId = body.productId;
      if (body.claimedCents !== undefined) data.claimedCents = body.claimedCents;
      if (body.approvedCents !== undefined) data.approvedCents = body.approvedCents;
      if (body.submittedAt !== undefined) {
        data.submittedAt = body.submittedAt ? new Date(`${body.submittedAt}T00:00:00Z`) : null;
      }
      if (body.decidedAt !== undefined) {
        data.decidedAt = body.decidedAt ? new Date(`${body.decidedAt}T00:00:00Z`) : null;
      }
      if (body.notes !== undefined) data.notes = body.notes;

      const claim = await prisma.warrantyClaim.update({ where: { id }, data, include: claimInclude });
      await audit('UPDATE', 'warranty_claims', id, before, claim);
      res.json({ claim: serializeClaim(claim) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- status transition (free-form, every change audited) ----------
const StatusSchema = z.object({
  status: z.enum(CLAIM_STATUSES),
  approvedCents: z.number().int().min(0).nullish(),
  decidedAt: isoDate.optional(),
});

claimsRouter.post(
  '/:id/status',
  requireAuth('ADMIN', 'STAFF'),
  validate({ params: idParam, body: StatusSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as z.infer<typeof StatusSchema>;
      const before = await prisma.warrantyClaim.findUnique({ where: { id } });
      if (!before) throw notFound('Claim');

      const data: Prisma.WarrantyClaimUncheckedUpdateInput = { status: body.status };
      if (body.approvedCents !== undefined) data.approvedCents = body.approvedCents;
      if (body.decidedAt) {
        data.decidedAt = new Date(`${body.decidedAt}T00:00:00Z`);
      } else if (DECIDED_STATUSES.has(body.status) && !before.decidedAt) {
        // decided today unless a date was supplied or already recorded
        data.decidedAt = new Date(`${todayInHelsinki()}T00:00:00Z`);
      }

      const claim = await prisma.warrantyClaim.update({ where: { id }, data, include: claimInclude });
      await audit('UPDATE', 'warranty_claims', id, before, claim);
      res.json({ claim: serializeClaim(claim) });
    } catch (err) {
      next(err);
    }
  },
);
