import pino from 'pino';

import { config } from '../config';

/**
 * Shared pino logger. Matches the whatsapp-service convention (pino, level
 * from LOG_LEVEL) so both processes log in the same shape.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'catalygn-content-service' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
