"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadImageCatalog = loadImageCatalog;
exports.pickImage = pickImage;
exports.recentImageUrls = recentImageUrls;
exports.recordImageUsage = recordImageUsage;
exports.resetImageCache = resetImageCache;
const promises_1 = __importDefault(require("node:fs/promises"));
const config_1 = require("../config");
const logger_1 = require("../logger");
/** How many recent images to keep out of rotation. */
const RECENT_IMAGE_WINDOW = 14;
/**
 * Accepts either images.json shape:
 *   [ { "url": "https://...", "pillars": ["positioning"], "alt": "..." } ]
 *   [ "https://...", "https://..." ]
 *   { "images": [ ...either of the above... ] }
 */
function normalizeCatalog(parsed) {
    const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.images)
            ? (parsed.images)
            : [];
    const out = [];
    for (const entry of list) {
        if (typeof entry === 'string') {
            if (entry.trim() !== '')
                out.push({ url: entry.trim(), pillars: [] });
            continue;
        }
        if (entry !== null && typeof entry === 'object') {
            const raw = entry;
            const url = typeof raw.url === 'string' ? raw.url : typeof raw.imageUrl === 'string' ? raw.imageUrl : undefined;
            if (!url || url.trim() === '')
                continue;
            const pillars = Array.isArray(raw.pillars)
                ? raw.pillars.filter((p) => typeof p === 'string').map(slugify)
                : typeof raw.pillar === 'string'
                    ? [slugify(raw.pillar)]
                    : [];
            out.push({
                url: url.trim(),
                pillars,
                alt: typeof raw.alt === 'string' ? raw.alt : undefined,
            });
        }
    }
    return out;
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}
let cachedCatalog;
/** Reads and validates images.json with strict-up-front loading. */
async function loadImageCatalog() {
    if (cachedCatalog)
        return cachedCatalog;
    let raw;
    try {
        raw = await promises_1.default.readFile(config_1.config.CATALYGN_IMAGES_PATH, 'utf8');
    }
    catch (err) {
        throw new Error(`Cannot read images catalog at ${config_1.config.CATALYGN_IMAGES_PATH}. ` +
            `Copy your images.json there or set CATALYGN_IMAGES_PATH. (${err.message})`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`images.json at ${config_1.config.CATALYGN_IMAGES_PATH} is not valid JSON: ${err.message}`);
    }
    const catalog = normalizeCatalog(parsed);
    if (catalog.length === 0) {
        throw new Error(`No usable image URLs found in ${config_1.config.CATALYGN_IMAGES_PATH}`);
    }
    cachedCatalog = catalog;
    logger_1.logger.info({ count: catalog.length }, 'image catalog loaded');
    return catalog;
}
/**
 * Picks an image, preferring (in order):
 *   1. pillar-matched images not used in the recent window
 *   2. any image not used in the recent window
 *   3. pillar-matched images (rotation exhausted)
 *   4. any image at all
 *
 * Random within the first non-empty tier, so repeated runs vary. Deterministic
 * only in the sense that the recent-usage list is supplied by the caller.
 */
async function pickImage(catalog, pillar, recentUrls) {
    const recent = new Set(recentUrls);
    const pillarMatches = (image) => image.pillars.length === 0 || image.pillars.includes(pillar.id);
    const tiers = [
        { pool: catalog.filter((i) => pillarMatches(i) && !recent.has(i.url)), fallback: false },
        { pool: catalog.filter((i) => !recent.has(i.url)), fallback: true },
        { pool: catalog.filter(pillarMatches), fallback: true },
        { pool: catalog, fallback: true },
    ];
    for (const tier of tiers) {
        if (tier.pool.length > 0) {
            const chosen = tier.pool[Math.floor(Math.random() * tier.pool.length)];
            if (tier.fallback) {
                logger_1.logger.warn({ pillar: pillar.id, poolSize: tier.pool.length }, 'image selection fell back past the preferred pillar/unused pool');
            }
            return { url: chosen.url, fallback: tier.fallback };
        }
    }
    throw new Error('Image catalog is empty');
}
/** Recently used image URLs, newest first (bounded window). */
async function recentImageUrls() {
    // Imported lazily so this module stays importable before the DB connects.
    const { ImageUsage } = await Promise.resolve().then(() => __importStar(require('../database/models/ImageUsage')));
    const since = new Date(Date.now() - RECENT_IMAGE_WINDOW * 24 * 60 * 60 * 1000);
    const rows = await ImageUsage.find({ usedAt: { $gte: since } })
        .sort({ usedAt: -1 })
        .limit(50)
        .lean();
    return rows.map((row) => row.url);
}
async function recordImageUsage(url, pillarId, postDate) {
    const { ImageUsage } = await Promise.resolve().then(() => __importStar(require('../database/models/ImageUsage')));
    await ImageUsage.create({ url, pillarId, postDate, usedAt: new Date() });
}
/** Test seam. */
function resetImageCache() {
    cachedCatalog = undefined;
}
//# sourceMappingURL=images.js.map