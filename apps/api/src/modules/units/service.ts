import { Prisma } from '@prisma/client';
import type { Investment, MoneyHolder, Unit } from '@prisma/client';
import {
  type ISODate,
  isPaidBack,
  lifetimeResult,
  paybackPct,
  remainingToPayback,
  saleProfit,
  todayInHelsinki,
  yymmdd,
} from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { conflict } from '../../errors.js';
import { currentUserId } from '../../context.js';
import type { Tx } from '../../services/entries.js';
import { getSetting } from '../../services/settings.js';
import type { UnitCreateInput, UnitUpdateInput } from './schemas.js';

/** Review reason used when a unit is saved without a purchase date (contract wording). */
export const DRAFT_REVIEW_REASON = 'Purchase date missing â€” ID provisional';

const DRAFT_CODE_RE = /-DRAFT\d*$/;

export type UnitWithHolders = Unit & { owner: MoneyHolder | null; paidBy: MoneyHolder | null };

export function toIsoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function isDraftCode(code: string): boolean {
  return DRAFT_CODE_RE.test(code);
}

// ------------------------------------------------------------------
// Computed financials (earned / parts / payback / sale profit / lifetime)
// ------------------------------------------------------------------

export interface UnitTotals {
  earnedCents: number;
  partsCents: number;
}

export interface UnitFinancials extends UnitTotals {
  paybackPct: number | null;
  paidBack: boolean;
  remainingCents: number | null;
  saleProfitCents: number | null;
  lifetimeCents: number;
}

/** Setting `units` â†’ `{ subtractRepairPartsFromPayback }`: subtract REPAIR_USE part costs from payback. */
export async function subtractPartsFromPayback(): Promise<boolean> {
  const setting = await getSetting<{ subtractRepairPartsFromPayback?: boolean }>('units', {
    subtractRepairPartsFromPayback: false,
  });
  return setting.subtractRepairPartsFromPayback === true;
}

/**
 * earnedCents = Î£ netCents of the unit's ACTIVE entries (net of VAT and discounts),
 * EXCLUDING the unit-sale entry itself: the sale price is tracked separately in
 * soldCents, so payback shows what the unit earned while owned and lifetimeResult
 * (earned + sale âˆ’ cost âˆ’ parts) never counts the sale twice.
 * partsCents  = Î£ |qty| Ã— (movement.unitCostCents ?? product.costCents ?? 0) of REPAIR_USE movements.
 */
export async function collectUnitTotals(unitIds: number[]): Promise<Map<number, UnitTotals>> {
  const totals = new Map<number, UnitTotals>();
  for (const id of unitIds) totals.set(id, { earnedCents: 0, partsCents: 0 });
  if (unitIds.length === 0) return totals;

  const earned = await prisma.entry.groupBy({
    by: ['unitId'],
    where: {
      unitId: { in: unitIds },
      status: 'ACTIVE',
      model: { isNot: { code: 'UNIT_SALES' } },
    },
    _sum: { netCents: true },
  });
  for (const row of earned) {
    if (row.unitId === null) continue;
    const t = totals.get(row.unitId);
    if (t) t.earnedCents = row._sum.netCents ?? 0;
  }

  const movements = await prisma.stockMovement.findMany({
    where: { unitId: { in: unitIds }, type: 'REPAIR_USE' },
    select: {
      unitId: true,
      qty: true,
      unitCostCents: true,
      product: { select: { costCents: true } },
    },
  });
  for (const m of movements) {
    if (m.unitId === null) continue;
    const t = totals.get(m.unitId);
    if (!t) continue;
    const costPerPiece = m.unitCostCents ?? m.product.costCents ?? 0;
    t.partsCents += Math.abs(m.qty) * costPerPiece;
  }
  return totals;
}

/** Full computed block per unit, honouring the subtract-parts setting for payback only. */
export async function computeFinancials<
  U extends Pick<Unit, 'id' | 'status' | 'purchaseCents' | 'soldCents'>,
