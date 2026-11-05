import { request, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './helpers';

export const STORAGE_STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth', 'admin.json');

/** Sign in ONCE per run and share the session: the API rate-limits logins (10 / 15 min). */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0].use.baseURL ?? 'http://localhost:5173';
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post('/api/auth/login', { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  if (!res.ok()) throw new Error(`E2E login failed: ${res.status()} ${await res.text()}`);
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await ctx.storageState({ path: STORAGE_STATE });
  await ctx.dispose();
}
