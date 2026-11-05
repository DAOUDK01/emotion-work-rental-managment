/**
 * Excel import: reads the client's workbook (clean tabs: Unit Data, Rental Data,
 * Sales Data, Cost Data) and loads it into the database.
 *
 * Principles (docs/ASSUMPTIONS.md has the full reasoning):
 *  - Names are normalised (AHMED / 'AHMED ' / Ahmee -> Ahmed; Salaman -> Salman).
 *  - Unit IDs come from prefix + purchase date; the source has NO purchase dates,
 *    so units get provisional <PREFIX>-DRAFT<n> codes and are flagged for review.
 *  - Yellow cells (missing/estimated values in the source) -> needsReview flags.
 *  - All imported income is non-VAT (the source has no VAT data); rows that say
 *    "invoice sent" / "vat inclusive" are flagged for the accountant to confirm.
 *  - Rows with a missing amount import as 0 and are flagged (never guessed).
 *  - Customer phone numbers are NOT imported (GDPR — the clean tabs have none).
 *  - After import, the dashboard reproduces the Excel Calc sheet exactly
 *    (enforced by test/import-reconciliation.test.ts).
 *
 * CLI: pnpm import:excel <file.xlsx> (entry point in cli.ts)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { Prisma, PrismaClient } from '@prisma/client';
import { normalizeHolderName, parseAmountToCents, parseFlexibleDate } from '@emotionfix/shared';

export interface ImportIssue {
  severity: 'warning' | 'review' | 'info';
  sheet: string;
  row: number | null;
  message: string;
}

export interface ImportResult {
  batchId: number;
  summary: {
    units: number;
    rentals: number;
    salesEntries: number;
    expenses: number;
    customers: number;
    investments: number;
    needsReview: number;
    /** sha256 of the workbook — used to refuse importing the same file twice */
    fileHash: string;
    totals: {
      rentalBilledCents: number;
      rentalReceivedCents: number;
      salesRevenueCents: number;
      totalRevenueCents: number;
      toolsCents: number;
      sparePartsCents: number;
      otherExpensesCents: number;
      unitPurchasesCents: number;
    };
  };
  issues: ImportIssue[];
}

const YELLOW = new Set(['FFFFF2A8', 'FFFFFF00', 'FFFFEB9C']);

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const obj = v as { result?: unknown; richText?: Array<{ text: string }>; text?: string };
    if (obj.richText) return obj.richText.map((t) => t.text).join('').trim();
    if (obj.result !== undefined && obj.result !== null) return String(obj.result).trim();
    if (obj.text) return String(obj.text).trim();
    return '';
  }
  return String(v).trim();
}

function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && 'result' in v && typeof (v as { result?: unknown }).result === 'number') {
    return (v as { result: number }).result;
  }
  const text = cellText(cell);
  if (text === '') return null;
  const cents = parseAmountToCents(text);
  return cents === null ? null : cents / 100;
}

function cellCents(cell: ExcelJS.Cell): number | null {
  const n = cellNumber(cell);
  if (n === null) return null;
  return Math.round(n * 100);
}

function isYellow(cell: ExcelJS.Cell): boolean {
  try {
    const fill = cell.fill;
    if (fill && fill.type === 'pattern' && fill.pattern === 'solid' && fill.fgColor?.argb) {
      return YELLOW.has(fill.fgColor.argb);
    }
  } catch {
    /* no fill info */
  }
  return false;
}

function cellDate(cell: ExcelJS.Cell): string | null {
  const v = cell.value;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v && typeof v === 'object' && 'result' in v) {
    const r = (v as { result?: unknown }).result;
    if (r instanceof Date) return r.toISOString().slice(0, 10);
  }
  return parseFlexibleDate(cellText(cell));
}

const MONTH_NAMES: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

function parseMonthish(text: string, fallbackYear: number): string | null {
  const direct = parseFlexibleDate(text);
  if (direct) return direct;
  const m = MONTH_NAMES[text.trim().toLowerCase()];
  if (m) return `${fallbackYear}-${m}-01`;
  return null;
}

