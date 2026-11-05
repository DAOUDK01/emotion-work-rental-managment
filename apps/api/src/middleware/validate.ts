import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { AppError } from '../errors.js';

/**
 * Zod validation on every endpoint. Usage:
 *   router.post('/', validate({ body: CreateSchema }), handler)
 * Parsed values replace req.body / req.query / req.params.
 */
export function validate<B extends ZodTypeAny, Q extends ZodTypeAny, P extends ZodTypeAny>(schemas: {
  body?: B;
  query?: Q;
  params?: P;
}) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body) as z.infer<B>;
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query) as z.infer<Q>;
        Object.defineProperty(req, 'query', { value: parsed, writable: true });
      }
      if (schemas.params) {
        const parsed = schemas.params.parse(req.params) as z.infer<P>;
        Object.defineProperty(req, 'params', { value: parsed, writable: true });
      }
      next();
    } catch (err: any) {
      const details = err?.issues?.map((i: any) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      }));
      next(new AppError(400, 'VALIDATION', 'Invalid input', details));
    }
  };
}
