import fs from 'node:fs/promises';

import { config } from '../config';
import { logger } from '../logger';
import type { CatalogImage, ContentPillar } from '../types';

/** How many recent images to keep out of rotation. */
const RECENT_IMAGE_WINDOW = 14;

interface RawImageEntry {
  url?: unknown;
  imageUrl?: unknown;
  pillars?: unknown;
  pillar?: unknown;
  alt?: unknown;
}

/**
 * Accepts either images.json shape:
 *   [ { "url": "https://...", "pillars": ["positioning"], "alt": "..." } ]
 *   [ "https://...", "https://..." ]
 *   { "images": [ ...either of the above... ] }
 */
function normalizeCatalog(parsed: unknown): CatalogImage[] {
  const list: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { images?: unknown })?.images)
      ? ((parsed as { images: unknown[] }).images)
      : [];

  const out: CatalogImage[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      if (entry.trim() !== '') out.push({ url: entry.trim(), pillars: [] });
      continue;
    }
    if (entry !== null && typeof entry === 'object') {
      const raw = entry as RawImageEntry;
      const url = typeof raw.url === 'string' ? raw.url : typeof raw.imageUrl === 'string' ? raw.imageUrl : undefined;
      if (!url || url.trim() === '') continue;

      const pillars = Array.isArray(raw.pillars)
        ? raw.pillars.filter((p): p is string => typeof p === 'string').map(slugify)
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

let cachedCatalog: CatalogImage[] | undefined;

/** Reads and validates images.json with strict-up-front loading. */
export async function loadImageCatalog(): Promise<CatalogImage[]> {
  if (cachedCatalog) return cachedCatalog;

  let raw: string;
  try {
    raw = await fs.readFile(config.CATALYGN_IMAGES_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read images catalog at ${config.CATALYGN_IMAGES_PATH}. ` +
        `Copy your images.json there or set CATALYGN_IMAGES_PATH. (${(err as Error).message})`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`images.json at ${config.CATALYGN_IMAGES_PATH} is not valid JSON: ${(err as Error).message}`);
  }

  const catalog = normalizeCatalog(parsed);
  if (catalog.length === 0) {
    throw new Error(`No usable image URLs found in ${config.CATALYGN_IMAGES_PATH}`);
  }

  cachedCatalog = catalog;
  logger.info({ count: catalog.length }, 'image catalog loaded');
  return catalog;
}

export interface ImageChoice {
  url: string;
  /** True when the pillar-desirable pool was exhausted and a fallback was used. */
  fallback: boolean;
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
export async function pickImage(
  catalog: CatalogImage[],
  pillar: ContentPillar,
  recentUrls: string[],
): Promise<ImageChoice> {
  const recent = new Set(recentUrls);
  const pillarMatches = (image: CatalogImage) =>
    image.pillars.length === 0 || image.pillars.includes(pillar.id);

  const tiers: Array<{ pool: CatalogImage[]; fallback: boolean }> = [
    { pool: catalog.filter((i) => pillarMatches(i) && !recent.has(i.url)), fallback: false },
    { pool: catalog.filter((i) => !recent.has(i.url)), fallback: true },
    { pool: catalog.filter(pillarMatches), fallback: true },
    { pool: catalog, fallback: true },
  ];

  for (const tier of tiers) {
    if (tier.pool.length > 0) {
      const chosen = tier.pool[Math.floor(Math.random() * tier.pool.length)];
      if (tier.fallback) {
        logger.warn(
          { pillar: pillar.id, poolSize: tier.pool.length },
          'image selection fell back past the preferred pillar/unused pool',
        );
      }
      return { url: chosen!.url, fallback: tier.fallback };
    }
  }

  throw new Error('Image catalog is empty');
}

/** Recently used image URLs, newest first (bounded window). */
export async function recentImageUrls(): Promise<string[]> {
  // Imported lazily so this module stays importable before the DB connects.
  const { ImageUsage } = await import('../database/models/ImageUsage');
  const since = new Date(Date.now() - RECENT_IMAGE_WINDOW * 24 * 60 * 60 * 1000);
  const rows = await ImageUsage.find({ usedAt: { $gte: since } })
    .sort({ usedAt: -1 })
    .limit(50)
    .lean();
  return rows.map((row) => row.url);
}

export async function recordImageUsage(url: string, pillarId: string, postDate: string): Promise<void> {
  const { ImageUsage } = await import('../database/models/ImageUsage');
  await ImageUsage.create({ url, pillarId, postDate, usedAt: new Date() });
}

/** Test seam. */
export function resetImageCache(): void {
  cachedCatalog = undefined;
}
