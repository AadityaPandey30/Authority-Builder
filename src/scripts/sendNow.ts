import { connectDb, disconnectDb } from '../database/db';
import { publishDaily } from '../publisher';
import { config } from '../config';
import { logger } from '../logger';
import { notifyViaWhatsApp } from './notify';

/**
 * Full end-to-end test: composes AND delivers one post, bypassing the daily
 * guard only when --force is passed. Defaults to a throwaway test date so a
 * smoke test never consumes a real day's slot.
 *
 *   npm run send:now                      # sends for postDate=today
 *   npm run send:now -- --test            # sends for 1970-01-01 (safe, repeatable)
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useTestDate = args.includes('--test');
  const force = args.includes('--force');

  await connectDb();
  try {
    const result = await publishDaily({ postDate: useTestDate ? '1970-01-01' : undefined, force });
    notifyViaWhatsApp(result);
    process.exitCode = result.status === 'failed' ? 1 : 0;
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  logger.error({ err: (err as Error).message, url: config.WHATSAPP_SERVICE_URL }, 'send-now failed');
  process.exit(1);
});
