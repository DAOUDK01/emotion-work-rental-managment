import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';
import { isProd } from '../env.js';

/** Final error handler: plain-language messages, stable codes, no stack leaks in production. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        error: { code: 'DUPLICATE', message: 'A record with the same unique value already exists', details: err.meta },
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
      return;
    }
    if (err.code === 'P2003') {
      res.status(409).json({
        error: { code: 'IN_USE', message: 'This record is referenced by other records and cannot be changed this way' },
      });
      return;
    }
  }
  logger.error({ err, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: isProd ? 'Something went wrong on the server' : String((err as Error)?.message ?? err),
    },
  });
}
