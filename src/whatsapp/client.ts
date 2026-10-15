import { config } from '../config';
import { logger } from '../logger';
import type { WhatsAppSendPayload, WhatsAppSendResult } from '../types';

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Delivers a pre-composed message through the existing OpsForge
 * whatsapp-service. Uses POST /send with `imageUrl` + `caption`.
 *
 * NOTE: the documented POST /send body carries `template` + `vars`
 * (services/whatsapp-service README, "POST /send"). Image-and-caption support
 * is the documented extension this service needs; when the whatsapp-service
 * implements it, this function needs no change. The two fields are sent
 * verbatim, and the response body is returned untouched so a mismatch shows up
 * in the error message instead of being swallowed.
 */
export async function sendPost(payload: WhatsAppSendPayload): Promise<WhatsAppSendResult> {
  const url = `${config.WHATSAPP_SERVICE_URL}/send`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.WHATSAPP_SERVICE_SECRET}`,
      },
      body: JSON.stringify({
        agencyId: payload.agencyId,
        clientId: payload.clientId,
        phone: payload.phone,
        imageUrl: payload.imageUrl,
        caption: payload.caption,
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // Leave the raw text in place; /status probes may return plain text.
    }

    const result: WhatsAppSendResult = { ok: response.ok, status: response.status, body };

    if (!response.ok) {
      logger.error({ status: response.status, body: text.slice(0, 400) }, 'whatsapp-service rejected the send');
    }

    return result;
  } catch (err) {
    const message = (err as Error).name === 'AbortError'
      ? `whatsapp-service did not respond within ${DEFAULT_TIMEOUT_MS}ms`
      : (err as Error).message;
    return { ok: false, status: 0, body: { error: message } };
  } finally {
    clearTimeout(timeout);
  }
}

/** Health probe used before sending, so a down service fails fast and cleanly. */
export async function whatsappServiceStatus(): Promise<{ reachable: boolean; status?: string; body?: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${config.WHATSAPP_SERVICE_URL}/status`, {
      headers: { Authorization: `Bearer ${config.WHATSAPP_SERVICE_SECRET}` },
      signal: controller.signal,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // plain-text response is fine
    }
    const status = (body as { status?: string } | undefined)?.status;
    return { reachable: response.ok, status, body };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'whatsapp-service status probe failed');
    return { reachable: false, body: { error: (err as Error).message } };
  } finally {
    clearTimeout(timeout);
  }
}
