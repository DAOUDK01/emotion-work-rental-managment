import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { addDays } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';

/**
 * Read-only audit trail: who did what, to which record, when and from which IP.
 * Rows are written by src/services/audit.ts inside every business mutation —
 * this module only lists them. ADMIN only (staff and accountants must never
 * see the audit log, per the conventions' role rules).
 */
export const auditRouter = Router();
auditRouter.use(requireAuth('ADMIN'));

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  entity: z.string().trim().min(1).max(80).optional(),
  entityId: z.string().trim().min(1).max(80).optional(),
  userId: z.coerce.number().int().positive().optional(),
  action: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .transform((s) => s.toUpperCase())
    .optional(),
  from: z.string().regex(ISO_DATE_RE, 'Expected YYYY-MM-DD').optional(),
  to: z.string().regex(ISO_DATE_RE, 'Expected YYYY-MM-DD').optional(),
});

// ---------- GET /audit?entity=&entityId=&userId=&action=&from=&to= ----------
auditRouter.get('/', validate({ query: ListQuery }), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof ListQuery>;

    const where: Prisma.AuditLogWhereInput = {};
    if (query.entity) where.entity = query.entity;
    if (query.entityId) where.entityId = query.entityId;
    if (query.userId !== undefined) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.from || query.to) {
      // `at` is a timestamp; from/to are calendar dates → [from 00:00, to+1d 00:00) UTC,
      // same day-window semantics as the other timestamp-filtered lists.
      where.at = {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
        ...(query.to ? { lt: new Date(`${addDays(query.to, 1)}T00:00:00Z`) } : {}),
      };
    }

    const [total, rows] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, name: true } } },
      }),
    ]);

    res.json({
      logs: rows.map((row) => ({ ...row, at: row.at.toISOString() })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  } catch (err) {
    next(err);
  }
});
