import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // API tests hit the test database; run files serially to keep state deterministic.
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    setupFiles: ['test/setup.ts'],
    globalSetup: ['test/global-setup.ts'],
  },
});
