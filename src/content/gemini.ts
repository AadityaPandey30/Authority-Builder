import { config } from '../config';
import { logger } from '../logger';
import type { ContentPillar, GeneratedPost } from '../types';
import { loadPlaybook } from './playbook';
import { DEFAULT_PILLARS } from './pillars';

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Hard ceiling on the caption body, WhatsApp-safe. */
const MAX_CAPTION_CHARS = 900;

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

/** Model output contract. Kept narrow so validation is mechanical. */
interface ModelOutput {
  pillarId?: unknown;
  topic?: unknown;
  hook?: unknown;
  body?: unknown;
  cta?: unknown;
}

/**
 * Strip markdown that WhatsApp does not render, keeping *bold* and _italic_
 * which it does. Also drops stray model artefacts like fence markers.
 */
function sanitize(text: string): string {
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

function extractJson(text: string): ModelOutput {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Gemini response contained no JSON object');
  }

  const parsed: unknown = JSON.parse(candidate.slice(start, end + 1));
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Gemini response JSON was not an object');
  }
  return parsed as ModelOutput;
}

function asNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Gemini response missing non-empty string field: ${field}`);
  }
  return value.trim();
}

/**
 * Chooses the pillar deterministically: the one least recently used. Falls back
 * to round-robin over DEFAULT_PILLARS so a fresh database still rotates.
 */
export async function selectPillar(
  available: ContentPillar[],
  recentlyUsedPillarIds: string[],
  salt = 0,
): Promise<ContentPillar> {
  const pool = available.length > 0 ? available : DEFAULT_PILLARS;
  const used = new Set(recentlyUsedPillarIds);
  const fresh = pool.filter((p) => !used.has(p.id));
  const candidates = fresh.length > 0 ? fresh : pool;
  const index = (salt % candidates.length + candidates.length) % candidates.length;
  return candidates[index]!;
}

export function buildPrompt(
  pillar: ContentPillar,
  contactPhone: string,
  playbookRaw: string,
  voiceNotes: string | undefined,
  recentTopics: string[],
): string {
  const ctaTarget = `End with a call to action that asks the reader to DM (direct message) this WhatsApp number: ${contactPhone}. The CTA MUST state that number exactly as written above. Do NOT include any meeting, calendar, call-booking or scheduling link.`;

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
    `- The only contact action is the DM number ${contactPhone}. Never output a meeting, calendar or scheduling link.`,
    '- Write in the second person, addressing a business owner directly.',
    '- If the playbook below states a rule, that rule wins over the guidance above.',
    '',
    'Respond with ONLY a JSON object, no prose and no code fences:',
    '{"pillarId":"<pillar id>","topic":"<6-12 word topic label>","hook":"...","body":"...","cta":"..."}',
    '',
    '<playbook>'
    ,
    playbookRaw,
    '</playbook>',
    voiceNotes ? `<voice_notes>\n${voiceNotes}\n</voice_notes>` : '',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

async function callGemini(prompt: string): Promise<string> {
  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(config.GEMINI_MODEL)}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Key travels in a header (never a query string) so it stays out of logs.
      'x-goog-api-key': config.GEMINI_API_KEY,
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

  let parsed: GeminiResponse;
  try {
    parsed = JSON.parse(text) as GeminiResponse;
  } catch {
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
export async function generatePost(options: {
  pillar: ContentPillar;
  recentTopics: string[];
}): Promise<Omit<GeneratedPost, 'imageUrl'>> {
  const playbook = await loadPlaybook();
  const prompt = buildPrompt(
    options.pillar,
    config.CATALYGN_CONTACT_PHONE,
    playbook.raw,
    playbook.voiceNotes,
    options.recentTopics,
  );

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const attemptPrompt =
      attempt === 1
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

      // The DM number is a contract: guarantee it is present. A model that
      // paraphrases the CTA without the number fails the post's whole purpose.
      const digits = config.CATALYGN_CONTACT_PHONE.replace(/\D/g, '');
      if (!caption.replace(/\D/g, '').includes(digits)) {
        caption = `${caption}\nDM ${config.CATALYGN_CONTACT_PHONE} to get started.`;
      }

      if (caption.length > MAX_CAPTION_CHARS) {
        throw new Error(
          `Generated caption exceeded ${MAX_CAPTION_CHARS} characters (${caption.length}); regenerating`,
        );
      }

      return {
        hook,
        body,
        cta,
        topic,
        pillarId: options.pillar.id,
        caption,
        model: config.GEMINI_MODEL,
      };
    } catch (err) {
      lastError = err as Error;
      logger.warn({ attempt, err: lastError.message }, 'content generation attempt failed');
    }
  }

  throw new Error(`Gemini content generation failed after 2 attempts: ${lastError?.message}`);
}
