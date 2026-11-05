import { Router } from 'express';
import { z } from 'zod';
import { compareISO, parseFlexibleDate } from '@emotionfix/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { buildPartnerSummary } from './service.js';

/**
 * Partner overview — investments, collections, cash holdings, salaries, profit split
 * and payables. ADMIN only, plus read-only ACCOUNTANT (writes are blocked globally);
 * STAFF must never see partner data. Read-only module: the single GET performs no
 * mutations, so there is nothing to audit here.
 */
export const partnersRouter = Router();
partnersRouter.use(requireAuth('ADMIN', 'ACCOUNTANT'));

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => parseFlexibleDate(s) === s, 'Not a real calendar date');

const SummaryQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((q) => compareISO(q.from, q.to) <= 0, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

partnersRouter.get('/summary', validate({ query: SummaryQuery }), async (req, res, next) => {
  try {
    const { from, to } = req.query as unknown as z.infer<typeof SummaryQuery>;
    res.json(await buildPartnerSummary(from, to));
  } catch (err) {
    next(err);
  }
});
