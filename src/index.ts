import { config } from './config';
import { logger } from './logger';
import { connectDb, disconnectDb } from './database/db';
import { createServer } from './api/server';
import { startScheduler, stopScheduler } from './scheduler/scheduler';
import { loadPlaybook } from './content/playbook';
import { loadImageCatalog } from './content/images';
import { normalizeIndianPhone } from './utils/phone';

async function main(): Promise<void> {
  // Fail fast on config/data problems before opening ports or DB connections.
  const phone = normalizeIndianPhone(config.CATALYGN_RECIPIENT);
  const playbook = await loadPlaybook();
  const catalog = await loadImageCatalog();

  await connectDb();

  const app = createServer();
  const server = app.listen(config.PORT, () => {
    logger.info(
      {
        port: config.PORT,
        recipient: phone,
        timezone: config.CRON_TIMEZONE,
        cron: config.SCHEDULER_ENABLED ? config.CRON_SCHEDULE : 'disabled',
        pillars: playbook.pillars.length,
        images: catalog.length,
      },
      'catalygn content service started',
    );
  });

  startScheduler();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    stopScheduler();
    server.close();
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'unhandled rejection');
  });
}

main().catch((err) => {
  logger.error({ err: (err as Error).message }, 'fatal startup error');
  process.exit(1);
});
