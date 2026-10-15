import express, { type Express, type Request, type Response } from 'express';

import { config } from '../config';
import { logger } from '../logger';
import { composeOnly, publicationHistory, publishDaily } from '../publisher';
import { whatsappServiceStatus } from '../whatsapp/client';
import { istDateString, istIsoString } from '../utils/date';
import { normalizeIndianPhone, isSamePhone } from '../utils/phone';
import { requireAdmin } from './middleware/auth';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parsePostDate(raw: unknown): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) {
    throw new Error('postDate must be a YYYY-MM-DD string');
  }
  const parsed = new Date(`${raw}T00:00:00+05:30`);
  if (Number.isNaN(parsed.getTime()) || istDateString(parsed) !== raw) {
    throw new Error(`postDate is not a valid calendar date: ${raw}`);
  }
  return raw;
}

export function createServer(): Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'catalygn-content-service',
      timezone: config.CRON_TIMEZONE,
      now: istIsoString(),
      schedule: config.SCHEDULER_ENABLED ? config.CRON_SCHEDULE : 'disabled',
    });
  });

  // Operator-facing summary: recipient, schedule, last post.
  app.get('/status', requireAdmin, async (_req, res) => {
    try {
      const history = await publicationHistory(5);
      const wa = await whatsappServiceStatus();
      res.json({
        recipient: normalizeIndianPhone(config.CATALYGN_RECIPIENT),
        today: istDateString(),
        schedule: config.SCHEDULER_ENABLED ? config.CRON_SCHEDULE : 'disabled',
        timezone: config.CRON_TIMEZONE,
        geminiModel: config.GEMINI_MODEL,
        whatsappService: { url: config.WHATSAPP_SERVICE_URL, reachable: wa.reachable, status: wa.status ?? null },
        recentPublications: history,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/history', requireAdmin, async (req, res) => {
    const limitRaw = Number.parseInt(String(req.query.limit ?? '20'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 20;
    try {
      res.json({ publications: await publicationHistory(limit) });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * Dry run: composes a caption + image and returns them WITHOUT sending.
   * This is the safe way to check formatting before arming the schedule.
   */
  app.post('/test', requireAdmin, async (req: Request, res: Response) => {
    try {
      const postDate = parsePostDate(req.body?.postDate) ?? istDateString();
      const post = await composeOnly(postDate);
      res.json({ dryRun: true, postDate, recipient: normalizeIndianPhone(config.CATALYGN_RECIPIENT), post });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'test composition failed');
      res.status(400).json({ error: (err as Error).message });
    }
  });

  /**
   * Real run. Idempotent per postDate: a second call for a date already sent is
   * a no-op unless force=true.
   */
  app.post('/run', requireAdmin, async (req: Request, res: Response) => {
    try {
      const postDate = parsePostDate(req.body?.postDate) ?? istDateString();
      const force = req.body?.force === true;

      // Validation before any side effect: a test send may not target an
      // arbitrary number, so a mistake in config cannot message a stranger.
      const phone = normalizeIndianPhone(config.CATALYGN_RECIPIENT);
      if (config.SEND_TEST_ALLOWLIST.length > 0 && !config.SEND_TEST_ALLOWLIST.some((n) => isSamePhone(n, phone))) {
        res.status(403).json({
          error: `Recipient ${phone} is not in SEND_TEST_ALLOWLIST`,
          allowlist: config.SEND_TEST_ALLOWLIST,
        });
        return;
      }

      const result = await publishDaily({ postDate, force });
      const code = result.status === 'failed' ? 502 : result.status === 'in_progress' ? 409 : 200;
      res.status(code).json(result);
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'manual run failed');
      res.status(400).json({ error: (err as Error).message });
    }
  });

  // Express error handler: keeps a bad JSON body from crashing the process.
  app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    logger.error({ err: err.message }, 'unhandled request error');
    res.status(400).json({ error: err.message });
  });

  return app;
}
