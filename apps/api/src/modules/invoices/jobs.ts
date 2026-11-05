import { addDays, todayInHelsinki } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import { invoiceTexts, queueInvoiceReminder, reminderTag, toDbDate } from './service.js';

/**
 * Daily invoice-overdue job (queue `invoice-overdue`, 06:30 Europe/Helsinki,
 * registered in src/jobs/boss.ts).
 *
 * OVERDUE is a DERIVED state (SENT/PARTIALLY_PAID with dueDate < today), so no
 * status is ever written here. The job only queues reminder emails:
 * - an invoice qualifies once it has been overdue for at least the
 *   `invoice.reminderDays` setting (first reminder), and
 * - a new reminder goes out only when the EmailOutbox holds NO mail whose subject
 *   carries the machine tag `[Reminder <numberFormatted>]` created within the last
 *   reminderDays (so reminders repeat every reminderDays until paid or credited).
 *
 * One invoice failing (e.g. no email address) never stops the rest.
 */
export async function handleInvoiceOverdueJob(): Promise<void> {
  const today = todayInHelsinki();
  const texts = await invoiceTexts();
  const reminderDays = Math.max(1, texts.reminderDays);
  // overdue by at least reminderDays: dueDate <= today − reminderDays
  const dueCutoff = addDays(today, -reminderDays);
  const windowStart = new Date(Date.now() - reminderDays * 24 * 3600 * 1000);

  const overdue = await prisma.invoice.findMany({
    where: { status: { in: ['SENT', 'PARTIALLY_PAID'] }, dueDate: { lte: toDbDate(dueCutoff) } },
    select: { id: true, numberFormatted: true },
    orderBy: { dueDate: 'asc' },
  });

  let queued = 0;
  let skipped = 0;
  let failures = 0;

  for (const invoice of overdue) {
    try {
      const recentReminder = await prisma.emailOutbox.findFirst({
        where: {
          subject: { contains: reminderTag(invoice.numberFormatted) },
          createdAt: { gte: windowStart },
        },
        select: { id: true },
      });
      if (recentReminder) {
        skipped += 1;
        continue;
      }
      await queueInvoiceReminder(invoice.id);
      queued += 1;
    } catch (err) {
      if (err instanceof AppError && err.code === 'NO_EMAIL') {
        skipped += 1;
        logger.warn(
          { invoiceId: invoice.id, numberFormatted: invoice.numberFormatted },
          'overdue reminder skipped — no email address for the customer',
        );
      } else if (err instanceof AppError && err.code === 'NOT_OPEN') {
        // raced with a payment or credit note between the query and the reminder
        skipped += 1;
      } else {
        failures += 1;
        logger.error({ err, invoiceId: invoice.id }, 'overdue reminder failed');
      }
    }
  }

  logger.info(
    { date: today, overdue: overdue.length, queued, skipped, failures, reminderDays },
    'invoice overdue job finished',
  );
}
