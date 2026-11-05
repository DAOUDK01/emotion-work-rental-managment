/**
 * THE reconciliation test required by the spec: after importing the client's
 * real workbook, the dashboard must give the same answers as the Excel Calc sheet.
 * Every expected number below is the cached result of a Calc-sheet formula
 * (see data/source/analysis/sheet_Calc.txt).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { runExcelImport, type ImportResult } from '../src/excel/import-excel.js';
import { dashboardSummary, unitPerformance } from '../src/modules/dashboard/service.js';
import { resetDataTables } from './helpers.js';

const WORKBOOK = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../data/source/E_MotionFix_Dashboard.xlsx',
);

// The client workbook contains customer data and is kept out of the public repository;
// without it (e.g. in CI) these suites are skipped. Put the file in data/source/ to run them.
const HAS_WORKBOOK = fs.existsSync(WORKBOOK);

const PERIOD ={ from: '2026-01-01', to: '2026-12-31' } as const;

let result: ImportResult;

beforeAll(async () => {
  if (!HAS_WORKBOOK) return;
  await resetDataTables();
  result = await runExcelImport(prisma, WORKBOOK);
});

describe.skipIf(!HAS_WORKBOOK)('Excel import — row counts and flags', () => {
  it('imports every record from the clean tabs', () => {
    expect(result.summary.rentals).toBe(10); // Calc B19: 10 rental orders
    expect(result.summary.units).toBe(11); // 10 on Unit Data + "EGO EVO -2" found only in rentals
    expect(result.summary.salesEntries).toBe(31);
    expect(result.summary.expenses).toBeGreaterThanOrEqual(60);
    expect(result.summary.customers).toBeGreaterThanOrEqual(7);
  });
  it('flags problem rows for review instead of guessing', () => {
    expect(result.summary.needsReview).toBeGreaterThan(0);
    const messages = result.issues.map((i) => i.message).join('\n');
    expect(messages).toContain('Purchase date missing'); // all units: provisional IDs
    expect(messages).toMatch(/duplicate/i); // Ali Express 88.10 twice, 59.72 twice
    expect(messages).toMatch(/EGO EVO -2/i); // unit missing from Unit Data
  });
  it('imports suspected duplicates as recorded (both Ali Express 88.10 rows)', async () => {
    const aliExpress = await prisma.expense.findMany({ where: { vendor: 'Ali Express', grossCents: 8810 } });
    expect(aliExpress).toHaveLength(2);
  });
  it('refuses to import the same workbook twice (would double all income)', async () => {
    await expect(runExcelImport(prisma, WORKBOOK)).rejects.toThrow(/already imported/);
    expect(await prisma.importBatch.count()).toBe(1);
  });
  it('does not import any customer phone numbers (GDPR)', async () => {
    const withPhone = await prisma.customer.count({ where: { phone: { not: null } } });
    expect(withPhone).toBe(0);
  });
});

describe.skipIf(!HAS_WORKBOOK)('Reconciliation with the Excel Calc sheet (all filters = All, toggle = No)', () => {
  it('importer totals match Calc', () => {
    const t = result.summary.totals;
    expect(t.rentalBilledCents).toBe(124356); // Calc B16: 1243.56
    expect(t.rentalReceivedCents).toBe(45100); // Calc B17: 451
    expect(t.salesRevenueCents).toBe(277690); // Calc B22: 2776.90
    expect(t.totalRevenueCents).toBe(402046); // Calc B25: 4020.46
    expect(t.toolsCents).toBe(26483); // Calc B30: 264.83
    expect(t.sparePartsCents).toBe(221211); // Calc B31: 2212.11
    expect(t.otherExpensesCents).toBe(2500); // Calc B32: 25
    expect(t.unitPurchasesCents).toBe(348000); // Calc B33: 3480
  });

  it('dashboard KPIs reproduce the Calc sheet', async () => {
    const s = await dashboardSummary(PERIOD);
    const k = s.kpis;
    expect(k.totalSalesCents).toBe(402046); // TOTAL REVENUE
    expect(k.receivedCents).toBe(322790); // Calc B27: 3227.90
    expect(k.outstandingCents).toBe(79256); // Calc B28: 792.56
    expect(k.rentalOrders).toBe(10); // Calc B19
    expect(k.rentalRevenueCents).toBe(124356);
    expect(k.operatingExpensesCents).toBe(250194); // Calc B34: 2501.94
    expect(k.unitPurchasesCents).toBe(348000);
    expect(k.unitPurchasesCounted).toBe(false); // the Excel toggle defaults to No
    expect(k.netProfitCents).toBe(151852); // Calc B36: 1518.52
    expect(k.profitMarginPct).toBe(37.8); // Calc B37: 0.3777
    expect(k.rentalPaybackPct).toBe(35.7); // Calc B39: 0.3573
    // the source has no VAT data: everything imports as non-VAT income
    expect(k.vatCollectedCents).toBe(0);
    expect(k.vatPayableCents).toBe(0);
    expect(k.nonVatIncomeCents).toBe(402046);
    expect(k.discountsCents).toBe(0);
  });

  it('revenue by model matches (unit sales reclassified from "spare parts", totals identical)', async () => {
    const s = await dashboardSummary(PERIOD);
    const byCode = Object.fromEntries(s.revenueByModel.map((r) => [r.model.code, r.grossCents]));
    expect(byCode.RENTAL).toBe(124356);
    expect(byCode.REPAIR).toBe(121090); // Calc B21: 1210.90 (Repair Labor)
    // Excel lumps sold units under "Spare Parts" (1566.00) — we split them truthfully:
    expect(byCode.SPARE_PARTS).toBe(40600);
    expect(byCode.UNIT_SALES).toBe(116000);
    expect(byCode.SPARE_PARTS + byCode.UNIT_SALES).toBe(156600); // Calc B20: 1566.00
  });

  it('rental revenue by product category matches (Calc rows 53-54)', async () => {
    const s = await dashboardSummary(PERIOD);
    const byCat = Object.fromEntries(s.rentalByCategory.map((c) => [c.category, c]));
    expect(byCat['E-Scooter'].receivedCents).toBe(8000); // 80
    expect(byCat['E-Scooter'].outstandingCents).toBe(25550); // 255.50
    expect(byCat['E-Bike'].receivedCents).toBe(37100); // 371
    expect(byCat['E-Bike'].outstandingCents).toBe(53706); // 537.06
  });

  it('unit performance covers every rental euro (Excel missed the unlisted unit)', async () => {
    const perf = await unitPerformance(PERIOD);
    expect(perf.totals.purchaseCents).toBe(348000);
    // Excel's unit table totalled 992.56 because "EGO EVO -2" was missing from Unit Data;
    // the import creates that unit, so the table now accounts for the full 1243.56.
    expect(perf.totals.rentalRevenueCents).toBe(124356);
    const stub = perf.rows.find((r) => r.code.includes('DRAFT') && r.rentalRevenueCents === 25100);
    expect(stub).toBeDefined();
  });

  it('received-by ledger: Salman holds the cash he collected', async () => {
    // Paid rentals with a named receiver: 50 + 40 (Salman). Other paid rows lack a
    // receiver in the source and are flagged — no invented ledger money.
    const payments = await prisma.payment.groupBy({
      by: ['receivedById'],
      where: { status: 'ACTIVE' },
      _sum: { amountCents: true },
    });
    const salman = await prisma.moneyHolder.findUnique({ where: { name: 'Salman' } });
    const row = payments.find((p) => p.receivedById === salman!.id);
    expect(row?._sum.amountCents).toBe(9000);
    expect(payments.filter((p) => p.receivedById !== salman!.id)).toHaveLength(0);
  });

  it('partner-paid purchases became investments automatically', async () => {
    const sums = await prisma.investment.groupBy({
      by: ['category'],
      where: { status: 'ACTIVE', auto: true },
      _sum: { amountCents: true },
    });
    const by = Object.fromEntries(sums.map((s) => [s.category, s._sum.amountCents ?? 0]));
    expect(by.UNITS).toBe(338000); // 3480 − 100 (Faafrees has no payer recorded)
    expect(by.TOOLS).toBeGreaterThan(0);
    expect(by.SPARE_PARTS).toBeGreaterThan(0);
  });
});
