import type { HolderKind, Prisma } from '@prisma/client';
import { type ISODate, addDays, compareISO, todayInHelsinki } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { getSetting } from '../../services/settings.js';

/**
 * "Cash & settlements" — the no-escape-point ledger.
 * Every euro received lands on a MoneyHolder (Payment rows, written by the entry
 * service); it leaves a holder only through a CashHandover to another holder
 * (normally the Company Account). Balances are therefore always derivable:
 *   holding = Σ active payments received − Σ active handovers out.
 * The Company row counts money the company got directly plus handovers in.
 */

const DEFAULT_ALERT_AFTER_DAYS = 7;

/** Setting `cash` = `{ alertAfterDays: 7 }` (see prisma/seed.ts DEFAULT_SETTINGS). */
export async function getAlertAfterDays(): Promise<number> {
  const cash = await getSetting<{ alertAfterDays?: number }>('cash', {
    alertAfterDays: DEFAULT_ALERT_AFTER_DAYS,
  });
  const n = Number(cash?.alertAfterDays);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_ALERT_AFTER_DAYS;
}

export interface HolderBalance {
  holder: { id: number; name: string; kind: HolderKind };
  receivedCents: number;
  handedOverCents: number;
  holdingCents: number;
  oldestUnsettledDate: ISODate | null;
  overdueAlert: boolean;
}

/**
 * FIFO settlement: walk the holder's active payments oldest-first, accumulating,
 * until the running sum first exceeds what was already handed over. That payment's
 * date is the oldest receipt that is not yet fully settled. Negative rows (refunds)
 * simply reduce the running sum.
 */
function oldestUnsettledDate(
  paymentsAsc: ReadonlyArray<{ amountCents: number; date: Date }>,
  handedOverCents: number,
): ISODate | null {
  let cumulative = 0;
  for (const p of paymentsAsc) {
    cumulative += p.amountCents;
    if (cumulative > handedOverCents) return p.date.toISOString().slice(0, 10);
  }
  return null;
}

/** Balances of every active money holder (the GET /cash/balances payload). */
export async function computeBalances(): Promise<{ balances: HolderBalance[]; alertAfterDays: number }> {
  const [alertAfterDays, holders, paymentSums, handoverOutSums, handoverInSums] = await Promise.all([
    getAlertAfterDays(),
    prisma.moneyHolder.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    }),
    prisma.payment.groupBy({
      by: ['receivedById'],
      where: { status: 'ACTIVE' },
      _sum: { amountCents: true },
    }),
    prisma.cashHandover.groupBy({
      by: ['fromHolderId'],
      where: { status: 'ACTIVE' },
      _sum: { amountCents: true },
    }),
    prisma.cashHandover.groupBy({
      by: ['toHolderId'],
      where: { status: 'ACTIVE' },
      _sum: { amountCents: true },
    }),
  ]);

  const receivedBy = new Map<number, number>(
    paymentSums.map((r) => [r.receivedById, r._sum.amountCents ?? 0]),
  );
  const handedOverBy = new Map<number, number>(
    handoverOutSums.map((r) => [r.fromHolderId, r._sum.amountCents ?? 0]),
  );
  const handedInTo = new Map<number, number>(
    handoverInSums.map((r) => [r.toHolderId, r._sum.amountCents ?? 0]),
  );

  // Payments (oldest first) for the FIFO walk of every non-company holder that has any.
  const walkHolderIds = holders
    .filter((h) => h.kind !== 'COMPANY' && receivedBy.has(h.id))
    .map((h) => h.id);
  const paymentsAsc =
    walkHolderIds.length > 0
      ? await prisma.payment.findMany({
          where: { status: 'ACTIVE', receivedById: { in: walkHolderIds } },
          orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: { receivedById: true, amountCents: true, date: true },
        })
      : [];
  const paymentsByHolder = new Map<number, { amountCents: number; date: Date }[]>();
  for (const p of paymentsAsc) {
    const list = paymentsByHolder.get(p.receivedById);
    if (list) list.push(p);
    else paymentsByHolder.set(p.receivedById, [p]);
  }

  const today = todayInHelsinki();
  const alertCutoff = addDays(today, -alertAfterDays);

  const balances: HolderBalance[] = holders.map((h) => {
    const holder = { id: h.id, name: h.name, kind: h.kind };
    if (h.kind === 'COMPANY') {
      // Company: money received directly + handovers in; it hands nothing "over".
      const receivedCents = (receivedBy.get(h.id) ?? 0) + (handedInTo.get(h.id) ?? 0);
      return {
        holder,
        receivedCents,
        handedOverCents: 0,
        holdingCents: receivedCents,
        oldestUnsettledDate: null,
        overdueAlert: false,
      };
    }
    const receivedCents = receivedBy.get(h.id) ?? 0;
    const handedOverCents = handedOverBy.get(h.id) ?? 0;
    const holdingCents = receivedCents - handedOverCents;
    const oldest = oldestUnsettledDate(paymentsByHolder.get(h.id) ?? [], handedOverCents);
    const overdueAlert =
      holdingCents > 0 && oldest !== null && compareISO(oldest, alertCutoff) < 0;
    return {
      holder,
      receivedCents,
      handedOverCents,
      holdingCents,
      oldestUnsettledDate: oldest,
      overdueAlert,
    };
  });

  return { balances, alertAfterDays };
}

