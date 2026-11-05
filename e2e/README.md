# End-to-end tests (Playwright)

The flows sign in as the seeded admin and exercise the real UI against the real API and a
real database. **They create `[E2E]`-marked data** — run them against development, never
against the production database.

First time:

```bash
pnpm --filter @emotionfix/e2e install-browsers
```

Run (starts the dev servers automatically if not already running):

```bash
pnpm e2e
```

Prereqs: `apps/api/.env` configured, database migrated (`pnpm db:migrate`) and seeded
(`pnpm db:seed`; `pnpm seed:demo` gives the dashboard something to show). Set `E2E_BASE_URL` to
point somewhere else (e.g. a staging stack).

The suite signs in **once** per run (`global-setup.ts`) and reuses the session, because the API
rate-limits logins to 10 per 15 minutes. If you restart runs back-to-back many times and see
"Too many login attempts", restart the API (the limiter is in memory) or wait 15 minutes.

Covered flows: login & navigation, dashboard filters + growth chart, quick entry with live
VAT preview, POS sale (barcode + manual, stock decrement, Z-report), invoice create → send
→ PDF → payment, WhatsApp simulated entry → inbox, cash handover.
