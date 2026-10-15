import cron, { type ScheduledTask } from 'node-cron';

import { config } from '../config';
import { logger } from '../logger';
import { publishDaily } from '../publisher';

let task: ScheduledTask | undefined;

/**
 * Arms the daily job. Fires at CRON_SCHEDULE in CRON_TIMEZONE (Asia/Kolkata by
 * default, so 12:00 means noon IST regardless of host timezone).
 *
 * Overlap is handled inside publishDaily: the date-slot claim means a tick that
 * runs long and a following tick cannot both deliver.
 */
export function startScheduler(): ScheduledTask | undefined {
  if (!config.SCHEDULER_ENABLED) {
    logger.warn('SCHEDULER_ENABLED=false - daily schedule is NOT armed');
    return undefined;
  }

  if (!cron.validate(config.CRON_SCHEDULE)) {
    throw new Error(`Invalid CRON_SCHEDULE: ${config.CRON_SCHEDULE}`);
  }

  task = cron.schedule(
    config.CRON_SCHEDULE,
    async () => {
      logger.info({ cron: config.CRON_SCHEDULE, tz: config.CRON_TIMEZONE }, 'scheduler tick');
      try {
        const result = await publishDaily();
        logger.info({ result: result.status, postDate: result.postDate }, 'scheduler tick complete');
      } catch (err) {
        // Never let a rejection escape into node-cron; log and wait for tomorrow.
        logger.error({ err: (err as Error).message }, 'scheduler tick threw');
      }
    },
    { timezone: config.CRON_TIMEZONE },
  );

  logger.info({ cron: config.CRON_SCHEDULE, tz: config.CRON_TIMEZONE }, 'daily scheduler armed');
  return task;
}

export function stopScheduler(): void {
  task?.stop();
  task = undefined;
}
