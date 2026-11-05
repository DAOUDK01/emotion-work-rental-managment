import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { unauthorized, forbidden } from '../errors.js';
import { requestContext } from '../context.js';
import { prisma } from '../db.js';

export type RoleName = 'ADMIN' | 'STAFF' | 'ACCOUNTANT';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: RoleName;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export const ACCESS_COOKIE = 'emf_access';
export const REFRESH_COOKIE = 'emf_refresh';
export const CSRF_COOKIE = 'emf_csrf';

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(
    { sub: String(user.id), email: user.email, name: user.name, role: user.role },
    env.JWT_SECRET,
    { expiresIn: `${env.JWT_ACCESS_MINUTES}m` },
  );
}

export function verifyAccessToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    if (!payload.sub) return null;
    return {
      id: Number(payload.sub),
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      role: payload.role as RoleName,
    };
  } catch {
    return null;
  }
}

/**
 * The token's role/active state is re-checked against the database (cached a few
 * seconds), so deactivating or demoting a user takes effect at once instead of
 * when their 15-minute access token expires.
 */
const USER_CACHE_MS = 5_000;
const userCache = new Map<number, { active: boolean; role: RoleName; at: number }>();

export function invalidateUserCache(userId: number): void {
  userCache.delete(userId);
}

async function currentState(userId: number): Promise<{ active: boolean; role: RoleName } | null> {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { active: true, role: true } });
  if (!row) {
    userCache.delete(userId);
    return null;
  }
  const state = { active: row.active, role: row.role as RoleName, at: Date.now() };
  userCache.set(userId, state);
  return state;
}

/** Reads the access-token cookie (or Bearer header) and populates req.user when valid. */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const bearer = req.headers.authorization;
    const token =
      (req.cookies?.[ACCESS_COOKIE] as string | undefined) ??
      (bearer?.startsWith('Bearer ') ? bearer.slice(7) : undefined);
    if (token) {
      const user = verifyAccessToken(token);
      if (user) {
        const state = await currentState(user.id);
        if (state?.active) req.user = { ...user, role: state.role };
      }
    }
  } catch (err) {
    return next(err);
  }
  requestContext.run({ userId: req.user?.id, role: req.user?.role, ip: req.ip }, () => next());
}

/** Requires a signed-in user, optionally restricted to specific roles. */
export function requireAuth(...roles: RoleName[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return next(forbidden('Your role does not allow this'));
    }
    next();
  };
}

/** Accountant role is read-only: block mutating methods for accountants globally. */
export function blockAccountantWrites(req: Request, _res: Response, next: NextFunction): void {
  if (
    req.user?.role === 'ACCOUNTANT' &&
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    // accountants may still manage their own session and password
    !(
      req.method === 'POST' &&
      ['/auth/change-password', '/auth/logout', '/auth/refresh'].includes(req.path)
    )
  ) {
    return next(forbidden('Accountant access is read-only'));
  }
  next();
}
