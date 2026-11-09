/**
 * Integration tests for the spec's required flows, over the real HTTP API:
 * received-by balances & handovers · POS sale decrements stock · credit note
 * restocks · invoice reference check digit + payments · WhatsApp parser flow
 * (valid + invalid + duplicate + UNDO) · rental entry + recurring generation ·
 * VAT-invoice defaults by receiver.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { isValidFinnishReference } from '@emotionfix/shared';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { resetDataTables } from './helpers.js';

const app = createApp();

type Agent = ReturnType<typeof request.agent>;
let admin: Agent;
let csrf = '';
let lookups: {
  models: Array<{ id: number; code: string }>;
  holders: Array<{ id: number; name: string }>;
  methods: Array<{ id: number; name: string }>;
  expenseCategories: Array<{ id: number; nameEn: string }>;
};

const model = (code: string) => lookups.models.find((m) => m.code === code)!.id;
const holder = (name: string) => lookups.holders.find((h) => h.name === name)!.id;
const method = (name: string) => lookups.methods.find((m) => m.name === name)!.id;

function post(path: string) {
  return admin.post(`/api${path}`).set('X-CSRF-Token', csrf);
}

beforeAll(async () => {
  await resetDataTables();
  admin = request.agent(app);
  const login = await admin
    .post('/api/auth/login')
    .send({ email: 'ahmed@emotionworks.fi', password: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!123' });
  expect(login.status).toBe(200);
  const cookies = login.get('Set-Cookie') ?? [];
  csrf = cookies.find((c) => c.startsWith('emf_csrf='))?.split(';')[0].split('=')[1] ?? '';
  expect(csrf).not.toBe('');
  const lk = await admin.get('/api/lookups');
  expect(lk.status).toBe(200);
  lookups = lk.body;
});

describe('quick entries & VAT defaults', () => {
  it('creates an income entry with VAT split and a payment for the receiver', async () => {
    const res = await post('/entries').send({
      entryDate: '2026-11-02',
      modelId: model('REPAIR'),
      description: 'Bench repair',
      grossBeforeDiscountCents: 12550,
      vatInvoice: true,
      vatRateBp: 2550,
      paymentStatus: 'PAID',
      paymentMethodId: method('Bank transfer'),
      receivedById: holder('Company Account'),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.entry.vatCents).toBe(2550);
    expect(res.body.entry.netCents).toBe(10000);
    const payments = await prisma.payment.findMany({ where: { entryId: res.body.entry.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amountCents).toBe(12550);
  });
  it('requires "Amount received by" for received money', async () => {
    const res = await post('/entries').send({
      entryDate: '2026-11-02',
      modelId: model('REPAIR'),
      grossBeforeDiscountCents: 1000,
      vatInvoice: false,
      vatRateBp: 2550,
      paymentStatus: 'PAID',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toMatch(/RECEIVED_BY|VALIDATION/);
  });
  it('discount reduces the base before VAT and records a discount row', async () => {
    const res = await post('/entries').send({
      entryDate: '2026-11-02',
      modelId: model('RENTAL'),
      grossBeforeDiscountCents: 5000,
      discountCents: 500,
      discountReason: 'Autumn promo',
      vatInvoice: true,
      vatRateBp: 2550,
      paymentStatus: 'PAID',
      receivedById: holder('Cash'),
    });
    expect(res.status).toBe(201);
    expect(res.body.entry.grossCents).toBe(4500);
    expect(res.body.entry.vatCents).toBe(914);
    const discounts = await prisma.discountRecord.findMany({ where: { entryId: res.body.entry.id } });
    expect(discounts).toHaveLength(1);
    expect(discounts[0].amountCents).toBe(500);
  });
});

describe('received-by balances and handovers (no escape point)', () => {
  it('tracks holdings and clears them with a handover', async () => {
    await post('/entries').send({
      entryDate: '2026-11-02',
      modelId: model('SPARE_PARTS'),
      description: 'parts cash sale',
      grossBeforeDiscountCents: 10000,
      vatInvoice: false,
      vatRateBp: 2550,
      paymentStatus: 'PAID',
      paymentMethodId: method('Cash'),
      receivedById: holder('Salman'),
    });
    let balances = await admin.get('/api/cash/balances');
    expect(balances.status).toBe(200);
    let salman = balances.body.balances.find((b: { holder: { name: string } }) => b.holder.name === 'Salman');
    expect(salman.holdingCents).toBe(10000);

    const handover = await post('/cash/handovers').send({
      date: '2026-11-03',
      fromHolderId: holder('Salman'),
      toHolderId: holder('Company Account'),
      amountCents: 6000,
      note: 'bank deposit',
    });
    expect(handover.status, JSON.stringify(handover.body)).toBe(201);

    balances = await admin.get('/api/cash/balances');
    salman = balances.body.balances.find((b: { holder: { name: string } }) => b.holder.name === 'Salman');
    expect(salman.receivedCents).toBe(10000);
    expect(salman.handedOverCents).toBe(6000);
    expect(salman.holdingCents).toBe(4000);
  });
  it('refuses overdrawing a holder unless forced', async () => {
    const res = await post('/cash/handovers').send({
      date: '2026-11-03',
      fromHolderId: holder('Salman'),
      toHolderId: holder('Company Account'),
      amountCents: 999999,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OVERDRAWN');
  });
});

describe('POS: stock decrement, split payment, refund restocks', () => {
  let productId = 0;
  let saleId = 0;
  it('sells from stock and decrements it', async () => {
    const product = await post('/products').send({
      nameEn: 'Test brake pad',
      priceCents: 1500,
      costCents: 700,
      vatRateBp: 2550,
      trackStock: true,
      initialStock: 10,
      barcodes: [{ barcode: '4006381333931' }],
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    productId = product.body.product.id;

    const byBarcode = await admin.get('/api/products/barcode/4006381333931');
    expect(byBarcode.status).toBe(200);
    expect(byBarcode.body.product.id).toBe(productId);

    const sale = await post('/pos/sales').send({ modelId: model('SPARE_PARTS') });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    saleId = sale.body.sale.id;
    const line = await post(`/pos/sales/${saleId}/lines`).send({ productId, qty: 2 });
    expect(line.status, JSON.stringify(line.body)).toBe(201);

    const complete = await post(`/pos/sales/${saleId}/complete`).send({
      payments: [
        { methodId: method('Card'), receivedById: holder('Company Account'), amountCents: 2000 },
        { methodId: method('Cash'), receivedById: holder('Ahmed'), amountCents: 1000 },
      ],
    });
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);

    const stock = await prisma.stockMovement.aggregate({ where: { productId }, _sum: { qty: true } });
    expect(stock._sum.qty).toBe(8);
    const entry = await prisma.entry.findFirst({ where: { saleId } });
    expect(entry?.grossCents).toBe(3000);
    expect(entry?.paymentStatus).toBe('PAID');
  });
  it('refund with restock creates a credit note, returns stock and reverses income', async () => {
    const sale = await admin.get(`/api/pos/sales/${saleId}`);
    const lineId = sale.body.sale.lines[0].id;
    const refund = await post(`/pos/sales/${saleId}/refund`).send({
      lines: [{ lineId, qty: 2 }],
      reason: 'customer returned the pads',
      restock: true,
      refundPayments: [{ methodId: method('Cash'), receivedById: holder('Ahmed'), amountCents: 3000 }],
    });
    expect(refund.status, JSON.stringify(refund.body)).toBe(200);
    expect(refund.body.creditNote).toBeDefined();

    const stock = await prisma.stockMovement.aggregate({ where: { productId }, _sum: { qty: true } });
    expect(stock._sum.qty).toBe(10); // restocked
    const entrySum = await prisma.entry.aggregate({
      where: { status: 'ACTIVE', OR: [{ saleId }, { description: { contains: refund.body.creditNote.numberFormatted } }] },
      _sum: { grossCents: true },
    });
    expect(entrySum._sum.grossCents).toBe(0); // original + reversing entry cancel out
  });
});

describe('invoices: Finnish reference, payments, credit note cancels', () => {
  let invoiceId = 0;
  let customerId = 0;
  it('creates a draft with a valid viitenumero', async () => {
    const customer = await post('/customers').send({
      type: 'BUSINESS',
      name: 'Testi Oy',
      businessId: '0244683-1',
      email: 'testi@example.com',
      language: 'FI',
    });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);
    customerId = customer.body.customer.id;

    const invoice = await post('/invoices').send({
      customerId,
      modelId: model('REPAIR'),
      issueDate: '2026-11-03',
      termsDays: 14,
      lines: [{ description: 'Repair work', qty: 1, unitPriceCents: 12550, vatRateBp: 2550 }],
    });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    invoiceId = invoice.body.invoice.id;
    expect(invoice.body.invoice.status).toBe('DRAFT');
    expect(isValidFinnishReference(invoice.body.invoice.referenceNumber)).toBe(true);
    expect(invoice.body.invoice.totalGrossCents).toBe(12550);
    expect(invoice.body.invoice.totalVatCents).toBe(2550);
  });
  it('send creates the INVOICED entry; full payment marks it PAID', async () => {
    const sent = await post(`/invoices/${invoiceId}/send`).send({});
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const entry = await prisma.entry.findFirst({ where: { invoiceId } });
    expect(entry?.paymentStatus).toBe('INVOICED');
    expect(entry?.vatInvoice).toBe(true);

    const payment = await post(`/invoices/${invoiceId}/payments`).send({
      date: '2026-11-04',
      amountCents: 12550,
      methodId: method('Bank transfer'),
      receivedById: holder('Company Account'),
    });
    expect(payment.status, JSON.stringify(payment.body)).toBe(201);
    const after = await admin.get(`/api/invoices/${invoiceId}`);
    expect(after.body.invoice.status).toBe('PAID');
    const entryAfter = await prisma.entry.findFirst({ where: { invoiceId } });
    expect(entryAfter?.paymentStatus).toBe('PAID');
  });
  it('refuses a payment larger than what is still open (typo guard)', async () => {
    const invoice = await post('/invoices').send({
      customerId,
      issueDate: '2026-11-03',
      lines: [{ description: 'Small job', qty: 1, unitPriceCents: 10000, vatRateBp: 2550 }],
    });
    const id = invoice.body.invoice.id;
    await post(`/invoices/${id}/send`).send({});
    const tooMuch = await post(`/invoices/${id}/payments`).send({
      date: '2026-11-04',
      amountCents: 100000,
      receivedById: holder('Company Account'),
    });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.code).toBe('OVERPAYMENT');
    const after = await admin.get(`/api/invoices/${id}`);
    expect(after.body.invoice.paidCents).toBe(0);
  });
  it('a mixed-rate invoice books exactly its per-line VAT (no dominant-rate drift)', async () => {
    const invoice = await post('/invoices').send({
      customerId,
      issueDate: '2026-11-03',
      lines: [
        { description: 'Parts', qty: 1, unitPriceCents: 10001, vatRateBp: 2550 },
        { description: 'Exempt service', qty: 1, unitPriceCents: 4999, vatRateBp: 0 },
      ],
    });
    expect(invoice.status, JSON.stringify(invoice.body)).toBe(201);
    const id = invoice.body.invoice.id;
    expect(invoice.body.invoice.totalVatCents).toBe(2032); // 10001 × 25.5/125.5 = 2032.1 -> 2032
    await post(`/invoices/${id}/send`).send({});
    const entry = await prisma.entry.findFirst({ where: { invoiceId: id } });
    expect(entry?.grossCents).toBe(15000);
    expect(entry?.vatCents).toBe(2032); // a dominant-rate recompute would give 3048
    expect(entry?.netCents).toBe(12968);
  });
  it('a full credit note cancels an unpaid invoice and voids its entry', async () => {
    const invoice = await post('/invoices').send({
      customerId,
      issueDate: '2026-11-03',
      lines: [{ description: 'Wrong charge', qty: 1, unitPriceCents: 5000, vatRateBp: 2550 }],
    });
    const id = invoice.body.invoice.id;
    await post(`/invoices/${id}/send`).send({});
    const credit = await post(`/invoices/${id}/credit-note`).send({ reason: 'billed in error' });
    expect(credit.status, JSON.stringify(credit.body)).toBe(201);
    const after = await admin.get(`/api/invoices/${id}`);
    expect(after.body.invoice.status).toBe('CANCELLED');
    const entry = await prisma.entry.findFirst({ where: { invoiceId: id } });
    expect(entry?.status).toBe('VOID');
  });
});

describe('rentals: entry link and recurring generation', () => {
  let unitId = 0;
  let rentalId = 0;
  it('creates rental + entry together', async () => {
    const unit = await post('/units').send({
      brand: 'Ego Evo 2',
      category: 'E_SCOOTER',
      purchaseDate: '2025-10-01',
      purchaseCents: 65000,
      status: 'AVAILABLE',
    });
    expect(unit.status, JSON.stringify(unit.body)).toBe(201);
    expect(unit.body.unit.code).toBe('EE2-251001');
    unitId = unit.body.unit.id;

    const rental = await post('/rentals').send({
      unitId,
      customerName: 'Test Customer',
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      amountCents: 25100,
      vatInvoice: false,
      paymentStatus: 'PENDING',
      recurring: true,
    });
    expect(rental.status, JSON.stringify(rental.body)).toBe(201);
    rentalId = rental.body.rental.id;
    const entry = await prisma.entry.findFirst({ where: { rentalId } });
    expect(entry?.grossCents).toBe(25100);
    expect(entry?.paymentStatus).toBe('PENDING');
  });
  it('an invoiced rental cannot be marked paid or voided around its invoice', async () => {
    const customer = await post('/customers').send({ type: 'INDIVIDUAL', name: 'Invoiced Renter' });
    const rental = await post('/rentals').send({
      unitId,
      customerId: customer.body.customer.id,
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      amountCents: 25100,
      vatInvoice: false,
      paymentStatus: 'PENDING',
    });
    const rid = rental.body.rental.id;
    const invoice = await post('/invoices').send({
      customerId: customer.body.customer.id,
      rentalId: rid,
      issueDate: '2026-11-01',
      lines: [{ description: 'Rental October', qty: 1, unitPriceCents: 25100, vatRateBp: 2550 }],
    });
    await post(`/invoices/${invoice.body.invoice.id}/send`).send({});
    const markPaid = await admin
      .put(`/api/rentals/${rid}`)
      .set('X-CSRF-Token', csrf)
      .send({ paymentStatus: 'PAID', receivedById: holder('Salman') });
    expect(markPaid.status).toBe(409);
    expect(markPaid.body.error.code).toBe('LINKED_ENTRY');
    const voided = await post(`/rentals/${rid}/void`).send({ reason: 'test' });
    expect(voided.status).toBe(409);
    // descriptive edits still work
    const note = await admin.put(`/api/rentals/${rid}`).set('X-CSRF-Token', csrf).send({ notes: 'keys returned' });
    expect(note.status).toBe(200);
  });
  it('generates the next monthly period once', async () => {
    const next = await post(`/rentals/${rentalId}/generate-next`).send({});
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    expect(next.body.rental.startDate).toBe('2026-12-01');
    const again = await post(`/rentals/${rentalId}/generate-next`).send({});
    expect(again.status).toBe(409);
  });
});

describe('WhatsApp pipeline (simulate): valid, invalid, duplicate, undo', () => {
  it('saves a valid entry and replies with payback', async () => {
    await prisma.setting.update({
      where: { key: 'whatsapp.allowedNumbers' },
      data: { value: ['+358401234567'] },
    });
    const res = await post('/whatsapp/simulate').send({
      from: '+358401234567',
      text: 'RENT | EE2-251001 | 45 | cash | Salman',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.reply).toContain('Saved');
    expect(res.body.reply).toContain('EE2-251001');
    const entry = await prisma.entry.findFirst({
      where: { source: 'WHATSAPP', grossCents: 4500 },
      include: { receivedBy: true },
    });
    expect(entry).not.toBeNull();
    expect(entry!.receivedBy?.name).toBe('Salman');
  });
  it('rejects an invalid message without saving anything', async () => {
    const before = await prisma.entry.count();
    const res = await post('/whatsapp/simulate').send({
      from: '+358401234567',
      text: 'RENT | EE2-251001 | abc | cash | Salman',
    });
    expect(res.status).toBe(200);
    expect(res.body.reply).toMatch(/not an amount/i);
    expect(await prisma.entry.count()).toBe(before);
  });
  it('ignores duplicate webhook deliveries (same wa message id)', async () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.DUPLICATE-1',
                    from: '358401234567',
                    type: 'text',
                    text: { body: 'PART | tube | 12 | cash | Ahmed' },
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
                contacts: [{ profile: { name: 'Ahmed' }, wa_id: '358401234567' }],
              },
            },
          ],
        },
      ],
    };
    const first = await post('/whatsapp/webhook').send(payload);
    expect(first.status).toBe(200);
    const second = await post('/whatsapp/webhook').send(payload);
    expect(second.status).toBe(200);
    const count = await prisma.whatsAppMessage.count({ where: { waMessageId: 'wamid.DUPLICATE-1' } });
    expect(count).toBe(1);
    const entries = await prisma.entry.count({ where: { source: 'WHATSAPP', grossCents: 1200 } });
    expect(entries).toBe(1);
  });
  it('UNDO voids the sender’s last entry', async () => {
    const res = await post('/whatsapp/simulate').send({ from: '+358401234567', text: 'UNDO' });
    expect(res.status).toBe(200);
    const undone = await prisma.entry.findFirst({
      where: { source: 'WHATSAPP', grossCents: 1200 },
    });
    expect(undone?.status).toBe('VOID');
  });
});

describe('part-payments & customer balance by type', () => {
  it('tyre change €125: €100 now, €25 a week later', async () => {
    const cust = await post('/customers').send({ name: 'Tyre Customer', type: 'INDIVIDUAL' });
    expect(cust.status, JSON.stringify(cust.body)).toBe(201);
    const customerId = cust.body.customer.id as number;

    // €125 repair, €100 paid now to Ahmed → stays PENDING, €25 owed
    const created = await post('/entries').send({
      entryDate: '2026-11-03',
      modelId: model('REPAIR'),
      customerId,
      description: 'Tyre change',
      grossBeforeDiscountCents: 12500,
      vatInvoice: false,
      vatRateBp: 2550,
      paymentStatus: 'PENDING',
      paidNowCents: 10000,
      receivedById: holder('Ahmed'),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const entryId = created.body.entry.id as number;
    expect(created.body.entry.paymentStatus).toBe('PENDING');
    let payments = await prisma.payment.findMany({ where: { entryId, status: 'ACTIVE' } });
    expect(payments.map((p) => p.amountCents)).toEqual([10000]);

    // the customer list and the by-type dropdown show only the €25 still owed
    const list = await admin.get('/api/customers?q=Tyre%20Customer');
    expect(list.body.customers[0].outstandingCents).toBe(2500);
    let balance = await admin.get(`/api/customers/${customerId}/balance`);
    expect(balance.status).toBe(200);
    const repair = balance.body.byModel.find((b: { model: { code: string } }) => b.model.code === 'REPAIR');
    expect(repair).toMatchObject({ chargedCents: 12500, receivedCents: 10000, owedCents: 2500 });
    const codes = balance.body.byModel.map((b: { model: { code: string } }) => b.model.code);
    expect(codes).toEqual(expect.arrayContaining(['RENTAL', 'REPAIR', 'SPARE_PARTS', 'MISC']));
    expect(balance.body.openItems).toHaveLength(1);
    expect(balance.body.openItems[0]).toMatchObject({ entryId, owedCents: 2500, receivedCents: 10000 });

    // paying more than is owed is refused
    const over = await post(`/entries/${entryId}/payments`).send({ amountCents: 3000, receivedById: holder('Salman') });
    expect(over.status).toBe(400);
    expect(over.body.error.code).toBe('OVERPAYMENT');

    // the remaining €25 a week later (to Salman) → PAID, payments add up to €125
    const rest = await post(`/entries/${entryId}/payments`).send({
      amountCents: 2500,
      receivedById: holder('Salman'),
      date: '2026-11-10',
    });
    expect(rest.status, JSON.stringify(rest.body)).toBe(201);
    expect(rest.body.entry.paymentStatus).toBe('PAID');
    payments = await prisma.payment.findMany({ where: { entryId, status: 'ACTIVE' }, orderBy: { id: 'asc' } });
    expect(payments.map((p) => p.amountCents)).toEqual([10000, 2500]);
    expect(payments.map((p) => p.receivedById)).toEqual([holder('Ahmed'), holder('Salman')]);
    balance = await admin.get(`/api/customers/${customerId}/balance`);
    expect(balance.body.totals.owedCents).toBe(0);
    expect(balance.body.openItems).toHaveLength(0);
  });

  it('"Mark paid" on a part-paid entry books only the remainder', async () => {
    const created = await post('/entries').send({
      entryDate: '2026-11-04',
      modelId: model('MISC'),
      customerName: 'Walk-in',
      grossBeforeDiscountCents: 5000,
      vatInvoice: false,
      vatRateBp: 2550,
      paymentStatus: 'PENDING',
      paidNowCents: 2000,
      receivedById: holder('Cash'),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const entryId = created.body.entry.id as number;
    const paid = await post(`/entries/${entryId}/mark-paid`).send({ receivedById: holder('Company Account') });
    expect(paid.status, JSON.stringify(paid.body)).toBe(200);
    const payments = await prisma.payment.findMany({ where: { entryId, status: 'ACTIVE' }, orderBy: { id: 'asc' } });
    expect(payments.map((p) => p.amountCents)).toEqual([2000, 3000]);
  });

  it('paying the whole amount "now" simply makes the entry paid', async () => {
    const created = await post('/entries').send({
      entryDate: '2026-11-04',
      modelId: model('SPARE_PARTS'),
      grossBeforeDiscountCents: 1500,
      vatInvoice: false,
      vatRateBp: 2550,
      paymentStatus: 'PENDING',
      paidNowCents: 1500,
      receivedById: holder('Cash'),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.entry.paymentStatus).toBe('PAID');
  });
});