>(units: U[]): Promise<Map<number, UnitFinancials>> {
  const totals = await collectUnitTotals(units.map((u) => u.id));
  const subtractParts = await subtractPartsFromPayback();
  const out = new Map<number, UnitFinancials>();
  for (const u of units) {
    const t = totals.get(u.id) ?? { earnedCents: 0, partsCents: 0 };
    const paybackBase = t.earnedCents - (subtractParts ? t.partsCents : 0);
    out.set(u.id, {
      earnedCents: t.earnedCents,
      partsCents: t.partsCents,
      paybackPct: paybackPct(paybackBase, u.purchaseCents),
      paidBack: isPaidBack(paybackBase, u.purchaseCents),
      remainingCents: remainingToPayback(paybackBase, u.purchaseCents),
      saleProfitCents:
        u.status === 'SOLD' && u.soldCents !== null
          ? saleProfit(u.soldCents, u.purchaseCents ?? 0)
          : null,
      lifetimeCents: lifetimeResult({
        earnedCents: t.earnedCents,
        saleCents: u.soldCents,
        costCents: u.purchaseCents,
        partsCents: t.partsCents,
      }),
    });
  }
  return out;
}

// ------------------------------------------------------------------
// Serialisation
// ------------------------------------------------------------------

function serializeHolder(h: MoneyHolder | null) {
  return h ? { id: h.id, name: h.name, kind: h.kind, active: h.active } : null;
}

export function serializeUnit(unit: UnitWithHolders, fin: UnitFinancials) {
  return {
    id: unit.id,
    code: unit.code,
    brand: unit.brand,
    modelName: unit.modelName,
    category: unit.category,
    inclusions: unit.inclusions,
    purchaseDate: toIsoDate(unit.purchaseDate),
    sellerName: unit.sellerName,
    purchaseCents: unit.purchaseCents,
    ownerId: unit.ownerId,
    owner: serializeHolder(unit.owner),
    paidById: unit.paidById,
    paidBy: serializeHolder(unit.paidBy),
    status: unit.status,
    notes: unit.notes,
    legacyName: unit.legacyName,
    soldCents: unit.soldCents,
    soldDate: toIsoDate(unit.soldDate),
    soldToCustomerId: unit.soldToCustomerId,
    needsReview: unit.needsReview,
    reviewReason: unit.reviewReason,
    active: unit.active,
    createdAt: unit.createdAt.toISOString(),
    updatedAt: unit.updatedAt.toISOString(),
    earnedCents: fin.earnedCents,
    partsCents: fin.partsCents,
    paybackPct: fin.paybackPct,
    paidBack: fin.paidBack,
    remainingCents: fin.remainingCents,
    saleProfitCents: fin.saleProfitCents,
    lifetimeCents: fin.lifetimeCents,
  };
}

// ------------------------------------------------------------------
// Code generation
// ------------------------------------------------------------------

/**
 * Match the brand against unit_prefixes (case-insensitive containment of the prefix's
 * brandName in the unit brand). The longest matching brandName wins, so "Ego Evo 2"
 * resolves to EE2, not EE. Falls back to the brand's first word, uppercased, â‰¤ 4 chars.
 */
export async function resolvePrefix(tx: Tx, brand: string): Promise<string> {
  const prefixes = await tx.unitPrefix.findMany({ where: { active: true } });
  const brandLc = brand.toLowerCase();
  const matches = prefixes.filter((p) => brandLc.includes(p.brandName.toLowerCase()));
  matches.sort(
    (a, b) => b.brandName.length - a.brandName.length || b.prefix.length - a.prefix.length,
  );
  if (matches.length > 0) return matches[0].prefix;
  const firstWord = brand.trim().split(/\s+/)[0] ?? '';
  const fallback = firstWord
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
  return fallback !== '' ? fallback : 'UNIT';
}

