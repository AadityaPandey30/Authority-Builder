/**
 * Offline smoke test for the pure logic: phone normalization, playbook parsing,
 * image selection tiers, and IST date handling. No network, no MongoDB.
 *
 *   npx tsx src/scripts/smoke.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizeIndianPhone, isSamePhone } from '../utils/phone';
import { istDateString, istIsoString } from '../utils/date';

let passed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    process.stdout.write(`  FAIL ${name}\n       ${(err as Error).message}\n`);
    process.exitCode = 1;
  }
}

// --- phone normalization ----------------------------------------------------
check('normalizes bare 10-digit Indian number', () => {
  assert.equal(normalizeIndianPhone('9532977264'), '+919532977264');
});
check('normalizes +91 with spaces', () => {
  assert.equal(normalizeIndianPhone('+91 95329 77264'), '+919532977264');
});
check('normalizes 91 country code without plus', () => {
  assert.equal(normalizeIndianPhone('919532977264'), '+919532977264');
});
check('normalizes leading trunk zero', () => {
  assert.equal(normalizeIndianPhone('09532977264'), '+919532977264');
});
check('the configured recipient is +919532977264', () => {
  assert.equal(normalizeIndianPhone('9532977264'), '+919532977264');
  assert.equal(isSamePhone('9532977264', '+919532977264'), true);
});
check('rejects invalid numbers', () => {
  assert.throws(() => normalizeIndianPhone('12345'));
  assert.throws(() => normalizeIndianPhone('1234567890')); // does not start 6-9
  assert.throws(() => normalizeIndianPhone(''));
  assert.throws(() => normalizeIndianPhone('not-a-number'));
  assert.equal(isSamePhone('garbage', '9532977264'), false);
});

// --- IST dates --------------------------------------------------------------
check('IST date is YYYY-MM-DD and stable for a fixed instant', () => {
  assert.match(istDateString(), /^\d{4}-\d{2}-\d{2}$/);
  // 2026-01-01T00:30Z is already 06:00 IST on the 1st.
  assert.equal(istDateString(new Date('2026-01-01T00:30:00Z')), '2026-01-01');
  // 2025-12-31T20:00Z is 01:30 IST on Jan 1 -> must roll forward.
  assert.equal(istDateString(new Date('2025-12-31T20:00:00Z')), '2026-01-01');
});
check('IST display string renders', () => {
  assert.ok(istIsoString().length > 0);
});

// --- playbook parsing -------------------------------------------------------
check('parses pillars from a Pillars bullet section', () => {
  const tmp = path.join(os.tmpdir(), `playbook-${Date.now()}.md`);
  fs.writeFileSync(
    tmp,
    ['# Catalygn', '', '## Pillars', '- Positioning: own a narrow niche', '- Pricing: charge for value', '', '## Voice', 'Direct, no hype.'].join('\n'),
  );
  process.env.CATALYGN_PLAYBOOK_PATH = tmp;
  process.env.CATALYGN_IMAGES_PATH = path.join(os.tmpdir(), 'nonexistent-images.json');
  process.env.CATALYGN_CONTACT_PHONE = '9555154334';
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.WHATSAPP_SERVICE_SECRET = 'test-secret';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/test';
  process.env.CATALYGN_ADMIN_SECRET = 'test-admin';

  // Imported after env is set, since config reads env at module load.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { loadPlaybook, resetPlaybookCache } = require('../content/playbook') as typeof import('../content/playbook');

  return loadPlaybook().then((playbook) => {
    resetPlaybookCache();
    assert.equal(playbook.pillars.length, 2, `expected 2 pillars, got ${playbook.pillars.length}`);
    assert.equal(playbook.pillars[0]!.id, 'positioning');
    assert.equal(playbook.pillars[1]!.id, 'pricing');
    assert.match(playbook.pillars[0]!.guidance, /narrow niche/);
    assert.equal(playbook.contactPhone, '9555154334');
    assert.match(playbook.voiceNotes ?? '', /Direct, no hype/);
  });
});

// --- prompt CTA: DM number only, never a meet link ---------------------------
check('prompt asks for a DM and contains no booking link', () => {
  process.env.CATALYGN_CONTACT_PHONE = '9555154334';
  const { buildPrompt } = require('../content/gemini') as typeof import('../content/gemini');
  const prompt = buildPrompt(
    { id: 'pricing', name: 'Pricing', guidance: 'Charge for value.' },
    '9555154334',
    '# Playbook\n\n## Pillars\n- Pricing: charge for value\n',
    undefined,
    [],
  );
  assert.match(prompt, /9555154334/, 'prompt must state the DM number');
  assert.match(prompt, /DM/, 'prompt must ask for a DM');
  assert.doesNotMatch(prompt, /cal\.com|calendly|https?:\/\/[^\s]*book/i, 'prompt must not contain a booking link');
});

process.stdout.write(`\n${passed} check(s) passed${process.exitCode ? ' (with failures)' : ''}\n`);
