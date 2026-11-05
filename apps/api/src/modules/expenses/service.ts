import type {
  Expense,
  ExpenseCategory,
  Investment,
  InvestmentCategory,
  Prisma,
  PrismaClient,
  StockMovement,
} from '@prisma/client';
import { reclaimableVat, roundHalfAwayFromZero, todayInHelsinki } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { currentUserId } from '../../context.js';

/**
 * Expense business rules:
 *  - reclaimableVatCents is a stored snapshot, recomputed on EVERY write (0 when the amount is missing)
 *  - partner personal spend / joint reinvestment maintains ONE derived auto Investment row
 *  - productId + stockQty receive goods into stock (PURCHASE movement) and update product cost
 *  - stock movements are append-only: corrections/voids are opposite ADJUSTMENT movements
 */

export type Tx = Prisma.TransactionClient;
type Db = Prisma.TransactionClient | PrismaClient;

// ---------------------------------------------------------------- serialization

export const expenseInclude = {
  category: { select: { id: true, nameEn: true, nameFi: true } },
  paidBy: { select: { id: true, name: true, kind: true } },
  unit: { select: { id: true, code: true, brand: true } },
  product: { select: { id: true, sku: true, nameEn: true } },
  attachments: { select: { id: true, fileName: true } },
} satisfies Prisma.ExpenseInclude;

export type ExpenseWithRefs = Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>;

export function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function serializeExpense(e: ExpenseWithRefs) {
  return { ...e, expenseDate: isoOrNull(e.expenseDate) };
}

// ---------------------------------------------------------------- VAT reclaim

/** Reclaimable input VAT snapshot â€” 0 when the gross amount is missing. */
export function computeReclaimable(args: {
  grossCents: number | null;
  vatRateBp: number;
  hasValidReceipt: boolean;
  businessUsePct: number;
}): number {
  if (args.grossCents == null) return 0;
  return reclaimableVat({
    grossCents: args.grossCents,
    rateBp: args.vatRateBp,
    hasValidReceipt: args.hasValidReceipt,
    businessUsePct: args.businessUsePct,
  });
}

// ---------------------------------------------------------------- auto investments

const CATEGORY_TO_INVESTMENT: Record<string, InvestmentCategory> = {
  'Unit purchases': 'UNITS',
  'Spare parts (stock)': 'SPARE_PARTS',
  Tools: 'TOOLS',
};

export function investmentCategoryForName(nameEn: string): InvestmentCategory {
  return CATEGORY_TO_INVESTMENT[nameEn] ?? 'EXPENSES';
}

export type ExpenseForInvestments = Pick<
  Expense,
  'id' | 'status' | 'grossCents' | 'jointReinvested' | 'paidById' | 'expenseDate' | 'unitId' | 'source'
> & { category: Pick<ExpenseCategory, 'nameEn'> };

export interface AutoInvestmentResult {
  deleted: Investment[];
  created: Investment[];
  kept: Investment[];
}

/**
 * Replace the derived auto Investment rows of an expense (inside the caller's transaction):
 * delete the ACTIVE auto rows, then recreate per the rules â€”
 *  - jointReinvested      -> joint 50/50 row  { isJoint: true, holderId: null }
 *  - paid by a PARTNER    -> personal row     { holderId, isJoint: false }
 *  - category mapped from the expense category name; amount = grossCents (skipped when null);
 *    date = expenseDate ?? today; auto = true.
 * An existing row that already matches is kept untouched (idempotent re-writes).
 */
