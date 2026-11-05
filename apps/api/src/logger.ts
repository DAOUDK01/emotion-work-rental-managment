import pino from 'pino';
import { env, isProd, isTest } from './env.js';

export const logger = pino({
  level: isTest ? 'warn' : env.NODE_ENV === 'development' ? 'debug' : 'info',
  transport: !isProd && !isTest ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'password', '*.password', '*.passwordHash'],
    censor: '[redacted]',
  },
});
