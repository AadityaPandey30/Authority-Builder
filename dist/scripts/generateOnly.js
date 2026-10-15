"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../database/db");
const publisher_1 = require("../publisher");
const phone_1 = require("../utils/phone");
const date_1 = require("../utils/date");
const config_1 = require("../config");
const logger_1 = require("../logger");
/**
 * Manual test command: composes a post and prints it WITHOUT sending.
 * Run before arming the schedule to check caption formatting and the image URL.
 *
 *   npm run test:generate
 *   npm run test:generate -- 2026-01-01
 */
async function main() {
    const postDate = process.argv[2];
    await (0, db_1.connectDb)();
    try {
        const post = await (0, publisher_1.composeOnly)(postDate);
        const phone = (0, phone_1.normalizeIndianPhone)(config_1.config.CATALYGN_RECIPIENT);
        process.stdout.write([
            '',
            '=== DRY RUN (nothing was sent) ===',
            `Time (IST):  ${(0, date_1.istIsoString)()}`,
            `Recipient:   ${phone}`,
            `Model:       ${post.model}`,
            `Pillar:      ${post.pillarId}`,
            `Topic:       ${post.topic}`,
            `Image URL:   ${post.imageUrl}`,
            `Chars:       ${post.caption.length}`,
            '',
            '--- Caption as WhatsApp will receive it ---',
            post.caption,
            '--- end caption ---',
            '',
        ].join('\n'));
    }
    finally {
        await (0, db_1.disconnectDb)();
    }
}
main().catch((err) => {
    logger_1.logger.error({ err: err.message }, 'generate-only failed');
    process.exit(1);
});
//# sourceMappingURL=generateOnly.js.map