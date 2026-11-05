import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { AppError, notFound } from '../../errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';
import { currentUserId } from '../../context.js';

/** Receipt photos, rental agreements, unit photos, product images, claim documents.
 *  Files live under UPLOAD_DIR with random names; downloads require a signed-in user. */
export const attachmentsRouter = Router();

const uploadDir = path.resolve(env.UPLOAD_DIR);
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(0, 10) || '.bin';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new AppError(400, 'BAD_FILE_TYPE', 'Only images (JPEG/PNG/WebP/HEIC) and PDFs are allowed'));
  },
});

const LinkSchema = z.object({
  unitId: z.coerce.number().int().optional(),
  expenseId: z.coerce.number().int().optional(),
  rentalId: z.coerce.number().int().optional(),
  invoiceId: z.coerce.number().int().optional(),
  claimId: z.coerce.number().int().optional(),
  productId: z.coerce.number().int().optional(),
  customerId: z.coerce.number().int().optional(),
});

attachmentsRouter.post('/', requireAuth('ADMIN', 'STAFF'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(400, 'NO_FILE', 'Attach a file in the "file" field');
    const links = LinkSchema.parse(req.body ?? {});
    const sha = await sha256File(req.file.path);
    const attachment = await prisma.attachment.create({
      data: {
        fileName: req.file.originalname.slice(0, 200),
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        path: path.basename(req.file.path),
        sha256: sha,
        uploadedById: currentUserId() ?? null,
        ...links,
      },
    });
    await audit('CREATE', 'attachments', attachment.id, undefined, {
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
      links,
    });
    res.status(201).json({ attachment });
  } catch (err) {
    next(err);
  }
});

attachmentsRouter.get(
  '/:id',
  requireAuth(),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const attachment = await prisma.attachment.findUnique({ where: { id } });
      if (!attachment) throw notFound('Attachment');
      const filePath = path.join(uploadDir, attachment.path);
      if (!fs.existsSync(filePath)) throw notFound('File');
      res.setHeader('Content-Type', attachment.mimeType);
      res.setHeader(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      );
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      next(err);
    }
  },
);

attachmentsRouter.delete(
  '/:id',
  requireAuth('ADMIN'),
  validate({ params: z.object({ id: z.coerce.number().int() }) }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: number };
      const attachment = await prisma.attachment.findUnique({ where: { id } });
      if (!attachment) throw notFound('Attachment');
      await prisma.attachment.delete({ where: { id } });
      const filePath = path.join(uploadDir, attachment.path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await audit('DELETE', 'attachments', id, attachment);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}
