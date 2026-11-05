# Assumptions and decisions

Every decision made without asking, with the reasoning. Items marked **⚠ confirm** need the
client's (or accountant's) explicit confirmation.

## Platform & stack

1. **Node 22 instead of Node 20.** The dev machine runs Node 22; everything targets `>=20`
   (`engines`), and the Docker images use Node 20 LTS, so production matches the spec.
2. **Express 4.21 (not 5).** The spec allowed Express; v4 chosen for maximum middleware
   ecosystem stability.
3. **bcryptjs (pure JS) instead of native bcrypt/argon2**, cost 12 — no native build steps on
   the client's cheap VPS or on Windows; at this user count the performance difference is irrelevant.
4. **pdfmake instead of Puppeteer** for PDFs (invoices, reports, dashboard export, labels) —
   the spec allowed it, and it avoids a ~300 MB Chromium per container (startup budget).
   Charts in PDFs are rendered as SVG with value labels.
5. **pg-boss (Postgres-backed queue) instead of BullMQ/Redis** — one less service to pay for
   and operate; the spec suggested exactly this trade.
6. **Development/test database runs on Neon (managed Postgres 16)**; production ships with
   `docker-compose.yml` including its own Postgres 16 container. The app only sees `DATABASE_URL`.
7. **UI kit**: shadcn/ui-style components implemented on native HTML controls (no Radix
   packages) — same look, fewer dependencies, and native controls keep keyboard accessibility.
8. **i18n**: per-page namespace JSON files auto-discovered (`src/locales/<lang>/<ns>.json`),
   so pages never edit a shared translation file.
9. **Internal barcodes** use the format `EMF000123` (Code128). EAN-13 checksums are validated
   on entry.
10. **Role model**: ADMIN (owners), STAFF (POS + entries; no settings, partner data, cash
    ledger or audit), ACCOUNTANT (read-only everything + exports; may change own password).
    Accountant writes are blocked globally in middleware.

## Money, VAT & P&L

11. **All money is integer euro cents**; VAT rates are basis points (2550 = 25.5 %).
    Rounding: half away from zero, per line, documented in `packages/shared/src/money.ts`.
12. **VAT-invoice default is decided by WHO received the money** (setting `vatDefaults.byHolder`:
    Company Account → Yes, Ahmed/Salman/Cash → No), then by payment-method default; the user can
    always override, and the UI shows the accountant-must-confirm warning. **⚠ confirm** the
    default mapping with the accountant.
