# API contract — every endpoint, request and response shape

All routes are under `/api`. Auth via httpOnly cookies; mutating requests send `X-CSRF-Token`
(value of the `emf_csrf` cookie). Amounts = integer cents. Dates = `YYYY-MM-DD`.
Lists: `?page=1&pageSize=50` → `{ <plural>, total, page, pageSize }`, newest first unless noted.
Errors: `{ error: { code, message, details? } }`.

Already implemented (do not touch): `/auth/*`, `/users`, `/settings`, `/lookups`, `/vocab/*`, `/attachments`.

## /units  (ADMIN, STAFF; list also ACCOUNTANT)
- `GET /units?status=&category=&q=&includeInactive=` → `{ units: [{ id, code, brand, modelName, category, inclusions, purchaseDate, sellerName, purchaseCents, owner, paidBy, status, notes, needsReview, reviewReason, soldCents, soldDate, earnedCents, partsCents, paybackPct, paidBack, remainingCents, saleProfitCents, lifetimeCents }], total }`
  — `earnedCents` = Σ active entries.netCents of the unit; `partsCents` = Σ REPAIR_USE movement qty×unitCost (abs);
  payback via shared `paybackPct(earned − optional parts, purchaseCents)` honouring setting `units.subtractRepairPartsFromPayback`.
- `GET /units/compare` → `{ byCategory: [{ category, unitCount, costCents, earnedCents, paybackPct }] }`
- `GET /units/:id` → `{ unit }` with same computed fields + `entries` (last 20) + `attachments`.
- `POST /units` body `{ brand, modelName?, category: 'E_SCOOTER'|'E_BIKE'|'MOPED', inclusions?, purchaseDate?, sellerName?, purchaseCents?, ownerId?, paidById?, status?, notes?, codeOverride? }`
  → generates `code` = prefix (match brand to unit_prefixes, else first word uppercased ≤4 chars) + `-` + YYMMDD(purchaseDate), suffix `-2`,`-3`… on collision; `codeOverride` wins (must be unique). No purchaseDate → code `<PREFIX>-DRAFT<n>`, `needsReview: true`, reason "Purchase date missing — ID provisional".
  Paid by a PARTNER holder → create Investment { category: UNITS, holderId: paidById, amountCents: purchaseCents, unitId, auto: true, date: purchaseDate ?? today }.
- `PUT /units/:id` (same fields) — if purchaseDate set on a DRAFT-coded unit, regenerate code (keep override). Recreate/adjust the auto Investment when purchase fields change.
- `POST /units/:id/sell` body `{ soldCents, soldDate, buyerCustomerId?, buyerName?, receivedById, paymentMethodId?, vatInvoice? }` → sets status SOLD + sale fields, creates Entry (model UNIT_SALES, PAID, description "Unit <code> sold"); response includes `saleProfitCents`.
- `POST /units/:id/void` body `{ reason }` → active:false (audit; only ADMIN).

## /customers  (ADMIN, STAFF; ACCOUNTANT read)
- `GET /customers?q=&type=&archived=` → `{ customers: [{ …, phone (ADMIN only — omit the field for others), outstandingCents, rentalCount, invoiceCount }], total }`
- `GET /customers/:id` → `{ customer, rentals: last 20, invoices: last 20, entries: last 20, outstandingCents }` (phone ADMIN only)
- `POST /customers` `{ type, name, businessId?, email?, phone?, address?, postalCode?, city?, country?, language?, notes? }` — validate businessId with shared `isValidBusinessId` when type BUSINESS and businessId given (warn-level: accept but include `businessIdValid` in response).
- `PUT /customers/:id`, `POST /customers/:id/archive` `{ archived }`.

