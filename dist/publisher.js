"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishDaily = publishDaily;
exports.composeOnly = composeOnly;
exports.publicationHistory = publicationHistory;
const config_1 = require("./config");
const logger_1 = require("./logger");
const Publication_1 = require("./database/models/Publication");
const TopicHistory_1 = require("./database/models/TopicHistory");
const phone_1 = require("./utils/phone");
const date_1 = require("./utils/date");
const playbook_1 = require("./content/playbook");
const images_1 = require("./content/images");
const gemini_1 = require("./content/gemini");
const client_1 = require("./whatsapp/client");
/** How many past topic labels to feed back as an explicit "do not repeat" list. */
const RECENT_TOPIC_WINDOW = 20;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Claims the date slot atomically. Returns undefined when another run already
 * owns this postDate, which is what makes a duplicate cron tick or a manual
 * /run racing the scheduler a no-op instead of a second message.
 */
async function claimDate(postDate, phone) {
    try {
        const doc = await Publication_1.Publication.create({
            postDate,
            phone,
            status: 'pending',
            pillarId: 'pending',
            topic: 'pending',
            imageUrl: 'pending',
            caption: 'pending',
            attempts: 0,
        });
        return String(doc._id);
    }
    catch (err) {
        const code = err.code;
        if (code === 11000) {
            logger_1.logger.info({ postDate }, 'date slot already claimed; skipping duplicate publication');
            return undefined;
        }
        throw err;
    }
}
/**
 * Runs the full daily pipeline for one IST date: pillar -> content -> image ->
 * send. Idempotent per date. Safe to call concurrently; exactly one caller
 * proceeds.
 */
