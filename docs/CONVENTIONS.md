# Engineering conventions (read before writing any module)

Monorepo: `apps/api` (Express 4 + Prisma + PostgreSQL 16), `apps/web` (React 18 + Vite),
`packages/shared` (`@emotionfix/shared`: money/VAT/dates/growth/payback/parser — USE IT, never re-implement).

## Hard rules

- **Money is never a float.** All amounts are integer euro cents in fields named `*Cents`.
  Parse user input with `parseAmountToCents`, round with `roundHalfAwayFromZero` (half away from zero, per line).
- **VAT**: rates are basis points (`2550` = 25.5 %). Prices are entered gross (VAT-inclusive):
  `splitGross(gross, rateBp)`. Net entry supported via `addVatToNet`. **Exception — POS and product
  cards:** product `priceCents` is WITHOUT VAT and POS sales (`Sale.pricesExclVat = true`) price lines
  without VAT and add it on top per line (`addVatToNet`); older sales (`pricesExclVat = false`) keep the
  VAT-inclusive maths. Invoices convert a product price to gross when it is picked. Income VAT follows the
  "VAT invoice issued?" flag — `incomeVat(gross, rateBp, vatInvoice)`; when false the full amount is
  non-VAT income. Purchases reclaim via `reclaimableVat({grossCents, rateBp, hasValidReceipt, businessUsePct})`.
- **Every income is an `Entry`** created via `createEntry` from `src/services/entries.ts` inside a
  `prisma.$transaction`. It computes VAT, snapshots segment, writes `DiscountRecord` for discounts,
  and writes a `Payment` row (received-by ledger) when the entry is PAID. Void with `voidEntry` —
  **financial rows are NEVER hard-deleted** (use `status: VOID` + reason, credit notes for invoices).
- **"Amount received by" is required** whenever money is received (createEntry enforces it; keep it
  required in your zod schemas for paid flows).
- **Audit everything**: call `audit(action, entity, entityId, before, after)` from
  `src/services/audit.ts` on every create/update/delete/void.
- **Dates are calendar dates** (Europe/Helsinki) as `YYYY-MM-DD` strings in the API. Store with
  `new Date(iso + 'T00:00:00Z')` into `@db.Date` columns; serialise with `.toISOString().slice(0, 10)`.
  Weeks are ISO weeks (Mon start) — use `@emotionfix/shared` date helpers.
- **Settings live in the DB**: `getSetting(key, fallback)` from `src/services/settings.ts`.
  Never hard-code VAT %, tax %, holder names, alert thresholds, invoice texts, company details.
- **Validation on every endpoint**: `validate({ body, query, params })` with zod. Coerce numeric
  params with `z.coerce.number().int()`.
- **Auth**: `requireAuth()` any signed-in user; `requireAuth('ADMIN')`, `requireAuth('ADMIN','STAFF')`.
  Accountant writes are blocked globally. Staff must NOT see partner data, settings, audit, cash ledger.
- **Errors**: `throw`/`next(new AppError(status, CODE, message))`; helpers in `src/errors.ts`.
  Codes are UPPER_SNAKE and stable (the web app translates them).

## Module pattern (copy `src/modules/vocab/router.ts` and `src/modules/auth/router.ts`)

- One folder per module: `src/modules/<name>/router.ts` exporting `<name>Router` (already stubbed —
  replace the stub's content, keep the export name; `importer` exports `importRouter`).
  Add `service.ts` / `schemas.ts` / `jobs.ts` in the same folder when the file would get long.
- Handlers: `async (req, res, next) => { try { ... } catch (err) { next(err); } }`.
- Response shapes: single `{ unit }`, lists `{ units, total, page, pageSize }`.
  List endpoints take `?page=1&pageSize=50` (max 200) plus documented filters, ordered newest first.
- Amounts in responses: cents (numbers). The web formats them.
- Do NOT: add npm dependencies, touch files outside your module folder, run pnpm/prisma commands,
  edit schema.prisma, app.ts, shared services, or other modules. Needed shared logic already exists —
  if something seems missing, implement it INSIDE your module folder.
- No TODOs, no placeholders, no mock data. Deliver complete, production-quality code.

## Key schema facts (see apps/api/prisma/schema.prisma for the full picture)

- `Entry` = income ledger (one row per rental period / POS sale / invoice / quick entry / WhatsApp entry).
  1-1 optional links: `saleId`, `rentalId`, `invoiceId`, `whatsappMessageId`. `paymentStatus`:
  PAID / INVOICED / PENDING / NOT_YET_BILLED. Outstanding = INVOICED + PENDING. Filter `status: 'ACTIVE'`
  in every aggregate.
- `Payment` = money received (ledger of "Amount received by"); `CashHandover` moves holder → company.
  Holder balance = active payments received − active handovers out (+ handovers in for Company).
- `Unit.code` like `EE2-251001` (prefix + purchase date YYMMDD, `-2` suffix on collision).
  Unit "earned" = sum of ACTIVE entries' `netCents` linked via `unitId` (payback uses net of VAT & discounts;
  optionally subtract REPAIR_USE stock movement costs when setting `units.subtractRepairPartsFromPayback`).
- `Product.trackStock=false` for services (labour). Stock on hand = sum of `StockMovement.qty` —
  never store a quantity column.
- `Sale` (POS): lines → entry on completion (model from sale), payments (split allowed), Z-report by `businessDate`.
- `Invoice`: sequential `number` via `nextNumber(tx, 'INVOICE')`, `numberFormatted` `2026-0001`,
  Finnish reference via `makeFinnishReference(number)`. Status DRAFT→SENT→PARTIALLY_PAID→PAID; CANCELLED
  only via credit note. OVERDUE is derived (status SENT/PARTIALLY_PAID && dueDate < today).
- `Expense.reclaimableVatCents` is a stored snapshot — recompute on every write with `reclaimableVat`.
- Personal spend (`paidBy` = partner holder, kind PARTNER) auto-creates an `Investment` (auto=true);
  `jointReinvested=true` creates a joint 50/50 investment instead. Category mapping:
  expense category "Unit purchases"→UNITS, "Spare parts (stock)"→SPARE_PARTS, "Tools"→TOOLS, else EXPENSES.
  Unit purchases (units table) likewise create UNITS investments for the payer.
- WhatsApp: `parseWhatsAppMessage` from shared does ALL parsing. Webhook must verify
  `X-Hub-Signature-256` over the RAW body (`(req as any).rawBody`), check `waMessageId` idempotency,
  allow-list sender numbers (setting `whatsapp.allowedNumbers`), and never save half-parsed entries.

## Dashboard semantics (must reconcile with the client's Excel Calc sheet)

- "Total sales (incl. VAT)" = sum of ACTIVE entries `grossCents` (gross as entered; non-VAT income included).
- Revenue received = entries with payments… simplified: PAID entries gross; Outstanding = INVOICED+PENDING gross.
- Net profit = revenue NET (sum `netCents`) − COGS − expenses − salaries for the period; unit purchases
  excluded unless setting `pnl.countUnitPurchasesAsCost`. (The reconciliation test freezes the Excel numbers.)
- Charts always return values ready for data labels; green = profit, red = loss.