/** Current holding of one holder (used for the OVERDRAWN check before a handover). */
export async function currentHoldingCents(holder: { id: number; kind: HolderKind }): Promise<number> {
  const [paymentSum, outSum, inSum] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: 'ACTIVE', receivedById: holder.id },
      _sum: { amountCents: true },
    }),
    prisma.cashHandover.aggregate({
      where: { status: 'ACTIVE', fromHolderId: holder.id },
      _sum: { amountCents: true },
    }),
    prisma.cashHandover.aggregate({
      where: { status: 'ACTIVE', toHolderId: holder.id },
      _sum: { amountCents: true },
    }),
  ]);
  const received = paymentSum._sum.amountCents ?? 0;
  if (holder.kind === 'COMPANY') {
    // Matches the balances view: company holding = direct receipts + handovers in.
    return received + (inSum._sum.amountCents ?? 0);
  }
  return received - (outSum._sum.amountCents ?? 0);
}

// ------------------------------------------------------------------
// Merged ledger (receipts + handovers)
// ------------------------------------------------------------------

export type LedgerKind = 'RECEIPT' | 'HANDOVER_OUT' | 'HANDOVER_IN';

export interface LedgerRow {
  date: ISODate;
  kind: LedgerKind;
  amountCents: number;
  /** The other side of the movement: payer (customer) for receipts, the other holder for handovers. */
  counterparty: string | null;
  description: string | null;
  link: { entryId?: number; saleId?: number; invoiceId?: number; handoverId?: number };
}

export interface LedgerFilter {
  holderId?: number;
  from?: ISODate;
  to?: ISODate;
}

type LedgerPayment = Prisma.PaymentGetPayload<{
  select: {
    id: true;
    date: true;
    createdAt: true;
    amountCents: true;
    note: true;
    reference: true;
    entryId: true;
    saleId: true;
    invoiceId: true;
    entry: { select: { description: true; customerName: true; customer: { select: { name: true } } } };
    sale: { select: { number: true; customer: { select: { name: true } } } };
    invoice: { select: { numberFormatted: true; customer: { select: { name: true } } } };
  };
}>;

function receiptDescription(p: LedgerPayment): string | null {
  if (p.entry?.description) return p.entry.description;
  if (p.invoice) return `Invoice ${p.invoice.numberFormatted}`;
  if (p.sale) return p.sale.number;
  return p.note ?? p.reference ?? null;
}

function receiptCounterparty(p: LedgerPayment): string | null {
  return (
    p.entry?.customer?.name ??
    p.entry?.customerName ??
    p.invoice?.customer?.name ??
    p.sale?.customer?.name ??
    null
  );
}

function dateFilter(filter: LedgerFilter): { date?: { gte?: Date; lte?: Date } } {
  if (!filter.from && !filter.to) return {};
  const range: { gte?: Date; lte?: Date } = {};
  if (filter.from) range.gte = new Date(`${filter.from}T00:00:00Z`);
  if (filter.to) range.lte = new Date(`${filter.to}T00:00:00Z`);
  return { date: range };
}

const KIND_ORDER: Record<LedgerKind, number> = { RECEIPT: 0, HANDOVER_OUT: 1, HANDOVER_IN: 2 };

