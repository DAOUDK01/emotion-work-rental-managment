import { compareISO, todayInHelsinki, type ISODate } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { AppError } from '../../errors.js';
import { logger } from '../../logger.js';
import { computeNextPeriod, generateNextRental } from './service.js';

/**
 * Daily recurring-rentals generator (queue `recurring-rentals`, 06:15 Europe/Helsinki,
 * registered in src/jobs/boss.ts). For every ACTIVE rental with recurring=true whose
 * computed next period start (startDate + 1 month) is due (<= today) and not yet
 * generated for its series, create the next Rental + Entry — paymentStatus
 * NOT_YET_BILLED, no received-by, source SYSTEM — through the same service code as
 * POST /rentals/:id/generate-next (same PERIOD_EXISTS guard, same audit trail).
 * Runs several passes so a few missed days or months are caught up in one run.
 */

const MAX_PASSES = 36; // catch up at most 3 years of missed monthly periods per run

const toDbDate = (iso: ISODate): Date => new Date(`${iso}T00:00:00Z`);
const fromDbDate = (d: Date): ISODate => d.toISOString().slice(0, 10);

export async function handleRecurringRentalsJob(): Promise<void> {
  const today = todayInHelsinki();
  let generated = 0;
  let failures = 0;
  const failedIds = new Set<number>(); // don't retry a refused rental within this run

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const candidates = await prisma.rental.findMany({
      where: { status: 'ACTIVE', recurring: true },
      select: { id: true, parentId: true, startDate: true, endDate: true },
      orderBy: { id: 'asc' },
    });

    let generatedThisPass = 0;
    for (const rental of candidates) {
      if (failedIds.has(rental.id)) continue;

      const next = computeNextPeriod(
        fromDbDate(rental.startDate),
        rental.endDate ? fromDbDate(rental.endDate) : null,
      );
      if (compareISO(next.startDate, today) > 0) continue; // next period not due yet

      // Already generated for this series? (generateNextRental re-checks inside its
      // transaction; this pre-check just keeps the loop quiet for caught-up series.)
      const seriesRootId = rental.parentId ?? rental.id;
      const exists = await prisma.rental.findFirst({
        where: {
          status: 'ACTIVE',
          startDate: toDbDate(next.startDate),
          OR: [{ parentId: seriesRootId }, { id: seriesRootId }],
        },
        select: { id: true },
      });
      if (exists) continue;

      try {
        await generateNextRental(rental.id, 'SYSTEM');
        generatedThisPass += 1;
      } catch (err) {
        if (err instanceof AppError && err.code === 'PERIOD_EXISTS') {
          continue; // raced with a manual generate-next — the period is covered, not a failure
        }
        failedIds.add(rental.id);
        failures += 1;
        if (err instanceof AppError) {
          // business refusal, e.g. UNIT_NOT_RENTABLE after the unit was sold/disposed
          logger.warn(
            { rentalId: rental.id, code: err.code, message: err.message },
            'recurring rentals: next period refused',
          );
        } else {
          logger.error({ err, rentalId: rental.id }, 'recurring rentals: generating next period failed');
        }
      }
    }

    generated += generatedThisPass;
    if (generatedThisPass === 0) break; // every series is caught up (or refused)
  }

  logger.info({ date: today, generated, failures }, 'recurring rentals job finished');
}