## /rentals  (ADMIN, STAFF; ACCOUNTANT read)
- `GET /rentals?status=&paymentStatus=&unitId=&customerId=&from=&to=&q=` → `{ rentals: [{ id, unit:{id,code,brand}, customer?, customerName, handOverDate, startDate, endDate, periodText, amountCents, depositCents, recurring, agreementSigned, notes, paymentStatus, receivedBy?, vatInvoice, entryId, needsReview, source }], total }` (paymentStatus/receivedBy/vatInvoice read from the linked entry)
- `GET /rentals/:id` → `{ rental }` + entry + attachments + child rentals.
- `POST /rentals` `{ unitId, customerId?|customerName?, handOverDate?, startDate, endDate?, periodText?, amountCents, depositCents?, discountCents?, discountReason?, vatInvoice?, vatRateBp?, paymentStatus, paymentMethodId?, receivedById?, recurring?, agreementSigned?, notes? }`
  → transaction: create Rental + `createEntry` (model RENTAL, unitId, dates: entryDate = startDate) ; unit status → ON_RENT when currently AVAILABLE. vatInvoice default from `defaultVatInvoice(receivedById, paymentMethodId)`; vatRateBp default `vatRateOn(startDate)`.
- `PUT /rentals/:id` — may update fields; amount/VAT/status changes re-write the linked entry (recompute via same rules; keep entry id). Mark paid: `paymentStatus: 'PAID'` requires `receivedById` → creates the Payment row (via entry service logic replicated in module service `markEntryPaid`).
- `POST /rentals/:id/generate-next` → creates next month's rental (startDate = +1 month span, same amount/customer/unit, paymentStatus NOT_YET_BILLED, parentId = series root) and returns it. Guard: refuse when a child already covers that period.
- Recurring job (`jobs.ts` `handleRecurringRentalsJob`): for each ACTIVE rental with `recurring=true` whose period has ended (endDate or startDate+1month < today) and no child for the next period → generate next (like above), source SYSTEM.
- `POST /rentals/:id/void` `{ reason }` → void rental + `voidEntry`.

## /entries  (quick entry web form; ADMIN, STAFF; ACCOUNTANT read)
- `GET /entries?from=&to=&modelId=&unitId=&customerId=&receivedById=&paymentStatus=&vatInvoice=&source=&needsReview=&q=` → `{ entries: [{ id, entryDate, model:{id,code,nameEn,nameFi}, unit?, customer?/customerName, description, grossCents, discountCents, vatInvoice, vatRateBp, vatCents, netCents, paymentStatus, paymentMethod?, receivedBy?, source, status, needsReview, reviewReason }], total, sums: { grossCents, vatCents, netCents, nonVatCents } }`
- `POST /entries` `{ entryDate, modelId, unitId?, customerId?|customerName?, description?, grossBeforeDiscountCents, discountCents?, discountReason?, vatInvoice?, vatRateBp?, labourCents?, partsCents?, paymentStatus, paymentMethodId?, receivedById?, needsReview? }` → `{ entry, unitPayback? }` — unitPayback `{ code, earnedCents, costCents, remainingCents, paybackPct }` when unitId given. Defaults: vatInvoice via `defaultVatInvoice`, vatRateBp via `vatRateOn(entryDate)`. source WEB.
- `PUT /entries/:id` — allowed while not linked to sale/invoice: recompute everything (delete+recreate discount record, adjust payment rows to match status/receiver).
- `POST /entries/:id/void` `{ reason }`.
- `POST /entries/:id/mark-paid` `{ receivedById, paymentMethodId?, date? }` → status PAID + Payment row.
- `GET /entries/preview?gross=&discount=&vatInvoice=&rateBp=` → `{ grossCents, discountCents, vatCents, netCents, nonVatCents }` (uses shared incomeVat; for the live form preview).

## /expenses  (ADMIN, STAFF; ACCOUNTANT read)
- `GET /expenses?from=&to=&categoryId=&paidById=&unitId=&needsReview=&q=` → `{ expenses: […, { category, paidBy, reclaimableVatCents, attachments: [{id,fileName}] }], total, sums: { grossCents, reclaimableVatCents } }`
- `POST /expenses` `{ expenseDate?, categoryId, description, vendor?, qtyText?, grossCents?, vatRateBp?, hasValidReceipt?, businessUsePct?, paidById?, jointReinvested?, unitId?, productId?, stockQty?, purchasedFor?, notes? }`
  → recompute `reclaimableVatCents`; duplicate warning: response `{ expense, duplicates: [{id, expenseDate, vendor, grossCents}] }` listing ACTIVE expenses with same vendor+grossCents and date within ±3 days (or same null date). When `productId` + `stockQty` → StockMovement PURCHASE qty=+stockQty unitCost=gross/qty, update product costCents. Investment auto-rows per CONVENTIONS (partner personal spend / jointReinvested).
