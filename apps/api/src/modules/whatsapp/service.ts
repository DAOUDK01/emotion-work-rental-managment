import { Prisma, type WaStatus, type WhatsAppMessage } from '@prisma/client';
import {
  WHATSAPP_HELP_TEXT,
  parseWhatsAppMessage,
  reclaimableVat,
  remainingToPayback,
  todayInHelsinki,
  type WaExpenseDraft,
  type WaIncomeDraft,
} from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { isProd } from '../../env.js';
import { AppError, notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import { currentUserId } from '../../context.js';
import { enqueue } from '../../jobs/boss.js';
import { audit } from '../../services/audit.js';
import { getSetting } from '../../services/settings.js';
import { createEntry, defaultVatInvoice, vatRateOn, voidEntry } from '../../services/entries.js';

/**
 * The WhatsApp entry pipeline. One stored WhatsAppMessage row goes in; the message is
 * parsed (shared parser), checked against the allow-list, and turned into an Entry /
 * Expense / undo / help reply inside a single transaction. The same pipeline serves
 * the Meta webhook, POST /whatsapp/simulate and POST /whatsapp/:id/reparse, so a
 * half-parsed entry can never be saved from any path.
 */

const UNDO_WINDOW_MS = 10 * 60 * 1000;
const NOTHING_TO_UNDO = 'Nothing to undo (entries can be cancelled within 10 minutes).';

export interface PipelineOptions {
  /** false for /simulate — the reply is returned in the response, not sent via Graph API. */
  sendReply: boolean;
}

export interface PipelineResult {
  status: WaStatus;
  reply: string | null;
  entryId?: number;
  expenseId?: number;
}

// ---------------------------------------------------------------- helpers

/** "4500" -> "45", "4550" -> "45.50" — the compact amount style of the PDF replies. */
export function fmtEur(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  if (abs % 100 === 0) return `${sign}${abs / 100}`;
  return `${sign}${(abs / 100).toFixed(2)}`;
}

/** E.164 comparison key: the number without its leading '+'. */
function barePhone(phone: string): string {
  return phone.trim().replace(/^\+/, '');
}

/** Both spellings of a number, for senderPhone lookups. */
export function phoneVariants(phone: string): string[] {
  const bare = barePhone(phone);
  return [bare, `+${bare}`];
}

/** Setting `whatsapp.allowedNumbers` — array of E.164 strings, defensively read. */
export async function getAllowedNumbers(): Promise<string[]> {
  const value = await getSetting<unknown>('whatsapp.allowedNumbers', []);
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map((v) => v.trim());
}

export function isAllowedNumber(senderPhone: string, allowed: string[]): boolean {
  const sender = barePhone(senderPhone);
  return allowed.some((a) => barePhone(a) === sender);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// ---------------------------------------------------------------- serialization

export const inboxEntryInclude = {
  model: { select: { id: true, code: true, nameEn: true } },
  unit: { select: { id: true, code: true } },
  receivedBy: { select: { id: true, name: true } },
} satisfies Prisma.EntryInclude;

export type InboxEntry = Prisma.EntryGetPayload<{ include: typeof inboxEntryInclude }>;

export const inboxExpenseInclude = {
  category: { select: { id: true, nameEn: true } },
  paidBy: { select: { id: true, name: true } },
} satisfies Prisma.ExpenseInclude;

export type InboxExpense = Prisma.ExpenseGetPayload<{ include: typeof inboxExpenseInclude }>;

export function serializeMessage(
  m: WhatsAppMessage & { entry?: InboxEntry | null },
  expense?: InboxExpense | null,
) {
  return {
    id: m.id,
    waMessageId: m.waMessageId,
    senderPhone: m.senderPhone,
    senderName: m.senderName,
    rawText: m.rawText,
    receivedAt: m.receivedAt.toISOString(),
    status: m.status,
    parsed: m.parsed,
    errorText: m.errorText,
    replyText: m.replyText,
    repliedAt: m.repliedAt ? m.repliedAt.toISOString() : null,
    processedAt: m.processedAt ? m.processedAt.toISOString() : null,
    undoneAt: m.undoneAt ? m.undoneAt.toISOString() : null,
    expenseId: m.expenseId,
    entry: m.entry
      ? {
          id: m.entry.id,
          entryDate: m.entry.entryDate.toISOString().slice(0, 10),
          grossCents: m.entry.grossCents,
          discountCents: m.entry.discountCents,
          vatInvoice: m.entry.vatInvoice,
          vatCents: m.entry.vatCents,
          netCents: m.entry.netCents,
          paymentStatus: m.entry.paymentStatus,
          status: m.entry.status,
          model: m.entry.model,
          unit: m.entry.unit,
          receivedBy: m.entry.receivedBy,
        }
      : null,
    expense: expense
      ? {
          id: expense.id,
          expenseDate: expense.expenseDate ? expense.expenseDate.toISOString().slice(0, 10) : null,
          description: expense.description,
          vendor: expense.vendor,
          grossCents: expense.grossCents,
          status: expense.status,
          category: expense.category,
          paidBy: expense.paidBy,
        }
      : null,
  };
}

// ---------------------------------------------------------------- voiding linked records

export interface VoidedLinks {
  entryId: number | null;
  expenseId: number | null;
  voidedInvestmentIds: number[];
  /** "Rental EUR 45" / "expense Jula EUR 59.72" — null when nothing was linked. */
  summary: string | null;
}

/** Void the Entry / Expense (+ its auto investments) linked to a message. Never hard-deletes. */
export async function voidLinkedRecords(
  tx: Prisma.TransactionClient,
  message: Pick<WhatsAppMessage, 'id' | 'expenseId'>,
  reason: string,
): Promise<VoidedLinks> {
  let summary: string | null = null;
  let entryId: number | null = null;
  const entry = await tx.entry.findUnique({
    where: { whatsappMessageId: message.id },
    include: { model: { select: { nameEn: true } } },
  });
  if (entry) {
    await voidEntry(tx, entry.id, reason);
    entryId = entry.id;
    summary = `${entry.model.nameEn} EUR ${fmtEur(entry.grossCents)}`;
  }

  let expenseId: number | null = null;
  let voidedInvestmentIds: number[] = [];
  if (message.expenseId != null) {
    const expense = await tx.expense.findUnique({ where: { id: message.expenseId } });
    if (expense) {
      expenseId = expense.id;
      if (expense.status === 'ACTIVE') {
        await tx.expense.update({
          where: { id: expense.id },
          data: { status: 'VOID', voidReason: reason },
        });
        const investments = await tx.investment.findMany({
          where: { expenseId: expense.id, status: 'ACTIVE' },
        });
        if (investments.length > 0) {
          await tx.investment.updateMany({
            where: { id: { in: investments.map((i) => i.id) } },
            data: { status: 'VOID' },
          });
        }
        voidedInvestmentIds = investments.map((i) => i.id);
      }
      summary =
        summary ??
        `expense ${expense.vendor ?? expense.description} EUR ${fmtEur(expense.grossCents ?? 0)}`;
    }
  }
  return { entryId, expenseId, voidedInvestmentIds, summary };
}

// ---------------------------------------------------------------- pipeline

export async function runPipeline(messageId: number, opts: PipelineOptions): Promise<PipelineResult> {
  const message = await prisma.whatsAppMessage.findUnique({ where: { id: messageId } });
  if (!message) throw notFound('WhatsApp message');

  // Allow-list first: unknown senders never reach the parser.
  const allowed = await getAllowedNumbers();
  if (!isAllowedNumber(message.senderPhone, allowed)) {
    // Store REJECTED, no reply in production (contract: "not authorised" reply only in dev).
    return finishMessage(
      message,
      {
        status: 'REJECTED',
        errorText: 'Sender is not in the allowed numbers list',
        replyText: isProd ? null : 'Not authorised.',
      },
      opts,
    );
  }

  const parsed = parseWhatsAppMessage(message.rawText);
  if (!parsed.ok) {
    return finishMessage(
      message,
      { status: 'ERROR', errorText: parsed.error, replyText: parsed.error },
      opts,
    );
  }

  try {
    const draft = parsed.entry;
    if (draft.kind === 'help') {
      return await finishMessage(
        message,
        { status: 'RECEIVED', errorText: null, replyText: WHATSAPP_HELP_TEXT },
        opts,
      );
    }
    if (draft.kind === 'undo') return await handleUndo(message, opts);
    if (draft.kind === 'income') return await handleIncome(message, draft, opts);
    return await handleExpense(message, draft, opts);
  } catch (err) {
    const text =
      err instanceof AppError
        ? err.message
        : 'Something went wrong — nothing was saved. Please try again or contact the admin.';
    logger.error({ err, messageId: message.id }, 'whatsapp pipeline failed');
    return finishMessage(message, { status: 'ERROR', errorText: text, replyText: text }, opts);
  }
}

interface FinishData {
  status: WaStatus;
  replyText: string | null;
  errorText: string | null;
  parsed?: Prisma.InputJsonValue;
}

/** Update the message row outside a business transaction (help / error / reject paths). */
async function finishMessage(
  message: WhatsAppMessage,
  data: FinishData,
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const updated = await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: data.status,
      replyText: data.replyText,
      errorText: data.errorText,
      ...(data.parsed !== undefined ? { parsed: data.parsed } : {}),
      processedAt: new Date(),
    },
  });
  await audit('UPDATE', 'whatsapp_messages', message.id, message, updated);
  if (opts.sendReply && data.replyText) {
    await enqueue('whatsapp-reply', { messageId: message.id });
  }
  return { status: data.status, reply: data.replyText };
}

