# Catalygn Daily WhatsApp Content Service

Standalone Node.js + TypeScript microservice that generates **one business-consulting
WhatsApp post per day at 12:00 PM IST** and delivers it as an image + caption.

It is deliberately independent of the CRM and of the WhatsApp service:

```
  Gemini (free tier)                 node-cron @ Asia/Kolkata
        |                                     |
        v                                     v
  +-------------------------------------------------+
  |  catalygn-content-service  (this service)       |
  |  pillar -> caption -> image -> idempotency      |
  +-------------------------------------------------+
        |  POST /send  { imageUrl, caption }
        v
  OpsForge whatsapp-service  (existing, Baileys)  -->  WhatsApp  +919532977264
```

No Redis, no paid APIs, no extra hosting: MongoDB (existing) + the existing
whatsapp-service + Gemini's free tier.

---

## 1. Prerequisites

- Node.js >= 18 (uses the built-in `fetch`)
- A reachable, running OpsForge **whatsapp-service** (Baileys already paired)
- MongoDB (the same instance the CRM uses)
- A free-tier Gemini API key: https://aistudio.google.com/apikey
- Your `catalygn.md` playbook and `images.json` catalogue

## 2. Input files

Both live beside this service (paths are overridable in `.env`).

### `catalygn.md`

Your playbook. It is sent to the model verbatim, so the more precise it is, the
more consistent the output. Pillars may be declared either as a bullet list:

```markdown
## Pillars
- Positioning: why a narrow niche out-earns a generalist
- Pricing: charge for value delivered, not hours worked
- Sales: qualification and follow-up discipline
```

...or as `##`/`###` headings. If no pillars are parsed, six built-in
consulting pillars are used (`src/content/pillars.ts`) so the service still runs.

A `## Voice` / `## Rules` section is picked up as extra voice instructions. The
CTA asks the reader to DM the number in `CATALYGN_CONTACT_PHONE` (default
`9555154334`); no meet or booking link is ever emitted.

### `images.json`

Any of these shapes works:

```json
[
  { "url": "https://.../1.jpg", "pillars": ["positioning"], "alt": "..." },
  { "url": "https://.../2.jpg", "pillars": ["pricing", "sales"] }
]
```

```json
["https://.../1.jpg", "https://.../2.jpg"]
```

```json
{ "images": [ { "url": "https://.../1.jpg", "pillars": ["growth"] } ] }
```

An entry with no `pillars` (or an empty array) is treated as usable for **any**
pillar. An image whose `pillars` list does not contain the chosen pillar is only
used as a fallback. See `images.example.json`.

## 3. Setup

```bash
cd catalygn-service
npm install
cp .env.example .env          # then fill in the secrets
cp catalygn.md.example catalygn.md   # replace with YOUR playbook
cp images.example.json images.json   # replace with YOUR image URLs
```

Required in `.env`:

| Variable | Notes |
| --- | --- |
| `GEMINI_API_KEY` | Free-tier key. Never committed. |
| `WHATSAPP_SERVICE_SECRET` | Must equal `SERVICE_SECRET` in the whatsapp-service. |
| `MONGODB_URI` | Existing Mongo instance. |
| `CATALYGN_ADMIN_SECRET` | Long random bearer token for this service's API. Generate with `openssl rand -hex 32`. |

Notable optional ones: `CATALYGN_RECIPIENT` (default `9532977264`),
`CATALYGN_CONTACT_PHONE` (the number the CTA asks readers to DM), `CRON_SCHEDULE`, `SCHEDULER_ENABLED`,
`SEND_TEST_ALLOWLIST`.

## 4. Test before enabling the schedule

**Step 1 - dry run, sends nothing.** Composes a real caption + image and prints it:

```bash
npm run test:generate
```

Check the caption follows Hook -> Body -> CTA and that the DM number is stated.

**Step 2 - dry run over HTTP** (service running):

```bash
curl -s -X POST http://127.0.0.1:4100/test \
  -H "Authorization: Bearer $CATALYGN_ADMIN_SECRET" \
  -H 'Content-Type: application/json' -d '{}' | jq
```

**Step 3 - real image + caption delivery to your phone.** This is the check that
must pass before arming the daily job:

```bash
npm run send:test
```

The `--test` flag publishes under the throwaway date `1970-01-01`, so you can
repeat it freely without consuming today's real slot. You should receive the
image with the caption as `+919532977264`. Confirm:

- the image renders (not a broken-link placeholder)
- the caption shows hook, body, CTA
- the DM number is correct and readable

**Step 4 - arm the schedule** by setting `SCHEDULER_ENABLED=true` and restarting.

## 5. Running

Development:

```bash
npm run dev
```

Production (reusing the existing PM2 infrastructure):

```bash
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 logs catalygn-content-service
```

Run exactly **one** instance. The date-slot guard would still prevent a duplicate
send, but a second instance would double-arm the cron for no benefit.

## 6. API

