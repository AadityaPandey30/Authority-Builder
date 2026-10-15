import { config } from './config';
import { logger } from './logger';
import { Publication } from './database/models/Publication';
import { TopicHistory } from './database/models/TopicHistory';
import { normalizeIndianPhone } from './utils/phone';
import { istDateString, istIsoString } from './utils/date';
import { loadPlaybook } from './content/playbook';
import { loadImageCatalog, pickImage, recentImageUrls, recordImageUsage } from './content/images';
import { generatePost, selectPillar } from './content/gemini';
import { sendPost } from './whatsapp/client';
import type { ContentPillar, GeneratedPost } from './types';

/** How many past topic labels to feed back as an explicit "do not repeat" list. */
const RECENT_TOPIC_WINDOW = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface PublishResult {
  status: 'sent' | 'already_published' | 'in_progress' | 'failed';
  postDate: string;
  phone: string;
  publicationId?: string;
  post?: GeneratedPost;
  error?: string;
}

/**
 * Claims the date slot atomically. Returns undefined when another run already
 * owns this postDate, which is what makes a duplicate cron tick or a manual
 * /run racing the scheduler a no-op instead of a second message.
 */
async function claimDate(postDate: string, phone: string): Promise<string | undefined> {
  try {
    const doc = await Publication.create({
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
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 11000) {
      logger.info({ postDate }, 'date slot already claimed; skipping duplicate publication');
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
export async function publishDaily(
  options: { postDate?: string; force?: boolean; allowSentResend?: boolean } = {},
): Promise<PublishResult> {
  const postDate = options.postDate ?? istDateString();
  const phone = normalizeIndianPhone(config.CATALYGN_RECIPIENT);

  // Pre-flight: refuse to consume the day's slot if content inputs are broken.
  const playbook = await loadPlaybook();
  const catalog = await loadImageCatalog();

  if (options.force) {
    // Manual re-run clears the guard. Re-sending a sent date is only allowed
    // for the dedicated throwaway test slot.
    await Publication.deleteMany(
      options.allowSentResend
        ? { postDate }
        : { postDate, status: { $ne: 'sent' } },
    );
  }

  const publicationId = await claimDate(postDate, phone);
  if (publicationId === undefined) {
    const existing = await Publication.findOne({ postDate }).lean();
    if (existing?.status === 'sent') {
      return { status: 'already_published', postDate, phone, publicationId: String(existing._id) };
    }
    return { status: 'in_progress', postDate, phone, error: 'Another run holds this date slot' };
  }

  try {
    const recentTopics = await TopicHistory.find()
      .sort({ createdAt: -1 })
      .limit(RECENT_TOPIC_WINDOW)
      .lean()
      .then((rows) => rows.map((row) => row.topic));

    const recentPillars = await TopicHistory.find()
      .sort({ createdAt: -1 })
      .limit(6)
      .lean()
      .then((rows) => rows.map((row) => row.pillarId));

    const pillars: ContentPillar[] = playbook.pillars.length > 0 ? playbook.pillars : [];
    // Deterministic daily salt keeps rotation stable across retries of one day,
    // while the least-recently-used rule prevents repeating yesterday's pillar.
    const salt = Number(postDate.replace(/-/g, '')) % 1000;
    const pillar = await selectPillar(pillars, recentPillars, salt);

    logger.info({ postDate, pillar: pillar.id }, 'generating daily post');
    const generated = await generatePost({ pillar, recentTopics });

    const recentImages = await recentImageUrls();
    const choice = await pickImage(catalog, pillar, recentImages);
    const post: GeneratedPost = { ...generated, imageUrl: choice.url };

    await Publication.updateOne(
      { _id: publicationId },
      {
        $set: {
          pillarId: post.pillarId,
          topic: post.topic,
          imageUrl: post.imageUrl,
          caption: post.caption,
        },
      },
    );

    let lastError = 'unknown error';
    for (let attempt = 1; attempt <= config.SEND_MAX_ATTEMPTS; attempt += 1) {
      await Publication.updateOne({ _id: publicationId }, { $inc: { attempts: 1 } });

      const result = await sendPost({
        agencyId: config.CATALYGN_AGENCY_ID,
        clientId: config.CATALYGN_CLIENT_ID,
        phone,
        imageUrl: post.imageUrl,
        caption: post.caption,
      });

      if (result.ok) {
        await Publication.updateOne(
          { _id: publicationId },
          {
            $set: {
              status: 'sent',
              sentAt: new Date(),
              whatsappResponse: result.body,
              lastError: undefined,
            },
          },
        );
        await recordImageUsage(post.imageUrl, post.pillarId, postDate);
        await TopicHistory.updateOne(
          { postDate },
          { $set: { pillarId: post.pillarId, topic: post.topic } },
          { upsert: true },
        );

        logger.info(
          { postDate, pillar: post.pillarId, topic: post.topic, attempts: attempt },
          'daily post delivered',
        );
        return { status: 'sent', postDate, phone, publicationId, post };
      }

      lastError = `whatsapp-service responded ${result.status}: ${JSON.stringify(result.body).slice(0, 300)}`;
      logger.warn({ attempt, postDate, error: lastError }, 'send attempt failed');

      if (attempt < config.SEND_MAX_ATTEMPTS) {
        await sleep(config.SEND_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }

    await Publication.updateOne(
      { _id: publicationId },
      { $set: { status: 'failed', lastError } },
    );
    logger.error({ postDate, error: lastError }, 'daily post failed after all attempts');
    return { status: 'failed', postDate, phone, publicationId, post, error: lastError };
  } catch (err) {
    const message = (err as Error).message;
    await Publication.updateOne(
      { _id: publicationId },
      { $set: { status: 'failed', lastError: message } },
    );
    logger.error({ postDate, err: message }, 'daily post threw');
    return { status: 'failed', postDate, phone, publicationId, error: message };
  }
}

/**
 * Composes a post WITHOUT sending it. Used by the manual test command so the
 * caption and image can be inspected before arming the schedule.
 */
export async function composeOnly(postDate = istDateString()): Promise<GeneratedPost> {
  const playbook = await loadPlaybook();
  const catalog = await loadImageCatalog();

  const recentTopics = await TopicHistory.find()
    .sort({ createdAt: -1 })
    .limit(RECENT_TOPIC_WINDOW)
    .lean()
    .then((rows) => rows.map((row) => row.topic));

  const recentPillars = await TopicHistory.find()
    .sort({ createdAt: -1 })
    .limit(6)
    .lean()
    .then((rows) => rows.map((row) => row.pillarId));

  const salt = Number(postDate.replace(/-/g, '')) % 1000;
  const pillar = await selectPillar(playbook.pillars, recentPillars, salt);
  const generated = await generatePost({ pillar, recentTopics });
  const choice = await pickImage(catalog, pillar, await recentImageUrls());

  return { ...generated, imageUrl: choice.url };
}

/** Recent publication history, newest first. */
export async function publicationHistory(limit = 20) {
  const rows = await Publication.find().sort({ postDate: -1 }).limit(limit).lean();
  return rows.map((row) => ({
    postDate: row.postDate,
    status: row.status,
    pillarId: row.pillarId,
    topic: row.topic,
    attempts: row.attempts,
    sentAt: row.sentAt ? istIsoString(row.sentAt) : null,
    lastError: row.lastError ?? null,
  }));
}
