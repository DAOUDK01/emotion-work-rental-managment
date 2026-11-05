import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  SECRET_SETTING_KEYS,
  getAllSettings,
  getSetting,
  setSetting,
} from '../../services/settings.js';
import { AppError } from '../../errors.js';

export const settingsRouter = Router();

/** Company header data for the app shell (any signed-in role). */
settingsRouter.get('/app', requireAuth(), async (_req, res, next) => {
  try {
    const all = await getAllSettings();
    const visible = Object.fromEntries(
      Object.entries(all).filter(([k]) => !SECRET_SETTING_KEYS.has(k)),
    );
    res.json({ settings: visible });
  } catch (err) {
    next(err);
  }
});

/** Full settings incl. integration config — admin only. */
settingsRouter.get('/', requireAuth('ADMIN'), async (_req, res, next) => {
  try {
    res.json({ settings: await getAllSettings() });
  } catch (err) {
    next(err);
  }
});

const KNOWN_KEYS = [
  'company', // { name, oldName, businessId, vatNumber, address, postalCode, city, country, phone, email, iban, bic, logoDataUrl }
  'invoice', // { numberingPrefix, termsDaysDefault, lateInterestTextEn, lateInterestTextFi, footerEn, footerFi, thermalWidthMm }
  'vatDefaults', // { byHolder: { "Company Account": true, Cash: false, ... }, warningText }
  'cash', // { alertAfterDays }
  'units', // { subtractRepairPartsFromPayback }
  'pnl', // { countUnitPurchasesAsCost, allocateSharedCostsByRevenue, partnerPayableForPersonalSpend }
  'whatsapp.allowedNumbers', // ["+3584...", ...]
  'whatsapp', // { dailySummary: boolean, groupFeatureFlag: boolean }
  'googleSheets', // { enabled, sheetId }
  'smtp', // { host, port, secure, user, pass, from }
  'pos', // { receiptWidthMm: 58|80, askCustomer: boolean }
] as const;

settingsRouter.put(
  '/:key',
  requireAuth('ADMIN'),
  validate({ params: z.object({ key: z.string() }), body: z.object({ value: z.unknown() }) }),
  async (req, res, next) => {
    try {
      const key = (req.params as unknown as { key: string }).key;
      if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
        throw new AppError(400, 'UNKNOWN_SETTING', `Unknown setting key "${key}"`);
      }
      await setSetting(key, (req.body as { value: unknown }).value);
      res.json({ key, value: await getSetting(key, null) });
    } catch (err) {
      next(err);
    }
  },
);