async function codeTaken(tx: Tx, code: string, excludeId?: number): Promise<boolean> {
  const found = await tx.unit.findUnique({ where: { code }, select: { id: true } });
  return found !== null && found.id !== excludeId;
}

/**
 * With a purchase date: PREFIX-YYMMDD, appending -2, -3â€¦ on collision.
 * Without one: PREFIX-DRAFT<n>, n = count of existing "<PREFIX>-DRAFTâ€¦" codes + 1
 * (bumped further if that exact code is somehow taken).
 */
export async function generateUnitCode(
  tx: Tx,
  brand: string,
  purchaseDate: ISODate | null,
  excludeId?: number,
): Promise<{ code: string; draft: boolean }> {
  const prefix = await resolvePrefix(tx, brand);
  if (purchaseDate) {
    const base = `${prefix}-${yymmdd(purchaseDate)}`;
    let candidate = base;
    let n = 2;
    while (await codeTaken(tx, candidate, excludeId)) {
      candidate = `${base}-${n}`;
      n += 1;
    }
    return { code: candidate, draft: false };
  }
  const draftBase = `${prefix}-DRAFT`;
  const existing = await tx.unit.count({ where: { code: { startsWith: draftBase } } });
  let n = existing + 1;
  while (await codeTaken(tx, `${draftBase}${n}`, excludeId)) n += 1;
  return { code: `${draftBase}${n}`, draft: true };
}

// ------------------------------------------------------------------
// Auto investment (partner-paid unit purchase â†’ Investment UNITS, auto)
// ------------------------------------------------------------------

export interface InvestmentSync {
  deleted: Investment[];
  created: Investment | null;
}

/**
 * Replace this unit's auto investment rows (unit purchases only: expenseId null, auto true).
 * A new row is created when the purchase was paid by a PARTNER holder and has a price.
 */
export async function syncAutoInvestments(tx: Tx, unit: Unit): Promise<InvestmentSync> {
  const deleted = await tx.investment.findMany({
    where: { unitId: unit.id, auto: true, expenseId: null, status: 'ACTIVE' },
  });
  if (deleted.length > 0) {
    await tx.investment.updateMany({ where: { id: { in: deleted.map((i) => i.id) } }, data: { status: 'VOID' } });
  }
  let created: Investment | null = null;
  if (unit.paidById !== null && unit.purchaseCents !== null && unit.purchaseCents > 0) {
    const holder = await tx.moneyHolder.findUnique({ where: { id: unit.paidById } });
    if (holder && holder.kind === 'PARTNER') {
      created = await tx.investment.create({
        data: {
          date: unit.purchaseDate ?? new Date(`${todayInHelsinki()}T00:00:00Z`),
          holderId: unit.paidById,
          category: 'UNITS',
          amountCents: unit.purchaseCents,
          unitId: unit.id,
          auto: true,
          source: 'WEB',
          createdById: currentUserId() ?? null,
        },
      });
    }
  }
  return { deleted, created };
}

// ------------------------------------------------------------------
// Create / update (transactions, with retry on code collisions under race)
// ------------------------------------------------------------------

function isUniqueCodeViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  const target = (err.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.includes('code');
  if (typeof target === 'string') return target.includes('code');
  return true;
}

/** Retries generated-code collisions (concurrent creates); an override collision is a 409. */
async function withCodeRetry<T>(hasOverride: boolean, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (isUniqueCodeViolation(err)) {
        if (!hasOverride && attempt < 3) continue;
        throw conflict('DUPLICATE', 'Unit code is already in use');
      }
      throw err;
    }
  }
}

export interface CreateUnitResult {
  unit: UnitWithHolders;
  investment: Investment | null;
}

