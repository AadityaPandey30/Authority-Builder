"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const logger_1 = require("./logger");
const db_1 = require("./database/db");
const server_1 = require("./api/server");
const scheduler_1 = require("./scheduler/scheduler");
const playbook_1 = require("./content/playbook");
const images_1 = require("./content/images");
const phone_1 = require("./utils/phone");
async function main() {
    // Fail fast on config/data problems before opening ports or DB connections.
    const phone = (0, phone_1.normalizeIndianPhone)(config_1.config.CATALYGN_RECIPIENT);
    const playbook = await (0, playbook_1.loadPlaybook)();
    const catalog = await (0, images_1.loadImageCatalog)();
    await (0, db_1.connectDb)();
    const app = (0, server_1.createServer)();
    const server = app.listen(config_1.config.PORT, () => {
        logger_1.logger.info({
            port: config_1.config.PORT,
            recipient: phone,
            timezone: config_1.config.CRON_TIMEZONE,
            cron: config_1.config.SCHEDULER_ENABLED ? config_1.config.CRON_SCHEDULE : 'disabled',
            pillars: playbook.pillars.length,
            images: catalog.length,
        }, 'catalygn content service started');
    });
    (0, scheduler_1.startScheduler)();
    const shutdown = async (signal) => {
        logger_1.logger.info({ signal }, 'shutting down');
        (0, scheduler_1.stopScheduler)();
        server.close();
        await (0, db_1.disconnectDb)();
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('unhandledRejection', (reason) => {
        logger_1.logger.error({ reason: String(reason) }, 'unhandled rejection');
    });
}
main().catch((err) => {
    logger_1.logger.error({ err: err.message }, 'fatal startup error');
    process.exit(1);
});
//# sourceMappingURL=index.js.map