function mapUnitStatus(raw: string): 'AVAILABLE' | 'ON_RENT' | 'WAITING_PARTS' | 'IN_REPAIR' | 'SOLD' | 'DISPOSED' {
  const s = raw.toLowerCase();
  if (s.includes('rent')) return 'ON_RENT';
  if (s.includes('sold')) return 'SOLD';
  if (s.includes('dispos')) return 'DISPOSED';
  if (s.includes('wait') || s.includes('part')) return 'WAITING_PARTS';
  if (s.includes('repair')) return 'IN_REPAIR';
  return 'AVAILABLE';
}

function mapCategory(raw: string): 'E_SCOOTER' | 'E_BIKE' | 'MOPED' | null {
  const s = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (s === 'escooter' || s === 'scooter') return 'E_SCOOTER';
  if (s === 'ebike' || s === 'bike') return 'E_BIKE';
  if (s === 'moped') return 'MOPED';
  return null;
}

function prefixFor(name: string, prefixes: Array<{ prefix: string; brandName: string }>): string {
  const n = name.toUpperCase();
  // longest brand-name match wins ("Ego Evo 2" must hit EE2, not EE)
  const sorted = [...prefixes].sort((a, b) => b.brandName.length - a.brandName.length);
  for (const p of sorted) {
    if (n.includes(p.brandName.toUpperCase())) return p.prefix;
  }
  if (n.includes('EGO EVO 2')) return 'EE2';
  if (n.includes('EGO EVO')) return 'EE';
  if (n.includes('ENGWE')) return 'EW';
  if (n.includes('FAAFRE') || n.includes('FAFREE')) return 'FF';
  const word = n.replace(/[^A-Z0-9 ]/g, '').split(' ')[0] ?? 'UNIT';
  return (word.slice(0, 4) || 'UNIT').toUpperCase();
}

/**
 * All-or-nothing import: everything is written in ONE transaction (a failure halfway
 * leaves nothing behind), and a workbook whose exact content was already imported is
 * refused — importing the same file twice would double every euro of income.
 */
export async function runExcelImport(
  prisma: PrismaClient,
  filePath: string,
  options?: { createdById?: number | null; allowDuplicate?: boolean },
): Promise<ImportResult> {
  const fileHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (!options?.allowDuplicate) {
    const previous = await prisma.importBatch.findMany({ select: { id: true, summary: true } });
    const dup = previous.find((b) => (b.summary as { fileHash?: string } | null)?.fileHash === fileHash);
    if (dup) {
      throw new ImportRefusedError(
        `This exact workbook was already imported (batch #${dup.id}). Importing it again would double all amounts.`,
      );
    }
  }
  return prisma.$transaction((tx) => importInto(tx, filePath, fileHash, options), {
    maxWait: 30_000,
    timeout: 10 * 60_000, // a remote database makes ~400 sequential writes slow, not risky
  });
}

export class ImportRefusedError extends Error {}