/**
 * The merged holder ledger, newest first. Receipts are active Payment rows
 * (including negative refund rows); each active handover appears as OUT for its
 * from-holder and IN for its to-holder (filtered to one side when holderId is given).
 */
export async function buildLedger(filter: LedgerFilter): Promise<LedgerRow[]> {
  const paymentWhere: Prisma.PaymentWhereInput = {
    status: 'ACTIVE',
    ...(filter.holderId !== undefined ? { receivedById: filter.holderId } : {}),
    ...dateFilter(filter),
  };
  const handoverWhere: Prisma.CashHandoverWhereInput = {
    status: 'ACTIVE',
    ...(filter.holderId !== undefined
      ? { OR: [{ fromHolderId: filter.holderId }, { toHolderId: filter.holderId }] }
      : {}),
    ...dateFilter(filter),
  };

  const [payments, handovers] = await Promise.all([
    prisma.payment.findMany({
      where: paymentWhere,
      select: {
        id: true,
        date: true,
        createdAt: true,
        amountCents: true,
        note: true,
        reference: true,
        entryId: true,
        saleId: true,
        invoiceId: true,
        entry: { select: { description: true, customerName: true, customer: { select: { name: true } } } },
        sale: { select: { number: true, customer: { select: { name: true } } } },
        invoice: { select: { numberFormatted: true, customer: { select: { name: true } } } },
      },
    }),
    prisma.cashHandover.findMany({
      where: handoverWhere,
      select: {
        id: true,
        date: true,
        createdAt: true,
        amountCents: true,
        note: true,
        fromHolderId: true,
        toHolderId: true,
        fromHolder: { select: { name: true } },
        toHolder: { select: { name: true } },
      },
    }),
  ]);

  const items: { row: LedgerRow; createdAt: Date }[] = [];

  for (const p of payments) {
    const link: LedgerRow['link'] = {};
    if (p.entryId !== null) link.entryId = p.entryId;
    if (p.saleId !== null) link.saleId = p.saleId;
    if (p.invoiceId !== null) link.invoiceId = p.invoiceId;
    items.push({
      createdAt: p.createdAt,
      row: {
        date: p.date.toISOString().slice(0, 10),
        kind: 'RECEIPT',
        amountCents: p.amountCents,
        counterparty: receiptCounterparty(p),
        description: receiptDescription(p),
        link,
      },
    });
  }

  for (const h of handovers) {
    const date = h.date.toISOString().slice(0, 10);
    const emitOut = filter.holderId === undefined || h.fromHolderId === filter.holderId;
    const emitIn = filter.holderId === undefined || h.toHolderId === filter.holderId;
    if (emitOut) {
      items.push({
        createdAt: h.createdAt,
        row: {
          date,
          kind: 'HANDOVER_OUT',
          amountCents: h.amountCents,
          counterparty: h.toHolder.name,
          description: h.note ?? null,
          link: { handoverId: h.id },
        },
      });
    }
    if (emitIn) {
      items.push({
        createdAt: h.createdAt,
        row: {
          date,
          kind: 'HANDOVER_IN',
          amountCents: h.amountCents,
          counterparty: h.fromHolder.name,
          description: h.note ?? null,
          link: { handoverId: h.id },
        },
      });
    }
  }

  items.sort((a, b) => {
    if (a.row.date !== b.row.date) return a.row.date < b.row.date ? 1 : -1;
    const t = b.createdAt.getTime() - a.createdAt.getTime();
    if (t !== 0) return t;
    return KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind];
  });

  return items.map((i) => i.row);
}

// ------------------------------------------------------------------
// Handover serialisation
// ------------------------------------------------------------------

export const handoverInclude = {
  fromHolder: { select: { id: true, name: true, kind: true } },
  toHolder: { select: { id: true, name: true, kind: true } },
} as const satisfies Prisma.CashHandoverInclude;

export type HandoverWithHolders = Prisma.CashHandoverGetPayload<{ include: typeof handoverInclude }>;

export function serializeHandover(h: HandoverWithHolders) {
  return {
    id: h.id,
    date: h.date.toISOString().slice(0, 10),
    fromHolderId: h.fromHolderId,
    fromHolder: h.fromHolder,
    toHolderId: h.toHolderId,
    toHolder: h.toHolder,
    amountCents: h.amountCents,
    note: h.note,
    status: h.status,
    createdById: h.createdById,
    createdAt: h.createdAt.toISOString(),
  };
}
