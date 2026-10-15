# Catalygn Daily WhatsApp Content Service

A standalone Node.js + TypeScript microservice that generates **one
business-consulting WhatsApp post every day at 12:00 PM IST** and
delivers it as an image with a caption.

The service is independent of the CRM and the existing WhatsApp service.

## Architecture

``` text
Gemini (free tier) + node-cron (Asia/Kolkata)
                    |
                    v
+--------------------------------------------------+
| catalygn-content-service                          |
| pillar -> caption -> image -> idempotency guard  |
+--------------------------------------------------+
                    |
                    | POST /send { imageUrl, caption }
                    v
       OpsForge whatsapp-service (Baileys)
                    |
                    v
             WhatsApp recipient
```

**Designed to reuse existing infrastructure:** MongoDB, the existing
`whatsapp-service`, and Gemini's free tier. No Redis, paid APIs, or
additional hosting are required by design.

## 1. Prerequisites

-   Node.js 18 or newer (uses the built-in `fetch` API).
-   A reachable, running OpsForge `whatsapp-service`, with Baileys
    already paired.
-   MongoDB (the existing CRM instance can be used, although a dedicated
    database is recommended).
-   A free-tier Gemini API key from [Google AI
    Studio](https://aistudio.google.com/apikey).
-   Your `catalygn.md` playbook and `images.json` image catalogue.

## 2. Input files

Both files live beside this service. Their paths can be overridden in
`.env`.

### `catalygn.md`

This is the content playbook. It is sent to the model verbatim, so clear
and specific instructions help keep posts consistent.

Pillars can be declared as a bullet list:

``` markdown
## Pillars

- Positioning: why a narrow niche out-earns a generalist
- Pricing: charge for value delivered, not hours worked
- Sales: qualification and follow-up discipline
```

Pillars can also be declared using `##` or `###` headings. If no pillars
are parsed, the service uses six built-in consulting pillars from
`src/content/pillars.ts`.

A `## Voice` or `## Rules` section is used as additional voice guidance.

The call to action asks readers to DM the number configured in
`CATALYGN_CONTACT_PHONE` (default: `9555154334`). The generated post
does not include a meeting or booking link.

### `images.json`

The catalogue supports these formats.

**Object entries with pillar matching:**

``` json
[
  {
    "url": "https://example.com/1.jpg",
    "pillars": ["positioning"],
    "alt": "Positioning visual"
  },
  {
    "url": "https://example.com/2.jpg",
    "pillars": ["pricing", "sales"]
  }
]
```

**A list of image URLs:**

``` json
[
  "https://example.com/1.jpg",
  "https://example.com/2.jpg"
]
```

**An object containing an `images` array:**

``` json
{
  "images": [
    {
      "url": "https://example.com/1.jpg",
      "pillars": ["growth"]
    }
  ]
}
```

An entry without `pillars`, or with an empty `pillars` array, can be
used for any pillar. An image whose pillar list does not include the
selected pillar is only used as a fallback. See `images.example.json`.

## 3. Setup

From the repository root:

``` bash
cd catalygn-service
npm install
cp .env.example .env
cp catalygn.md.example catalygn.md
cp images.example.json images.json
```

Then edit `.env` and add your secrets. Replace `catalygn.md` with your
own playbook and `images.json` with your own image URLs.

### Required environment variables

  -----------------------------------------------------------------------
  Variable                            Purpose
  ----------------------------------- -----------------------------------
  `GEMINI_API_KEY`                    Gemini free-tier API key. Never
                                      commit it.

  `WHATSAPP_SERVICE_SECRET`           Must match `SERVICE_SECRET` in the
                                      `whatsapp-service`.

  `MONGODB_URI`                       Connection string for the MongoDB
                                      instance.

  `CATALYGN_ADMIN_SECRET`             Long, random bearer token for this
                                      service's API. Generate one with
                                      `openssl rand -hex 32`.
  -----------------------------------------------------------------------

### Optional environment variables

-   `CATALYGN_RECIPIENT` --- recipient number; default: `9532977264`.
-   `CATALYGN_CONTACT_PHONE` --- number shown in the post's call to
    action.
-   `CRON_SCHEDULE` --- schedule used by the daily job.
-   `SCHEDULER_ENABLED` --- enables or disables the scheduler.
-   `SEND_TEST_ALLOWLIST` --- restricts test sends to approved
    recipients.

See `.env.example` for the complete annotated list.

## 4. Test before enabling the schedule

### Step 1 --- Generate a post without sending it

``` bash
npm run test:generate
```

Review the generated caption. Confirm that it follows **Hook → Body →
CTA** and includes the correct DM number.

### Step 2 --- Test the HTTP dry-run endpoint

Start the service, then run:

``` bash
curl -s -X POST http://127.0.0.1:4100/test \
  -H "Authorization: Bearer $CATALYGN_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

This composes a post but does not send it.

### Step 3 --- Send a real test image and caption

``` bash
npm run send:test
```

The `--test` flag uses the throwaway date `1970-01-01`, allowing
repeated tests without consuming the current day's publication slot.

Confirm that:

-   The image renders correctly and is not a broken-link placeholder.
-   The caption contains the hook, body, and CTA.
-   The DM number is correct and readable.

### Step 4 --- Enable the daily schedule

Set `SCHEDULER_ENABLED=true` in `.env`, then restart the service.

## 5. Running the service

### Development

``` bash
npm run dev
```

### Production with PM2

``` bash
npm run build
pm2 start ecosystem.config.js
pm2 save
pm2 logs catalygn-content-service
```

When `SCHEDULER_ENABLED=true`, the daily scheduler runs at **12:00 PM
IST**. The cron timezone is explicitly set to `Asia/Kolkata`, so the
schedule does not depend on the host machine's timezone.

The process must be running at the scheduled time.

### Optional keepalive

An optional 10-minute pinger can be enabled with:

``` env
KEEPALIVE_ENABLED=true
KEEPALIVE_URL=https://your-service.onrender.com/health
```

A service cannot reliably keep its own Render free instance awake by
pinging itself: a sleeping process cannot execute its own timer. If
preventing sleep is required, use an external uptime monitor or a
supported always-on hosting plan.

Run **exactly one instance**. The date-slot guard prevents duplicate
publication, but multiple instances would unnecessarily arm multiple
cron jobs.

## 6. API

All routes except `GET /health` require bearer-token authentication:

``` http
Authorization: Bearer <CATALYGN_ADMIN_SECRET>
```

  --------------------------------------------------------------------------------------------
  Method                  Route                   Purpose
  ----------------------- ----------------------- --------------------------------------------
  `GET`                   `/health`               Liveness, timezone, current IST time, and
                                                  schedule. No authentication required.

  `GET`                   `/status`               Recipient, schedule, model, WhatsApp-service
                                                  reachability, and the last five
                                                  publications.

  `GET`                   `/history?limit=20`     Publication history.

  `POST`                  `/test`                 Dry run: composes content only. Optional
                                                  body: `{"postDate":"YYYY-MM-DD"}`. Never
                                                  sends a message.

  `POST`                  `/run`                  Real send. Optional body:
                                                  `{"postDate":"YYYY-MM-DD","force":false}`.
                                                  Idempotent per date.
  --------------------------------------------------------------------------------------------

### `POST /run` response statuses

  ------------------------------------------------------------------------
  `status`                               HTTP status Meaning
  --------------------- ---------------------------- ---------------------
  `sent`                                       `200` Message delivered.

  `already_published`                          `200` The date already has
                                                     a publication;
                                                     nothing was sent
                                                     again.

  `in_progress`                                `409` Another run currently
                                                     holds the date slot.

  `failed`                                     `502` All send attempts
                                                     failed; inspect the
                                                     `error` field.
  ------------------------------------------------------------------------

## 7. Reliability and safeguards

-   **Daily idempotency:** `Publication.postDate` has a unique index.
    The date slot is claimed by inserting a record before generation or
    sending begins. Duplicate cron ticks, retries after a crash, and a
    manual `/run` racing the scheduler therefore converge on one
    publication per IST date.
-   **Duplicate-key handling:** MongoDB error `E11000` is treated as
    `already_published`, not as an unexpected error.
-   **Send retries:** Sending is attempted `SEND_MAX_ATTEMPTS` times
    with exponential backoff: `SEND_BACKOFF_MS * 2^(n-1)`. After the
    final failure, the publication is marked `failed` and `lastError` is
    retained.
-   **Content retries:** If the model returns invalid JSON or an
    overlong caption, generation is retried once with corrective
    instructions. If it still fails, the service stops instead of
    sending a malformed caption.
-   **Topic variety:** The last 20 published topics are passed to the
    model as topics to avoid. Pillars are selected using
    least-recently-used logic so consecutive days do not repeat a theme.
-   **Image rotation:** Images are selected from a 14-day unused window
    (`ImageUsage`), preferring images that match the chosen pillar.
-   **No fabricated claims:** The prompt prohibits invented statistics,
    client names, revenue figures, case studies, or research findings.
-   **Pre-flight validation:** The playbook, image catalogue, and
    recipient number are validated at startup and before each run, so
    invalid configuration fails before a message is sent.
-   **Test-recipient protection:** `SEND_TEST_ALLOWLIST` can restrict
    test messages to approved numbers.
-   **Timeouts:** Calls to the WhatsApp service abort after 20 seconds;
    `/status` checks time out after 8 seconds.

## 8. Environment variables and secrets

See `.env.example` for the full annotated list.

The following values are read only from the environment and are never
logged:

-   `GEMINI_API_KEY`
-   `WHATSAPP_SERVICE_SECRET`
-   `CATALYGN_ADMIN_SECRET`
-   `MONGODB_URI`

The Gemini API key is sent in the `x-goog-api-key` header rather than in
the URL query string, avoiding exposure through logged URLs.

**Never commit `.env` or real API keys, tokens, or database
credentials.**

## 9. Integration with the existing `whatsapp-service`

This service calls the following endpoint:

``` http
POST {WHATSAPP_SERVICE_URL}/send
Authorization: Bearer {WHATSAPP_SERVICE_SECRET}
Content-Type: application/json
```

Request body:

``` json
{
  "agencyId": "catalygn",
  "clientId": "catalygn-authority",
  "phone": "+919532977264",
  "imageUrl": "https://example.com/post.jpg",
  "caption": "Your generated caption goes here."
}
```

The existing `whatsapp-service` README documents `POST /send` with
`template` and `vars` for one-off text messages. Image-and-caption
delivery is an extension required by this service.

The `whatsapp-service` must accept `imageUrl` and `caption` on `/send`
and pass them to Baileys in a call equivalent to:

``` ts
sendMessage(phone, {
  image: { url: imageUrl },
  caption
});
```

Until that extension is implemented, the existing service may reject or
ignore the additional fields. Such failures should surface in the `/run`
response's `error` field and in `lastError`; they must not be silently
swallowed.

## 10. Data model

  -----------------------------------------------------------------------
  Collection                          Purpose
  ----------------------------------- -----------------------------------
  `publications`                      Publication history and the unique
                                      per-date idempotency guard.

  `imageusages`                       Image-rotation history for the
                                      14-day unused window.

  `topichistories`                    Topic history used to help the
                                      model avoid repetition.
  -----------------------------------------------------------------------

Use a dedicated database (for example, `mongodb://.../catalygn`) so
these collections do not mix with CRM data.

## 11. Project layout

``` text
catalygn-service/
├── .env.example                  # Annotated environment template
├── catalygn.md.example           # Playbook template
├── images.example.json           # Image catalogue template
├── ecosystem.config.js           # PM2 process definition
└── src/
    ├── index.ts                  # Entrypoint: validate -> DB -> API -> scheduler
    ├── config.ts                 # Environment loading and validation
    ├── publisher.ts              # Daily pipeline, idempotency, retries, history
    ├── types.ts
    ├── logger/
    │   └── index.ts              # Pino logger
    ├── utils/
    │   ├── phone.ts              # Indian phone number -> E.164 (+91...)
    │   └── date.ts               # Asia/Kolkata date helpers
    ├── content/
    │   ├── playbook.ts           # Playbook loader/parser (pillars, voice, CTA)
    │   ├── images.ts             # Image catalogue loader and rotation-aware selector
    │   ├── pillars.ts            # Built-in fallback pillars
    │   └── gemini.ts             # Pillar selection, prompting, generation, validation
    ├── whatsapp/
    │   └── client.ts             # POST /send (image + caption) and /status probe
    ├── scheduler/
    │   └── scheduler.ts          # Daily node-cron tick at 12:00 PM IST
    ├── database/
    │   ├── db.ts                 # MongoDB connection
    │   └── models/
    │       ├── Publication
    │       ├── ImageUsage
    │       └── TopicHistory
    ├── api/
    │   ├── server.ts             # Express routes: /health, /status, /history, /test, /run
    │   └── middleware/
    │       └── auth.ts            # Bearer CATALYGN_ADMIN_SECRET validation
    └── scripts/
        ├── generateOnly.ts       # npm run test:generate (dry run)
        ├── sendNow.ts            # npm run send:now (real send)
        └── smoke.ts              # Offline logic tests (no network/DB)
```