- `PUT /expenses/:id` — recompute reclaim + investments (replace auto investment rows of this expense).
- `POST /expenses/:id/void` `{ reason }` — voids auto investments, reverses its stock movement (create opposite ADJUSTMENT movement, reason "expense voided").
- `GET /expenses/duplicates` → groups of suspected duplicates (same vendor+amount, dates within 3 days).

## /investments  (ADMIN only; ACCOUNTANT read)
- `GET /investments?from=&to=&holderId=&category=&isJoint=` → `{ investments: […, holder?, expense?, unit?], total, sums: { byHolder: [{holder, totalCents}], jointCents } }`
- `POST /investments` `{ date, holderId?|isJoint, category, amountCents, note?, unitId?, expenseId? }` (manual rows, e.g. Cash injected)
- `PUT /investments/:id`, `POST /investments/:id/void` `{ reason }` (manual rows only; auto rows follow their expense/unit).

## /cash  (ADMIN; ACCOUNTANT read) — "Cash & settlements"
- `GET /cash/balances` → `{ balances: [{ holder: {id,name,kind}, receivedCents, handedOverCents, holdingCents, oldestUnsettledDate, overdueAlert }], alertAfterDays }`
  — per non-COMPANY holder: received = Σ active payments; handedOver = Σ active handovers from holder; holding = received − handedOver; overdueAlert when oldest unsettled receipt older than setting `cash.alertAfterDays`. Company row: received direct + handovers in.
- `GET /cash/ledger?holderId=&from=&to=` → merged, dated list `{ rows: [{ date, kind: 'RECEIPT'|'HANDOVER_OUT'|'HANDOVER_IN', amountCents, counterparty, description, link: {entryId?|saleId?|invoiceId?|handoverId} }], total }`
- `POST /cash/handovers` `{ date, fromHolderId, toHolderId, amountCents, note? }` → `{ handover, balances }` (validate amount ≤ current holding + warn code OVERDRAWN otherwise — allow with `force:true`).
- `GET /cash/handovers` list; `POST /cash/handovers/:id/void` `{ reason }`.

## /products + /stock  (ADMIN, STAFF; ACCOUNTANT read)
- `GET /products?q=&category=&active=&lowStock=` → `{ products: […, { stockQty, stockValueCents, barcodes: [{barcode,type}], lowStock }], total }` (stockQty = Σ movements; services trackStock=false → stockQty null)
- `GET /products/:id` → `{ product, movements: last 50 }`
- `GET /products/barcode/:code` → `{ product }` or 404 `{ error: { code: 'UNKNOWN_BARCODE' } }` — matches ProductBarcode.barcode OR shared `parseInternalProductCode` → product id.
- `POST /products` `{ sku?, nameEn, nameFi?, category?, brand?, compatibleUnits?, costCents?, priceCents, wholesaleCents?, vatRateBp?, trackStock?, reorderLevel?, location?, supplierId?, barcodes?: [{barcode,type?}], initialStock?, active? }` — sku auto `P-000123` if missing; `initialStock` → IMPORT movement. Barcode validation: EAN13 via shared `isValidEan13` (reject invalid checksums with code BAD_EAN13).
- `PUT /products/:id` (same, barcodes replaced when provided), `POST /products/:id/barcodes` add one, `DELETE /products/:id/barcodes/:barcodeId`.
- `GET /products/:id/label?qty=` → PDF (Content-Type application/pdf) with Code128 labels (bwip-js SVG → pdfmake), internal code when no barcode.
- `POST /stock/receive` `{ productId, qty, unitCostCents?, supplierId?, shippingCents?, customsCents?, importVatCents?, notes? }` → PURCHASE movement + update product.costCents (per unit incl. landed share).
- `POST /stock/adjust` `{ productId, qty (signed), reason, notes? }` (reason required)
- `POST /stock/repair-use` `{ productId, qty, unitId?, notes? }` → REPAIR_USE movement qty=−qty.
- `GET /stock/movements?productId=&type=&from=&to=` list.
- `GET /stock/low` → products at/below reorderLevel. `GET /stock/value` → `{ totalCents, byCategory: [...] }` (Σ qty×costCents).
- Suppliers: `GET/POST/PUT /products/suppliers[/:id]` minimal CRUD.

