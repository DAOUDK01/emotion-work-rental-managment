import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { corsOrigins, isTest } from './env.js';
import { logger } from './logger.js';
import { attachUser, blockAccountantWrites } from './middleware/auth.js';
import { csrfProtect } from './middleware/csrf.js';
import { errorHandler } from './middleware/error-handler.js';

import { authRouter } from './modules/auth/router.js';
import { usersRouter } from './modules/users/router.js';
import { settingsRouter } from './modules/settings/router.js';
import { lookupsRouter } from './modules/lookups/router.js';
import { vocabRouter } from './modules/vocab/router.js';
import { unitsRouter } from './modules/units/router.js';
import { customersRouter } from './modules/customers/router.js';
import { rentalsRouter } from './modules/rentals/router.js';
import { entriesRouter } from './modules/entries/router.js';
import { expensesRouter } from './modules/expenses/router.js';
import { investmentsRouter } from './modules/investments/router.js';
import { cashRouter } from './modules/cash/router.js';
import { productsRouter } from './modules/products/router.js';
import { stockRouter } from './modules/stock/router.js';
import { posRouter } from './modules/pos/router.js';
import { invoicesRouter } from './modules/invoices/router.js';
import { dashboardRouter } from './modules/dashboard/router.js';
import { vatRouter } from './modules/vat/router.js';
import { partnersRouter } from './modules/partners/router.js';
import { reportsRouter } from './modules/reports/router.js';
import { whatsappRouter } from './modules/whatsapp/router.js';
import { sheetsRouter } from './modules/sheets/router.js';
import { claimsRouter } from './modules/claims/router.js';
import { contractsRouter } from './modules/contracts/router.js';
import { attachmentsRouter } from './modules/attachments/router.js';
import { auditRouter } from './modules/audit/router.js';
import { importRouter } from './modules/importer/router.js';
import { gdprRouter } from './modules/gdpr/router.js';
import { publicPrivacyPage } from './modules/gdpr/public-page.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    }),
  );
  if (!isTest) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/api/health' },
      }),
    );
  }
  app.use(
    express.json({
      limit: '5mb',
      verify: (req, _res, buf) => {
        // keep the raw body for WhatsApp webhook signature validation
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  // public privacy policy (Meta needs a public URL to publish the WhatsApp app)
  api.get('/privacy', publicPrivacyPage);

  api.use(attachUser);
  api.use(csrfProtect);
  api.use(blockAccountantWrites);

  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/settings', settingsRouter);
  api.use('/lookups', lookupsRouter);
  api.use('/vocab', vocabRouter);
  api.use('/units', unitsRouter);
  api.use('/customers', customersRouter);
  api.use('/rentals', rentalsRouter);
  api.use('/entries', entriesRouter);
  api.use('/expenses', expensesRouter);
  api.use('/investments', investmentsRouter);
  api.use('/cash', cashRouter);
  api.use('/products', productsRouter);
  api.use('/stock', stockRouter);
  api.use('/pos', posRouter);
  api.use('/invoices', invoicesRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/vat', vatRouter);
  api.use('/partners', partnersRouter);
  api.use('/reports', reportsRouter);
  api.use('/whatsapp', whatsappRouter);
  api.use('/sheets', sheetsRouter);
  api.use('/claims', claimsRouter);
  api.use('/contracts', contractsRouter);
  api.use('/attachments', attachmentsRouter);
  api.use('/audit', auditRouter);
  api.use('/import', importRouter);
  api.use('/gdpr', gdprRouter);

  app.use('/api', api);
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint' } }));
  app.use(errorHandler);
  return app;
}
