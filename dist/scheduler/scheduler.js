"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduler = startScheduler;
exports.stopScheduler = stopScheduler;
const node_cron_1 = __importDefault(require("node-cron"));
const config_1 = require("../config");
const logger_1 = require("../logger");
const publisher_1 = require("../publisher");
let task;
/**
 * Arms the daily job. Fires at CRON_SCHEDULE in CRON_TIMEZONE (Asia/Kolkata by
 * default, so 12:00 means noon IST regardless of host timezone).
 *
 * Overlap is handled inside publishDaily: the date-slot claim means a tick that
 * runs long and a following tick cannot both deliver.
 */
function startScheduler() {
    if (!config_1.config.SCHEDULER_ENABLED) {
        logger_1.logger.warn('SCHEDULER_ENABLED=false - daily schedule is NOT armed');
        return undefined;
    }
    if (!node_cron_1.default.validate(config_1.config.CRON_SCHEDULE)) {
        throw new Error(`Invalid CRON_SCHEDULE: ${config_1.config.CRON_SCHEDULE}`);
    }
    task = node_cron_1.default.schedule(config_1.config.CRON_SCHEDULE, async () => {
        logger_1.logger.info({ cron: config_1.config.CRON_SCHEDULE, tz: config_1.config.CRON_TIMEZONE }, 'scheduler tick');
        try {
            const result = await (0, publisher_1.publishDaily)();
            logger_1.logger.info({ result: result.status, postDate: result.postDate }, 'scheduler tick complete');
        }
        catch (err) {
            // Never let a rejection escape into node-cron; log and wait for tomorrow.
            logger_1.logger.error({ err: err.message }, 'scheduler tick threw');
        }
    }, { timezone: config_1.config.CRON_TIMEZONE });
    logger_1.logger.info({ cron: config_1.config.CRON_SCHEDULE, tz: config_1.config.CRON_TIMEZONE }, 'daily scheduler armed');
    return task;
}
function stopScheduler() {
    task?.stop();
    task = undefined;
}
//# sourceMappingURL=scheduler.js.map