"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const express_1 = __importDefault(require("express"));
const config_1 = require("../config");
const logger_1 = require("../logger");
const publisher_1 = require("../publisher");
const client_1 = require("../whatsapp/client");
const date_1 = require("../utils/date");
const phone_1 = require("../utils/phone");
const auth_1 = require("./middleware/auth");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parsePostDate(raw) {
    if (raw === undefined)
        return undefined;
    if (typeof raw !== 'string' || !DATE_RE.test(raw)) {
        throw new Error('postDate must be a YYYY-MM-DD string');
    }
    const parsed = new Date(`${raw}T00:00:00+05:30`);
    if (Number.isNaN(parsed.getTime()) || (0, date_1.istDateString)(parsed) !== raw) {
        throw new Error(`postDate is not a valid calendar date: ${raw}`);
    }
    return raw;
}
function createServer() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: '64kb' }));
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            service: 'catalygn-content-service',
            timezone: config_1.config.CRON_TIMEZONE,
            now: (0, date_1.istIsoString)(),
            schedule: config_1.config.SCHEDULER_ENABLED ? config_1.config.CRON_SCHEDULE : 'disabled',
        });
    });
    // Operator-facing summary: recipient, schedule, last post.
    app.get('/status', auth_1.requireAdmin, async (_req, res) => {
        try {
            const history = await (0, publisher_1.publicationHistory)(5);
            const wa = await (0, client_1.whatsappServiceStatus)();
            res.json({
                recipient: (0, phone_1.normalizeIndianPhone)(config_1.config.CATALYGN_RECIPIENT),
                today: (0, date_1.istDateString)(),
                schedule: config_1.config.SCHEDULER_ENABLED ? config_1.config.CRON_SCHEDULE : 'disabled',
                timezone: config_1.config.CRON_TIMEZONE,
                geminiModel: config_1.config.GEMINI_MODEL,
                whatsappService: { url: config_1.config.WHATSAPP_SERVICE_URL, reachable: wa.reachable, status: wa.status ?? null },
                recentPublications: history,
            });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/history', auth_1.requireAdmin, async (req, res) => {
        const limitRaw = Number.parseInt(String(req.query.limit ?? '20'), 10);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
        try {
            res.json({ publications: await (0, publisher_1.publicationHistory)(limit) });
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    /**
     * Dry run: composes a caption + image and returns them WITHOUT sending.
     * This is the safe way to check formatting before arming the schedule.
     */
    app.post('/test', auth_1.requireAdmin, async (req, res) => {
        try {
            const postDate = parsePostDate(req.body?.postDate) ?? (0, date_1.istDateString)();
            const post = await (0, publisher_1.composeOnly)(postDate);
            res.json({ dryRun: true, postDate, recipient: (0, phone_1.normalizeIndianPhone)(config_1.config.CATALYGN_RECIPIENT), post });
        }
        catch (err) {
            logger_1.logger.error({ err: err.message }, 'test composition failed');
            res.status(400).json({ error: err.message });
        }
    });
    /**
     * Real run. Idempotent per postDate: a second call for a date already sent is
     * a no-op unless force=true.
     */
    app.post('/run', auth_1.requireAdmin, async (req, res) => {
        try {
            const postDate = parsePostDate(req.body?.postDate) ?? (0, date_1.istDateString)();
            const force = req.body?.force === true;
            // Validation before any side effect: a test send may not target an
            // arbitrary number, so a mistake in config cannot message a stranger.
            const phone = (0, phone_1.normalizeIndianPhone)(config_1.config.CATALYGN_RECIPIENT);
            if (config_1.config.SEND_TEST_ALLOWLIST.length > 0 && !config_1.config.SEND_TEST_ALLOWLIST.some((n) => (0, phone_1.isSamePhone)(n, phone))) {
                res.status(403).json({
                    error: `Recipient ${phone} is not in SEND_TEST_ALLOWLIST`,
                    allowlist: config_1.config.SEND_TEST_ALLOWLIST,
                });
                return;
            }
            const result = await (0, publisher_1.publishDaily)({ postDate, force });
            const code = result.status === 'failed' ? 502 : result.status === 'in_progress' ? 409 : 200;
            res.status(code).json(result);
        }
        catch (err) {
            logger_1.logger.error({ err: err.message }, 'manual run failed');
            res.status(400).json({ error: err.message });
        }
    });
    // Express error handler: keeps a bad JSON body from crashing the process.
    app.use((err, _req, res, _next) => {
        logger_1.logger.error({ err: err.message }, 'unhandled request error');
        res.status(400).json({ error: err.message });
    });
    return app;
}
//# sourceMappingURL=server.js.map