All routes except `/health` require `Authorization: Bearer <CATALYGN_ADMIN_SECRET>`.

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness, timezone, current IST time, schedule. No auth. |
| `GET /status` | Recipient, schedule, model, whatsapp-service reachability, last 5 publications. |
| `GET /history?limit=20` | Publication history. |
| `POST /test` | **Dry run** - compose only, body optional `{ "postDate": "YYYY-MM-DD" }`. Never sends. |
| `POST /run` | **Real send.** Body optional `{ "postDate": "YYYY-MM-DD", "force": false }`. Idempotent per date. |

`POST /run` responses:

| `status` | HTTP | Meaning |
| --- | --- | --- |
| `sent` | 200 | Delivered. |
| `already_published` | 200 | Today already sent - nothing was sent again. |
| `in_progress` | 409 | Another run holds this date slot. |
| `failed` | 502 | All send attempts failed; see `error`. |

## 7. Reliability

- **Daily idempotency.** `Publication.postDate` has a unique index. The day's slot
  is claimed with an insert *before* any generation or sending work, so a
  duplicate cron tick, a retry after a crash, or a manual `/run` racing the
  scheduler all collapse to one message per IST date. A second insert raises
  E11000, which is treated as `already_published`, not as an error.
- **Retries.** Sends are attempted `SEND_MAX_ATTEMPTS` times with exponential
  backoff (`SEND_BACKOFF_MS * 2^(n-1)`), then the publication is marked `failed`
  with `lastError` retained for inspection.
- **Content retries.** If the model returns non-JSON or an over-long caption, the
  call is retried once with a corrective instruction, then fails loudly rather
  than sending a broken caption.
- **No repetition.** The last 20 published topics are fed back as an explicit
  "do not reuse these" list, and the pillar is chosen least-recently-used so
  consecutive days do not repeat a theme. Images are drawn from a 14-day
  unused window (`ImageUsage`), preferring pillar-matched images.
- **No fabricated claims.** The prompt forbids inventing statistics, client
  names, revenue figures, case studies or research findings.
- **Pre-flight validation.** Playbook, image catalogue and recipient number are
  validated at startup and before each run, so bad config fails before anything
  is sent. `SEND_TEST_ALLOWLIST` guards against messaging an unintended number.
- **Timeouts.** The whatsapp-service call is aborted after 20s; `/status` after 8s.

## 8. Environment variables

See `.env.example` for the full annotated list. Secrets (`GEMINI_API_KEY`,
`WHATSAPP_SERVICE_SECRET`, `CATALYGN_ADMIN_SECRET`, `MONGODB_URI`) are read only
from the environment and are never logged. The Gemini key is sent in the
`x-goog-api-key` header, not a query string, so it cannot leak via a logged URL.

## 9. Wiring to the existing whatsapp-service

This service calls the documented route:

```
POST {WHATSAPP_SERVICE_URL}/send
Authorization: Bearer {WHATSAPP_SERVICE_SECRET}

{ "agencyId": "catalygn", "clientId": "catalygn-authority",
  "phone": "+919532977264", "imageUrl": "https://...", "caption": "..." }
```

The whatsapp-service README documents `POST /send` with `template` + `vars`
(one-off text). Image-and-caption delivery is the **documented extension** this
service requires: the whatsapp-service needs to accept `imageUrl` + `caption`
on `/send` and hand them to Baileys' `sendMessage(..., { image: { url }, caption })`.
Until that lands, the whatsapp-service will reject or ignore the extra fields and
the failure surfaces in `POST /run`'s `error` field and in `lastError` - it is not
silently swallowed.

## 10. Data model

| Collection | Purpose |
| --- | --- |
| `publications` | Publication history + the unique per-date idempotency guard. |
| `imageusages` | Image rotation history (14-day unused window). |
| `topichistories` | Topic history, fed back to the model to avoid repetition. |

Use a dedicated database (e.g. `mongodb://.../catalygn`) so these collections
do not mix with CRM data.

## 11. Project layout

```
catalygn-service/
  .env.example              annotated environment template
  catalygn.md.example       playbook template
  images.example.json       image catalogue template
  ecosystem.config.js       PM2 process definition
  src/
    index.ts                entrypoint: validate -> DB -> API -> scheduler
    config.ts               env loading + validation
    publisher.ts            the daily pipeline (idempotency, retries, history)
    types.ts
    logger/index.ts         pino logger
    utils/phone.ts          Indian phone -> E.164 (+91...)
    utils/date.ts           Asia/Kolkata date helpers
    content/playbook.ts     catalygn.md loader/parser (pillars, voice, CTA)
    content/images.ts       images.json loader + rotation-aware selector
    content/pillars.ts      built-in fallback pillars
    content/gemini.ts       pillar selection, prompt, generation, validation
    whatsapp/client.ts      POST /send (image + caption) and /status probe
    scheduler/scheduler.ts  node-cron daily tick @ Asia/Kolkata
    database/db.ts          Mongo connection
    database/models/        Publication, ImageUsage, TopicHistory
    api/server.ts           express app (/health, /status, /history, /test, /run)
    api/middleware/auth.ts  Bearer CATALYGN_ADMIN_SECRET check
    scripts/generateOnly.ts npm run test:generate (dry run)
    scripts/sendNow.ts      npm run send:now (real send)
    scripts/smoke.ts        offline logic tests (no network/DB)
```
#   A u t h o r i t y - B u i l d e r  
 