import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { currentUserId } from '../../context.js';
import { ImportRefusedError, runExcelImport } from '../../excel/import-excel.js';

/** Excel import (admin): upload the workbook, get a batch report with every issue. */
export const importRouter = Router();
importRouter.use(requireAuth('ADMIN'));

const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => cb(null, `emf-import-${Date.now()}${path.extname(file.originalname) || '.xlsx'}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.toLowerCase().endsWith('.xlsx');
    if (ok) cb(null, true);
    else cb(new AppError(400, 'BAD_FILE_TYPE', 'Upload the Excel workbook (.xlsx)'));
  },
});

importRouter.post('/excel', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, 'NO_FILE', 'Attach the workbook in the "file" field');
    const result = await runExcelImport(prisma, req.file.path, { createdById: currentUserId() ?? null });
    await audit('IMPORT', 'import_batches', result.batchId, undefined, result.summary);
    fs.unlink(req.file.path, () => {});
    res.status(201).json({ batch: { id: result.batchId, summary: result.summary, issues: result.issues } });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    if (err instanceof ImportRefusedError) {
      next(new AppError(409, 'ALREADY_IMPORTED', err.message));
      return;
    }
    next(err);
  }
});

importRouter.get('/batches', async (_req, res, next) => {
  try {
    const batches = await prisma.importBatch.findMany({ orderBy: { id: 'desc' }, take: 50 });
    res.json({
      batches: batches.map((b) => ({
        id: b.id,
        fileName: b.fileName,
        importedAt: b.importedAt,
        summary: b.summary,
        issueCount: Array.isArray(b.issues) ? (b.issues as unknown[]).length : 0,
      })),
    });
  } catch (err) {
    next(err);
  }
});

importRouter.get(
  '/batches/:id',
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const batch = await prisma.importBatch.findUnique({ where: { id } });
      if (!batch) throw notFound('Import batch');
      const [units, entries, expenses] = await Promise.all([
        prisma.unit.findMany({
          where: { importBatchId: id, needsReview: true },
          select: { id: true, code: true, brand: true, reviewReason: true },
        }),
        prisma.entry.findMany({
          where: { importBatchId: id, needsReview: true },
          select: { id: true, entryDate: true, description: true, grossCents: true, reviewReason: true },
        }),
        prisma.expense.findMany({
          where: { importBatchId: id, needsReview: true },
          select: { id: true, description: true, vendor: true, grossCents: true, reviewReason: true },
        }),
      ]);
      res.json({
        batch: {
          id: batch.id,
          fileName: batch.fileName,
          importedAt: batch.importedAt,
          summary: batch.summary,
          issues: batch.issues,
        },
        needsReview: {
          units,
          entries: entries.map((e) => ({ ...e, entryDate: e.entryDate.toISOString().slice(0, 10) })),
          expenses,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

/** GDPR trail: the admin's explicit decision about customer phone numbers.
 *  Phones are never imported from the Excel; this records that the admin was asked. */
importRouter.post(
  '/batches/:id/confirm-phones',
  validate({ params: z.object({ id: z.coerce.number().int() }), body: z.object({ confirm: z.boolean() }) }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const { confirm } = req.body as { confirm: boolean };
      const batch = await prisma.importBatch.findUnique({ where: { id } });
      if (!batch) throw notFound('Import batch');
      await audit('IMPORT', 'import_batches', id, undefined, {
        phoneNumbersDecision: confirm ? 'admin confirmed phones may be added manually' : 'admin declined phone import',
      });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
