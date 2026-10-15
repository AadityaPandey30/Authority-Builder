import { connectDb, disconnectDb } from '../database/db';
import { composeOnly } from '../publisher';
import { normalizeIndianPhone } from '../utils/phone';
import { istIsoString } from '../utils/date';
import { config } from '../config';
import { logger } from '../logger';

/**
 * Manual test command: composes a post and prints it WITHOUT sending.
 * Run before arming the schedule to check caption formatting and the image URL.
 *
 *   npm run test:generate
 *   npm run test:generate -- 2026-01-01
 */
async function main(): Promise<void> {
  const postDate = process.argv[2];
  await connectDb();
  try {
    const post = await composeOnly(postDate);
    const phone = normalizeIndianPhone(config.CATALYGN_RECIPIENT);

    process.stdout.write(
      [
        '',
        '=== DRY RUN (nothing was sent) ===',
        `Time (IST):  ${istIsoString()}`,
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
      ].join('\n'),
    );
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  logger.error({ err: (err as Error).message }, 'generate-only failed');
  process.exit(1);
});
