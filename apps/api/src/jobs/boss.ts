import PgBoss from 'pg-boss';
import { env, isTest } from '../env.js';
import { logger } from '../logger.js';

/**
 * Background jobs via pg-boss (Postgres-backed queue — no Redis needed, per budget).
 * Queues: whatsapp-reply, sheets-sync, recurring-rentals (daily), invoice-overdue (daily),
 * whatsapp-daily-summary (daily), email-outbox (every few minutes).
 * Handlers register themselves in registerJobHandlers() below.
 */

let boss: PgBoss | null = null;

export function getBoss(): PgBoss | null {
  return boss;
}

export async function startJobs(): Promise<void> {
  if (isTest) return; // tests call job handlers directly
  boss = new PgBoss({
    connectionString: env.DIRECT_URL || env.DATABASE_URL,
    schema: 'pgboss',
    max: 3,
  });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  await boss.start();
  await registerJobHandlers(boss);
  logger.info('job system started (pg-boss)');
}

export async function stopJobs(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true, timeout: 5000 });
    boss = null;
  }
}

/** Send a job if the queue is up; otherwise run the fallback inline (dev convenience). */
export async function enqueue(name: string, data: object): Promise<void> {
  if (boss) {
    await boss.send(name, data, { retryLimit: 5, retryDelay: 30, retryBackoff: true });
  } else {
    logger.warn({ name }, 'job queue not running — job skipped');
  }
}

async function registerJobHandlers(b: PgBoss): Promise<void> {
  // Handlers are imported lazily to avoid circular imports at module load.
  const { handleWhatsAppReplyJob, handleWhatsAppDailySummary } = await import(
    '../modules/whatsapp/jobs.js'
  );
  const { handleSheetsSyncJob } = await import('../modules/sheets/jobs.js');
  const { handleRecurringRentalsJob } = await import('../modules/rentals/jobs.js');
  const { handleInvoiceOverdueJob } = await import('../modules/invoices/jobs.js');
  const { handleEmailOutboxJob } = await import('../services/email.js');

  for (const queue of [
    'whatsapp-reply',
    'sheets-sync',
    'recurring-rentals',
    'invoice-overdue',
    'whatsapp-daily-summary',
    'email-outbox',
  ]) {
    await b.createQueue(queue).catch(() => {});
  }

  await b.work('whatsapp-reply', async ([job]) => handleWhatsAppReplyJob(job.data as never));
  await b.work('sheets-sync', async () => handleSheetsSyncJob());
  await b.work('recurring-rentals', async () => handleRecurringRentalsJob());
  await b.work('invoice-overdue', async () => handleInvoiceOverdueJob());
  await b.work('whatsapp-daily-summary', async () => handleWhatsAppDailySummary());
  await b.work('email-outbox', async () => handleEmailOutboxJob());

  // Europe/Helsinki schedules
  await b.schedule('recurring-rentals', '15 6 * * *', undefined, { tz: 'Europe/Helsinki' });
  await b.schedule('invoice-overdue', '30 6 * * *', undefined, { tz: 'Europe/Helsinki' });
  await b.schedule('whatsapp-daily-summary', '0 20 * * *', undefined, { tz: 'Europe/Helsinki' });
  await b.schedule('sheets-sync', '*/30 * * * *', undefined, { tz: 'Europe/Helsinki' });
  await b.schedule('email-outbox', '*/5 * * * *', undefined, { tz: 'Europe/Helsinki' });
}
