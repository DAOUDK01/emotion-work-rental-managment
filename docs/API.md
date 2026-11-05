# API documentation

The complete endpoint reference — every route with request/response shapes, auth rules,
status codes and behaviours — is maintained in **[API_CONTRACT.md](API_CONTRACT.md)**.
It is the contract the backend is implemented against and the frontend consumes.

Quick facts:

- Base path `/api`, JSON in/out, amounts in integer euro cents, dates `YYYY-MM-DD`.
- Auth: httpOnly cookie session (`POST /api/auth/login`); mutating requests echo the
  `emf_csrf` cookie in the `X-CSRF-Token` header.
- Errors: `{ "error": { "code": "UPPER_SNAKE", "message": "plain language", "details?": … } }`.
- Lists: `?page&pageSize` → `{ <rows>, total, page, pageSize }`.
- Roles: ADMIN (everything), STAFF (operational, no settings/partner/cash/audit),
  ACCOUNTANT (read-only + exports).
- Health probe: `GET /api/health`.
