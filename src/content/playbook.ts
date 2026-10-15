import fs from 'node:fs/promises';

import { config } from '../config';
import { logger } from '../logger';
import type { Playbook, ContentPillar } from '../types';

const CONTACT_RE = /\b([6-9]\d{9})\b/;

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
function parsePillars(markdown: string): ContentPillar[] {
  const lines = markdown.split(/\r?\n/);

  // Shape 1: bullet list under a Pillars/Content pillars heading.
  const bullets: ContentPillar[] = [];
  let inPillarSection = false;
  for (const line of lines) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (heading) {
      inPillarSection = /pillar/i.test(heading[1] ?? '');
      continue;
    }
    if (!inPillarSection) continue;

    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const entry = bullet?.[1]?.trim();
    if (!entry) continue;

    // "Positioning: own a narrow niche" | "Positioning - own a narrow niche"
    const split = /^([^:\-]{2,40}?)\s*[:\-]\s*(.+)$/.exec(entry);
    const name = (split?.[1] ?? entry).trim();
    const guidance = (split?.[2] ?? '').trim() || `Write about ${name.toLowerCase()}.`;
    bullets.push({ id: slugify(name), name, guidance });
  }
  if (bullets.length > 0) return dedupe(bullets);

  // Shape 2: headings that are not structural/section headers.
  const STRUCTURAL = /^(pillars?|content pillars?|playbook|overview|rules?|voice|tone|instructions?|guidelines?|cta|call to action|examples?|notes?|goal|audience|format)$/i;
  const headings = lines
    .map((line) => /^#{2,3}\s+(.+)$/.exec(line.trim())?.[1]?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => !STRUCTURAL.test(value))
    .map((value) => ({
      id: slugify(value),
      name: value.replace(/[:\-]+$/, '').trim(),
      guidance: `Write about ${value.toLowerCase()}.`,
    }));

  return dedupe(headings);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function dedupe(pillars: ContentPillar[]): ContentPillar[] {
  const seen = new Set<string>();
  const out: ContentPillar[] = [];
  for (const pillar of pillars) {
    if (pillar.id === '' || seen.has(pillar.id)) continue;
    seen.add(pillar.id);
    out.push(pillar);
  }
  return out;
}

/** Extracts the brand-voice section, if the playbook has one. */
function parseVoiceNotes(markdown: string): string | undefined {
  const match =
    /#{1,6}\s*(?:brand\s+)?(?:voice|tone|rules|guidelines)[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/i.exec(markdown);
  const body = match?.[1]?.trim();
  return body && body.length > 0 ? body : undefined;
}

/** Extracts a 10-digit contact number from the playbook, if one is stated. */
function parseContactPhone(markdown: string): string | undefined {
  return CONTACT_RE.exec(markdown)?.[1];
}

let cached: Playbook | undefined;

/** Reads and parses the playbook. Cached: it is static config, not per-run data. */
export async function loadPlaybook(): Promise<Playbook> {
  if (cached) return cached;

  let raw: string;
  try {
    raw = await fs.readFile(config.CATALYGN_PLAYBOOK_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `Cannot read playbook at ${config.CATALYGN_PLAYBOOK_PATH}. ` +
        `Copy your catalygn.md there or set CATALYGN_PLAYBOOK_PATH. (${(err as Error).message})`,
    );
  }

  if (raw.trim() === '') {
    throw new Error(`Playbook at ${config.CATALYGN_PLAYBOOK_PATH} is empty`);
  }

  const pillars = parsePillars(raw);
  const contactPhone = config.CATALYGN_CONTACT_PHONE || parseContactPhone(raw);

  cached = { raw, pillars, contactPhone, voiceNotes: parseVoiceNotes(raw) };
  logger.info(
    { pillars: cached.pillars.map((p) => p.id), contactPhone: contactPhone ?? null },
    'playbook loaded',
  );
  return cached;
}

/** Test seam: clears the memoized playbook. */
export function resetPlaybookCache(): void {
  cached = undefined;
}
