# Web app conventions (read before building any page)

Stack: React 18 + TS strict + Vite · TanStack Query v5 · react-hook-form + zod ·
Tailwind + the in-house UI kit (`src/components/ui/*`) · i18next (EN/FI) · Recharts wrappers
in `src/components/charts.tsx` · sonner toasts.

**Reference implementations — read them first:**
`src/pages/dashboard/DashboardPage.tsx` (queries, filters, charts, tables),
`src/pages/login/LoginPage.tsx` (forms), `src/components/PeriodSelector.tsx`,
`src/lib/api.ts`, `src/lib/format.ts`, `src/lib/auth.tsx`, `src/components/ui/*`.

## File ownership (no conflicts)

- You own `src/pages/<your-folder>/` — replace the stub `<Name>Page.tsx` (keep the default
  export name) and add any sub-components there.
- You own your locale namespace: CREATE `src/locales/en/<ns>.json` AND `src/locales/fi/<ns>.json`
  (same key tree). They are auto-discovered; `useTranslation('<ns>')`. Shared strings come from
  the `common` namespace (read `src/locales/en/common.json` — do NOT edit it).
- Never touch: lib/, components/ (ui, charts, AppShell, PeriodSelector), routes.tsx, other pages.
  Everything you need exists; page-specific widgets go in your folder.
- No new npm dependencies. Available: @zxing/browser (camera barcode), jsbarcode (barcode SVG),
  lucide-react icons, sonner.

## Data

- `api.get/post/put/del<T>(path)` from `@/lib/api` — cookie auth + CSRF handled; errors throw
  `ApiError { status, code, message, details }`.
- Query keys: `['units']`, `['units', id]`, `['units', 'list', filtersQs]`. After a mutation:
  `queryClient.invalidateQueries({ queryKey: ['units'] })` (+ `['lookups']`/`['dashboard']` when relevant).
- Build query strings with `qs({...})` from `@/lib/api`. File downloads: `downloadFile(path, name)`.
- Amounts are integer CENTS in every API payload/response. Forms: keep the input as a string,
  convert with `euroInputToCents` on submit; show with `fmtEUR` / `fmtEURShort`; prefill edits
  with `centsToInput`. Dates are `YYYY-MM-DD` strings — use `<Input type="date">` directly.
- Dropdown data: `api.get('/lookups')` → `{ models, holders, methods, expenseCategories,
  unitPrefixes, vatRates, vatDefaults }` (see DashboardPage usage).

## UI rules

- Page skeleton: `<div className="mx-auto max-w-6xl space-y-4">` + `<PageHeader title=… actions=…/>`.
- Lists: `Table/THead/TBody/TR/TH/TD/TDMoney` + search `Input` (debounce with a small
  `useEffect`+`setTimeout`), filter `Select`s, pagination buttons when `total > pageSize`.
- Loading `<LoadingState/>`, errors `<ErrorState error={q.error} onRetry={() => q.refetch()}/>`,
  empty `<EmptyState title hint action/>` — every page needs all three states.
- Forms: react-hook-form + zodResolver; wrap inputs in `<Field label error={errors.x?.message} required>`;
  submit via useMutation; success → `toast.success(t('common:common.savedOk'))` + close dialog +
  invalidate; failure → `toast.error(message)` (ApiError message is already human-readable).
- Create/edit in a `<Dialog>`; void/delete/cancel through `<ConfirmDialog>` (destructive actions
  always confirm, and send `{ reason }` when the API wants one).
- Money-received flows must require "Amount received by" (`receivedById`) exactly like the API.
- The "VAT invoice issued?" checkbox shows the warning text `t('common:money.vatWarning')`
  whenever the user sets it to No on an income form; default the flag from
  `lookups.vatDefaults.byHolder[holderName]` when the receiver changes (user can override).
- `needsReview` rows get `<Badge variant="warning">{t('common:common.needsReview')}</Badge>`
  with `reviewReason` as `title` tooltip.
- Status→Badge: PAID success · INVOICED info · PENDING warning · VOID/overdue danger.
- Charts: always the wrappers from `@/components/charts` (labels on the data). Green profit,
  red loss. Payback bars like DashboardPage's unit table.
- Responsive: forms stack on mobile (`grid gap-3 sm:grid-cols-2`); POS/entry must work on a
  tablet and phone. Buttons on POS use `size="pos"`. Keyboard accessible: real `<label>`s
  (Field does it), focus states exist in the kit.
- Role gating in the page: `const { user } = useAuth()` — hide admin-only buttons from STAFF
  (the API enforces it too).

## Special patterns

- **Keyboard-wedge scanner** (POS/receiving): window `keydown` listener; buffer printable keys
  whose inter-key gap < 50 ms; on Enter with buffer length ≥ 4 treat as scan, clear buffer,
  `e.preventDefault()`; ignore when an editable element has focus unless the gap signature says
  scanner. Clean up on unmount.
- **Camera scanning**: `BrowserMultiFormatReader` from `@zxing/browser`; start on a `<video>`
  element inside a Dialog, stop + release on close; surface camera errors as a hint.
- **Printing receipts/invoices**: fetch the HTML (`api.get<Blob>` returns a Blob for non-JSON) —
  for HTML endpoints instead use `window.open(path)`? No: auth cookies ride on same-origin
  requests, so open `/<api path>` directly with `window.open('/api/pos/sales/7/receipt?width=80')`
  then call `print()` from the opened window's `onload` (the endpoint returns a full HTML page).
  PDFs: `downloadFile('/invoices/7/pdf', 'invoice-2026-0001.pdf')`.
- **Uploads**: `const fd = new FormData(); fd.append('file', file); fd.append('expenseId', String(id));
  api.post('/attachments', fd)` — never set Content-Type manually.
- Barcode preview on labels screen: `jsbarcode` on a `<svg ref>` (`JsBarcode(ref.current, code,
  { format: 'CODE128' })`).

## Quality bar

No placeholder UI, no TODOs, no `any` unless unavoidable. Translate EVERY visible string
(both languages, honest Finnish). Typecheck mentally against the contract — response shapes
are in docs/API_CONTRACT.md and are exact.
