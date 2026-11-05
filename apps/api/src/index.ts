import { createApp } from './app.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { prisma } from './db.js';
import { startJobs, stopJobs } from './jobs/boss.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`E Motion Works API listening on http://localhost:${env.PORT}`);
});

startJobs().catch((err) => logger.error({ err }, 'job system failed to start'));

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  await stopJobs();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
