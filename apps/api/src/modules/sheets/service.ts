import type { SyncLog } from '@prisma/client';
import type { sheets_v4 } from 'googleapis';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { badRequest, conflict } from '../../errors.js';
import { logger } from '../../logger.js';
import { getSetting } from '../../services/settings.js';
import { buildAllTabs, type CellValue, type TabData } from './tabs.js';

/**
 * Google Sheets one-way mirror (the database is the master).
 *
 * Auth: service account via google.auth.GoogleAuth with the key file from
 * env.GOOGLE_SERVICE_ACCOUNT_FILE. Spreadsheet id: setting `googleSheets.sheetId`
 * (fallback env.GOOGLE_SHEET_ID); the sync only runs when setting
 * `googleSheets.enabled` is true. The spreadsheet must be shared with the
 * service account's email as an editor.
 *
 * Every sync: SyncLog RUNNING row → ensure the tabs exist → per tab clear +
 * rewrite (header + data, RAW) → SyncLog OK with the total of data rows synced.
 * Failures flip the row to ERROR and rethrow so the job queue retries.
 *
 * googleapis is imported lazily (`await import`) so the API process boots and
 * serves requests even when the Google integration is not configured.
 */

export const SHEETS_TARGET = 'GOOGLE_SHEETS';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/** A RUNNING row older than this is a crashed sync and gets flipped to ERROR. */
const STALE_RUNNING_MS = 30 * 60 * 1000;

/** Extra empty rows kept below the data so small growth doesn't need a resize every sync. */
const ROW_HEADROOM = 50;

// ------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------

export interface SheetsConfig {
  enabled: boolean;
  sheetId: string;
  keyFile: string;
}

export async function getSheetsConfig(): Promise<SheetsConfig> {
  const raw = await getSetting<{ enabled?: unknown; sheetId?: unknown }>('googleSheets', {
    enabled: false,
    sheetId: '',
  });
  const settingSheetId = typeof raw.sheetId === 'string' ? raw.sheetId.trim() : '';
  return {
    enabled: raw.enabled === true,
    sheetId: settingSheetId !== '' ? settingSheetId : env.GOOGLE_SHEET_ID.trim(),
    keyFile: env.GOOGLE_SERVICE_ACCOUNT_FILE.trim(),
  };
}

function configProblemOf(cfg: SheetsConfig): string | null {
  if (!cfg.enabled) return 'sync is disabled (setting googleSheets.enabled)';
  if (cfg.sheetId === '') {
    return 'no spreadsheet id (setting googleSheets.sheetId or env GOOGLE_SHEET_ID)';
  }
  if (cfg.keyFile === '') {
    return 'no service-account key file (env GOOGLE_SERVICE_ACCOUNT_FILE)';
  }
  return null;
}

/** Why the sync cannot run, or null when fully configured. */
export async function sheetsConfigProblem(): Promise<string | null> {
  return configProblemOf(await getSheetsConfig());
}

// ------------------------------------------------------------------
// Serialisation
// ------------------------------------------------------------------

export function serializeSyncLog(log: SyncLog) {
  return {
    id: log.id,
    target: log.target,
    startedAt: log.startedAt.toISOString(),
    finishedAt: log.finishedAt ? log.finishedAt.toISOString() : null,
    status: log.status,
    rowsSynced: log.rowsSynced,
    error: log.error,
  };
}

// ------------------------------------------------------------------
// Google Sheets client (lazy)
// ------------------------------------------------------------------

