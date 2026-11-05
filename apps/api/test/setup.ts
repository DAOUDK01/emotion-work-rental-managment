/**
 * Test setup (runs before every test file): point the API at the TEST database.
 * The test DB (…/emotionfix_test) is migrated + seeded once by global-setup.ts.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'test-secret-test-secret-test-secret';

function toTestUrl(url: string | undefined): string | undefined {
  return url?.replace('/emotionfix?', '/emotionfix_test?').replace(/\/emotionfix$/, '/emotionfix_test');
}

if (process.env.DATABASE_URL?.includes('/emotionfix')) {
  process.env.DATABASE_URL = toTestUrl(process.env.DATABASE_URL);
  process.env.DIRECT_URL = toTestUrl(process.env.DIRECT_URL) ?? process.env.DATABASE_URL;
}
