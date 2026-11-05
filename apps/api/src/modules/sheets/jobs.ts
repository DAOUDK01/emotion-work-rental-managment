import { prisma } from '../../db.js';
import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import { SHEETS_TARGET, runSheetsSync } from './service.js';

/**
 * Scheduled Google Sheets mirror sync (queue `sheets-sync`, every 30 minutes,
 * registered in src/jobs/boss.ts; also enqueued/run manually via POST /sheets/sync).
 *
 * - Disabled or unconfigured: record a SyncLog ERROR "not configured…" row and
 *   return quietly — a missing integration must never make the job retry-loop.
 * - Another sync still running: skip quietly (that run owns the log row).
 * - Real failures: runSheetsSync has already recorded SyncLog ERROR; rethrow so
 *   pg-boss retries the job with backoff.
 */
export async function handleSheetsSyncJob(): Promise<void> {
  try {
    await runSheetsSync();
  } catch (err) {
    if (err instanceof AppError && err.code === 'NOT_CONFIGURED') {
      await prisma.syncLog
        .create({
          data: {
            target: SHEETS_TARGET,
            status: 'ERROR',
            finishedAt: new Date(),
            error: err.message, // "Google Sheets sync is not configured: …"
          },
        })
        .catch((logErr: unknown) =>
          logger.error({ err: logErr }, 'failed to record "not configured" sheets sync log'),
        );
      logger.info({ reason: err.message }, 'sheets sync skipped: not configured');
      return;
    }
    if (err instanceof AppError && err.code === 'SYNC_IN_PROGRESS') {
      logger.info('sheets sync skipped: another sync is already running');
      return;
    }
    throw err;
  }
}
