"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function required(name) {
    const value = process.env[name];
    if (value === undefined || value.trim() === '') {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value.trim();
}
function optional(name, fallback) {
    const value = process.env[name];
    return value === undefined || value.trim() === '' ? fallback : value.trim();
}
function optionalInt(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '')
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Environment variable ${name} must be a non-negative integer`);
    }
    return parsed;
}
function optionalBool(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '')
        return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}
/** Resolves a documented path relative to the service root, not the cwd. */
function resolvePath(value) {
    return node_path_1.default.isAbsolute(value) ? value : node_path_1.default.resolve(__dirname, '..', value);
}
function parseAllowlist(raw) {
    return raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
}
const serviceRoot = node_path_1.default.resolve(__dirname, '..');
exports.config = {
    // Gemini (free tier only)
    GEMINI_API_KEY: required('GEMINI_API_KEY'),
    GEMINI_MODEL: optional('GEMINI_MODEL', 'gemini-2.0-flash'),
    // Existing OpsForge whatsapp-service (reused unchanged)
    WHATSAPP_SERVICE_URL: optional('WHATSAPP_SERVICE_URL', 'http://127.0.0.1:4000').replace(/\/+$/, ''),
    WHATSAPP_SERVICE_SECRET: required('WHATSAPP_SERVICE_SECRET'),
    // Recipient + attribution
    CATALYGN_RECIPIENT: optional('CATALYGN_RECIPIENT', '9532977264'),
    CATALYGN_AGENCY_ID: optional('CATALYGN_AGENCY_ID', 'catalygn'),
    CATALYGN_CLIENT_ID: optional('CATALYGN_CLIENT_ID', 'catalygn-authority'),
    // Content inputs (data files, not secrets)
    CATALYGN_PLAYBOOK_PATH: resolvePath(optional('CATALYGN_PLAYBOOK_PATH', './catalygn.md')),
    CATALYGN_IMAGES_PATH: resolvePath(optional('CATALYGN_IMAGES_PATH', './images.json')),
    CATALYGN_BOOKING_URL: optional('CATALYGN_BOOKING_URL', ''),
    // Existing MongoDB infrastructure
    MONGODB_URI: required('MONGODB_URI'),
    // Schedule
    CRON_SCHEDULE: optional('CRON_SCHEDULE', '0 12 * * *'),
    CRON_TIMEZONE: optional('CRON_TIMEZONE', 'Asia/Kolkata'),
    SCHEDULER_ENABLED: optionalBool('SCHEDULER_ENABLED', true),
    // API / ops
    PORT: optionalInt('PORT', 4100),
    LOG_LEVEL: optional('LOG_LEVEL', 'info'),
    CATALYGN_ADMIN_SECRET: required('CATALYGN_ADMIN_SECRET'),
    // Delivery
    SEND_MAX_ATTEMPTS: optionalInt('SEND_MAX_ATTEMPTS', 3),
    SEND_BACKOFF_MS: optionalInt('SEND_BACKOFF_MS', 2000),
    SEND_TEST_ALLOWLIST: parseAllowlist(optional('SEND_TEST_ALLOWLIST', '9532977264')),
    SERVICE_ROOT: serviceRoot,
};
//# sourceMappingURL=config.js.map