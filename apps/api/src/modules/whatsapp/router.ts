import crypto from 'node:crypto';
import { Router, type Request } from 'express';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { conflict, notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { InboxQuery, RejectSchema, SimulateSchema, idParam, type InboxQueryType } from './schemas.js';
import {
  inboxEntryInclude,
  inboxExpenseInclude,
  ingestWebhookPayload,
  runPipeline,
  serializeMessage,
  voidLinkedRecords,
  type InboxExpense,
} from './service.js';

/**
 * WhatsApp integration: Meta Cloud API webhook (public, HMAC-authenticated),
 * admin inbox, reject/reparse and an admin simulator that exercises the exact
 * same pipeline. Replies go out through the `whatsapp-reply` job (see jobs.ts).
 */
export const whatsappRouter = Router();

// ---------------------------------------------------------------- webhook (public)

// Meta endpoint verification handshake.
whatsappRouter.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && typeof token === 'string' && token === env.WHATSAPP_VERIFY_TOKEN) {
    res.status(200).send(typeof challenge === 'string' ? challenge : '');
    return;
  }
  res.sendStatus(403);
});

/** Constant-time check of X-Hub-Signature-256 over the RAW request body. */
function verifySignature(req: Request): boolean {
  if (!env.WHATSAPP_APP_SECRET) {
    // No secret configured: only acceptable outside production.
    return env.NODE_ENV !== 'production';
  }
  const header = req.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || header === '') return false;
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
  const expected =
    'sha256=' + crypto.createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

whatsappRouter.post('/webhook', async (req, res) => {
  try {
    if (!verifySignature(req)) {
      logger.warn({ ip: req.ip }, 'whatsapp webhook: invalid signature');
      res.sendStatus(403);
      return;
    }
    // Processing is awaited but fully error-wrapped inside; Meta retries on non-200,
    // so anything short of a forged signature must answer 200.
    await ingestWebhookPayload(req.body);
    res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, 'whatsapp webhook failed');
    res.sendStatus(200);
  }
});

// ---------------------------------------------------------------- inbox (ADMIN)

whatsappRouter.get(
  '/inbox',
  requireAuth('ADMIN'),
  validate({ query: InboxQuery }),
  async (req, res, next) => {
    try {
      const { status, from, to, page, pageSize } = req.query as unknown as InboxQueryType;
      const where: Prisma.WhatsAppMessageWhereInput = {};
      if (status) where.status = status;
      if (from || to) {
        where.receivedAt = {
          ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
          ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
        };
      }
      const [total, rows] = await Promise.all([
        prisma.whatsAppMessage.count({ where }),
        prisma.whatsAppMessage.findMany({
          where,
          orderBy: { receivedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { entry: { include: inboxEntryInclude } },
        }),
      ]);
      const expenseIds = rows
        .map((r) => r.expenseId)
        .filter((id): id is number => id !== null);
      const expenses: InboxExpense[] = expenseIds.length
        ? await prisma.expense.findMany({
            where: { id: { in: expenseIds } },
            include: inboxExpenseInclude,
          })
        : [];
      const expenseById = new Map(expenses.map((e) => [e.id, e]));
      res.json({
        messages: rows.map((r) =>
          serializeMessage(r, r.expenseId !== null ? expenseById.get(r.expenseId) ?? null : null),
        ),
        total,
        page,
        pageSize,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- reject (ADMIN)

whatsappRouter.post(
  '/:id/reject',
  requireAuth('ADMIN'),
  validate({ params: idParam, body: RejectSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { reason } = req.body as z.infer<typeof RejectSchema>;
      const before = await prisma.whatsAppMessage.findUnique({ where: { id } });
      if (!before) throw notFound('WhatsApp message');
      if (before.status === 'REJECTED') {
        throw conflict('ALREADY_REJECTED', 'Message is already rejected');
      }

      const result = await prisma.$transaction(async (tx) => {
        const voided = await voidLinkedRecords(tx, before, reason);
        // Free the unique entry link so a later reparse can attach a fresh entry;
        // the voided entry itself is kept (financial rows are never deleted).
        await tx.entry.updateMany({
          where: { whatsappMessageId: id },
          data: { whatsappMessageId: null },
        });
        const message = await tx.whatsAppMessage.update({
          where: { id },
          data: { status: 'REJECTED', errorText: reason, processedAt: before.processedAt ?? new Date() },
        });
        return { voided, message };
      });

      if (result.voided.entryId !== null) {
        await audit('VOID', 'entries', result.voided.entryId, undefined, { reason });
      }
      if (result.voided.expenseId !== null) {
        await audit('VOID', 'expenses', result.voided.expenseId, undefined, { reason });
      }
      for (const invId of result.voided.voidedInvestmentIds) {
        await audit('VOID', 'investments', invId, undefined, { reason });
      }
      await audit('UPDATE', 'whatsapp_messages', id, before, result.message);
      res.json({ message: serializeMessage(result.message) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- reparse (ADMIN)

whatsappRouter.post(
  '/:id/reparse',
  requireAuth('ADMIN'),
  validate({ params: idParam }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const before = await prisma.whatsAppMessage.findUnique({ where: { id } });
      if (!before) throw notFound('WhatsApp message');
      if (before.status !== 'ERROR' && before.status !== 'REJECTED') {
        throw conflict(
          'NOT_REPARSABLE',
          'Only messages in ERROR or REJECTED status can be re-parsed',
        );
      }
      const result = await runPipeline(id, { sendReply: true });
      const message = await prisma.whatsAppMessage.findUnique({
        where: { id },
        include: { entry: { include: inboxEntryInclude } },
      });
      const expense =
        message && message.expenseId !== null
          ? await prisma.expense.findUnique({
              where: { id: message.expenseId },
              include: inboxExpenseInclude,
            })
          : null;
      res.json({
        message: message ? serializeMessage(message, expense) : null,
        reply: result.reply,
        status: result.status,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------- simulate (ADMIN)

whatsappRouter.post(
  '/simulate',
  requireAuth('ADMIN'),
  validate({ body: SimulateSchema }),
  async (req, res, next) => {
    try {
      const { from, text } = req.body as z.infer<typeof SimulateSchema>;
      const row = await prisma.whatsAppMessage.create({
        data: {
          waMessageId: `sim-${crypto.randomUUID()}`,
          senderPhone: from,
          senderName: `Simulated by ${req.user!.name}`,
          rawText: text,
        },
      });
      await audit('CREATE', 'whatsapp_messages', row.id, undefined, row);
      const result = await runPipeline(row.id, { sendReply: false });
      res.json({
        reply: result.reply,
        status: result.status,
        ...(result.entryId !== undefined ? { entryId: result.entryId } : {}),
        ...(result.expenseId !== undefined ? { expenseId: result.expenseId } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);