async function importInto(
  prisma: Prisma.TransactionClient,
  filePath: string,
  fileHash: string,
  options?: { createdById?: number | null },
): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  const issues: ImportIssue[] = [];
  const need = (sheet: string, row: number | null, message: string) =>
    issues.push({ severity: 'review', sheet, row, message });
  const warn = (sheet: string, row: number | null, message: string) =>
    issues.push({ severity: 'warning', sheet, row, message });
  const info = (sheet: string, row: number | null, message: string) =>
    issues.push({ severity: 'info', sheet, row, message });

  const sheetUnits = wb.getWorksheet('Unit Data');
  const sheetRentals = wb.getWorksheet('Rental Data');
  const sheetSales = wb.getWorksheet('Sales Data');
  const sheetCosts = wb.getWorksheet('Cost Data');
  if (!sheetUnits || !sheetRentals || !sheetSales || !sheetCosts) {
    throw new Error(
      'Workbook is missing the clean tabs (Unit Data, Rental Data, Sales Data, Cost Data). Is this the right file?',
    );
  }

  // lookups
  const [holders, models, categories, prefixes] = await Promise.all([
    prisma.moneyHolder.findMany(),
    prisma.businessModel.findMany(),
    prisma.expenseCategory.findMany(),
    prisma.unitPrefix.findMany({ where: { active: true } }),
  ]);
  const holderByName = new Map(holders.map((h) => [h.name, h.id]));
  const modelByCode = new Map(models.map((m) => [m.code, m.id]));
  const categoryByName = new Map(categories.map((c) => [c.nameEn.toLowerCase(), c.id]));
  const requiredModels = ['RENTAL', 'REPAIR', 'SPARE_PARTS', 'UNIT_SALES'] as const;
  for (const code of requiredModels) {
    if (!modelByCode.has(code)) throw new Error(`Seed missing: business model ${code}. Run pnpm db:seed first.`);
  }

  const batch = await prisma.importBatch.create({
    data: {
      fileName: path.basename(filePath),
      createdById: options?.createdById ?? null,
      summary: {},
      issues: [],
    },
  });

  const counters = { units: 0, rentals: 0, salesEntries: 0, expenses: 0, customers: 0, investments: 0 };
  const totals = {
    rentalBilledCents: 0,
    rentalReceivedCents: 0,
    salesRevenueCents: 0,
    toolsCents: 0,
    sparePartsCents: 0,
    otherExpensesCents: 0,
    unitPurchasesCents: 0,
  };

  // ---------------- Units ----------------
  const unitByLegacyName = new Map<string, number>(); // first unit wins (Excel SUMIFS merges duplicates)
  const draftCounters = new Map<string, number>();
  for (let r = 6; r <= sheetUnits.rowCount; r++) {
    const row = sheetUnits.getRow(r);
    const name = cellText(row.getCell(1));
    if (!name) continue;
    const categoryRaw = cellText(row.getCell(2));
    const category = mapCategory(categoryRaw);
    const purchaseDate = cellDate(row.getCell(4));
    const amountCents = cellCents(row.getCell(6));
    const amountYellow = isYellow(row.getCell(6));
    const paidByName = normalizeHolderName(cellText(row.getCell(7)));
    const statusRaw = cellText(row.getCell(8));
    const notes = cellText(row.getCell(9));

    const reasons: string[] = [];
    if (!purchaseDate) reasons.push('Purchase date missing — unit ID is provisional');
    if (amountCents === null) reasons.push('Purchase amount missing');
    else if (amountYellow) reasons.push('Purchase amount was estimated (yellow cell in source)');
    if (!category) reasons.push(`Unknown category "${categoryRaw}"`);
    if (notes.toLowerCase().includes('need')) reasons.push(`Source note: ${notes}`);

    const prefix = prefixFor(name, prefixes);
    let code: string;
    if (purchaseDate) {
      const yymmdd = purchaseDate.slice(2, 4) + purchaseDate.slice(5, 7) + purchaseDate.slice(8, 10);
      code = `${prefix}-${yymmdd}`;
      let suffix = 2;
      while (await prisma.unit.findUnique({ where: { code } })) code = `${prefix}-${yymmdd}-${suffix++}`;
    } else {
      let n = (draftCounters.get(prefix) ?? 0) + 1;
      code = `${prefix}-DRAFT${n}`;
      while (await prisma.unit.findUnique({ where: { code } })) code = `${prefix}-DRAFT${++n}`;
      draftCounters.set(prefix, n);
    }

    const paidById = paidByName ? (holderByName.get(paidByName) ?? null) : null;
    const unit = await prisma.unit.create({
      data: {
        code,
        brand: name,
        category: category ?? 'E_SCOOTER',
        inclusions: cellText(row.getCell(3)) || null,
        purchaseDate: purchaseDate ? new Date(`${purchaseDate}T00:00:00Z`) : null,
        sellerName: cellText(row.getCell(5)) || null,
        purchaseCents: amountCents,
        ownerId: paidById, // assumption: the partner who paid owns the unit (source has no owner column)
        paidById,
        status: mapUnitStatus(statusRaw),
        notes: notes || null,
        legacyName: name,
        needsReview: reasons.length > 0,
        reviewReason: reasons.length ? reasons.join('; ') : null,
        importBatchId: batch.id,
      },
    });
    counters.units++;
    totals.unitPurchasesCents += amountCents ?? 0;
    if (reasons.length) need('Unit Data', r, `${name}: ${reasons.join('; ')}`);
    if (unitByLegacyName.has(name.toUpperCase())) {
      warn('Unit Data', r, `Duplicate unit name "${name}" — rentals are linked to the first one; give them distinct names.`);
    } else {
      unitByLegacyName.set(name.toUpperCase(), unit.id);
    }
    // partner-paid unit purchase -> investment
    if (paidById && amountCents) {
      const holder = holders.find((h) => h.id === paidById);
      if (holder?.kind === 'PARTNER') {
        await prisma.investment.create({
          data: {
            date: purchaseDate ? new Date(`${purchaseDate}T00:00:00Z`) : new Date('2026-08-01T00:00:00Z'),
            holderId: paidById,
            category: 'UNITS',
            amountCents,
            unitId: unit.id,
            auto: true,
            source: 'IMPORT',
            note: `Imported unit purchase ${name}`,
          },
        });
        counters.investments++;
      }
    }
  }

  // ---------------- Rentals ----------------
  const customerIdByName = new Map<string, number>();
  async function ensureCustomer(name: string, businessId: string | null): Promise<number> {
    const key = name.toLowerCase();
    const existing = customerIdByName.get(key);
    if (existing) return existing;
    const customer = await prisma.customer.create({
      data: {
        name,
        type: businessId ? 'BUSINESS' : 'INDIVIDUAL',
        businessId: businessId || null,
        notes: 'Imported from Excel',
      },
    });
    customerIdByName.set(key, customer.id);
    counters.customers++;
    return customer.id;
  }

  for (let r = 6; r <= sheetRentals.rowCount; r++) {
    const row = sheetRentals.getRow(r);
    const unitName = cellText(row.getCell(2));
    const amountCents = cellCents(row.getCell(9));
    if (!unitName && amountCents === null) continue;

    const monthDate = cellDate(row.getCell(1));
    const customerName = cellText(row.getCell(4));
    const businessId = cellText(row.getCell(5)) || null;
    const handOver = cellDate(row.getCell(7));
    const periodText = cellText(row.getCell(8));
    const statusRaw = cellText(row.getCell(10)).toLowerCase();
    const receivedByName = normalizeHolderName(cellText(row.getCell(11)));
    const agreement = cellText(row.getCell(12)).toLowerCase() === 'yes';
    const notes = cellText(row.getCell(13));
    const categoryTyped = cellText(row.getCell(3)); // only set when the unit is missing from Unit Data

    const reasons: string[] = [];
    let unitId = unitByLegacyName.get(unitName.toUpperCase());
    if (!unitId) {
      // unit referenced by a rental but missing from Unit Data (e.g. "EGO EVO -2")
      const cat = mapCategory(categoryTyped) ?? 'E_SCOOTER';
      const prefix = prefixFor(unitName, prefixes);
      let n = (draftCounters.get(prefix) ?? 0) + 1;
      let code = `${prefix}-DRAFT${n}`;
      while (await prisma.unit.findUnique({ where: { code } })) code = `${prefix}-DRAFT${++n}`;
      draftCounters.set(prefix, n);
      const stub = await prisma.unit.create({
        data: {
          code,
          brand: unitName,
          category: cat,
          legacyName: unitName,
          status: 'ON_RENT',
          needsReview: true,
          reviewReason: 'Unit appears in rentals but not on the Unit Data tab — add its purchase details',
          importBatchId: batch.id,
        },
      });
      counters.units++;
      unitId = stub.id;
      unitByLegacyName.set(unitName.toUpperCase(), stub.id);
      need('Rental Data', r, `Unit "${unitName}" was not on Unit Data — created as ${code} for review`);
    }

    const startDate = monthDate ?? handOver ?? '2026-08-01';
    if (!monthDate) reasons.push('Month missing — used hand-over date');
    if (amountCents === null) reasons.push('Amount missing — imported as 0');
    const paymentStatus =
      statusRaw === 'paid' ? 'PAID' : statusRaw === 'invoiced' ? 'INVOICED' : statusRaw === 'pending' ? 'PENDING' : 'PENDING';
    if (!statusRaw) reasons.push('Payment status missing — set to Pending');
    if (paymentStatus === 'PAID' && !receivedByName) reasons.push('"Amount received by" missing for a paid rental');
    if (statusRaw === 'invoiced') reasons.push('Invoice sent per source — accountant must confirm VAT treatment');
    if (periodText && /01\.09 TO 31\.08/i.test(periodText)) reasons.push('Rental period ends before it starts (typo in source)');

    const customerId = customerName ? await ensureCustomer(customerName, businessId) : null;
    const receivedById = receivedByName ? (holderByName.get(receivedByName) ?? null) : null;

    const rental = await prisma.rental.create({
      data: {
        unitId,
        customerId,
        customerName: customerId ? null : customerName || null,
        handOverDate: handOver ? new Date(`${handOver}T00:00:00Z`) : null,
        startDate: new Date(`${startDate}T00:00:00Z`),
        periodText: periodText || null,
        amountCents: amountCents ?? 0,
        agreementSigned: agreement,
        notes: notes || null,
        needsReview: reasons.length > 0,
        reviewReason: reasons.length ? reasons.join('; ') : null,
        source: 'IMPORT',
        importBatchId: batch.id,
      },
    });
    const entry = await prisma.entry.create({
      data: {
        entryDate: new Date(`${startDate}T00:00:00Z`),
        modelId: modelByCode.get('RENTAL')!,
        unitId,
        customerId,
        customerName: customerId ? null : customerName || null,
        description: periodText ? `Rental ${periodText}` : 'Rental',
        grossCents: amountCents ?? 0,
        vatInvoice: false,
        vatRateBp: 2550,
        vatCents: 0,
        netCents: amountCents ?? 0,
        paymentStatus,
        receivedById,
        segment: businessId ? 'BUSINESS' : 'INDIVIDUAL',
        source: 'IMPORT',
        rentalId: rental.id,
        importBatchId: batch.id,
        needsReview: reasons.length > 0,
        reviewReason: reasons.length ? reasons.join('; ') : null,
      },
    });
    if (paymentStatus === 'PAID' && receivedById && (amountCents ?? 0) > 0) {
      await prisma.payment.create({
        data: {
          date: entry.entryDate,
          amountCents: amountCents ?? 0,
          receivedById,
          entryId: entry.id,
          note: 'Imported from Excel',
        },
      });
    }
    counters.rentals++;
    totals.rentalBilledCents += amountCents ?? 0;
    if (paymentStatus === 'PAID') totals.rentalReceivedCents += amountCents ?? 0;
    if (reasons.length) need('Rental Data', r, `${unitName || 'rental'}: ${reasons.join('; ')}`);
  }

  // ---------------- Sales ----------------
  const earliestYear = 2026;
  for (let r = 6; r <= sheetSales.rowCount; r++) {
    const row = sheetSales.getRow(r);
    const customerName = cellText(row.getCell(3));
    const amountCents = cellCents(row.getCell(8));
    if (!customerName && amountCents === null) continue;

    const orderNo = cellText(row.getCell(1));
    const monthText = cellText(row.getCell(2));
    const monthDate = cellDate(row.getCell(2)) ?? parseMonthish(monthText, earliestYear);
    const segmentRaw = cellText(row.getCell(4)).toLowerCase();
    const categoryRaw = cellText(row.getCell(5)).toLowerCase();
    const items = cellText(row.getCell(6));
    const qtyText = cellText(row.getCell(7));
    const profitCents = cellCents(row.getCell(9));
    const settlement = cellText(row.getCell(10));
    const notes = cellText(row.getCell(11));
    const amountYellow = isYellow(row.getCell(8));

    const isUnitSale = items.toLowerCase().includes('unit sold');
    const modelCode = isUnitSale ? 'UNIT_SALES' : categoryRaw.includes('repair') ? 'REPAIR' : 'SPARE_PARTS';

    const reasons: string[] = [];
    if (!monthDate) reasons.push('Sale date missing — counted in totals, chart placement approximate (set to 2026-08-01)');
    if (amountCents === null) reasons.push('Sale amount missing — imported as 0');
    else if (amountYellow) reasons.push('Sale amount was estimated (yellow cell in source)');
    if (settlement.toLowerCase().includes('vat')) reasons.push(`Source says "${settlement}" — accountant must confirm VAT treatment`);
    if (settlement.toLowerCase().includes('adjusted')) reasons.push(`Settlement: ${settlement}`);
    if (isUnitSale && profitCents !== null && profitCents !== amountCents) {
      reasons.push(
        `Unit sale: tabs disagree (amount ${(amountCents ?? 0) / 100} € vs ${profitCents / 100} € in the profit column) — confirm the real sale price`,
      );
    }

    // link unit sales back to the unit and record the sale on it
    let unitId: number | null = null;
    if (isUnitSale) {
      const matched = [...unitByLegacyName.entries()].find(([n]) =>
        n.replace(/\s+/g, '').includes(customerName.toUpperCase().replace(/\s+/g, '')),
      );
      if (matched) {
        unitId = matched[1];
        await prisma.unit.update({
          where: { id: unitId },
          data: {
            status: 'SOLD',
            soldCents: amountCents ?? undefined,
            needsReview: reasons.length > 0 ? true : undefined,
            reviewReason: reasons.length ? reasons.join('; ') : undefined,
          },
        });
      } else {
        reasons.push(`Could not match sold unit "${customerName}" to a unit — link it manually`);
      }
    }

    const description = [
      items,
      qtyText && `qty ${qtyText}`,
      profitCents !== null && !isUnitSale ? `recorded profit ${(profitCents / 100).toFixed(2)} €` : '',
      notes,
    ]
      .filter(Boolean)
      .join(' · ');
    await prisma.entry.create({
      data: {
        entryDate: new Date(`${monthDate ?? '2026-08-01'}T00:00:00Z`),
        modelId: modelByCode.get(modelCode)!,
        unitId,
        customerName: isUnitSale ? null : customerName || null,
        description: `${orderNo ? `${orderNo} · ` : ''}${description || 'Sale'}${isUnitSale ? ` · Unit sold: ${customerName}` : ''}`,
        grossCents: amountCents ?? 0,
        vatInvoice: false,
        vatRateBp: 2550,
        vatCents: 0,
        netCents: amountCents ?? 0,
        paymentStatus: 'PAID', // sales are assumed received at the time of sale (Excel Notes)
        segment: segmentRaw.startsWith('b') ? 'BUSINESS' : 'INDIVIDUAL',
        source: 'IMPORT',
        importBatchId: batch.id,
        needsReview: reasons.length > 0,
        reviewReason: reasons.length ? reasons.join('; ') : null,
      },
    });
    counters.salesEntries++;
    totals.salesRevenueCents += amountCents ?? 0;
    if (reasons.length) need('Sales Data', r, `${customerName || items || 'sale'}: ${reasons.join('; ')}`);
    void earliestYear;
  }

  // ---------------- Costs ----------------
  const costCategoryMap: Record<string, string> = {
    tools: 'Tools',
    'spare parts': 'Spare parts (stock)',
    other: 'Other',
  };
  const seenCosts: Array<{ vendor: string; amountCents: number | null; row: number }> = [];
  for (let r = 6; r <= sheetCosts.rowCount; r++) {
    const row = sheetCosts.getRow(r);
    const typeRaw = cellText(row.getCell(1));
    const itemsText = cellText(row.getCell(2));
    if (!typeRaw && !itemsText) continue;

    const qty = cellText(row.getCell(3));
    const vendor = cellText(row.getCell(4));
    const date = cellDate(row.getCell(5));
    const purchasedFor = cellText(row.getCell(6));
    const amountCents = cellCents(row.getCell(7));
    const paidByName = normalizeHolderName(cellText(row.getCell(8)));
    const notes = cellText(row.getCell(9));

    const categoryName = costCategoryMap[typeRaw.toLowerCase()] ?? 'Other';
    const categoryId = categoryByName.get(categoryName.toLowerCase()) ?? categoryByName.get('other')!;

    const reasons: string[] = [];
    if (amountCents === null) reasons.push('Amount missing');
    if (!date) reasons.push('Purchase date missing — excluded from monthly charts');
    if (notes.toUpperCase().includes('REVIEW')) reasons.push(notes);
    if (notes.toUpperCase().includes('RETURNED')) reasons.push('Source says the item was returned — check for a refund');

    const dup = seenCosts.find(
      (c) => c.amountCents !== null && c.amountCents === amountCents && c.vendor.toLowerCase() === vendor.toLowerCase(),
    );
    if (dup && amountCents !== null) {
      warn('Cost Data', r, `Possible duplicate: ${vendor || 'unknown vendor'} ${(amountCents / 100).toFixed(2)} € also on row ${dup.row}`);
    }
    seenCosts.push({ vendor, amountCents, row: r });

    const paidById = paidByName ? (holderByName.get(paidByName) ?? null) : null;
    const expense = await prisma.expense.create({
      data: {
        expenseDate: date ? new Date(`${date}T00:00:00Z`) : null,
        categoryId,
        description: itemsText || '(item not recorded)',
        vendor: vendor || null,
        qtyText: qty || null,
        grossCents: amountCents,
        vatRateBp: 2550,
        hasValidReceipt: false, // the source has no receipt data — accountant reviews before reclaiming VAT
        reclaimableVatCents: 0,
        paidById,
        purchasedFor: purchasedFor || null,
        notes: notes || null,
        needsReview: reasons.length > 0,
        reviewReason: reasons.length ? reasons.join('; ') : null,
        source: 'IMPORT',
        importBatchId: batch.id,
      },
    });
    counters.expenses++;
    if (typeRaw.toLowerCase() === 'tools') totals.toolsCents += amountCents ?? 0;
    else if (typeRaw.toLowerCase() === 'spare parts') totals.sparePartsCents += amountCents ?? 0;
    else totals.otherExpensesCents += amountCents ?? 0;
    if (reasons.length) need('Cost Data', r, `${itemsText || vendor}: ${reasons.join('; ')}`);

    const holder = holders.find((h) => h.id === paidById);
    if (holder?.kind === 'PARTNER' && amountCents) {
      await prisma.investment.create({
        data: {
          date: date ? new Date(`${date}T00:00:00Z`) : new Date('2026-08-01T00:00:00Z'),
          holderId: holder.id,
          category: categoryName === 'Tools' ? 'TOOLS' : categoryName === 'Spare parts (stock)' ? 'SPARE_PARTS' : 'EXPENSES',
          amountCents,
          expenseId: expense.id,
          auto: true,
          source: 'IMPORT',
        },
      });
      counters.investments++;
    }
  }

  info('Import', null, 'Customer phone numbers were NOT imported (GDPR) — the clean tabs contain none, and the original RENTAL tab numbers stay in the Excel only.');
  info('Import', null, 'All imported income is recorded WITHOUT a VAT invoice (the source has no VAT data). Rows marked "invoice sent" / "vat inclusive" are flagged — the accountant must confirm their VAT treatment.');
  info('Import', null, 'Unit sale rows on the Sales Data tab are imported under the Unit sales model (the Excel grouped them under Spare Parts). Totals still reconcile; only the per-model split is more truthful.');

  const needsReview = issues.filter((i) => i.severity === 'review').length;
  const summary: ImportResult['summary'] = {
    ...counters,
    needsReview,
    fileHash,
    totals: { ...totals, totalRevenueCents: totals.rentalBilledCents + totals.salesRevenueCents },
  };
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { summary: summary as never, issues: issues as never },
  });

  return { batchId: batch.id, summary, issues };
}
