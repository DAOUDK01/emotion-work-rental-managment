import { prisma } from '../src/db.js';

/** Wipe all DATA tables (keeps seeded vocabulary: users, settings, rates, models,
 *  holders, methods, categories, prefixes, number sequences). */
export async function resetDataTables(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      payments, discounts, credit_note_lines, credit_notes, invoice_lines, invoices,
      sale_lines, sales, stock_movements, entries, rentals, expenses, investments,
      cash_handovers, whatsapp_messages, warranty_claims, contract_jobs, contracts,
      attachments, product_barcodes, products, suppliers, units, customers,
      import_batches, email_outbox, sync_log, audit_log, salaries
    RESTART IDENTITY CASCADE
  `);
}