export async function rebuildAutoInvestments(
  tx: Tx,
  expense: ExpenseForInvestments,
): Promise<AutoInvestmentResult> {
  const existing = await tx.investment.findMany({
    where: { expenseId: expense.id, auto: true, status: 'ACTIVE' },
    orderBy: { id: 'asc' },
  });

  let target: { holderId: number | null; isJoint: boolean } | null = null;
  if (expense.status === 'ACTIVE' && expense.grossCents != null) {
    if (expense.jointReinvested) {
      target = { holderId: null, isJoint: true };
    } else if (expense.paidById != null) {
      const holder = await tx.moneyHolder.findUnique({ where: { id: expense.paidById } });
      if (holder && holder.kind === 'PARTNER') target = { holderId: holder.id, isJoint: false };
    }
  }

  if (!target) {
    if (existing.length > 0) {
      await tx.investment.updateMany({ where: { id: { in: existing.map((i) => i.id) } }, data: { status: 'VOID' } });
    }
    return { deleted: existing, created: [], kept: [] };
  }

  const dateIso = expense.expenseDate ? isoOrNull(expense.expenseDate)! : todayInHelsinki();
  const date = new Date(`${dateIso}T00:00:00Z`);
  const category = investmentCategoryForName(expense.category.nameEn);
  const amountCents = expense.grossCents as number; // checked non-null above
  const unitId = expense.unitId ?? null;

  const match = existing.length === 1 ? existing[0] : null;
  if (
    match &&
    match.holderId === target.holderId &&
    match.isJoint === target.isJoint &&
    match.category === category &&
    match.amountCents === amountCents &&
    match.date.getTime() === date.getTime() &&
    match.unitId === unitId
  ) {
    return { deleted: [], created: [], kept: [match] };
  }

  if (existing.length > 0) {
    await tx.investment.updateMany({ where: { id: { in: existing.map((i) => i.id) } }, data: { status: 'VOID' } });
  }
  const created = await tx.investment.create({
    data: {
      date,
      holderId: target.holderId,
      isJoint: target.isJoint,
      category,
      amountCents,
      expenseId: expense.id,
      unitId,
      note: null,
      auto: true,
      source: expense.source,
      createdById: currentUserId() ?? null,
    },
  });
  return { deleted: existing, created: [created], kept: [] };
}

// ---------------------------------------------------------------- stock receiving

export interface DesiredStock {
  productId: number;
  qty: number;
  unitCostCents: number | null;
}

/** Per-unit landed cost of the received goods: round(gross / qty), half away from zero. */
export function unitCostFor(grossCents: number | null, qty: number): number | null {
  if (grossCents == null || qty <= 0) return null;
  return roundHalfAwayFromZero(grossCents / qty);
}

/** Net stock effect (qty per product) of the movements linked to one expense. */
export async function stockEffectOf(db: Db, expenseId: number): Promise<Map<number, number>> {
  const movements = await db.stockMovement.findMany({ where: { expenseId } });
  const net = new Map<number, number>();
  for (const m of movements) net.set(m.productId, (net.get(m.productId) ?? 0) + m.qty);
  for (const [productId, qty] of [...net.entries()]) if (qty === 0) net.delete(productId);
  return net;
}

/**
 * Bring the stock effect of an expense to `desired` (or to nothing when null).
 * Movements are never edited or deleted: the previous effect is reversed with an
 * opposite ADJUSTMENT (`reason`), then a fresh PURCHASE movement is written and
 * product.costCents is updated to the new unit cost. No-op when already in the
 * desired state. Returns the movements that were created.
 */
export async function syncStockMovements(
  tx: Tx,
  expenseId: number,
  desired: DesiredStock | null,
  reason: string,
): Promise<StockMovement[]> {
  const movements = await tx.stockMovement.findMany({ where: { expenseId }, orderBy: { id: 'asc' } });
  const net = new Map<number, number>();
  for (const m of movements) net.set(m.productId, (net.get(m.productId) ?? 0) + m.qty);
  for (const [productId, qty] of [...net.entries()]) if (qty === 0) net.delete(productId);

  let lastPurchaseCost: number | null = null;
  if (desired) {
    for (const m of movements) {
      if (m.type === 'PURCHASE' && m.productId === desired.productId) lastPurchaseCost = m.unitCostCents;
    }
  }

  const unchanged = desired
    ? net.size === 1 &&
      net.get(desired.productId) === desired.qty &&
      lastPurchaseCost === desired.unitCostCents
    : net.size === 0;
  if (unchanged) return [];

  const created: StockMovement[] = [];
  for (const [productId, qty] of net.entries()) {
    created.push(
      await tx.stockMovement.create({
        data: {
          productId,
          type: 'ADJUSTMENT',
          qty: -qty,
          reason,
          expenseId,
          createdById: currentUserId() ?? null,
        },
      }),
    );
  }
  if (desired) {
    created.push(
      await tx.stockMovement.create({
        data: {
          productId: desired.productId,
          type: 'PURCHASE',
          qty: desired.qty,
          unitCostCents: desired.unitCostCents,
          expenseId,
          createdById: currentUserId() ?? null,
        },
      }),
    );
    if (desired.unitCostCents != null) {
      await tx.product.update({
        where: { id: desired.productId },
        data: { costCents: desired.unitCostCents },
      });
    }
  }
  return created;
}

