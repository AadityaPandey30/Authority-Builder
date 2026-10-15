import path from 'node:path';

import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer`);
  }
  return parsed;
}

function optionalBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** Resolves a documented path relative to the service root, not the cwd. */
function resolvePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(__dirname, '..', value);
}

function parseAllowlist(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

const serviceRoot = path.resolve(__dirname, '..');

export const config = {
  // Gemini (free tier only)
  GEMINI_API_KEY: required('GEMINI_API_KEY'),
  GEMINI_MODEL: optional('GEMINI_MODEL', 'gemini-2.5-flash'),

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
  // The CTA asks readers to DM this number rather than open a meet link.
  CATALYGN_CONTACT_PHONE: optional('CATALYGN_CONTACT_PHONE', '9555154334'),

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
} as const;

export type Config = typeof config;