// ---------------------------------------------------------------- undo

async function handleUndo(message: WhatsAppMessage, opts: PipelineOptions): Promise<PipelineResult> {
  const cutoff = new Date(Date.now() - UNDO_WINDOW_MS);
  const target = await prisma.whatsAppMessage.findFirst({
    where: {
      id: { not: message.id },
      senderPhone: { in: phoneVariants(message.senderPhone) },
      status: 'SAVED',
      receivedAt: { gte: cutoff },
      OR: [{ entry: { isNot: null } }, { expenseId: { not: null } }],
    },
    orderBy: { receivedAt: 'desc' },
  });
  if (!target) {
    return finishMessage(
      message,
      { status: 'RECEIVED', errorText: null, replyText: NOTHING_TO_UNDO },
      opts,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const voided = await voidLinkedRecords(tx, target, 'Cancelled via WhatsApp UNDO');
    const updatedTarget = await tx.whatsAppMessage.update({
      where: { id: target.id },
      data: { status: 'UNDONE', undoneAt: new Date() },
    });
    const replyText = voided.summary ? `Cancelled: ${voided.summary}.` : NOTHING_TO_UNDO;
    const updatedMessage = await tx.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: 'RECEIVED', errorText: null, replyText, processedAt: new Date() },
    });
    return { voided, updatedTarget, updatedMessage, replyText };
  });

  if (result.voided.entryId != null) {
    await audit('VOID', 'entries', result.voided.entryId, undefined, {
      reason: 'Cancelled via WhatsApp UNDO',
    });
  }
  if (result.voided.expenseId != null) {
    await audit('VOID', 'expenses', result.voided.expenseId, undefined, {
      reason: 'Cancelled via WhatsApp UNDO',
    });
  }
  for (const id of result.voided.voidedInvestmentIds) {
    await audit('VOID', 'investments', id, undefined, { reason: 'Cancelled via WhatsApp UNDO' });
  }
  await audit('UPDATE', 'whatsapp_messages', target.id, target, result.updatedTarget);
  await audit('UPDATE', 'whatsapp_messages', message.id, message, result.updatedMessage);
  if (opts.sendReply) await enqueue('whatsapp-reply', { messageId: message.id });
  return { status: 'RECEIVED', reply: result.replyText };
}