async function publishDaily(options = {}) {
    const postDate = options.postDate ?? (0, date_1.istDateString)();
    const phone = (0, phone_1.normalizeIndianPhone)(config_1.config.CATALYGN_RECIPIENT);
    // Pre-flight: refuse to consume the day's slot if content inputs are broken.
    const playbook = await (0, playbook_1.loadPlaybook)();
    const catalog = await (0, images_1.loadImageCatalog)();
    if (options.force) {
        // Manual re-run of an existing date: clear the guard intentionally.
        await Publication_1.Publication.deleteMany({ postDate, status: { $ne: 'sent' } });
    }
    const publicationId = await claimDate(postDate, phone);
    if (publicationId === undefined) {
        const existing = await Publication_1.Publication.findOne({ postDate }).lean();
        if (existing?.status === 'sent') {
            return { status: 'already_published', postDate, phone, publicationId: String(existing._id) };
        }
        return { status: 'in_progress', postDate, phone, error: 'Another run holds this date slot' };
    }
    try {
        const recentTopics = await TopicHistory_1.TopicHistory.find()
            .sort({ createdAt: -1 })
            .limit(RECENT_TOPIC_WINDOW)
            .lean()
            .then((rows) => rows.map((row) => row.topic));
        const recentPillars = await TopicHistory_1.TopicHistory.find()
            .sort({ createdAt: -1 })
            .limit(6)
            .lean()
            .then((rows) => rows.map((row) => row.pillarId));
        const pillars = playbook.pillars.length > 0 ? playbook.pillars : [];
        // Deterministic daily salt keeps rotation stable across retries of one day,
        // while the least-recently-used rule prevents repeating yesterday's pillar.
        const salt = Number(postDate.replace(/-/g, '')) % 1000;
        const pillar = await (0, gemini_1.selectPillar)(pillars, recentPillars, salt);
        logger_1.logger.info({ postDate, pillar: pillar.id }, 'generating daily post');
        const generated = await (0, gemini_1.generatePost)({ pillar, recentTopics });
        const recentImages = await (0, images_1.recentImageUrls)();
        const choice = await (0, images_1.pickImage)(catalog, pillar, recentImages);
        const post = { ...generated, imageUrl: choice.url };
        await Publication_1.Publication.updateOne({ _id: publicationId }, {
            $set: {
                pillarId: post.pillarId,
                topic: post.topic,
                imageUrl: post.imageUrl,
                caption: post.caption,
            },
        });
        let lastError = 'unknown error';
        for (let attempt = 1; attempt <= config_1.config.SEND_MAX_ATTEMPTS; attempt += 1) {
            await Publication_1.Publication.updateOne({ _id: publicationId }, { $inc: { attempts: 1 } });
            const result = await (0, client_1.sendPost)({
                agencyId: config_1.config.CATALYGN_AGENCY_ID,
                clientId: config_1.config.CATALYGN_CLIENT_ID,
                phone,
                imageUrl: post.imageUrl,
                caption: post.caption,
            });
            if (result.ok) {
                await Publication_1.Publication.updateOne({ _id: publicationId }, {
                    $set: {
                        status: 'sent',
                        sentAt: new Date(),
                        whatsappResponse: result.body,
                        lastError: undefined,
                    },
                });
                await (0, images_1.recordImageUsage)(post.imageUrl, post.pillarId, postDate);
                await TopicHistory_1.TopicHistory.updateOne({ postDate }, { $set: { pillarId: post.pillarId, topic: post.topic } }, { upsert: true });
                logger_1.logger.info({ postDate, pillar: post.pillarId, topic: post.topic, attempts: attempt }, 'daily post delivered');
                return { status: 'sent', postDate, phone, publicationId, post };
            }
            lastError = `whatsapp-service responded ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}`;
            logger_1.logger.warn({ attempt, postDate, error: lastError }, 'send attempt failed');
            if (attempt < config_1.config.SEND_MAX_ATTEMPTS) {
                await sleep(config_1.config.SEND_BACKOFF_MS * 2 ** (attempt - 1));
            }
        }
        await Publication_1.Publication.updateOne({ _id: publicationId }, { $set: { status: 'failed', lastError } });
        logger_1.logger.error({ postDate, error: lastError }, 'daily post failed after all attempts');
        return { status: 'failed', postDate, phone, publicationId, post, error: lastError };
    }
    catch (err) {
        const message = err.message;
        await Publication_1.Publication.updateOne({ _id: publicationId }, { $set: { status: 'failed', lastError: message } });
        logger_1.logger.error({ postDate, err: message }, 'daily post threw');
        return { status: 'failed', postDate, phone, publicationId, error: message };
    }
}
/**
 * Composes a post WITHOUT sending it. Used by the manual test command so the
 * caption and image can be inspected before arming the schedule.
 */
async function composeOnly(postDate = (0, date_1.istDateString)()) {
    const playbook = await (0, playbook_1.loadPlaybook)();
    const catalog = await (0, images_1.loadImageCatalog)();
    const recentTopics = await TopicHistory_1.TopicHistory.find()
        .sort({ createdAt: -1 })
        .limit(RECENT_TOPIC_WINDOW)
        .lean()
        .then((rows) => rows.map((row) => row.topic));
    const recentPillars = await TopicHistory_1.TopicHistory.find()
        .sort({ createdAt: -1 })
        .limit(6)
        .lean()
        .then((rows) => rows.map((row) => row.pillarId));
    const salt = Number(postDate.replace(/-/g, '')) % 1000;
    const pillar = await (0, gemini_1.selectPillar)(playbook.pillars, recentPillars, salt);
    const generated = await (0, gemini_1.generatePost)({ pillar, recentTopics });
    const choice = await (0, images_1.pickImage)(catalog, pillar, await (0, images_1.recentImageUrls)());
    return { ...generated, imageUrl: choice.url };
}
/** Recent publication history, newest first. */
async function publicationHistory(limit = 20) {
    const rows = await Publication_1.Publication.find().sort({ postDate: -1 }).limit(limit).lean();
    return rows.map((row) => ({
        postDate: row.postDate,
        status: row.status,
        pillarId: row.pillarId,
        topic: row.topic,
        attempts: row.attempts,
        sentAt: row.sentAt ? (0, date_1.istIsoString)(row.sentAt) : null,
        lastError: row.lastError ?? null,
    }));
}
//# sourceMappingURL=publisher.js.map