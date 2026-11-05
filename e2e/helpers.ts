import { expect, type APIResponse, type Page } from '@playwright/test';

export const ADMIN_EMAIL = 'ahmed@emotionworks.fi';
export const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!123';

/** Open the app with the run's shared admin session (signed in once in global-setup). */
export async function login(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20000 });
}

/** Sign in through the real login form (only for tests of the form itself). */
export async function loginViaForm(page: Page, email = ADMIN_EMAIL, password = ADMIN_PASSWORD): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email|sähköposti/i).fill(email);
  await page.getByLabel(/password|salasana/i).fill(password);
  await page.getByRole('button', { name: /sign in|kirjaudu/i }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible({ timeout: 20000 });
}

/** Unique marker for data created by this e2e run. */
export function e2eTag(): string {
  return `E2E-${Date.now().toString(36)}`;
}

async function csrf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return cookies.find((c) => c.name === 'emf_csrf')?.value ?? '';
}

/** Authenticated API helpers sharing the page's session cookies (for setup + verification). */
export const apiOf = (page: Page) => ({
  get: async <T>(path: string): Promise<T> => {
    const res = await page.request.get(`/api${path}`);
    await assertOk(res, `GET ${path}`);
    return (await res.json()) as T;
  },
  post: async <T>(path: string, data: unknown): Promise<T> => {
    const res = await page.request.post(`/api${path}`, { data, headers: { 'X-CSRF-Token': await csrf(page) } });
    await assertOk(res, `POST ${path}`);
    return (await res.json()) as T;
  },
  put: async <T>(path: string, data: unknown): Promise<T> => {
    const res = await page.request.put(`/api${path}`, { data, headers: { 'X-CSRF-Token': await csrf(page) } });
    await assertOk(res, `PUT ${path}`);
    return (await res.json()) as T;
  },
});

async function assertOk(res: APIResponse, what: string): Promise<void> {
  if (!res.ok()) throw new Error(`${what} failed: ${res.status()} ${await res.text()}`);
}

export interface Lookups {
  models: Array<{ id: number; code: string }>;
  holders: Array<{ id: number; name: string }>;
  methods: Array<{ id: number; name: string }>;
}