// ---------------------------------------------------------------- income

async function handleIncome(
  message: WhatsAppMessage,
  draft: WaIncomeDraft,
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const today = todayInHelsinki();

  const model = await prisma.businessModel.findUnique({ where: { code: draft.model } });
  if (!model) {
    const text = `The business model ${draft.model} is not configured. Contact the admin.`;
    return finishMessage(message, { status: 'ERROR', errorText: text, replyText: text }, opts);
  }

  let unit: { id: number; code: string; purchaseCents: number | null } | null = null;
  if (draft.unitCode) {
    unit = await prisma.unit.findFirst({
      where: { code: { equals: draft.unitCode, mode: 'insensitive' } },
      select: { id: true, code: true, purchaseCents: true },
    });
    if (!unit) {
      const text = `Unknown unit "${draft.unitCode}". Check the unit ID (like EE2-251001).`;
      return finishMessage(message, { status: 'ERROR', errorText: text, replyText: text }, opts);
    }
  }

  let holder: { id: number; name: string } | null = null;
  if (draft.receivedBy) {
    holder = await prisma.moneyHolder.findFirst({
      where: { name: { equals: draft.receivedBy, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    if (!holder) {
      const text = `Receiver "${draft.receivedBy}" was not found. Use Ahmed, Salman, Company Account or Cash.`;
      return finishMessage(message, { status: 'ERROR', errorText: text, replyText: text }, opts);
    }
  }

  let methodId: number | null = null;
  if (draft.paymentMethod) {
    const method = await prisma.paymentMethod.findFirst({
      where: { name: { equals: draft.paymentMethod, mode: 'insensitive' } },
      select: { id: true },
    });
    methodId = method?.id ?? null;
  }

  const vatInvoice = draft.vatOverride ?? (await defaultVatInvoice(holder?.id ?? null, methodId));
  const vatRateBp = await vatRateOn(today);
  const paymentStatus: 'PAID' | 'PENDING' = holder ? 'PAID' : 'PENDING';
  const description = [draft.itemName, draft.notes].filter(Boolean).join(' — ') || null;

  const result = await prisma.$transaction(async (tx) => {
    // A rejected-then-reparsed message may still have a voided entry linked; the link
    // is unique, so hand it over to the fresh entry (the voided row itself is kept).
    await tx.entry.updateMany({
      where: { whatsappMessageId: message.id },
      data: { whatsappMessageId: null },
    });

    const entry = await createEntry(tx, {
      entryDate: today,
      modelId: model.id,
      unitId: unit?.id ?? null,
      description,
      grossBeforeDiscountCents: draft.grossCents,
      discountCents: draft.discountCents,
      discountReason: draft.discountCents > 0 ? 'WhatsApp DISC' : null,
      vatInvoice,
      vatRateBp,
      labourCents: draft.labourCents ?? null,
      partsCents: draft.partsCents ?? null,
      paymentStatus,
      paymentMethodId: methodId,
      receivedById: holder?.id ?? null,
      source: 'WHATSAPP',
      whatsappMessageId: message.id,
    });

    let replyText = `Saved: ${model.nameEn} EUR ${fmtEur(entry.grossCents)}, ${
      draft.paymentMethod ? draft.paymentMethod.toLowerCase() : 'cash'
    }, ${vatInvoice ? 'VAT' : 'no VAT'}.`;
    replyText += holder
      ? ` Collected by ${holder.name}.`
      : ' Marked pending — no receiver given.';

    if (unit && unit.purchaseCents != null && unit.purchaseCents > 0) {
      const earned = await tx.entry.aggregate({
        _sum: { netCents: true },
        where: { unitId: unit.id, status: 'ACTIVE' },
      });
      const remaining = remainingToPayback(earned._sum.netCents ?? 0, unit.purchaseCents);
      if (remaining !== null) {
        replyText +=
          remaining > 0
            ? ` Unit ${unit.code} is EUR ${fmtEur(remaining)} from payback.`
            : ` Unit ${unit.code} is paid back.`;
      }
    }

    const updatedMessage = await tx.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status: 'SAVED',
        parsed: asJson(draft),
        errorText: null,
        replyText,
        processedAt: new Date(),
      },
    });
    return { entry, updatedMessage, replyText };
  });

  await audit('CREATE', 'entries', result.entry.id, undefined, result.entry);
  await audit('UPDATE', 'whatsapp_messages', message.id, message, result.updatedMessage);
  if (opts.sendReply) await enqueue('whatsapp-reply', { messageId: message.id });
  return { status: 'SAVED', reply: result.replyText, entryId: result.entry.id };
}

// ---------------------------------------------------------------- expense

/** Expense-category name -> Investment category (same mapping as the expenses module). */
function investmentCategoryFor(nameEn: string): 'UNITS' | 'SPARE_PARTS' | 'TOOLS' | 'EXPENSES' {
  if (nameEn === 'Unit purchases') return 'UNITS';
  if (nameEn === 'Spare parts (stock)') return 'SPARE_PARTS';
  if (nameEn === 'Tools') return 'TOOLS';
  return 'EXPENSES';
}

async function handleExpense(
  message: WhatsAppMessage,
  draft: WaExpenseDraft,
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const today = todayInHelsinki();

  let category = draft.category
    ? await prisma.expenseCategory.findFirst({
        where: { nameEn: { contains: draft.category, mode: 'insensitive' }, active: true },
        orderBy: { sortOrder: 'asc' },
      })
    : null;
  if (!category) {
    category = await prisma.expenseCategory.findFirst({
      where: { nameEn: { equals: 'Other', mode: 'insensitive' } },
    });
  }
  if (!category) {
    const text = 'Expense categories are not configured. Contact the admin.';
    return finishMessage(message, { status: 'ERROR', errorText: text, replyText: text }, opts);
  }
  const cat = category; // const capture: the closure below must see it as non-null

  let paidBy: { id: number; name: string; kind: string } | null = null;
  if (draft.paidBy) {
    paidBy = await prisma.moneyHolder.findFirst({
      where: { name: { equals: draft.paidBy, mode: 'insensitive' } },
      select: { id: true, name: true, kind: true },
    });
    if (!paidBy) {
      const text = `Payer "${draft.paidBy}" was not found. Use Ahmed, Salman, Company Account or Cash.`;
      return finishMessage(message, { status: 'ERROR', errorText: text, replyText: text }, opts);
    }
  }

  const vatRateBp = await vatRateOn(today);
  const hasValidReceipt = false; // WhatsApp expenses never carry a receipt photo
  const reclaimableVatCents = reclaimableVat({
    grossCents: draft.grossCents,
    rateBp: vatRateBp,
    hasValidReceipt,
    businessUsePct: 100,
  });
  const entryDate = new Date(`${today}T00:00:00Z`);

  const result = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.create({
      data: {
        expenseDate: entryDate,
        categoryId: cat.id,
        description: draft.vendor,
        vendor: draft.vendor,
        grossCents: draft.grossCents,
        vatRateBp,
        hasValidReceipt,
        businessUsePct: 100,
        reclaimableVatCents,
        paidById: paidBy?.id ?? null,
        notes: draft.notes ?? null,
        needsReview: false,
        source: 'WHATSAPP',
        createdById: currentUserId() ?? null,
      },
    });

    // Same auto-investment rule as the expenses module: partner personal spend
    // creates one derived Investment row (auto=true) in the mapped category.
    let investmentId: number | null = null;
    if (paidBy && paidBy.kind === 'PARTNER') {
      const investment = await tx.investment.create({
        data: {
          date: entryDate,
          holderId: paidBy.id,
          isJoint: false,
          category: investmentCategoryFor(cat.nameEn),
          amountCents: draft.grossCents,
          expenseId: expense.id,
          note: null,
          auto: true,
          source: 'WHATSAPP',
          createdById: currentUserId() ?? null,
        },
      });
      investmentId = investment.id;
    }

    let replyText = `Saved: expense ${draft.vendor} EUR ${fmtEur(draft.grossCents)} (${cat.nameEn}).`;
    if (paidBy) replyText += ` Paid by ${paidBy.name}.`;

    const updatedMessage = await tx.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status: 'SAVED',
        expenseId: expense.id,
        parsed: asJson(draft),
        errorText: null,
        replyText,
        processedAt: new Date(),
      },
    });
    return { expense, investmentId, updatedMessage, replyText };
  });

  await audit('CREATE', 'expenses', result.expense.id, undefined, result.expense);
  if (result.investmentId != null) {
    await audit('CREATE', 'investments', result.investmentId, undefined, {
      expenseId: result.expense.id,
      auto: true,
    });
  }
  await audit('UPDATE', 'whatsapp_messages', message.id, message, result.updatedMessage);
  if (opts.sendReply) await enqueue('whatsapp-reply', { messageId: message.id });
  return { status: 'SAVED', reply: result.replyText, expenseId: result.expense.id };
}

