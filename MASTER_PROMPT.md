# E Motion Works Oy — master build specification

> This file is the client/project owner's build specification, kept in the repo for reference.
> The two source files live in `data/source/` (Excel) and were delivered alongside a requirements PDF.
> Where this document and the PDF disagree, this document wins. See `docs/ASSUMPTIONS.md`
> for every decision made during implementation.

The full specification covers: role & working rules; tech stack (pnpm monorepo, React 18 + Vite,
Express + Prisma + PostgreSQL 16, pdfmake/ExcelJS, WhatsApp Cloud API, Google Sheets, pg-boss);
business context (models: Rental, Repair & maintenance, Spare parts, Unit sales, Contract work);
VAT rules (25.5 % gross-inclusive, VAT-invoice flag, reclaimable input VAT, payable = collected −
reclaimable); "Amount received by" on every income + cash-holder ledger with handovers; unit IDs
(prefix + YYMMDD) and payback; partners/investments/salaries (50/50 after salaries); expenses and
corporate tax (20 % → 18 % from 2027); discounts; rentals incl. recurring; modules 4.1–4.14
(auth/roles/audit, dashboard with growth-by-time, quick entry, WhatsApp entry, Google Sheet sync,
inventory, POS with barcode scanning, invoicing with Finnish requirements incl. viitenumero,
customers, expenses, warranty claims, contract work, reports, settings); data model; Excel import
with reconciliation against the Calc sheet; security & quality; UI; deliverables; build phases.