// ---------------------------------------------------------------- duplicate detection

const DUP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** Vendor comparison key: trimmed, lowercased; null when there is no usable vendor. */
export function vendorKey(vendor: string | null): string | null {
  const key = vendor?.trim().toLowerCase();
  return key ? key : null;
}

/** Dates match when both are missing, or both set and at most 3 days apart. */
export function datesWithinDuplicateWindow(a: Date | null, b: Date | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a.getTime() - b.getTime()) <= DUP_WINDOW_MS;
}

/** ACTIVE expenses that look like duplicates of the given one (same vendor + gross, date Â±3 days). */
export async function findDuplicatesOf(
  expense: Pick<Expense, 'id' | 'vendor' | 'grossCents' | 'expenseDate'>,
): Promise<Array<{ id: number; expenseDate: string | null; vendor: string | null; grossCents: number | null }>> {
  const key = vendorKey(expense.vendor);
  if (key == null || expense.grossCents == null) return [];
  const candidates = await prisma.expense.findMany({
    where: {
      status: 'ACTIVE',
      id: { not: expense.id },
      grossCents: expense.grossCents,
      vendor: { not: null },
    },
    orderBy: [{ expenseDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
  });
  return candidates
    .filter(
      (c) => vendorKey(c.vendor) === key && datesWithinDuplicateWindow(expense.expenseDate, c.expenseDate),
    )
    .map((c) => ({
      id: c.id,
      expenseDate: isoOrNull(c.expenseDate),
      vendor: c.vendor,
      grossCents: c.grossCents,
    }));
}

export interface DuplicateClusterExpense {
  id: number;
  expenseDate: string | null;
  vendor: string | null;
  description: string;
  grossCents: number | null;
  category: { id: number; nameEn: string };
}

export interface DuplicateCluster {
  vendor: string | null;
  grossCents: number | null;
  count: number;
  expenses: DuplicateClusterExpense[];
}

/**
 * Grouped clusters of suspected duplicates among ACTIVE expenses:
 * same trimmed-lowercase vendor + same gross amount, dates within 3 days of the
 * cluster's earliest member (expenses with no date cluster together). Newest first.
 */
export async function findDuplicateClusters(): Promise<DuplicateCluster[]> {
  const rows = await prisma.expense.findMany({
    where: { status: 'ACTIVE', vendor: { not: null }, grossCents: { not: null } },
    include: { category: { select: { id: true, nameEn: true } } },
    orderBy: [{ expenseDate: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
  });
  type Row = (typeof rows)[number];

  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const v = vendorKey(r.vendor);
    if (v == null) continue;
    const key = `${v}\u0000${r.grossCents}`;
    const list = byKey.get(key);
    if (list) list.push(r);
    else byKey.set(key, [r]);
  }

  const clusters: Array<DuplicateCluster & { newestMs: number }> = [];
  const pushCluster = (members: Row[]): void => {
    if (members.length < 2) return;
    clusters.push({
      vendor: members[0].vendor,
      grossCents: members[0].grossCents,
      count: members.length,
      newestMs: members.reduce((max, e) => Math.max(max, e.expenseDate?.getTime() ?? -1), -1),
      expenses: members.map((e) => ({
        id: e.id,
        expenseDate: isoOrNull(e.expenseDate),
        vendor: e.vendor,
        description: e.description,
        grossCents: e.grossCents,
        category: e.category,
      })),
    });
  };

  for (const group of byKey.values()) {
    pushCluster(group.filter((e) => e.expenseDate == null));
    const dated = group.filter((e) => e.expenseDate != null); // already sorted ascending
    let cluster: Row[] = [];
    for (const e of dated) {
      if (
        cluster.length === 0 ||
        e.expenseDate!.getTime() - cluster[0].expenseDate!.getTime() <= DUP_WINDOW_MS
      ) {
        cluster.push(e);
      } else {
        pushCluster(cluster);
        cluster = [e];
      }
    }
    pushCluster(cluster);
  }

  clusters.sort((a, b) => b.newestMs - a.newestMs);
  return clusters.map(({ newestMs: _ignored, ...cluster }) => cluster);
}
