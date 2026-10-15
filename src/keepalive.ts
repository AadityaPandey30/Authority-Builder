import { config } from './config';
import { logger } from './logger';

const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;

let timer: NodeJS.Timeout | undefined;

export function startKeepalive(): void {
  if (!config.KEEPALIVE_ENABLED) {
    logger.info('KEEPALIVE_ENABLED=false - keepalive pinger is disabled');
    return;
  }

  if (!config.KEEPALIVE_URL) {
    throw new Error('KEEPALIVE_URL is required when KEEPALIVE_ENABLED=true');
  }

  const ping = async (): Promise<void> => {
    try {
      const response = await fetch(config.KEEPALIVE_URL, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) {
        logger.warn({ status: response.status, url: config.KEEPALIVE_URL }, 'keepalive ping failed');
        return;
      }
      logger.debug({ url: config.KEEPALIVE_URL }, 'keepalive ping complete');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'keepalive ping failed');
    }
  };

  timer = setInterval(() => void ping(), KEEPALIVE_INTERVAL_MS);
  timer.unref();
  void ping();
  logger.info({ intervalMinutes: 10, url: config.KEEPALIVE_URL }, 'keepalive pinger armed');
}

export function stopKeepalive(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
