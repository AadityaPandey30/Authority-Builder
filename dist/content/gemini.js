"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectPillar = selectPillar;
exports.generatePost = generatePost;
const config_1 = require("../config");
const logger_1 = require("../logger");
const playbook_1 = require("./playbook");
const pillars_1 = require("./pillars");
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Hard ceiling on the caption body, WhatsApp-safe. */
const MAX_CAPTION_CHARS = 900;
/**
 * Strip markdown that WhatsApp does not render, keeping *bold* and _italic_
 * which it does. Also drops stray model artefacts like fence markers.
 */
function sanitize(text) {
    return text
        .replace(/```[a-z]*/gi, '')
        .replace(/^\s*#{1,6}\s*/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/^\s*[-*]\s+/gm, '• ')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function extractJson(text) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidate = (fenced?.[1] ?? text).trim();
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Gemini response contained no JSON object');
    }
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    if (parsed === null || typeof parsed !== 'object') {
        throw new Error('Gemini response JSON was not an object');
    }
    return parsed;
}
function asNonEmptyString(value, field) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`Gemini response missing non-empty string field: ${field}`);
    }
    return value.trim();
}
/**
 * Chooses the pillar deterministically: the one least recently used. Falls back
 * to round-robin over DEFAULT_PILLARS so a fresh database still rotates.
 */
async function selectPillar(available, recentlyUsedPillarIds, salt = 0) {
    const pool = available.length > 0 ? available : pillars_1.DEFAULT_PILLARS;
    const used = new Set(recentlyUsedPillarIds);
    const fresh = pool.filter((p) => !used.has(p.id));
    const candidates = fresh.length > 0 ? fresh : pool;
    const index = (salt % candidates.length + candidates.length) % candidates.length;
    return candidates[index];
}
function buildPrompt(pillar, playbookRaw, voiceNotes, bookingUrl, recentTopics) {
    const ctaTarget = bookingUrl
        ? `End with a call to action that invites the reader to book a call using exactly this link: ${bookingUrl}`
        : 'End with a call to action that invites the reader to book a call, and mention that they can reply to this message to get the booking link.';
    const avoid = recentTopics.length
        ? `Do NOT reuse or lightly reword any of these recently published topics:\n${recentTopics
            .map((topic) => `- ${topic}`)
            .join('\n')}`
        : 'This is an early post; there is no topic history yet.';
    return [
        'You write daily WhatsApp posts for Catalygn, a business consulting practice.',
        'Your goal is to build authority in business consulting and drive booked calls.',
        '',
        'The post MUST follow Hook -> Body -> CTA:',
        '- hook: one punchy opening line (max 120 characters) that names a real, specific business problem.',
        '- body: 2 to 4 short paragraphs of practical consulting insight. Concrete, actionable, no fluff.',
        '- cta: one short closing line. ' + ctaTarget,
        '',
        `Today's content pillar: ${pillar.name}`,
        `Pillar guidance: ${pillar.guidance}`,
        '',
        avoid,
        '',
        'Hard rules:',
        '- Never invent statistics, client names, revenue figures, case studies, or research findings.',
        '- No emojis. No hashtags. No markdown headings or bullet symbols beyond simple dashes.',
        '- WhatsApp formatting only: *bold* for emphasis, sparingly.',
        '- Total caption length must be under 900 characters.',
        '- Write in the second person, addressing a business owner directly.',
        '- If the playbook below states a rule, that rule wins over the guidance above.',
        '',
        'Respond with ONLY a JSON object, no prose and no code fences:',
        '{"pillarId":"<pillar id>","topic":"<6-12 word topic label>","hook":"...","body":"...","cta":"..."}',
        '',
        '<playbook>',
        playbookRaw,
        '</playbook>',
        voiceNotes ? `<voice_notes>\n${voiceNotes}\n</voice_notes>` : '',
    ]
        .filter((part) => part !== '')
        .join('\n');
}
async function callGemini(prompt) {
    const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(config_1.config.GEMINI_MODEL)}:generateContent`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // Key travels in a header (never a query string) so it stays out of logs.
            'x-goog-api-key': config_1.config.GEMINI_API_KEY,
        },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 1.0,
                topP: 0.95,
                maxOutputTokens: 2048,
                responseMimeType: 'application/json',
            },
        }),
    });
    const text = await response.text();
    if (!response.ok) {
        // Never echo the key; only the upstream status and body.
        throw new Error(`Gemini request failed (${response.status}): ${text.slice(0, 400)}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        throw new Error(`Gemini returned non-JSON envelope: ${text.slice(0, 200)}`);
    }
    if (parsed.promptFeedback?.blockReason) {
        throw new Error(`Gemini blocked the prompt: ${parsed.promptFeedback.blockReason}`);
    }
    const parts = parsed.candidates?.[0]?.content?.parts ?? [];
    const content = parts
        .map((part) => part.text ?? '')
        .join('')
        .trim();
    if (content === '') {
        const reason = parsed.candidates?.[0]?.finishReason ?? 'no candidates';
        throw new Error(`Gemini returned empty content (${reason})`);
    }
    return content;
}
/**
 * Generates one post. Retries once with a corrective instruction when the model
 * returns prose instead of JSON, then fails loudly rather than sending a broken
 * caption.
 */
async function generatePost(options) {
    const playbook = await (0, playbook_1.loadPlaybook)();
    const prompt = buildPrompt(options.pillar, playbook.raw, playbook.voiceNotes, playbook.bookingUrl, options.recentTopics);
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const attemptPrompt = attempt === 1
            ? prompt
            : `${prompt}\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object.`;
        try {
            const raw = await callGemini(attemptPrompt);
            const parsed = extractJson(raw);
            const hook = sanitize(asNonEmptyString(parsed.hook, 'hook'));
            const body = sanitize(asNonEmptyString(parsed.body, 'body'));
            const cta = sanitize(asNonEmptyString(parsed.cta, 'cta'));
            const topic = sanitize(asNonEmptyString(parsed.topic, 'topic'));
            let caption = `${hook}\n\n${body}\n\n${cta}`;
            // The booking link is a contract: guarantee it is present. A model that
            // paraphrases the CTA without the link fails the post's whole purpose.
            if (playbook.bookingUrl && !caption.includes(playbook.bookingUrl)) {
                caption = `${caption}\n${playbook.bookingUrl}`;
            }
            if (caption.length > MAX_CAPTION_CHARS) {
                throw new Error(`Generated caption exceeded ${MAX_CAPTION_CHARS} characters (${caption.length}); regenerating`);
            }
            return {
                hook,
                body,
                cta,
                topic,
                pillarId: options.pillar.id,
                caption,
                model: config_1.config.GEMINI_MODEL,
            };
        }
        catch (err) {
            lastError = err;
            logger_1.logger.warn({ attempt, err: lastError.message }, 'content generation attempt failed');
        }
    }
    throw new Error(`Gemini content generation failed after 2 attempts: ${lastError?.message}`);
}
//# sourceMappingURL=gemini.js.map