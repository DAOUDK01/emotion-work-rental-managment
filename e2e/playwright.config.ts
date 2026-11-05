import { defineConfig, devices } from '@playwright/test';

/**
 * E2E flows against the dev stack. The web server proxies /api to the API,
 * so one baseURL covers everything. Start the stack yourself (pnpm dev) or let
 * the webServer blocks below do it.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  // the dev database is remote (Neon, Frankfurt): first aggregate loads can take several seconds
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1, // flows share one database — run serially for determinism
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    storageState: './.auth/admin.json',
    trace: 'retain-on-failure',
    locale: 'en-GB',
    timezoneId: 'Europe/Helsinki',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      // iPad landscape viewport + touch, run on Chromium (the shop tablet uses Chrome)
      name: 'tablet-pos',
      use: { ...devices['iPad (gen 7) landscape'], defaultBrowserType: 'chromium' },
      testMatch: /pos\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @emotionfix/api dev',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: true,
      cwd: '..',
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @emotionfix/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      cwd: '..',
      timeout: 60_000,
    },
  ],
});
