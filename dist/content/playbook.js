"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPlaybook = loadPlaybook;
exports.resetPlaybookCache = resetPlaybookCache;
const promises_1 = __importDefault(require("node:fs/promises"));
const config_1 = require("../config");
const logger_1 = require("../logger");
const URL_RE = /https?:\/\/[^\s<>"')\]]+/i;
/**
 * Parses pillar definitions out of catalygn.md.
 *
 * Supported shapes (either one is enough):
 *   1. A "## Pillars" section with bullets:  - Positioning: own a narrow niche
 *   2. Markdown headings:                     ## Positioning
 *
 * Returns an empty pillar list when the playbook does not declare any; the
 * engine then falls back to its built-in default pillars.
 */
function parsePillars(markdown) {
    const lines = markdown.split(/\r?\n/);
    // Shape 1: bullet list under a Pillars/Content pillars heading.
    const bullets = [];
    let inPillarSection = false;
    for (const line of lines) {
        const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
        if (heading) {
            inPillarSection = /pillar/i.test(heading[1] ?? '');
            continue;
        }
        if (!inPillarSection)
            continue;
        const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
        const entry = bullet?.[1]?.trim();
        if (!entry)
            continue;
        // "Positioning: own a narrow niche" | "Positioning - own a narrow niche"
        const split = /^([^:\-]{2,40}?)\s*[:\-]\s*(.+)$/.exec(entry);
        const name = (split?.[1] ?? entry).trim();
        const guidance = (split?.[2] ?? '').trim() || `Write about ${name.toLowerCase()}.`;
        bullets.push({ id: slugify(name), name, guidance });
    }
    if (bullets.length > 0)
        return dedupe(bullets);
    // Shape 2: headings that are not structural/section headers.
    const STRUCTURAL = /^(pillars?|content pillars?|playbook|overview|rules?|voice|tone|instructions?|guidelines?|cta|call to action|examples?|notes?|goal|audience|format)$/i;
    const headings = lines
        .map((line) => /^#{2,3}\s+(.+)$/.exec(line.trim())?.[1]?.trim())
        .filter((value) => Boolean(value))
        .filter((value) => !STRUCTURAL.test(value))
        .map((value) => ({
        id: slugify(value),
        name: value.replace(/[:\-]+$/, '').trim(),
        guidance: `Write about ${value.toLowerCase()}.`,
    }));
    return dedupe(headings);
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}
function dedupe(pillars) {
    const seen = new Set();
    const out = [];
    for (const pillar of pillars) {
        if (pillar.id === '' || seen.has(pillar.id))
            continue;
        seen.add(pillar.id);
        out.push(pillar);
    }
    return out;
}
/** Extracts the brand-voice section, if the playbook has one. */
function parseVoiceNotes(markdown) {
    const match = /#{1,6}\s*(?:brand\s+)?(?:voice|tone|rules|guidelines)[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(markdown);
    const body = match?.[1]?.trim();
    return body && body.length > 0 ? body : undefined;
}
function parseBookingUrl(markdown) {
    const labelled = /(?:book(?:ing)?(?:\s+(?:a\s+)?call)?|cal\.com|calendly)[^\n]*?(https?:\/\/[^\s<>"')\]]+)/i.exec(markdown);
    return labelled?.[1] ?? URL_RE.exec(markdown)?.[0];
}
let cached;
/** Reads and parses the playbook. Cached: it is static config, not per-run data. */
async function loadPlaybook() {
    if (cached)
        return cached;
    let raw;
    try {
        raw = await promises_1.default.readFile(config_1.config.CATALYGN_PLAYBOOK_PATH, 'utf8');
    }
    catch (err) {
        throw new Error(`Cannot read playbook at ${config_1.config.CATALYGN_PLAYBOOK_PATH}. ` +
            `Copy your catalygn.md there or set CATALYGN_PLAYBOOK_PATH. (${err.message})`);
    }
    if (raw.trim() === '') {
        throw new Error(`Playbook at ${config_1.config.CATALYGN_PLAYBOOK_PATH} is empty`);
    }
    const pillars = parsePillars(raw);
    const bookingUrl = config_1.config.CATALYGN_BOOKING_URL || parseBookingUrl(raw);
    cached = { raw, pillars, bookingUrl, voiceNotes: parseVoiceNotes(raw) };
    logger_1.logger.info({ pillars: cached.pillars.map((p) => p.id), bookingUrl: bookingUrl ?? null }, 'playbook loaded');
    return cached;
}
/** Test seam: clears the memoized playbook. */
function resetPlaybookCache() {
    cached = undefined;
}
//# sourceMappingURL=playbook.js.map