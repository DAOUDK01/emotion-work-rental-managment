/** Application errors carry an HTTP status and a stable machine code.
 *  The web app translates codes to EN/FI; `message` is a plain-English fallback. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code: string, message?: string, details?: unknown) =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'Not signed in') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Not allowed') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Record') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message?: string) => new AppError(409, code, message);
