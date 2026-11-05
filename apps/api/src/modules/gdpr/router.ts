import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { resolvePrivacyNotice } from './notice.js';
import { buildCustomerExport, eraseCustomer } from './service.js';

/**
 * GDPR tooling (ADMIN only): the privacy notice shown/printed for customers,
 * the per-customer data export (right of access / portability) and the
 * right-to-erasure flow. Erasure anonymises the customer record but keeps
 * financial rows — the Finnish Bookkeeping Act requires 6 years of retention.
 */
export const gdprRouter = Router();
gdprRouter.use(requireAuth('ADMIN'));

const idParam = z.object({ id: z.coerce.number().int().positive() });

// ---------- GET /gdpr/privacy-notice → { textEn, textFi } ----------
gdprRouter.get('/privacy-notice', async (_req, res, next) => {
  try {
    const { textEn, textFi } = await resolvePrivacyNotice();
    res.json({ textEn, textFi });
  } catch (err) {
    next(err);
  }
});

// ---------- GET /gdpr/customers/:id/export → downloadable JSON document ----------
gdprRouter.get('/customers/:id/export', validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    const doc = await buildCustomerExport(id);

    // Every export of personal data leaves a trail: who pulled whose data, when.
    await audit('EXPORT', 'customers', id, undefined, {
      kind: 'GDPR_EXPORT',
      rentals: doc.rentals.length,
      invoices: doc.invoices.length,
      entries: doc.entries.length,
      payments: doc.payments.length,
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="customer-${id}-data.json"`);
    res.send(JSON.stringify(doc, null, 2));
  } catch (err) {
    next(err);
  }
});

// ---------- POST /gdpr/customers/:id/erase { confirm: true } ----------
const EraseSchema = z.object({ confirm: z.boolean().optional() });

gdprRouter.post(
  '/customers/:id/erase',
  validate({ params: idParam, body: EraseSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { confirm } = req.body as z.infer<typeof EraseSchema>;
      if (confirm !== true) {
        throw new AppError(
          400,
          'CONFIRM_REQUIRED',
          'Erasure is irreversible — send { "confirm": true } to proceed',
        );
      }

      const { customer, erasedFields } = await eraseCustomer(id);

      // The before-snapshot must NOT re-save the personal values being erased:
      // record only WHICH fields held data. The after-state is already anonymous.
      await audit('DELETE', 'customers', id, { erasedFields }, customer);

      res.json({ customer });
    } catch (err) {
      next(err);
    }
  },
);
