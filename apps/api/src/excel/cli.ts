/**
 * CLI entry: pnpm import:excel <file.xlsx>
 * Kept out of import-excel.ts because the production build bundles every module into
 * dist/index.js, where a "was this file run directly?" check would fire on API start.
 */
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { runExcelImport } from './import-excel.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: pnpm import:excel <path-to-workbook.xlsx>');
  process.exit(1);
}

const prisma = new PrismaClient();
runExcelImport(prisma, path.resolve(file))
  .then((result) => {
    console.log('Import complete. Batch', result.batchId);
    console.log(JSON.stringify(result.summary, null, 2));
    const reviews = result.issues.filter((i) => i.severity !== 'info');
    console.log(`${reviews.length} rows need review — open Settings → Import report in the app.`);
  })
  .catch((err) => {
    console.error('Import failed:', err.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
