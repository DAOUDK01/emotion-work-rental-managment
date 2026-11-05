# E Motion Works Oy — business system

Full business dashboard and bookkeeping system for a scooter / e-bike rental, repair and
spare-parts company: POS with barcode scanning, Finnish invoicing (viitenumero, EN/FI),
rentals with payback tracking, VAT reporting, partner/investment ledger, cash-holder
settlements ("no escape point"), WhatsApp entry via the official Meta Cloud API, Google
Sheets mirror for the accountant, and an Excel importer that reconciles exactly with the
old workbook.

**Stack:** pnpm monorepo — React 18 + Vite + Tailwind (apps/web) · Express + Prisma +
PostgreSQL 16 + pg-boss (apps/api) · shared money/VAT/domain library with unit tests
(packages/shared) · pdfmake + ExcelJS for documents · Vitest/Supertest/Playwright.

## Quick start (development)

Prereqs: Node ≥ 20, pnpm 9 (`npm i -g pnpm@9`), a PostgreSQL 16 database.

```bash
pnpm install
```

```bash
cp .env.example apps/api/.env
```

Edit `apps/api/.env`: set `DATABASE_URL` (+ `DIRECT_URL`, same value unless you use a
pooler) and a random `JWT_SECRET`.

```bash
pnpm db:migrate
```

```bash
pnpm db:seed
```

```bash
pnpm dev
```

Web: http://localhost:5173 · API: http://localhost:4000/api/health
Sign in: `ahmed@emotionworks.fi` / `salman@emotionworks.fi` / `accountant@emotionworks.fi`
with the `SEED_ADMIN_PASSWORD` from `.env` (default `ChangeMe!123` — change it after login).

Optional sample data so every screen shows something (all rows marked `[DEMO]`):

```bash
pnpm seed:demo
```

Import the real Excel workbook (idempotent per file; produces a review report in
Settings → Import):

```bash
pnpm import:excel data/source/E_MotionFix_Dashboard.xlsx
```

## Tests

```bash
pnpm test
```

Runs the shared money/VAT/parser suite and the API integration tests, including the
**Excel reconciliation test** (`apps/api/test/import-reconciliation.test.ts`), which imports
the real workbook into the test database (`emotionfix_test` — created automatically by
`test/global-setup.ts`) and asserts the dashboard reproduces the Excel Calc sheet to the cent.

```bash
pnpm e2e
```

Playwright end-to-end flows against a running dev stack (desktop + iPad-landscape POS): sign-in,
dashboard filters and EN/FI switch, quick entry with live VAT preview, POS sale with stock
decrement and Z-report, invoice draft → send → payment, WhatsApp simulated entry, cash handover —
see `e2e/README.md`.

Current status: **112 automated tests passing** — 67 shared (money/VAT/parser/dates), 31 API
integration incl. the Excel reconciliation, 14 end-to-end.

Other checks: `pnpm lint` · `pnpm typecheck` · `pnpm build`.

## Production deployment (one small VPS)

```bash
cp .env.example .env
```

Set at least `JWT_SECRET`, `POSTGRES_PASSWORD`, `CORS_ORIGINS` (your https origin),
`COOKIE_SECURE=true`, then:

```bash
docker compose up -d --build
```

- Web (nginx, proxies `/api`): port `8080` (change with `WEB_PORT`).
- Put your TLS terminator (Caddy / nginx / the host's reverse proxy) in front — cookies are
  `Secure` in production, so HTTPS is required.
- Migrations and the base seed run automatically on API start (both idempotent).
- **Backups:** the `backup` container writes a nightly `pg_dump` to `./backups/`
  (14 days kept). Manual backup / restore:

```bash
docker compose exec postgres pg_dump -U emotionfix emotionfix | gzip > backups/manual-$(date +%F).sql.gz
```

```bash
gunzip -c backups/manual-2026-11-03.sql.gz | docker compose exec -T postgres psql -U emotionfix emotionfix
```

Uploaded files (receipts, agreements, photos) live in the `uploads` volume — include it in
your VPS snapshot schedule.

## Production deployment (Railway + Neon) — current live setup

Two Railway services built from this repo (branch `main`, region EU West), database on Neon
(Frankfurt). Both images are the same Dockerfiles as above.

| Service | Variables (set in Railway → Variables) | Other settings |
|---|---|---|
| `api` | `RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile`, `PORT=4000`, `NODE_ENV=production`, `COOKIE_SECURE=true`, `UPLOAD_DIR=/app/apps/api/uploads`, `DIRECT_URL=${{DATABASE_URL}}`, `CORS_ORIGINS=https://${{web.RAILWAY_PUBLIC_DOMAIN}}`, plus the secrets `DATABASE_URL` (Neon connection string), `JWT_SECRET`, `SEED_ADMIN_PASSWORD` | volume at `/app/apps/api/uploads`, healthcheck `/api/health`, no public domain |
| `web` | `RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile`, `API_UPSTREAM=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000` | public domain (nginx proxies `/api` to the API over the private network) |

Pushing to `main` redeploys both. If a push does not show up, run **Deploy latest commit** from
the service's command palette (Ctrl+K). Migrations and the base seed run on every API start;
the seed never overwrites existing users, so `SEED_ADMIN_PASSWORD` only matters for the very
first start. Neon keeps point-in-time history; the volume holds uploads (Railway volume backups
are under the service's Backups tab).

## Configuration

Everything that can change lives in the **database Settings** (admin UI): company details
(Business ID, VAT number, IBAN — fill these before sending real invoices), VAT and corporate
tax rates (effective-dated), models, payment methods, "Amount received by" options, unit
prefixes, expense categories, invoice texts (EN/FI), salaries, cash-alert days, WhatsApp
allow-list, Google Sheet, SMTP. Environment variables (`.env.example`) carry only secrets
and infrastructure addresses.

Integrations are optional and off until configured:
- **WhatsApp** — Meta Cloud API credentials; see `docs/WHATSAPP_META_COMPLIANCE.md`.
- **Google Sheets** — service-account JSON + sheet ID; one-way mirror for the accountant.
- **Email (SMTP)** — invoice sending; without SMTP, mails queue visibly in the outbox.

## Repository layout

```
apps/api        Express API, Prisma schema/migrations/seeds, jobs, PDF/Excel, Excel import
apps/web        React app (Vite, Tailwind, i18next EN/FI, Recharts)
packages/shared money & VAT engine, dates/ISO weeks, growth, payback, Finnish reference
                numbers, barcode helpers, WhatsApp parser — one implementation, fully tested
e2e             Playwright flows
docs            ASSUMPTIONS · VAT_EXPLAINED · WHATSAPP_META_COMPLIANCE · USER_GUIDE ·
                API_CONTRACT · CONVENTIONS
data/source     the original client workbook + extracted sheet analysis (NOT in git:
                it contains customer data — copy it in locally to run the import/test)
```

## Documentation

- `docs/USER_GUIDE.md` — how the partners use it (dashboard, POS, invoices, WhatsApp format,
  cash handover).
- `docs/VAT_EXPLAINED.md` — plain-English VAT with worked examples (for the client).
- `docs/WHATSAPP_META_COMPLIANCE.md` — why the integration is built on the official API.
- `docs/API_CONTRACT.md` — every endpoint with request/response shapes.
- `docs/ASSUMPTIONS.md` — every decision made during the build, with ⚠ items the client
  must confirm (VAT defaults, invoice details, Excel discrepancies).
