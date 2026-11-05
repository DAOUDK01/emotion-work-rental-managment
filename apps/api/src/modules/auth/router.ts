import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { env, isTest } from '../../env.js';
import { AppError, unauthorized } from '../../errors.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  type AuthUser,
  requireAuth,
  signAccessToken,
} from '../../middleware/auth.js';
import { issueCsrfCookie } from '../../middleware/csrf.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../services/audit.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts, try again later' } },
});

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function cookieBase() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: env.COOKIE_SECURE, path: '/' };
}

async function issueSession(res: Response, user: AuthUser, userAgent?: string) {
  const access = signAccessToken(user);
  const refreshRaw = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_DAYS * 24 * 3600 * 1000);
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: sha256(refreshRaw), expiresAt, userAgent: userAgent?.slice(0, 250) },
  });
  res.cookie(ACCESS_COOKIE, access, { ...cookieBase(), maxAge: env.JWT_ACCESS_MINUTES * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refreshRaw, {
    ...cookieBase(),
    path: '/api/auth',
    maxAge: env.JWT_REFRESH_DAYS * 24 * 3600 * 1000,
  });
  issueCsrfCookie(res);
}

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post('/login', loginLimiter, validate({ body: LoginSchema }), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof LoginSchema>;
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new AppError(401, 'BAD_CREDENTIALS', 'Wrong email or password');
    }
    const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    await issueSession(res, authUser, req.headers['user-agent']);
    await audit('LOGIN', 'users', user.id);
    res.json({ user: { ...authUser, language: user.language, maxDiscountPct: user.maxDiscountPct } });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) throw unauthorized('No session');
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.active) {
      throw unauthorized('Session expired');
    }
    // Atomic single-use rotation: of two concurrent refreshes with the same token, only one wins.
    const revoked = await prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw unauthorized('Session expired');
    const user: AuthUser = {
      id: stored.user.id,
      email: stored.user.email,
      name: stored.user.name,
      role: stored.user.role,
    };
    await issueSession(res, user, req.headers['user-agent']);
    res.json({
      user: { ...user, language: stored.user.language, maxDiscountPct: stored.user.maxDiscountPct },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (raw) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(raw), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    if (req.user) await audit('LOGOUT', 'users', req.user.id);
    res.clearCookie(ACCESS_COOKIE, cookieBase());
    res.clearCookie(REFRESH_COOKIE, { ...cookieBase(), path: '/api/auth' });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth(), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !user.active) throw unauthorized();
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        language: user.language,
        maxDiscountPct: user.maxDiscountPct,
      },
    });
  } catch (err) {
    next(err);
  }
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

authRouter.post(
  '/change-password',
  requireAuth(),
  validate({ body: ChangePasswordSchema }),
  async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body as z.infer<typeof ChangePasswordSchema>;
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
        throw new AppError(400, 'BAD_CURRENT_PASSWORD', 'Current password is wrong');
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      });
      // sign other sessions out
      await prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit('UPDATE', 'users', user.id, { password: '[changed]' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);
