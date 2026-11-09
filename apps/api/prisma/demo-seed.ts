/**
 * DEMO seed: realistic sample data, clearly marked [DEMO], so every screen shows
 * something on a fresh install. Run AFTER db:seed:  pnpm seed:demo
 * Safe to re-run (it first removes previous [DEMO] data it created).
 */
import { PrismaClient } from '@prisma/client';
import { addDays, splitGross, todayInHelsinki } from '@emotionfix/shared';

const prisma = new PrismaClient();
const RATE = 2550;

function d(offsetDays: number): Date {
  return new Date(`${addDays(todayInHelsinki(), offsetDays)}T00:00:00Z`);
}

async function main() {
  const marker = '[DEMO]';
  // wipe previous demo data (entries cascade via explicit deletes)
  const oldCustomers = await prisma.customer.findMany({ where: { notes: marker } });
  const oldUnits = await prisma.unit.findMany({ where: { notes: marker } });
  const customerIds = oldCustomers.map((c) => c.id);
  const unitIds = oldUnits.map((u) => u.id);
  await prisma.payment.deleteMany({ where: { OR: [{ entry: { customerId: { in: customerIds } } }, { entry: { unitId: { in: unitIds } } }] } });
  await prisma.discountRecord.deleteMany({ where: { OR: [{ entry: { customerId: { in: customerIds } } }, { entry: { unitId: { in: unitIds } } }] } });
  await prisma.entry.deleteMany({ where: { OR: [{ customerId: { in: customerIds } }, { unitId: { in: unitIds } }] } });
  await prisma.rental.deleteMany({ where: { OR: [{ customerId: { in: customerIds } }, { unitId: { in: unitIds } }] } });
  await prisma.investment.deleteMany({ where: { OR: [{ unitId: { in: unitIds } }, { note: marker }, { expense: { notes: marker } }] } });
  await prisma.stockMovement.deleteMany({ where: { OR: [{ notes: marker }, { product: { category: marker } }] } });
  await prisma.expense.deleteMany({ where: { notes: marker } });
  await prisma.productBarcode.deleteMany({ where: { product: { category: marker } } });
  await prisma.product.deleteMany({ where: { category: marker } });
  await prisma.cashHandover.deleteMany({ where: { note: marker } });
  await prisma.warrantyClaim.deleteMany({ where: { notes: marker } });
  await prisma.unit.deleteMany({ where: { id: { in: unitIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });

  const [models, holders, methods, categories] = await Promise.all([
    prisma.businessModel.findMany(),
    prisma.moneyHolder.findMany(),
    prisma.paymentMethod.findMany(),
    prisma.expenseCategory.findMany(),
  ]);
  const model = (code: string) => models.find((m) => m.code === code)!.id;
  const holder = (name: string) => holders.find((h) => h.name === name)!.id;
  const method = (name: string) => methods.find((m) => m.name === name)!.id;
  const category = (nameEn: string) => categories.find((c) => c.nameEn === nameEn)!.id;

  // ---- customers ----
  const mkCustomer = (data: { name: string; type?: 'INDIVIDUAL' | 'BUSINESS'; businessId?: string; email?: string; language?: 'EN' | 'FI' }) =>
    prisma.customer.create({ data: { ...data, type: data.type ?? 'INDIVIDUAL', notes: marker } });
  const lucky = await mkCustomer({ name: 'Aino Demo', email: 'aino@example.com' });
  const subhan = await mkCustomer({ name: 'Mikko Demo' });
  const bikeOy = await mkCustomer({ name: 'TurkuBikes Demo Oy', type: 'BUSINESS', businessId: '0244683-1', email: 'billing@example.com', language: 'FI' });
  const roberto = await mkCustomer({ name: 'Roberto Demo' });

  // ---- units ----
  const mkUnit = (data: {
    code: string; brand: string; category: 'E_SCOOTER' | 'E_BIKE' | 'MOPED'; purchaseDate: number;
    purchaseCents: number; owner: string; status?: 'AVAILABLE' | 'ON_RENT' | 'WAITING_PARTS' | 'IN_REPAIR' | 'SOLD';
  }) =>
    prisma.unit.create({
      data: {
        code: data.code,
        brand: data.brand,
        category: data.category,
        purchaseDate: d(data.purchaseDate),
        purchaseCents: data.purchaseCents,
        ownerId: holder(data.owner),
        paidById: holder(data.owner),
        status: data.status ?? 'AVAILABLE',
        inclusions: '2 batteries + charger',
        notes: marker,
      },
    });
  const u1 = await mkUnit({ code: 'EE2-DEMO01', brand: 'Ego Evo 2', category: 'E_SCOOTER', purchaseDate: -120, purchaseCents: 65000, owner: 'Ahmed', status: 'ON_RENT' });
  const u2 = await mkUnit({ code: 'EW-DEMO02', brand: 'Engwe EP-2 Pro', category: 'E_BIKE', purchaseDate: -110, purchaseCents: 70000, owner: 'Salman', status: 'ON_RENT' });
  const u3 = await mkUnit({ code: 'FF-DEMO03', brand: 'Faafres F20', category: 'E_BIKE', purchaseDate: -95, purchaseCents: 48000, owner: 'Ahmed', status: 'AVAILABLE' });
  const u4 = await mkUnit({ code: 'EE-DEMO04', brand: 'Ego Evo', category: 'E_SCOOTER', purchaseDate: -90, purchaseCents: 59000, owner: 'Salman', status: 'IN_REPAIR' });

  for (const [u, owner] of [[u1, 'Ahmed'], [u2, 'Salman'], [u3, 'Ahmed'], [u4, 'Salman']] as const) {
    await prisma.investment.create({
      data: { date: u.purchaseDate!, holderId: holder(owner), category: 'UNITS', amountCents: u.purchaseCents!, unitId: u.id, auto: true, note: marker },
    });
  }

  // ---- income entries (rentals + repairs + parts) over the last ~10 weeks ----
  async function income(args: {
    day: number; modelCode: string; gross: number; discount?: number; discountReason?: string;
    unitId?: number; customerId?: number; description: string; status?: 'PAID' | 'INVOICED' | 'PENDING';
    receivedBy?: string; methodName?: string; vatInvoice?: boolean; labour?: number; parts?: number;
  }) {
    const grossAfter = args.gross - (args.discount ?? 0);
    const vat = args.vatInvoice ? splitGross(grossAfter, RATE) : { vatCents: 0, netCents: grossAfter };
    const customer = args.customerId ? await prisma.customer.findUnique({ where: { id: args.customerId } }) : null;
    const entry = await prisma.entry.create({
      data: {
        entryDate: d(args.day),
        modelId: model(args.modelCode),
        unitId: args.unitId ?? null,
        customerId: args.customerId ?? null,
        description: `${marker} ${args.description}`,
        grossCents: grossAfter,
        discountCents: args.discount ?? 0,
        discountReason: args.discountReason ?? null,
        vatInvoice: args.vatInvoice ?? false,
        vatRateBp: RATE,
        vatCents: vat.vatCents,
        netCents: vat.netCents,
        labourCents: args.labour ?? null,
        partsCents: args.parts ?? null,
        paymentStatus: args.status ?? 'PAID',
        paymentMethodId: args.methodName ? method(args.methodName) : null,
        receivedById: args.receivedBy ? holder(args.receivedBy) : null,
        segment: customer?.type ?? 'INDIVIDUAL',
        source: 'WEB',
      },
    });
    if ((args.discount ?? 0) > 0) {
      await prisma.discountRecord.create({
        data: { date: entry.entryDate, amountCents: args.discount!, reason: args.discountReason, modelId: entry.modelId, entryId: entry.id },
      });
    }
    if (entry.paymentStatus === 'PAID' && entry.receivedById) {
      await prisma.payment.create({
        data: { date: entry.entryDate, amountCents: grossAfter, methodId: entry.paymentMethodId, receivedById: entry.receivedById, entryId: entry.id },
      });
    }
    return entry;
  }

  // weekly rentals with growth pattern (the 4-week chart gets a story)
  const rentalPlan: Array<[number, number, number, number]> = [
    // [weeksAgo, u1 rent, u2 rent, repairs that week]
    [9, 9000, 12000, 6000],
    [8, 7000, 15000, 8000],
    [7, 12000, 9000, 12550],
    [6, 10000, 18000, 4500],
    [5, 8000, 11000, 9000],
    [4, 10500, 14000, 7000],
    [3, 12000, 16000, 12000],
    [2, 9500, 13500, 15000],
    [1, 15000, 17500, 8000],
    [0, 4500, 25100, 6000],
  ];
  for (const [weeksAgo, r1, r2, rep] of rentalPlan) {
    const base = -7 * weeksAgo;
    await income({ day: base - 5, modelCode: 'RENTAL', gross: r1, unitId: u1.id, customerId: subhan.id, description: `Rental week, ${u1.code}`, receivedBy: weeksAgo % 2 ? 'Salman' : 'Company Account', methodName: weeksAgo % 2 ? 'Cash' : 'Bank transfer', vatInvoice: weeksAgo % 2 === 0 });
    await income({ day: base - 3, modelCode: 'RENTAL', gross: r2, unitId: u2.id, customerId: lucky.id, description: `Rental week, ${u2.code}`, receivedBy: weeksAgo % 3 ? 'Ahmed' : 'Company Account', methodName: weeksAgo % 3 ? 'MobilePay' : 'Bank transfer', vatInvoice: weeksAgo % 3 === 0 });
    await income({ day: base - 2, modelCode: 'REPAIR', gross: rep, customerId: roberto.id, description: 'Repair job', labour: Math.round(rep * 0.6), parts: rep - Math.round(rep * 0.6), receivedBy: 'Company Account', methodName: 'Card', vatInvoice: true });
  }
  await income({ day: -4, modelCode: 'SPARE_PARTS', gross: 1500, customerId: roberto.id, description: 'Brake pads', discount: 200, discountReason: 'Autumn promo', receivedBy: 'Cash', methodName: 'Cash' });
  await income({ day: -9, modelCode: 'SPARE_PARTS', gross: 4300, description: 'Tyre + tube', receivedBy: 'Ahmed', methodName: 'Cash' });
  await income({ day: -15, modelCode: 'UNIT_SALES', gross: 52000, description: 'Used e-bike sold', receivedBy: 'Company Account', methodName: 'Bank transfer', vatInvoice: true });
  // outstanding money (Unpaid card)
  await income({ day: -12, modelCode: 'RENTAL', gross: 25100, unitId: u2.id, customerId: bikeOy.id, description: 'Monthly rental — invoice sent', status: 'INVOICED', vatInvoice: true });
  await income({ day: -6, modelCode: 'RENTAL', gross: 12550, unitId: u1.id, customerId: roberto.id, description: 'Rental — payment pending', status: 'PENDING' });

  // a formal rental agreement row (recurring)
  await prisma.rental.create({
    data: {
      unitId: u2.id, customerId: bikeOy.id, startDate: d(-30), endDate: d(0), periodText: 'monthly',
      amountCents: 25100, recurring: true, agreementSigned: true, notes: marker, source: 'WEB',
    },
  });

  // ---- expenses ----
  const expensePlan: Array<[number, string, string, string, number, string, boolean]> = [
    [-60, 'Rent', 'Business space rent', 'Landlord Oy', 165000, 'Company Account', true],
    [-45, 'Tools', 'Tyre machine', 'Motonet', 15000, 'Ahmed', true],
    [-30, 'Spare parts (stock)', 'Controller batch (5 pcs)', 'AliExpress', 20500, 'Salman', false],
    [-25, 'Accounting', 'Accounting services', 'Inspirit Accounting', 4393, 'Company Account', true],
    [-20, 'Marketing', 'Facebook ads', 'Meta', 5000, 'Company Account', true],
    [-10, 'Spare parts (stock)', 'Brake pads (10 pcs)', 'Sahko', 6275, 'Ahmed', true],
    [-5, 'Utilities', 'Electricity', 'Turku Energia', 8900, 'Company Account', true],
  ];
  for (const [day, cat, desc, vendor, gross, paidBy, receipt] of expensePlan) {
    const reclaim = receipt ? Math.round((gross * RATE) / (10000 + RATE)) : 0;
    const paidByHolder = holders.find((h) => h.name === paidBy)!;
    const expense = await prisma.expense.create({
      data: {
        expenseDate: d(day), categoryId: category(cat), description: desc, vendor,
        grossCents: gross, vatRateBp: RATE, hasValidReceipt: receipt, reclaimableVatCents: reclaim,
        paidById: paidByHolder.id, notes: marker, source: 'WEB',
      },
    });
    if (paidByHolder.kind === 'PARTNER') {
      await prisma.investment.create({
        data: {
          date: d(day), holderId: paidByHolder.id,
          category: cat === 'Tools' ? 'TOOLS' : cat === 'Spare parts (stock)' ? 'SPARE_PARTS' : 'EXPENSES',
          amountCents: gross, expenseId: expense.id, auto: true, note: marker,
        },
      });
    }
  }
  await prisma.investment.create({
    data: { date: d(-100), holderId: holder('Ahmed'), category: 'CASH_INJECTED', amountCents: 150000, note: `${marker} starting capital` },
  });
  await prisma.investment.create({
    data: { date: d(-100), holderId: holder('Salman'), category: 'CASH_INJECTED', amountCents: 100000, note: `${marker} starting capital` },
  });

  // a settlement so the cash screen shows a handover
  await prisma.cashHandover.create({
    data: { date: d(-8), fromHolderId: holder('Salman'), toHolderId: holder('Company Account'), amountCents: 20000, note: marker },
  });

  // ---- products (POS inventory) ----
  const productsPlan: Array<[string, string, string | null, number, number, number, boolean, string | null]> = [
    ['P-DEMO01', 'Brake pad set', 'Jarrupalasarja', 700, 1500, 24, true, '6416453061668'],
    ['P-DEMO02', 'Inner tube 10"', 'Sisärengas 10"', 450, 1200, 15, true, null],
    ['P-DEMO03', 'Controller 60V', 'Ohjain 60V', 4100, 7900, 6, true, null],
    ['P-DEMO04', 'Throttle', 'Kaasukahva', 800, 1900, 10, true, null],
    ['P-DEMO05', 'Tyre change labour', 'Renkaanvaihtotyö', 0, 3500, 0, false, null],
    ['P-DEMO06', 'Diagnosis', 'Vianmääritys', 0, 2000, 0, false, null],
  ];
  for (const [sku, nameEn, nameFi, cost, price, stock, track, ean] of productsPlan) {
    const product = await prisma.product.create({
      data: {
        sku, nameEn: `${nameEn}`, nameFi: nameFi ?? undefined, category: marker, costCents: cost || null,
        // product cards are priced WITHOUT VAT (the plan lists the shelf price incl. VAT)
        priceCents: price - Math.round((price * RATE) / (10000 + RATE)), vatRateBp: RATE, trackStock: track, reorderLevel: track ? 5 : 0, location: 'A1',
      },
    });
    if (ean) await prisma.productBarcode.create({ data: { productId: product.id, barcode: ean, type: 'EAN13' } });
    if (track && stock > 0) {
      await prisma.stockMovement.create({
        data: { productId: product.id, type: 'IMPORT', qty: stock, unitCostCents: cost || null, notes: marker },
      });
    }
  }

  // a demo warranty claim
  await prisma.warrantyClaim.create({
    data: {
      caseNumber: 'WC-DEMO-0001', company: 'Engwe Warranty EU', customerId: lucky.id, unitId: u2.id,
      description: 'Battery cell failure under warranty', status: 'SUBMITTED', claimedCents: 18000,
      submittedAt: d(-14), notes: marker,
    },
  });

  console.log('Demo data seeded. Everything is marked [DEMO]; rerunning this script replaces it.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
