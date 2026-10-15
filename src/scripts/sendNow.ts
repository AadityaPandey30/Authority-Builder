import { connectDb, disconnectDb } from '../database/db';
import { publishDaily } from '../publisher';
import { config } from '../config';
import { logger } from '../logger';
import { notifyViaWhatsApp } from './notify';

/**
 * Full end-to-end test: composes AND delivers one post. Test runs use a
 * throwaway date and reclaim any non-sent record for that date so a stale
 * interrupted attempt cannot block a real-time retry.
 *
 *   npm run send:now                      # sends for postDate=today
 *   npm run send:test                     # sends for 1970-01-01 (safe, repeatable)
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useTestDate = args.includes('--test');
  const force = useTestDate || args.includes('--force');

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
