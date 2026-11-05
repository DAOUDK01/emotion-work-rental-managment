import { Router } from 'express';
import { incomeVat, todayInHelsinki } from '@emotionfix/shared';
import { badRequest } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { vatRateOn } from '../../services/entries.js';
import {
  CreateEntrySchema,
  idParam,
  ListEntriesQuerySchema,
  MarkPaidSchema,
  PreviewQuerySchema,
  UpdateEntrySchema,
  VoidEntrySchema,
  type CreateEntryBody,
  type ListEntriesQuery,
  type MarkPaidBody,
  type PreviewQuery,
  type UpdateEntryBody,
  type VoidEntryBody,
} from './schemas.js';
import {
  createQuickEntry,
  getEntryWithRefs,
  listEntries,
  serializeEntry,
  type UnitPayback,
} from './service.js';
import { markEntryPaid, updateEntry, voidEntryById } from './mutations.js';

/**
 * /entries — the quick-entry backbone of the income ledger.
 * ADMIN and STAFF read/write; ACCOUNTANT reads (writes are also blocked globally).
 * Every income row is an Entry; money received is a Payment ("Amount received by").
 */
export const entriesRouter = Router();
entriesRouter.use(requireAuth());

// ---------- list (filters + sums over the whole filtered set) ----------
entriesRouter.get('/', validate({ query: ListEntriesQuerySchema }), async (req, res, next) => {
  try {
    const q = req.query as unknown as ListEntriesQuery;
    res.json(await listEntries(q));
  } catch (err) {
    next(err);
  }
});

// ---------- live form preview (pure — no DB writes) ----------
// Registered before '/:id' so "preview" is never parsed as an id.
entriesRouter.get('/preview', validate({ query: PreviewQuerySchema }), async (req, res, next) => {
  try {
    const q = req.query as unknown as PreviewQuery;
    const grossBeforeDiscountCents = q.grossCents ?? q.gross;
    if (grossBeforeDiscountCents === undefined) {
      throw badRequest('VALIDATION', 'grossCents (integer cents) is required');
    }
    const discountCents = q.discountCents ?? q.discount ?? 0;
    if (discountCents > grossBeforeDiscountCents) {
      throw badRequest('DISCOUNT_EXCEEDS_AMOUNT', 'Discount is larger than the amount');
    }
    const rateBp = q.rateBp ?? (await vatRateOn(todayInHelsinki()));
    const result = incomeVat(grossBeforeDiscountCents - discountCents, rateBp, q.vatInvoice ?? false);
    res.json({
      grossCents: result.grossCents,
      discountCents,
      vatCents: result.vatCents,
      netCents: result.netCents,
      nonVatCents: result.nonVatCents,
    });
  } catch (err) {
    next(err);
  }
});

// ---------- create (quick entry web form; source WEB) ----------
entriesRouter.post(
  '/',
  requireAuth('ADMIN', 'STAFF'),
  validate({ body: CreateEntrySchema }),
  async (req, res, next) => {
    try {
      const body = req.body as CreateEntryBody;
      const { entry, unitPayback } = await createQuickEntry(body);
      const payload: { entry: ReturnType<typeof serializeEntry>; unitPayback?: UnitPayback } = {
        entry: serializeEntry(entry),
      };
      if (unitPayback) payload.unitPayback = unitPayback;
      res.status(201).json(payload);
    } catch (err) {
      next(err);
    }
  },
);

// ---------- read one ----------
entriesRouter.get('/:id', validate({ params: idParam }), async (req, res, next) => {
  try {
    const { id } = req.params as unknown as { id: number };
    res.json({ entry: serializeEntry(await getEntryWithRefs(id)) });
  } catch (err) {
    next(err);
  }
});

// ---------- update (recompute everything; 409 LINKED_ENTRY when sale/invoice-linked) ----------
entriesRouter.put(
  '/:id',
  requireAuth('ADMIN', 'STAFF'),
  validate({ params: idParam, body: UpdateEntrySchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as UpdateEntryBody;
      res.json({ entry: serializeEntry(await updateEntry(id, body)) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- void (financial rows are never hard-deleted) ----------
entriesRouter.post(
  '/:id/void',
  requireAuth('ADMIN', 'STAFF'),
  validate({ params: idParam, body: VoidEntrySchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { reason } = req.body as VoidEntryBody;
      res.json({ entry: serializeEntry(await voidEntryById(id, reason)) });
    } catch (err) {
      next(err);
    }
  },
);

// ---------- mark paid (status PAID + Payment ledger row) ----------
entriesRouter.post(
  '/:id/mark-paid',
  requireAuth('ADMIN', 'STAFF'),
  validate({ params: idParam, body: MarkPaidSchema }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const body = req.body as MarkPaidBody;
      res.json({ entry: serializeEntry(await markEntryPaid(id, body)) });
    } catch (err) {
      next(err);
    }
  },
);
