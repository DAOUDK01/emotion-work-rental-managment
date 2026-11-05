/** Runs ONCE per vitest run: migrate + seed the test database. */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

export default function globalSetup(): void {
  const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const toTest = (url: string | undefined) =>
    url?.replace('/emotionfix?', '/emotionfix_test?').replace(/\/emotionfix$/, '/emotionfix_test');
  const testUrl = toTest(process.env.DATABASE_URL);
  const testDirect = toTest(process.env.DIRECT_URL) ?? testUrl;
  if (!testUrl) throw new Error('DATABASE_URL missing — create apps/api/.env first');
  const env = {
    ...process.env,
    DATABASE_URL: testUrl,
    DIRECT_URL: testDirect,
    NODE_ENV: 'test',
  };
  console.log('[test] migrating test database…');
  runWithRetry('pnpm exec prisma migrate deploy', apiDir, env);
  console.log('[test] seeding test database…');
  runWithRetry('pnpm exec tsx prisma/seed.ts', apiDir, env);
}

/** A serverless Postgres (e.g. Neon) may be suspended: the first connect can time out while it wakes. */
function runWithRetry(cmd: string, cwd: string, env: NodeJS.ProcessEnv, attempts = 3): void {
  for (let i = 1; ; i++) {
    try {
      execSync(cmd, { cwd, env, stdio: 'inherit' });
      return;
    } catch (err) {
      if (i >= attempts) throw err;
      console.log(`[test] "${cmd}" failed (attempt ${i}/${attempts}) — retrying in 5 s`);
      execSync(process.platform === 'win32' ? 'ping -n 6 127.0.0.1 >NUL' : 'sleep 5', { stdio: 'ignore', shell: true } as never);
    }
  }
}
