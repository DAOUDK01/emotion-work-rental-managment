import { prisma } from '../db.js';
import { audit } from './audit.js';

/**
 * Settings live in the database (never hard-coded): company details, invoice texts,
 * cash-alert thresholds, WhatsApp allow-list, Google Sheet config, SMTP, toggles.
 * Values are JSON; see DEFAULT_SETTINGS in prisma/seed.ts for the full catalogue.
 */

const cache = new Map<string, unknown>();
let cacheLoaded = false;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (!cacheLoaded) await reloadSettings();
  return (cache.has(key) ? (cache.get(key) as T) : fallback);
}

export async function getAllSettings(): Promise<Record<string, unknown>> {
  if (!cacheLoaded) await reloadSettings();
  return Object.fromEntries(cache);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const before = await prisma.setting.findUnique({ where: { key } });
  await prisma.setting.upsert({
    where: { key },
    update: { value: value as object },
    create: { key, value: value as object },
  });
  cache.set(key, value);
  await audit('UPDATE', 'settings', key, before?.value, value);
}

export async function reloadSettings(): Promise<void> {
  const rows = await prisma.setting.findMany();
  cache.clear();
  for (const row of rows) cache.set(row.key, row.value);
  cacheLoaded = true;
}

/** Keys whose values must never reach non-admin clients. */
export const SECRET_SETTING_KEYS = new Set([
  'smtp',
  'whatsapp.allowedNumbers',
  'googleSheets',
]);