// ---------------------------------------------------------------- webhook ingest

interface MetaTextMessage {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
}

interface MetaContact {
  wa_id?: string;
  profile?: { name?: string };
}

interface MetaChangeValue {
  messaging_product?: string;
  contacts?: MetaContact[];
  messages?: MetaTextMessage[];
  statuses?: unknown[];
}

interface MetaWebhookPayload {
  object?: string;
  entry?: Array<{ changes?: Array<{ field?: string; value?: MetaChangeValue }> }>;
}

/**
 * Store and process every text message in a Meta webhook delivery.
 * Duplicates (redeliveries) are skipped silently via the unique waMessageId.
 * Status updates and non-text messages are ignored. Never throws per message —
 * the webhook must answer 200 whatever happens inside.
 */
export async function ingestWebhookPayload(payload: unknown): Promise<void> {
  const body = (payload ?? {}) as MetaWebhookPayload;
  if (!Array.isArray(body.entry)) return;

  for (const entry of body.entry) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      const value = change?.value;
      if (!value || !Array.isArray(value.messages)) continue; // statuses-only delivery
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];

      for (const msg of value.messages) {
        try {
          if (msg?.type !== 'text') continue;
          const waMessageId = typeof msg.id === 'string' ? msg.id : '';
          const senderPhone = typeof msg.from === 'string' ? msg.from : '';
          const rawText = typeof msg.text?.body === 'string' ? msg.text.body : '';
          if (waMessageId === '' || senderPhone === '') continue;

          const senderName =
            contacts.find((c) => c?.wa_id && barePhone(c.wa_id) === barePhone(senderPhone))
              ?.profile?.name ?? null;

          // Dedupe: check first, then create and treat P2002 as "already stored".
          const existing = await prisma.whatsAppMessage.findUnique({ where: { waMessageId } });
          if (existing) continue;
          let row: WhatsAppMessage;
          try {
            row = await prisma.whatsAppMessage.create({
              data: { waMessageId, senderPhone, senderName, rawText },
            });
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              continue; // concurrent redelivery
            }
            throw err;
          }
          await audit('CREATE', 'whatsapp_messages', row.id, undefined, row);
          await runPipeline(row.id, { sendReply: true });
        } catch (err) {
          logger.error({ err, waMessageId: msg?.id }, 'whatsapp webhook message failed');
          if (typeof msg?.id === 'string' && msg.id !== '') {
            await prisma.whatsAppMessage
              .updateMany({
                where: { waMessageId: msg.id, status: 'RECEIVED' },
                data: { status: 'ERROR', errorText: 'Processing failed — see server logs' },
              })
              .catch(() => undefined);
          }
        }
      }
    }
  }
}