async function loadGoogleApis(): Promise<typeof import('googleapis')> {
  try {
    return await import('googleapis');
  } catch (err) {
    throw new Error(
      `The googleapis package could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** A1 range covering a whole sheet, with the title safely quoted. */
function sheetRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/**
 * Ensure every tab exists and is large enough, then rewrite each one:
 * values.clear over the whole sheet, values.update RAW from A1 with
 * header + data rows (+ a note row when the tab was truncated).
 */
async function pushTabs(cfg: SheetsConfig, tabs: TabData[]): Promise<void> {
  const { google } = await loadGoogleApis();
  const auth = new google.auth.GoogleAuth({ keyFile: cfg.keyFile, scopes: [SHEETS_SCOPE] });
  const api = google.sheets({ version: 'v4', auth });

  const meta = await api.spreadsheets.get({
    spreadsheetId: cfg.sheetId,
    fields: 'sheets.properties',
  });
  const existing = new Map<string, { sheetId: number | null; rowCount: number; columnCount: number }>();
  for (const sheet of meta.data.sheets ?? []) {
    const props = sheet.properties;
    if (!props?.title) continue;
    existing.set(props.title, {
      sheetId: props.sheetId ?? null,
      rowCount: props.gridProperties?.rowCount ?? 0,
      columnCount: props.gridProperties?.columnCount ?? 0,
    });
  }

  // Missing tabs are added; existing tabs whose grid is too small are grown
  // (values.update does not expand the grid by itself). Grids are never shrunk.
  const requests: sheets_v4.Schema$Request[] = [];
  for (const tab of tabs) {
    const neededRows = tab.rows.length + 2; // header + possible truncation note
    const neededCols = tab.header.length;
    const current = existing.get(tab.title);
    if (!current) {
      requests.push({
        addSheet: {
          properties: {
            title: tab.title,
            gridProperties: {
              rowCount: Math.max(neededRows + ROW_HEADROOM, 200),
              columnCount: Math.max(neededCols, 26),
            },
          },
        },
      });
    } else if (
      current.sheetId !== null &&
      (current.rowCount < neededRows || current.columnCount < neededCols)
    ) {
      requests.push({
        updateSheetProperties: {
          properties: {
            sheetId: current.sheetId,
            gridProperties: {
              rowCount: Math.max(current.rowCount, neededRows + ROW_HEADROOM),
              columnCount: Math.max(current.columnCount, neededCols),
            },
          },
          fields: 'gridProperties.rowCount,gridProperties.columnCount',
        },
      });
    }
  }
  if (requests.length > 0) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: cfg.sheetId,
      requestBody: { requests },
    });
  }

  for (const tab of tabs) {
    const range = sheetRange(tab.title);
    await api.spreadsheets.values.clear({ spreadsheetId: cfg.sheetId, range });
    const values: CellValue[][] = [tab.header, ...tab.rows];
    if (tab.totalRows > tab.rows.length) {
      values.push([
        `NOTE: truncated — showing ${tab.rows.length} of ${tab.totalRows} rows (full data in the app)`,
      ]);
    }
    await api.spreadsheets.values.update({
      spreadsheetId: cfg.sheetId,
      range: `${range}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });
  }
}

// ------------------------------------------------------------------
// Sync run
// ------------------------------------------------------------------

/**
 * Run a full mirror sync now. Throws AppError NOT_CONFIGURED (400) when the
 * integration is off/incomplete and SYNC_IN_PROGRESS (409) when another sync
 * is still running. Any other failure is recorded on the SyncLog row (ERROR)
 * and rethrown so the caller (job queue) can retry.
 */
export async function runSheetsSync(): Promise<SyncLog> {
  const cfg = await getSheetsConfig();
  const problem = configProblemOf(cfg);
  if (problem) {
    throw badRequest('NOT_CONFIGURED', `Google Sheets sync is not configured: ${problem}`);
  }

  // A sync that never finished (process crash/restart) must not block forever.
  await prisma.syncLog.updateMany({
    where: {
      target: SHEETS_TARGET,
      status: 'RUNNING',
      startedAt: { lt: new Date(Date.now() - STALE_RUNNING_MS) },
    },
    data: {
      status: 'ERROR',
      finishedAt: new Date(),
      error: 'Sync never finished (process restarted?) — superseded by a newer sync',
    },
  });
  const running = await prisma.syncLog.findFirst({
    where: { target: SHEETS_TARGET, status: 'RUNNING' },
  });
  if (running) {
    throw conflict('SYNC_IN_PROGRESS', 'A Google Sheets sync is already running');
  }

  const log = await prisma.syncLog.create({ data: { target: SHEETS_TARGET } }); // status RUNNING
  try {
    const tabs = await buildAllTabs();
    await pushTabs(cfg, tabs);
    const rowsSynced = tabs.reduce((sum, tab) => sum + tab.rows.length, 0);
    const finished = await prisma.syncLog.update({
      where: { id: log.id },
      data: { status: 'OK', finishedAt: new Date(), rowsSynced, error: null },
    });
    logger.info({ rowsSynced, sheetId: cfg.sheetId }, 'google sheets sync finished');
    return finished;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
    await prisma.syncLog
      .update({
        where: { id: log.id },
        data: { status: 'ERROR', finishedAt: new Date(), error: message },
      })
      .catch((updateErr: unknown) =>
        logger.error({ err: updateErr }, 'failed to record google sheets sync error'),
      );
    logger.error({ err }, 'google sheets sync failed');
    throw err;
  }
}
