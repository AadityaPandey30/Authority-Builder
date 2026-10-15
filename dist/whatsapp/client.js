"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPost = sendPost;
exports.whatsappServiceStatus = whatsappServiceStatus;
const config_1 = require("../config");
const logger_1 = require("../logger");
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
async function sendPost(payload) {
    const url = `${config_1.config.WHATSAPP_SERVICE_URL}/send`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${config_1.config.WHATSAPP_SERVICE_SECRET}`,
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
        let body = text;
        try {
            body = JSON.parse(text);
        }
        catch {
            // Leave the raw text in place; /status probes may return plain text.
        }
        const result = { ok: response.ok, status: response.status, body };
        if (!response.ok) {
            logger_1.logger.error({ status: response.status, body: text.slice(0, 400) }, 'whatsapp-service rejected the send');
        }
        return result;
    }
    catch (err) {
        const message = err.name === 'AbortError'
            ? `whatsapp-service did not respond within ${DEFAULT_TIMEOUT_MS}ms`
            : err.message;
        return { ok: false, status: 0, body: { error: message } };
    }
    finally {
        clearTimeout(timeout);
    }
}
/** Health probe used before sending, so a down service fails fast and cleanly. */
async function whatsappServiceStatus() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
        const response = await fetch(`${config_1.config.WHATSAPP_SERVICE_URL}/status`, {
            headers: { Authorization: `Bearer ${config_1.config.WHATSAPP_SERVICE_SECRET}` },
            signal: controller.signal,
        });
        const text = await response.text();
        let body = text;
        try {
            body = JSON.parse(text);
        }
        catch {
            // plain-text response is fine
        }
        const status = body?.status;
        return { reachable: response.ok, status, body };
    }
    catch (err) {
        logger_1.logger.warn({ err: err.message }, 'whatsapp-service status probe failed');
        return { reachable: false, body: { error: err.message } };
    }
    finally {
        clearTimeout(timeout);
    }
}
//# sourceMappingURL=client.js.map