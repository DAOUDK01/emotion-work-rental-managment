import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

export const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

prisma.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'));
prisma.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'));

/** Next value from a named sequence (invoice/receipt/credit-note numbering, gap-free). */
export async function nextNumber(tx: Pick<PrismaClient, '$queryRaw'>, key: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ nextValue: number }>>`
    INSERT INTO number_sequences ("key", "nextValue") VALUES (${key}, 2)
    ON CONFLICT ("key") DO UPDATE SET "nextValue" = number_sequences."nextValue" + 1
    RETURNING number_sequences."nextValue" - 1 AS "nextValue"`;
  return rows[0].nextValue;
}