13. **Cash-basis P&L (no separate COGS line).** Spare-part purchases are expenses when bought
    (exactly like the client's Excel); selling from stock does not additionally subtract cost of
    goods sold. The stock value report still shows what the shelf is worth. If the accountant
    wants accrual COGS later, the stock movements already carry the data. **⚠ confirm**.
14. **Undated expenses count in every period** until they are dated (they are flagged
    "needs review"). The Excel behaves the same way — its cost sums have no date filter.
15. **Unit purchases are capital investment by default** (`pnl.countUnitPurchasesAsCost=false`),
    reproducing the Excel toggle. Units with no purchase date count in all periods (same logic
    as undated expenses).
16. **Shared costs** (tools, parts, rent…) are shown only when no unit/segment filter is active —
    the Excel's "shared costs in scope" rule. Optional allocation by revenue share is the
    `pnl.allocateSharedCostsByRevenue` setting; when off, the P&L-by-model chart shows one red
    "Shared costs" bar instead of pretending costs belong to a model.
17. **Partner salaries** count as an expense for each calendar month whose first day falls in
    the selected period (effective-dated monthly amounts). No salaries are seeded — set them in
    Settings → Salaries. Profit is split 50/50 after salaries; an odd cent goes to the first partner.
18. **"Orders" counts every income entry** (each rental period, each sale). The Excel counted
    only the 5 rows that had an order number plus 10 rentals (15) although ~31 sale rows carry
    revenue — the system's count is the truthful one. All € totals still match the Excel exactly
    (enforced by `apps/api/test/import-reconciliation.test.ts`).

## Rentals, entries, POS, invoices

19. **Every income is one `Entry` row** (the income ledger). Rentals/sales/invoices create or
    update their entry inside the same transaction. "Amount received by" is mandatory whenever
    money is actually received, and each receipt writes a `Payment` row — the holder ledger is
    the sum of payments minus handovers (the "no escape point").
20. **Rental rows with no payment status import as Pending** (so Outstanding matches the Excel's
    "billed − received" definition, which included the unstatused 130 € row). Spec 3.7's
    "Outstanding = Invoiced + Pending" then gives the same number.
21. **POS cart discounts** are distributed across lines proportionally (largest-remainder, so the
    cents add up exactly), and VAT is computed per line on the discounted price.
22. **POS refunds / invoice credit notes** create a reversing negative entry (and negative payment
    rows), so every aggregate stays a plain sum over entries. Restocking is optional per refund.
23. **An invoice is always a VAT invoice** (`vatInvoice=true` on its entry). Sending an invoice
    for a rental UPDATES the rental's existing entry to Invoiced instead of creating a second
    income row (no double counting).
24. **Invoice numbering**: gap-free sequence from the DB (`number_sequences`), formatted
    `2026-0001`; Finnish reference number generated with the 7-3-1 check digit. **⚠ confirm**
    Business ID (Y-tunnus), VAT number, address and IBAN/BIC in Settings → Company before
    sending real invoices (seeded empty on purpose).
25. **Late-interest text** defaults to "according to the Finnish Interest Act (korkolaki)" in
    EN/FI — editable in Settings. **⚠ confirm** exact wording with the accountant.

## Excel import (see also the in-app import report)

26. **Source of truth = the clean tabs** (Rental/Sales/Cost/Unit Data). The original tabs
    (RENTAL, PURCHASES, …) are not imported — the workbook's own Notes sheet documents the
    discrepancies between them.
27. **All imported income is non-VAT** (the workbook has no VAT data). Rows the source marks
    "invoice sent" / "vat inclusive" are imported that way too but flagged — **⚠ confirm** their
    VAT treatment with the accountant before filing.
28. **No purchase dates exist in the source**, so every unit gets a provisional
    `<PREFIX>-DRAFT<n>` ID and a review flag; set the purchase date in the app to get the real
    `EE2-251001`-style ID.
29. **Unit owner = the partner who paid** (the source has no owner column). Editable per unit.
30. **"EGO EVO -2"** appears in rentals but not on Unit Data — imported as a review-flagged unit
    so its 251 € rental stays visible (the Excel's own unit table silently missed it).
31. **Unit-sale rows** (Sales Data "unit sold") are recorded under the **Unit sales** model, not
    "Spare parts" as the Excel lumped them. Totals still reconcile; the tabs disagree about the
    actual sale prices (500 vs 1380, 660 vs 700) — imported as the amount column says and
    flagged. **⚠ confirm** the real prices.
32. **Undated sales rows** get entry date 2026-08-01 (earliest business month) and a review flag;
    totals match the Excel, monthly-chart placement is approximate until real dates are set.
33. **Paid rows with no "received by"** import as Paid but create NO ledger money for anyone —
    flagged instead (no invented cash). The Excel notes name the likely receivers; fix them in
    the app after confirming.
34. **Suspected duplicates** (Ali Express 88.10 ×2, 59.72 ×2) and the returned-harness row are
    imported as recorded and flagged, exactly as the workbook's Notes sheet recommends.
35. **Customer phone numbers are not imported** (GDPR; the clean tabs deliberately omit them).
    Sales buyers stay free-text names; rental customers become customer records (they recur).

## Integrations

36. **WhatsApp**: official Cloud API only, 1-to-1 messages with the company number (no group
    ingestion — Meta's API does not read arbitrary group chats; `whatsapp.groupFeatureFlag`
    reserved). Without credentials configured the module runs in log-only mode and the admin
    "simulate" endpoint lets you test the full pipeline. **⚠ requires** Meta Business
    verification — see docs/WHATSAPP_META_COMPLIANCE.md.
37. **Google Sheets sync** is one-way (DB → sheet), full rewrite per sync, 30-min schedule +
    manual button; disabled until a service-account key and sheet ID are configured.
38. **Email** goes through an outbox table; with no SMTP configured, mails wait visibly in the
    outbox instead of failing silently.

## Invoices, POS and money rules settled during the build

40. **Reference number (viitenumero) base = year + 4-digit sequence** (e.g. invoice 2026-0001 →
    base `20260001` + 7-3-1 check digit). Unique across years; the standard needs ≥ 3 digits.
41. **Mixed VAT rates are booked exactly.** A sale or invoice can mix 25.5 % and 0 % lines; its
    income entry stores the exact sum of per-line VAT (never re-split at one rate), so the VAT
    report ties out to the cent with receipts and invoices. Refunds and credit notes likewise.
42. **Credit notes:** a full credit cancels the invoice (and voids its payments when money is
    returned). Partial credits reduce what is owed and are tracked per line, so the same item
    cannot be credited (or restocked) twice. After a partial credit, a "full" credit is refused —
    credit the remaining lines explicitly.
43. **Outstanding = invoice total − credit notes − payments** everywhere (lists, PDFs, reminder
    emails). Payments larger than what is still open are refused (typo guard).
44. **Once a rental is invoiced, the invoice owns its money.** Marking that rental paid or voiding it
    is refused — record the payment on the invoice or issue a credit note. Notes etc. stay editable.
45. **Staff cannot lower a product's price on a POS line** — they give a discount instead, which is
    recorded with a reason and limited by their personal discount cap. Owners may override prices.
46. **Staff see operational numbers but no partner data:** salaries are folded into "Other" in
    their dashboard, the 50/50 profit split is hidden, and dashboard export is for owners and the
    accountant only.
47. **Partners screen:** invested capital and cash holdings are all-time figures; collected money,
    salaries and profit follow the selected period. Undated legacy expenses count in every period —
    the same rule as the dashboard and P&L report, so all three show the same profit.
48. **VAT report counts only dated purchases** (a VAT return is per period). Undated legacy
    expenses are shown as a separate note. **⚠ action:** date the imported purchases (and mark
    valid receipts) so their VAT can be reclaimed in the right period.
49. **Expenses filed under "Unit purchases" are capital** like the units table: excluded from
    operating costs, included in profit only when the "count unit purchases as cost" toggle is on.
50. **Cost of goods sold is 0 by design** (cash basis — parts are expensed when bought, exactly as
    in the Excel). The stock value report still shows what the shelf is worth.
51. **Unit "earned" excludes the unit's own sale** (the sale price is tracked separately), so
    payback and the lifetime result never count the sale twice.
52. **Imported "paid" rows with no recorded receiver** count as received on the dashboard (as in the
    Excel) but create no cash-holder balance — the system never invents who holds money. Assign the
    receiver in the app once confirmed.
53. **The Excel import is all-or-nothing** (one database transaction) and the same workbook cannot be
    imported twice (content hash check) — a second import would double every amount.
54. **GDPR erasure** anonymises the customer, the name copies on their rentals/entries, and the
    personal content of their audit-log rows (the fact that a change happened is kept). Financial rows
    are kept for the 6-year bookkeeping period.
55. **Sessions:** a deactivated or demoted user loses access within seconds (role re-checked on each
    request), not when their 15-minute token expires. Refresh tokens are strictly single-use.
56. **Login is rate-limited** (10 attempts per 15 minutes per IP). The E2E tests therefore sign in
    once per run and share the session.

## Usage-limit resilience (how this build survives interruptions)

39. Long-running builds execute as **resumable workflows**: every agent's result is journaled,
    and re-launching with `resumeFromRunId` replays finished work from cache and re-runs only
    what was cut off. This is exactly how the first backend wave resumed after a usage-limit
    stop with zero lost work.
