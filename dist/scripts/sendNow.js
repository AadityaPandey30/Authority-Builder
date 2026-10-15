"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../database/db");
const publisher_1 = require("../publisher");
const config_1 = require("../config");
const logger_1 = require("../logger");
const notify_1 = require("./notify");
/**
 * Full end-to-end test: composes AND delivers one post, bypassing the daily
 * guard only when --force is passed. Defaults to a throwaway test date so a
 * smoke test never consumes a real day's slot.
 *
 *   npm run send:now                      # sends for postDate=today
 *   npm run send:now -- --test            # sends for 1970-01-01 (safe, repeatable)
 */
async function main() {
    const args = process.argv.slice(2);
    const useTestDate = args.includes('--test');
    const force = args.includes('--force');
    await (0, db_1.connectDb)();
    try {
        const result = await (0, publisher_1.publishDaily)({ postDate: useTestDate ? '1970-01-01' : undefined, force });
        (0, notify_1.notifyViaWhatsApp)(result);
        process.exitCode = result.status === 'failed' ? 1 : 0;
    }
    finally {
        await (0, db_1.disconnectDb)();
    }
}
main().catch((err) => {
    logger_1.logger.error({ err: err.message, url: config_1.config.WHATSAPP_SERVICE_URL }, 'send-now failed');
    process.exit(1);
});
//# sourceMappingURL=sendNow.js.map