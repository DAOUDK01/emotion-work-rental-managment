import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE } from './auth.js';
import { env } from '../env.js';
import { AppError } from '../errors.js';

/**
 * CSRF protection for cookie-based auth (double-submit cookie):
 * the readable emf_csrf cookie must be echoed in the X-CSRF-Token header
 * on every mutating request. The WhatsApp webhook is exempt — it is
 * authenticated by Meta's X-Hub-Signature-256 instead.
 */

export function issueCsrfCookie(res: Response): string {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
  return token;
}

const EXEMPT_PATHS = [/^\/whatsapp\/webhook/, /^\/auth\/login$/, /^\/auth\/refresh$/, /^\/health$/];

export function csrfProtect(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (EXEMPT_PATHS.some((re) => re.test(req.path))) return next();
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.headers['x-csrf-token'];
  if (!cookie || !header || header !== cookie) {
    return next(new AppError(403, 'CSRF', 'Missing or invalid CSRF token'));
  }
  next();
}