export async function createUnit(input: UnitCreateInput): Promise<CreateUnitResult> {
  return withCodeRetry(input.codeOverride != null, () =>
    prisma.$transaction(async (tx) => {
      const missingDate = input.purchaseDate == null;
      const code =
        input.codeOverride != null
          ? input.codeOverride
          : (await generateUnitCode(tx, input.brand, input.purchaseDate ?? null)).code;

      const unit = await tx.unit.create({
        data: {
          code,
          brand: input.brand,
          modelName: input.modelName ?? null,
          category: input.category,
          inclusions: input.inclusions ?? null,
          purchaseDate: input.purchaseDate ? new Date(`${input.purchaseDate}T00:00:00Z`) : null,
          sellerName: input.sellerName ?? null,
          purchaseCents: input.purchaseCents ?? null,
          ownerId: input.ownerId ?? null,
          paidById: input.paidById ?? null,
          status: input.status ?? 'AVAILABLE',
          notes: input.notes ?? null,
          needsReview: missingDate,
          reviewReason: missingDate ? DRAFT_REVIEW_REASON : null,
        },
        include: { owner: true, paidBy: true },
      });
      const { created } = await syncAutoInvestments(tx, unit);
      return { unit, investment: created };
    }),
  );
}

export interface UpdateUnitResult {
  unit: UnitWithHolders;
  deletedInvestments: Investment[];
  createdInvestment: Investment | null;
}

export async function updateUnit(before: Unit, input: UnitUpdateInput): Promise<UpdateUnitResult> {
  return withCodeRetry(input.codeOverride != null, () =>
    prisma.$transaction(async (tx) => {
      const data: Prisma.UnitUncheckedUpdateInput = {};
      if (input.brand !== undefined) data.brand = input.brand;
      if (input.modelName !== undefined) data.modelName = input.modelName;
      if (input.category !== undefined) data.category = input.category;
      if (input.inclusions !== undefined) data.inclusions = input.inclusions;
      if (input.sellerName !== undefined) data.sellerName = input.sellerName;
      if (input.purchaseCents !== undefined) data.purchaseCents = input.purchaseCents;
      if (input.ownerId !== undefined) data.ownerId = input.ownerId;
      if (input.paidById !== undefined) data.paidById = input.paidById;
      if (input.status !== undefined) data.status = input.status;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.purchaseDate !== undefined) {
        data.purchaseDate = input.purchaseDate
          ? new Date(`${input.purchaseDate}T00:00:00Z`)
          : null;
      }

      // Code: an explicit override wins; otherwise a purchase date arriving on a
      // DRAFT-coded unit regenerates the real PREFIX-YYMMDD code.
      if (input.codeOverride != null) {
        data.code = input.codeOverride;
      } else if (input.purchaseDate != null && isDraftCode(before.code)) {
        const gen = await generateUnitCode(
          tx,
          input.brand ?? before.brand,
          input.purchaseDate,
          before.id,
        );
        data.code = gen.code;
      }

      // Clear the review flag when the missing purchase date was the (only) reason.
      const effectiveDate =
        input.purchaseDate !== undefined
          ? (input.purchaseDate ?? null)
          : toIsoDate(before.purchaseDate);
      if (effectiveDate !== null && before.reviewReason === DRAFT_REVIEW_REASON) {
        data.needsReview = false;
        data.reviewReason = null;
      }

      const unit = await tx.unit.update({
        where: { id: before.id },
        data,
        include: { owner: true, paidBy: true },
      });

      const purchaseChanged =
        (input.purchaseCents !== undefined &&
          (input.purchaseCents ?? null) !== before.purchaseCents) ||
        (input.paidById !== undefined && (input.paidById ?? null) !== before.paidById) ||
        (input.purchaseDate !== undefined &&
          (input.purchaseDate ?? null) !== toIsoDate(before.purchaseDate));

      let deletedInvestments: Investment[] = [];
      let createdInvestment: Investment | null = null;
      if (purchaseChanged) {
        const sync = await syncAutoInvestments(tx, unit);
        deletedInvestments = sync.deleted;
        createdInvestment = sync.created;
      }
      return { unit, deletedInvestments, createdInvestment };
    }),
  );
}
