import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_ACCESS_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  UPLOAD_DIR: z.string().default('./uploads'),
  SEED_ADMIN_PASSWORD: z.string().default('ChangeMe!123'),

  WHATSAPP_VERIFY_TOKEN: z.string().optional().default(''),
  WHATSAPP_APP_SECRET: z.string().optional().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(''),

  GOOGLE_SERVICE_ACCOUNT_FILE: z.string().optional().default(''),
  GOOGLE_SHEET_ID: z.string().optional().default(''),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('E Motion Works Oy <noreply@example.com>'),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
   
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
     
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
export const corsOrigins = env.CORS_ORIGINS.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