## /pos  (ADMIN, STAFF)
- `POST /pos/sales` `{ modelId, customerId?, unitId?, businessDate?, notes? }` → creates PARKED sale with `number` `R-000123` (nextNumber RECEIPT) → `{ sale }` (with lines []).
- `GET /pos/sales?status=&date=` (status default PARKED) → parked/held sales list; `GET /pos/sales/:id` → `{ sale: { …, lines, payments } }`.
- `POST /pos/sales/:id/lines` `{ productId?|description, qty, unitPriceCents?, discountCents?|discountPct?, discountReason?, vatRateBp?, isLabour? }` — product line: price/vat default from product; scanning same product again → caller may instead `PUT …/lines/:lineId` qty+1. Line totals via shared splitGross on (qty×price − discount). Stock NOT moved yet (only on completion).
- `PUT /pos/sales/:id/lines/:lineId`, `DELETE …/lines/:lineId` (recompute sale totals each time).
- `PUT /pos/sales/:id` `{ cartDiscountCents?|cartDiscountPct?, cartDiscountReason?, customerId?, unitId?, modelId?, notes? }` — staff discount cap: line+cart discount total ≤ user.maxDiscountPct% of subtotal, else 403 DISCOUNT_LIMIT.
- `POST /pos/sales/:id/complete` `{ payments: [{ methodId?, receivedById, amountCents, changeCents? }], vatInvoice? }` — validates Σ payments − change = total; transaction: sale COMPLETED (+completedAt), SALE stock movements (qty −line.qty for tracked products; insufficient stock → 409 OUT_OF_STOCK with details, `force:true` overrides), Entry (model = sale.modelId, PAID, receivedById = first payment's receiver, gross = totalGross, discount = Σ line+cart discounts) + Payment rows per split, DiscountRecords via entry+cart lines. vatInvoice default `defaultVatInvoice(firstReceiver, firstMethod)`.
- `POST /pos/sales/:id/park` (no-op status PARKED already — used to re-park an edited sale), `DELETE /pos/sales/:id` → VOID a parked sale.
- `POST /pos/sales/:id/refund` `{ lines: [{ lineId, qty }], reason, restock, refundPayments: [{ methodId?, receivedById, amountCents }] }` → credit note (nextNumber CREDIT_NOTE, numberFormatted `CN-2026-0001`) + RETURN movements when restock + negative Payment rows (amountCents < 0) + sale status REFUNDED (full) — also voids/adjusts? Keep original entry, create reversing Entry (negative gross, model same, description "Refund R-000123", source POS)? NO — reversing entries complicate sums; instead credit note reduces: create Entry with negative grossCents linked to nothing? Decision: create a reversing Entry (negative amounts) with `description: 'Credit note CN-… for R-…'` — dashboards then stay a pure Σ over entries. Response `{ creditNote, receiptPdfUrl }`.
- `GET /pos/z-report?date=` → `{ date, totals: { salesCount, grossCents, vatCents, netCents, discountCents }, byModel: [...], byMethod: [...], byReceiver: [...], refunds: {...} }` (COMPLETED sales of that businessDate; also as PDF with `?format=pdf`).
- `GET /pos/sales/:id/receipt?width=80|58&format=pdf|html` → thermal receipt (HTML with print CSS sized to roll width, or pdfmake PDF A4 when `format=pdf&a4=1`). Company details from settings; VAT breakdown per rate; EN/FI by customer language (default EN).

## /invoices  (ADMIN, STAFF; ACCOUNTANT read)
- `GET /invoices?status=&customerId=&overdue=&from=&to=&q=` → `{ invoices: […, { customer, totalGrossCents, paidCents, dueDate, isOverdue, referenceNumber }], total, sums }`
- `GET /invoices/:id` → `{ invoice: { …, lines, payments, creditNotes, entry } }`
- `POST /invoices` `{ customerId, modelId?, unitId?, rentalId?, language?, issueDate, deliveryDate?, periodText?, termsDays?, dueDate?, notes?, lines: [{ productId?|description, qty, unitPriceCents, discountCents?, discountReason?, vatRateBp?, isLabour? }] }` → DRAFT; number/numberFormatted/reference (`makeFinnishReference(number)`) assigned at creation; dueDate default issueDate+termsDays; totals computed per line (splitGross after discount). Language default from customer.
- `PUT /invoices/:id` (DRAFT only) — replace lines, recompute.
- `POST /invoices/:id/send` `{ email? }` → status SENT; creates the Entry (model: invoice.modelId ?? SPARE_PARTS, paymentStatus INVOICED, gross totals, customer, unit, vatInvoice TRUE always — an invoice IS a VAT invoice) + marks rental (when rentalId) entry superseded: if the invoice was made FROM a rental that already has an entry, instead UPDATE that rental entry to INVOICED and link invoiceId (no duplicate income!). When `email` given (or customer.email): render PDF, store as attachment, queueEmail with invoice attached; response `{ invoice, emailQueued }`.
- `POST /invoices/:id/payments` `{ date, amountCents, methodId?, receivedById, reference? }` → Payment row; paidCents cache; status → PARTIALLY_PAID or PAID (and entry.paymentStatus follows).
- `POST /invoices/:id/credit-note` `{ reason, lines?: subset like refund, restock? }` → credit note PDF-able; full credit → invoice CANCELLED + entry voided (or negative entry when partial — same rule as POS refunds: partial credit creates reversing negative Entry).
- `GET /invoices/:id/pdf?format=a4|thermal&width=80` → invoice document (A4 pdfmake PDF; thermal = HTML print CSS). Finnish-law content: seller name+Business ID+VAT number+address, buyer, invoice number/date, delivery/period, due date+terms, per-rate VAT breakdown, reference number formatted, IBAN/BIC, late-interest text, EN/FI by invoice.language. Reprint always allowed.
- `GET /invoices/overdue` → list + `POST /invoices/:id/remind` → reminder email (queue; audit SEND).
- Credit notes list: `GET /invoices/credit-notes?from=&to=`; `GET /invoices/credit-notes/:id/pdf`.
- Jobs: `handleInvoiceOverdueJob` — daily: no status change needed (derived), but queue reminder emails for invoices overdue ≥ settings.invoice.reminderDays without a reminder in last reminderDays (track via audit or add sentAt logic — use EmailOutbox existence check by subject tag `[Reminder <numberFormatted>]`).

## /dashboard  (all roles)
Query params everywhere: `from,to` (required), `modelId?`, `unitId?`, `segment?` (INDIVIDUAL|BUSINESS), `receivedById?`.
- `GET /dashboard/summary` → `{ kpis: { totalSalesCents, receivedCents, outstandingCents, outstandingCustomers, expensesCents, netProfitCents, profitMarginPct, vatPayableCents, vatCollectedCents, vatReclaimableCents, nonVatIncomeCents, discountsCents, discountCount, orders, rentalOrders, salesOrders, avgOrderCents, rentalPaybackPct, taxEstimateCents, profitAfterTaxCents }, revenueByModel: [{ model, grossCents, receivedCents, outstandingCents }], profitByModel: [{ model, profitCents }] (shared costs allocated per setting pnl.allocateSharedCostsByRevenue — default: only "All models" view shows shared costs; per-model shows model revenue − model-linked costs), monthlyTrend: [{ key, label, receivedCents, outstandingCents }] (6 months), revenueByChannel: [{ label, grossCents }] (Rental / Spare parts / Repair labour / Unit sales / by model), expensesByType: [{ category, grossCents }] (+ Unit purchases line), rentalByCategory: [{ category, receivedCents, outstandingCents }], filters applied echo }`
- `GET /dashboard/growth?granularity=weekly|monthly|yearly&count=4|8|12|6&modelId=&metric=gross` → `{ points: [{ key, label, valueCents, pctChange }] }` (shared buildGrowthSeries over entries).
- `GET /dashboard/compare-models?granularity=&count=` → `{ series: [{ model, points: [...] }] }`
- `GET /dashboard/unit-performance?segment=` → unit table rows (like /units but respecting segment filter on entries) + totals row.
- `GET /dashboard/profit-bridge?from=&to=…` → `{ rows: [{ label, amountCents, kind: 'add'|'subtract'|'total' }] }` (Rental revenue, Parts & labour sales, = Total revenue, − Spare parts, − Tools, − Other expenses, − Salaries, ± Unit purchases per toggle, = NET PROFIT, margin).
- `GET /dashboard/export?format=pdf|xlsx&…filters` → file (pdfmake / exceljs): KPI cards, tables of every chart's data, filter header, generated timestamp.

## /vat  (all roles)
- `GET /vat/report?from=&to=` → `{ cards: { collectedCents, reclaimableCents, payableCents, nonVatIncomeCents }, byModel: [{ model, withVatGrossCents, vatCents, noVatCents }], incomeLines: [...entries], purchaseLines: [...expenses with reclaim], note }`
- `GET /vat/export?from=&to=&format=pdf|xlsx` → accountant export listing EVERY line composing the numbers.

## /partners  (ADMIN; ACCOUNTANT read)
- `GET /partners/summary?from=&to=` → `{ invested: [{ holder, totalCents, byCategory: {UNITS: c, SPARE_PARTS: c, TOOLS: c, EXPENSES: c, CASH_INJECTED: c} }], jointCents, collectedByHolder: [{ holder, amountCents }], holdings: (cash balances), salaries: [{ holder, monthlyCents, periodTotalCents }], profit: { netProfitCents, afterSalariesCents, split: [{ holder, shareCents }], taxEstimateCents, afterTaxCents }, payables: [{ holder, payableCents }] (company owes partner for personal spend when setting pnl.partnerPayableForPersonalSpend, minus handovers kept? payable = personal-spend investments − nothing; display only) }`

## /reports  (all roles; exports audit EXPORT)
- `GET /reports/sales?groupBy=model|unit|customer|product|receivedBy&from=&to=` → `{ rows: [{ key, label, orders, grossCents, vatCents, netCents, discountCents }], totals }` (product grouping from sale/invoice lines)
- `GET /reports/pnl?from=&to=&modelId=` → `{ revenueGrossCents, revenueNetCents, cogsCents, expensesByCategory: [...], salariesCents, unitPurchasesCents, countUnitPurchases, netProfitCents, marginPct, taxRateBp, taxEstimateCents, afterTaxCents, perModel: [{ model, revenue, costs, profit }] }`
- `GET /reports/discounts?from=&to=` → rows + total + count by reason.
- `GET /reports/outstanding` → unpaid entries/invoices grouped by customer `{ rows: [{ customer/customerName, items: n, amountCents, oldestDate }], totalCents }`
- `GET /reports/inventory` → stock valuation rows.
- `GET /reports/cash-ledger?from=&to=` → handovers + balances snapshot.
- `GET /reports/zreports?from=&to=` → list of daily Z summaries.
- Every report: `&format=pdf|xlsx` → file export (exceljs sheet per table / pdfmake).
- `GET /reports/accountant-pack?month=YYYY-MM` → one xlsx: sheets Entries, Expenses, VAT summary, Payments, Handovers, Invoices, CreditNotes for that month.

## /whatsapp  (webhook public; inbox ADMIN)
- `GET /whatsapp/webhook` Meta verification: echo `hub.challenge` when `hub.verify_token` matches env.
- `POST /whatsapp/webhook` — raw-body HMAC check (X-Hub-Signature-256, app secret; skip check when env secret empty AND not production). Statuses ignored. For each message: dedupe by waMessageId; sender must be in settings `whatsapp.allowedNumbers` (else store REJECTED, reply "not authorised" only in dev); parse via shared `parseWhatsAppMessage`; HELP → reply help text; UNDO → void sender's last SAVED entry within 10 min (reply confirm/na); income → transaction Entry (+unit lookup by code case-insensitive; unknown unit → error reply listing the code; model map; defaults like /entries) ; expense → Expense row (category match by name ilike else "Other", vendor, paidBy holder). Reply like the PDF: "Saved: Rental EUR 45, cash, no VAT. Collected by Salman. Unit EE2-251001 is EUR 455 from payback." Parse error → error text + format. Reply goes through job `whatsapp-reply` (Graph API, token from env; without token log-only). Always 200 to Meta.
- `GET /whatsapp/inbox?status=&from=&to=` → `{ messages: […, entry?, expense? ] }`; `POST /whatsapp/:id/reject` `{ reason }` (voids linked entry/expense); `POST /whatsapp/:id/reparse` after admin edits entry manually.
- `POST /whatsapp/simulate` (ADMIN; also works in production for testing) `{ from, text }` → runs the same pipeline without signature, returns `{ reply }`.
- `jobs.ts`: `handleWhatsAppReplyJob({messageId})` sends via Graph API `https://graph.facebook.com/v21.0/{phoneNumberId}/messages`; `handleWhatsAppDailySummary()` sends each allow-listed number the day's totals when setting `whatsapp.dailySummary`.

## /sheets  (ADMIN)
- `POST /sheets/sync` → run now; `GET /sheets/status` → `{ lastOk, lastError, logs: last 10 }`.
- `jobs.ts` `handleSheetsSyncJob`: service account (env GOOGLE_SERVICE_ACCOUNT_FILE) + setting googleSheets.sheetId; mirrors tabs: Entries, Expenses, Rentals, Units, Payments, Handovers, "Summary" (KPIs). Full rewrite each sync (DB is master). SyncLog rows; failures recorded, job retries.

## /claims  (ADMIN, STAFF; ACCOUNTANT read)
- CRUD `GET/POST/PUT /claims[/:id]`, `POST /claims/:id/status` `{ status, approvedCents?, decidedAt? }`; caseNumber `WC-2026-0001` (nextNumber CLAIM); list filters status/q; attachments via /attachments claimId.

## /contracts  (ADMIN; ACCOUNTANT read)
- CRUD contracts; `GET/POST /contracts/:id/jobs` (+PUT/void) log per repaired vehicle `{ date, vehicleRef, description, hours?, amountCents }`;
- `POST /contracts/:id/invoice-month` `{ month: 'YYYY-MM' }` → creates an Invoice to the contract customer with one line per uninvoiced job of that month (marks jobs invoiced, links invoiceId). Activates CONTRACT model (set active true on first use).

## /audit  (ADMIN)
- `GET /audit?entity=&entityId=&userId=&action=&from=&to=` → `{ logs: […, user:{id,name}], total }`.

## /import  (ADMIN)
- `POST /import/excel` multipart `file` → runs the Excel importer (same engine as CLI) → `{ batch: { id, summary, issues } }`.
- `GET /import/batches` + `GET /import/batches/:id` → report page data (summary, issues list, needs-review links, reconciliation { ours, excel, match }).
- `POST /import/batches/:id/confirm-phones` `{ confirm: true }` — no-op placeholder that records consent in audit (phones are NOT imported from Excel; endpoint records the admin's explicit decision for GDPR trail).

## /gdpr  (ADMIN)
- `GET /gdpr/privacy-notice` → `{ textEn, textFi }` (from settings with built-in default).
- `GET /gdpr/customers/:id/export` → JSON file of all data about one customer (profile, rentals, invoices, entries, payments).
- `POST /gdpr/customers/:id/erase` `{ confirm: true }` → anonymise personal fields (name → "Erased customer #id", null email/phone/address/notes), keep financial rows (legal retention), audit DELETE.
