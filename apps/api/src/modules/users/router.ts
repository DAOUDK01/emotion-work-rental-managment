import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { AppError, notFound } from '../../errors.js';
import { invalidateUserCache, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';

/** Admin-managed user accounts (admin creates users; no self sign-up). */
export const usersRouter = Router();

usersRouter.use(requireAuth('ADMIN'));

const userShape = {
  id: true,
  email: true,
  name: true,
  role: true,
  language: true,
  active: true,
  maxDiscountPct: true,
  createdAt: true,
} as const;

usersRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ users: await prisma.user.findMany({ select: userShape, orderBy: { id: 'asc' } }) });
  } catch (err) {
    next(err);
  }
});

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'STAFF', 'ACCOUNTANT']),
  language: z.enum(['EN', 'FI']).default('EN'),
  maxDiscountPct: z.number().int().min(0).max(100).default(100),
});

usersRouter.post('/', validate({ body: CreateUserSchema }), async (req, res, next) => {
  try {
    const data = req.body as z.infer<typeof CreateUserSchema>;
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase().trim(),
        name: data.name,
        passwordHash: await bcrypt.hash(data.password, 12),
        role: data.role,
        language: data.language,
        maxDiscountPct: data.maxDiscountPct,
      },
      select: userShape,
    });
    await audit('CREATE', 'users', user.id, undefined, user);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: z.enum(['ADMIN', 'STAFF', 'ACCOUNTANT']).optional(),
  language: z.enum(['EN', 'FI']).optional(),
  active: z.boolean().optional(),
  maxDiscountPct: z.number().int().min(0).max(100).optional(),
  password: z.string().min(8).optional(),
});

usersRouter.put(
  '/:id',
  validate({ params: z.object({ id: z.coerce.number().int() }), body: UpdateUserSchema }),
  async (req, res, next) => {
    try {
      const id = (req.params as unknown as { id: number }).id;
      const data = req.body as z.infer<typeof UpdateUserSchema>;
      const before = await prisma.user.findUnique({ where: { id }, select: userShape });
      if (!before) throw notFound('User');
      if (before.id === req.user!.id && data.active === false) {
        throw new AppError(400, 'CANT_DEACTIVATE_SELF', 'You cannot deactivate your own account');
      }
      const user = await prisma.user.update({
        where: { id },
        data: {
          name: data.name,
          role: data.role,
          language: data.language,
          active: data.active,
          maxDiscountPct: data.maxDiscountPct,
          ...(data.password ? { passwordHash: await bcrypt.hash(data.password, 12) } : {}),
        },
        select: userShape,
      });
      if (data.active === false || data.password) {
        await prisma.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      invalidateUserCache(id);
      await audit('UPDATE', 'users', id, before, user);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  },
);
