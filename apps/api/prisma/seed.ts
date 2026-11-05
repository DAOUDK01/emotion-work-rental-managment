/**
 * Base seed: everything the system NEEDS to run — settings, VAT/tax rates, models,
 * money holders, payment methods, expense categories, unit prefixes, admin users.
 * Idempotent: safe to run again (upserts). Demo data lives in demo-seed.ts instead.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_MODELS,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_RECEIVED_BY,
  DEFAULT_UNIT_PREFIXES,
} from '@emotionfix/shared';

const prisma = new PrismaClient();

const DEFAULT_SETTINGS: Record<string, unknown> = {
  company: {
    name: 'E Motion Works Oy',
    oldName: 'E Motion Fix Oy',
    businessId: '', // Y-tunnus — the client must fill this in (Settings → Company)
    vatNumber: '', // FI + digits
    address: '',
    postalCode: '',
    city: 'Turku',
    country: 'Finland',
    phone: '',
    email: '',
    iban: '', // required on invoices — client must fill in
    bic: '',
    logoDataUrl: null,
  },
  invoice: {
    numberingPrefix: 'year', // "year" -> 2026-0001
    termsDaysDefault: 14,
    lateInterestTextEn: 'Late payment interest according to the Finnish Interest Act (korkolaki).',
    lateInterestTextFi: 'Viivästyskorko korkolain mukaan.',
    footerEn: 'Thank you for your business!',
    footerFi: 'Kiitos!',
    reminderDays: 7,
  },
  vatDefaults: {
    byHolder: { 'Company Account': true, Ahmed: false, Salman: false, Cash: false },
    warningText:
      'The accountant must confirm the VAT treatment of income without a VAT invoice.',
  },
  cash: { alertAfterDays: 7 },
  units: { subtractRepairPartsFromPayback: false },
  pnl: {
    countUnitPurchasesAsCost: false,
    allocateSharedCostsByRevenue: false,
    partnerPayableForPersonalSpend: true,
  },
  'whatsapp.allowedNumbers': [],
  whatsapp: { dailySummary: false, groupFeatureFlag: false },
  googleSheets: { enabled: false, sheetId: '' },
  smtp: {},
  pos: { receiptWidthMm: 80, askCustomer: false },
};

async function main() {
  // Settings (only create missing keys; never overwrite admin-edited values)
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as object },
    });
  }

  // VAT rates: Finnish general rate history + special 0 %
  const vatRates = [
    { rateBp: 2400, validFrom: '2013-01-01', label: 'General rate (history)', isDefault: true },
    { rateBp: 2550, validFrom: '2024-09-01', label: 'General rate', isDefault: true },
  ];
  for (const r of vatRates) {
    await prisma.vatRate.upsert({
      where: { rateBp_validFrom: { rateBp: r.rateBp, validFrom: new Date(`${r.validFrom}T00:00:00Z`) } },
      update: { label: r.label, isDefault: r.isDefault },
      create: { ...r, validFrom: new Date(`${r.validFrom}T00:00:00Z`) },
    });
  }
  const zeroExists = await prisma.vatRate.findFirst({ where: { rateBp: 0 } });
  if (!zeroExists) {
    await prisma.vatRate.create({
      data: {
        rateBp: 0,
        validFrom: new Date('2013-01-01T00:00:00Z'),
        label: '0 % (exempt / reverse charge)',
        isDefault: false,
      },
    });
  }

  // Corporate tax: 20 % now, 18 % from 1 Jan 2027
  for (const t of [
    { rateBp: 2000, validFrom: '2014-01-01' },
    { rateBp: 1800, validFrom: '2027-01-01' },
  ]) {
    const exists = await prisma.taxRate.findFirst({
      where: { validFrom: new Date(`${t.validFrom}T00:00:00Z`) },
    });
    if (!exists) {
      await prisma.taxRate.create({ data: { rateBp: t.rateBp, validFrom: new Date(`${t.validFrom}T00:00:00Z`) } });
    }
  }

  // Business models (a table, not an enum — Settings can add more)
  for (const m of DEFAULT_MODELS) {
    await prisma.businessModel.upsert({
      where: { code: m.code },
      update: {},
      create: { ...m, isSystem: true, active: m.code !== 'CONTRACT' }, // contract work activates later
    });
  }

  // Money holders ("Amount received by" options)
  const holderKinds: Record<string, 'PARTNER' | 'COMPANY' | 'CASHBOX'> = {
    Ahmed: 'PARTNER',
    Salman: 'PARTNER',
    'Company Account': 'COMPANY',
    Cash: 'CASHBOX',
  };
  let order = 1;
  for (const name of DEFAULT_RECEIVED_BY) {
    await prisma.moneyHolder.upsert({
      where: { name },
      update: {},
      create: { name, kind: holderKinds[name] ?? 'OTHER', sortOrder: order++, isSystem: true },
    });
  }

  // Payment methods
  order = 1;
  for (const name of DEFAULT_PAYMENT_METHODS) {
    await prisma.paymentMethod.upsert({
      where: { name },
      update: {},
      create: {
        name,
        sortOrder: order++,
        isSystem: true,
        defaultVatInvoice: name === 'Bank transfer' || name === 'Card',
      },
    });
  }

  // Expense categories
  order = 1;
  for (const c of DEFAULT_EXPENSE_CATEGORIES) {
    await prisma.expenseCategory.upsert({
      where: { nameEn: c.nameEn },
      update: {},
      create: { ...c, sortOrder: order++, isSystem: true },
    });
  }

  // Unit prefixes
  for (const p of DEFAULT_UNIT_PREFIXES) {
    await prisma.unitPrefix.upsert({ where: { prefix: p.prefix }, update: {}, create: p });
  }

  // Admin users (admin creates further users in the app)
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!123';
  const passwordHash = await bcrypt.hash(password, 12);
  const users = [
    { email: 'ahmed@emotionworks.fi', name: 'Ahmed', role: 'ADMIN' as const },
    { email: 'salman@emotionworks.fi', name: 'Salman', role: 'ADMIN' as const },
    { email: 'accountant@emotionworks.fi', name: 'Accountant', role: 'ACCOUNTANT' as const },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash, language: 'EN' },
    });
  }

  // Number sequences
  for (const key of ['INVOICE', 'RECEIPT', 'CREDIT_NOTE', 'CLAIM']) {
    await prisma.numberSequence.upsert({ where: { key }, update: {}, create: { key, nextValue: 1 } });
  }

  console.log('Seed complete.');
  console.log('Sign in with ahmed@emotionworks.fi / salman@emotionworks.fi');
  console.log(`Password: the SEED_ADMIN_PASSWORD env value${process.env.SEED_ADMIN_PASSWORD ? '' : ' (default "ChangeMe!123")'} — change it after first login.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
