import type { Prisma } from '@prisma/client';
import { paybackPct, remainingToPayback } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { badRequest, notFound } from '../../errors.js';
import { audit } from '../../services/audit.js';
import { createEntry, defaultVatInvoice, vatRateOn, type Tx } from '../../services/entries.js';
import { getSetting } from '../../services/settings.js';
import type { CreateEntryBody, ListEntriesQuery } from './schemas.js';

/** Rich includes used by every read of this module. */
export const entryInclude = {
  model: true,
  unit: true,
  customer: true,
  paymentMethod: true,
  receivedBy: true,
} satisfies Prisma.EntryInclude;

export type EntryWithRefs = Prisma.EntryGetPayload<{ include: typeof entryInclude }>;

export const toDbDate = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
export const toIsoDate = (d: Date): string => d.toISOString().slice(0, 10);

export function serializeEntry(e: EntryWithRefs) {
  return {
    id: e.id,
    entryDate: toIsoDate(e.entryDate),
    modelId: e.modelId,
    model: { id: e.model.id, code: e.model.code, nameEn: e.model.nameEn, nameFi: e.model.nameFi },
    unitId: e.unitId,
    unit: e.unit
      ? { id: e.unit.id, code: e.unit.code, brand: e.unit.brand, modelName: e.unit.modelName }
      : null,
    customerId: e.customerId,
    customer: e.customer ? { id: e.customer.id, name: e.customer.name, type: e.customer.type } : null,
    customerName: e.customerName,
    description: e.description,
    grossCents: e.grossCents,
    discountCents: e.discountCents,
    discountReason: e.discountReason,
    vatInvoice: e.vatInvoice,
    vatRateBp: e.vatRateBp,
    vatCents: e.vatCents,
    netCents: e.netCents,
    labourCents: e.labourCents,
    partsCents: e.partsCents,
    paymentStatus: e.paymentStatus,
    paymentMethodId: e.paymentMethodId,
    paymentMethod: e.paymentMethod ? { id: e.paymentMethod.id, name: e.paymentMethod.name } : null,
    receivedById: e.receivedById,
    receivedBy: e.receivedBy
      ? { id: e.receivedBy.id, name: e.receivedBy.name, kind: e.receivedBy.kind }
      : null,
    segment: e.segment,
    source: e.source,
    status: e.status,
    voidReason: e.voidReason,
    needsReview: e.needsReview,
    reviewReason: e.reviewReason,
    saleId: e.saleId,
    rentalId: e.rentalId,
    invoiceId: e.invoiceId,
    whatsappMessageId: e.whatsappMessageId,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

export async function getEntryWithRefs(id: number): Promise<EntryWithRefs> {
  const entry = await prisma.entry.findUnique({ where: { id }, include: entryInclude });
  if (!entry) throw notFound('Entry');
  return entry;
}

// ------------------------------------------------------------------
// audit bookkeeping — collected inside the transaction, written after commit
// (audit() uses the global client and must never log a rolled-back change)
// ------------------------------------------------------------------

export interface AuditItem {
  action: 'CREATE' | 'UPDATE' | 'VOID';
  entity: string;
  entityId: number;
  before?: unknown;
  after?: unknown;
}

export async function flushAudits(items: AuditItem[]): Promise<void> {
  for (const item of items) {
    await audit(item.action, item.entity, item.entityId, item.before, item.after);
  }
}

// ------------------------------------------------------------------
// referenced-row validation (clean 400s instead of FK violations)
// ------------------------------------------------------------------

export async function assertRefs(
  tx: Tx,
  refs: {
    modelId?: number;
    unitId?: number | null;
    paymentMethodId?: number | null;
    receivedById?: number | null;
  },
): Promise<void> {
  if (refs.modelId !== undefined) {
    const model = await tx.businessModel.findUnique({ where: { id: refs.modelId } });
    if (!model) throw badRequest('BAD_MODEL', 'Business model not found');
  }
  if (refs.unitId !== undefined && refs.unitId !== null) {
    const unit = await tx.unit.findUnique({ where: { id: refs.unitId } });
    if (!unit) throw badRequest('BAD_UNIT', 'Unit not found');
  }
  if (refs.paymentMethodId !== undefined && refs.paymentMethodId !== null) {
    const method = await tx.paymentMethod.findUnique({ where: { id: refs.paymentMethodId } });
    if (!method) throw badRequest('BAD_PAYMENT_METHOD', 'Payment method not found');
  }
  if (refs.receivedById !== undefined && refs.receivedById !== null) {
    const holder = await tx.moneyHolder.findUnique({ where: { id: refs.receivedById } });
    if (!holder) throw badRequest('BAD_RECEIVED_BY', '"Amount received by" holder not found');
  }
}

// ------------------------------------------------------------------
// list
// ------------------------------------------------------------------

function buildWhere(q: ListEntriesQuery): Prisma.EntryWhereInput {
  const where: Prisma.EntryWhereInput = {};
  if (q.from !== undefined || q.to !== undefined) {
    where.entryDate = {
      ...(q.from !== undefined ? { gte: toDbDate(q.from) } : {}),
      ...(q.to !== undefined ? { lte: toDbDate(q.to) } : {}),
    };
  }
  if (q.modelId !== undefined) where.modelId = q.modelId;
  if (q.unitId !== undefined) where.unitId = q.unitId;
  if (q.customerId !== undefined) where.customerId = q.customerId;
  if (q.receivedById !== undefined) where.receivedById = q.receivedById;
  if (q.paymentStatus !== undefined) where.paymentStatus = q.paymentStatus;
  if (q.vatInvoice !== undefined) where.vatInvoice = q.vatInvoice;
  if (q.source !== undefined) where.source = q.source;
  if (q.needsReview !== undefined) where.needsReview = q.needsReview;
  if (q.status !== undefined) where.status = q.status;
  if (q.q !== undefined && q.q !== '') {
    where.OR = [
      { description: { contains: q.q, mode: 'insensitive' } },
      { customerName: { contains: q.q, mode: 'insensitive' } },
      { customer: { is: { name: { contains: q.q, mode: 'insensitive' } } } },
      { unit: { is: { code: { contains: q.q, mode: 'insensitive' } } } },
    ];
  }
  return where;
}

export async function listEntries(q: ListEntriesQuery) {
  const where = buildWhere(q);
  // Sums cover the WHOLE filtered set (not just the page), ACTIVE rows only.
  const activeWhere: Prisma.EntryWhereInput = { AND: [where, { status: 'ACTIVE' }] };
  const nonVatWhere: Prisma.EntryWhereInput = { AND: [where, { status: 'ACTIVE', vatInvoice: false }] };
  const [entries, total, sumAll, sumNonVat] = await Promise.all([
    prisma.entry.findMany({
      where,
      include: entryInclude,
      orderBy: [{ entryDate: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.entry.count({ where }),
    prisma.entry.aggregate({
      where: activeWhere,
      _sum: { grossCents: true, vatCents: true, netCents: true },
    }),
    prisma.entry.aggregate({ where: nonVatWhere, _sum: { grossCents: true } }),
  ]);
  return {
    entries: entries.map(serializeEntry),
    total,
    page: q.page,
    pageSize: q.pageSize,
    sums: {
      grossCents: sumAll._sum.grossCents ?? 0,
      vatCents: sumAll._sum.vatCents ?? 0,
      netCents: sumAll._sum.netCents ?? 0,
      nonVatCents: sumNonVat._sum.grossCents ?? 0,
    },
  };
}

// ------------------------------------------------------------------
// unit payback (for the POST response / quick feedback to staff)
// ------------------------------------------------------------------

export interface UnitPayback {
  code: string;
  earnedCents: number;
  costCents: number | null;
  remainingCents: number | null;
  paybackPct: number | null;
}

export async function computeUnitPayback(db: Tx, unitId: number): Promise<UnitPayback | null> {
  const unit = await db.unit.findUnique({ where: { id: unitId } });
  if (!unit) return null;
  // same rule as the Units page: the unit's own sale is not "earned" (it's soldCents)
  const earnedAgg = await db.entry.aggregate({
    where: { unitId, status: 'ACTIVE', model: { isNot: { code: 'UNIT_SALES' } } },
    _sum: { netCents: true },
  });
  let earnedCents = earnedAgg._sum.netCents ?? 0;
  const subtractParts =
    (await getSetting<{ subtractRepairPartsFromPayback?: boolean }>('units', {})).subtractRepairPartsFromPayback ===
    true;
  if (subtractParts) {
    const moves = await db.stockMovement.findMany({
      where: { unitId, type: 'REPAIR_USE' },
      select: { qty: true, unitCostCents: true },
    });
    const partsCents = moves.reduce((sum, m) => sum + Math.abs(m.qty) * (m.unitCostCents ?? 0), 0);
    earnedCents -= partsCents;
  }
  const costCents = unit.purchaseCents;
  return {
    code: unit.code,
    earnedCents,
    costCents,
    remainingCents: remainingToPayback(earnedCents, costCents),
    paybackPct: paybackPct(earnedCents, costCents),
  };
}

// ------------------------------------------------------------------
// create (quick entry form)
// ------------------------------------------------------------------

export async function createQuickEntry(
  input: CreateEntryBody,
): Promise<{ entry: EntryWithRefs; unitPayback: UnitPayback | null }> {
  const vatInvoice =
    input.vatInvoice ?? (await defaultVatInvoice(input.receivedById ?? null, input.paymentMethodId ?? null));
  const vatRateBp = input.vatRateBp ?? (await vatRateOn(input.entryDate));

  const created = await prisma.$transaction(async (tx) => {
    await assertRefs(tx, input);
    return createEntry(tx, {
      entryDate: input.entryDate,
      modelId: input.modelId,
      unitId: input.unitId ?? null,
      customerId: input.customerId ?? null,
      customerName: input.customerName ?? null,
      description: input.description ?? null,
      grossBeforeDiscountCents: input.grossBeforeDiscountCents,
      discountCents: input.discountCents ?? 0,
      discountReason: input.discountReason ?? null,
      vatInvoice,
      vatRateBp,
      labourCents: input.labourCents ?? null,
      partsCents: input.partsCents ?? null,
      paymentStatus: input.paymentStatus,
      paymentMethodId: input.paymentMethodId ?? null,
      receivedById: input.receivedById ?? null,
      source: 'WEB',
      needsReview: input.needsReview ?? false,
      reviewReason: input.reviewReason ?? null,
    });
  });

  await audit('CREATE', 'entries', created.id, undefined, created);
  const entry = await getEntryWithRefs(created.id);
  // Payback feedback includes the entry just saved (ACTIVE net cents of the unit).
  const unitPayback = created.unitId !== null ? await computeUnitPayback(prisma, created.unitId) : null;
  return { entry, unitPayback };
}
