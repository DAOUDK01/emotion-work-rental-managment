import { Router } from 'express';
import { prisma } from '../../db.js';
import { AppError, badRequest } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { audit } from '../../services/audit.js';
import { SHEETS_TARGET, runSheetsSync, serializeSyncLog, sheetsConfigProblem } from './service.js';

/**
 * Google Sheets mirror (ADMIN only).
 *  - POST /sheets/sync   run a full mirror sync now (400 NOT_CONFIGURED when the
 *    integration is disabled or incomplete, 409 SYNC_IN_PROGRESS when one is running).
 *  - GET  /sheets/status last OK time, last error and the last 10 sync log rows.
 */
export const sheetsRouter = Router();
sheetsRouter.use(requireAuth('ADMIN'));

sheetsRouter.post('/sync', async (_req, res, next) => {
  try {
    const problem = await sheetsConfigProblem();
    if (problem) {
      throw badRequest('NOT_CONFIGURED', `Google Sheets sync is not configured: ${problem}`);
    }
    const log = await runSheetsSync();
    await audit('EXPORT', 'sync_log', log.id, undefined, {
      target: SHEETS_TARGET,
      status: log.status,
      rowsSynced: log.rowsSynced,
    });
    res.json({ log: serializeSyncLog(log) });
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
    } else {
      // Google/network failure — already recorded on the SyncLog row by the service.
      next(
        new AppError(
          502,
          'SYNC_FAILED',
          err instanceof Error ? err.message : 'Google Sheets sync failed',
        ),
      );
    }
  }
});

sheetsRouter.get('/status', async (_req, res, next) => {
  try {
    const [problem, lastOkLog, lastErrorLog, logs] = await Promise.all([
      sheetsConfigProblem(),
      prisma.syncLog.findFirst({
        where: { target: SHEETS_TARGET, status: 'OK' },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.syncLog.findFirst({
        where: { target: SHEETS_TARGET, status: 'ERROR' },
        orderBy: { startedAt: 'desc' },
      }),
      prisma.syncLog.findMany({
        where: { target: SHEETS_TARGET },
        orderBy: { startedAt: 'desc' },
        take: 10,
      }),
    ]);
    res.json({
      configured: problem === null,
      configProblem: problem,
      lastOk: lastOkLog ? (lastOkLog.finishedAt ?? lastOkLog.startedAt).toISOString() : null,
      lastError: lastErrorLog?.error ?? null,
      lastErrorAt: lastErrorLog
        ? (lastErrorLog.finishedAt ?? lastErrorLog.startedAt).toISOString()
        : null,
      logs: logs.map(serializeSyncLog),
    });
  } catch (err) {
    next(err);
  }
});
