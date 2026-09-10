# Notification webhook

An HTTP endpoint an external system POSTs to, which forwards the message — and any attached
file — to a WhatsApp recipient.

This is completely separate from the `@mention` bot. The bot is *inbound*: a message arrives,
the AI pipeline runs, a reply goes out. This is *outbound only*: something outside the app
decides a message should be sent, and this delivers it. No AI, no research, no cost.

Off by default. Set `NOTIFY_ENABLED=true` to turn it on.

## Quick start

```bash
# .env
NOTIFY_ENABLED=true
NOTIFY_API_KEY=<generate one, see below>
NOTIFY_DEFAULT_COUNTRY_CODE=55
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then `npm run dev` as usual — the webhook comes up alongside the bot, on
`http://127.0.0.1:3001`.

To work on the HTTP side without pairing a phone or spending a real message:

```bash
npm run notify:server
```

That runs the same gateway with deliveries logged instead of sent. More on why that exists
under [Splitting into two repositories](#splitting-into-two-repositories).

## The request

```
POST /notifications
x-api-key: <NOTIFY_API_KEY>
Idempotency-Key: <optional>
Content-Type: multipart/form-data
```

| Field     | Required | Notes |
| --------- | -------- | ----- |
| `to`      | yes      | Digits with country code, or a full JID for groups (`...@g.us`) |
| `message` | if no file | Text body, up to `NOTIFY_MAX_MESSAGE_LENGTH` |
| `file`    | if no message | Repeatable, up to `NOTIFY_MAX_FILES` |

`to` is forgiving about formatting: `+55 (11) 98765-4321`, `5511987654321` and — with
`NOTIFY_DEFAULT_COUNTRY_CODE=55` — `11987654321` all resolve to the same recipient.

### Responses

| Status | Meaning |
| ------ | ------- |
| `202` | Accepted and queued. Body is `{ "id", "status": "queued" }` |
| `400` | Validation failed. Body lists the specific `issues` |
| `401` | Missing or wrong `x-api-key` |
| `413` | A file exceeded `NOTIFY_MAX_FILE_BYTES` |
| `415` | Body was not `multipart/form-data` |
| `503` | Queue full. Retry after the seconds in `Retry-After` |

**`202` means queued, not delivered.** See [Why 202](#why-202-and-not-200).

### Other routes

| Route | Auth | Purpose |
| ----- | ---- | ------- |
| `GET /notifications/:id` | yes | How a job actually went: `queued`, `sending`, `sent` or `failed` |
| `GET /health` | no | Liveness, for a supervisor or reverse proxy that has no API key |

## Examples

Text only:

```bash
curl -X POST http://127.0.0.1:3001/notifications \
  -H "x-api-key: $NOTIFY_API_KEY" \
  -F "to=5511987654321" \
  -F "message=Deploy finished"
```

With an image:

```bash
curl -X POST http://127.0.0.1:3001/notifications \
  -H "x-api-key: $NOTIFY_API_KEY" \
  -F "to=5511987654321" \
  -F "message=Yesterday's numbers" \
  -F "file=@chart.png;type=image/png"
```

To a group, with a retry-safe key:

```bash
curl -X POST http://127.0.0.1:3001/notifications \
  -H "x-api-key: $NOTIFY_API_KEY" \
  -H "Idempotency-Key: report-2026-09-08" \
  -F "to=120363012345678901@g.us" \
  -F "message=Daily report"
```

Checking how it went:

```bash
curl -H "x-api-key: $NOTIFY_API_KEY" \
  http://127.0.0.1:3001/notifications/<id>
```

## How a request flows

```
POST /notifications
  |
  |  gateway/            (knows nothing about WhatsApp)
  +--> auth.ts           x-api-key check
  +--> parseMultipart.ts stream -> fields + file buffers
  +--> schema.ts         Zod + phone.ts -> a valid Notification
  |
  +==> NotificationSender.send()  ---------> 202 { id } back to the caller
  |
  |  worker/             (knows nothing about HTTP)
  +--> dispatcher.ts     own TaskQueue, own worker pool
  +--> jobStore.ts       status + idempotency
  |
  |  ../whatsapp/        (injected as a plain function)
  +--> notify.ts         wait for socket -> resolve JID -> compress -> send
```

## Design decisions

Written down because the reasoning matters more than the code, and because each of these had a
plausible alternative.

### The one-way dependency rule

`gateway/` never imports from `src/whatsapp/` or `src/ai/`. It knows only `contract.ts`.

Everything it needs — the sender, its configuration, its logger — arrives as arguments to
`buildNotificationServer()`. That single constraint is the entire decoupling strategy: a module
that imports nothing from its host can be moved to another repository by copying the folder.

`worker/` follows the same rule in the other direction: it receives a `delivery` function and
has no idea it eventually reaches Baileys.

`wiring.ts` is the one file that knows about all three. That is deliberate — it is the
composition root, and the only file that gets rewritten when the split happens.

### Why 202 and not 200

A WhatsApp send takes seconds, and it can arrive while the socket is reconnecting. Holding the
caller's request open for all of that would make every external system's timeout your problem.

So `send()` resolves on *acceptance*, and delivery continues in the background. It also happens
to be the only promise a remote implementation could honestly keep, which is exactly why the
in-process sender and a future HTTP one stay interchangeable.

The cost is that `202` no longer means "delivered", so `GET /notifications/:id` exists to
answer that separately.

### Why the file is buffered into memory

The bytes have to be fully read before the handler responds. Returning `202` ends the request,
which destroys the multipart stream — a worker that tried to read it later would find it closed.

That is what `NOTIFY_MAX_FILE_BYTES` is protecting: peak memory is roughly that ceiling times
`NOTIFY_CONCURRENCY`. At the 10 MB default with 2 workers that is ~20 MB, which is fine. If you
ever need substantially larger files, spool them to a temp directory in `parseMultipart.ts` and
pass a path instead of a buffer.

A related Node detail worth knowing: **every file part must be fully consumed**, even one you
intend to discard. A multipart body is a single stream of parts, and abandoning one mid-way
leaves the parser waiting for bytes nobody is reading, hanging the request until it times out.

### Its own queue, not the bot's

The `TaskQueue` in `src/lib/queue.ts` is reused, but notifications get their **own instance**.

Two independent worker pools beat one shared pool with priority rules: a burst of notifications
cannot occupy the workers the `@mention` pipeline needs, and a slow infographic cannot delay a
notification. Each gets a small, predictable budget.

The bot's `AdmissionControl` is deliberately *not* used. Its per-user cooldown and
one-job-per-user rule are right for humans spamming a bot and wrong for a notification system,
which may legitimately fire ten messages to one recipient in a row.

### Why the socket is looked up on every send

`WhatsAppConnection` builds a brand new `WASocket` on every reconnect. Anything that captures a
reference keeps writing into a dead socket from the first disconnect onward — and because
Baileys does not always error loudly on a closed socket, that failure can be silent.

`SocketGate` holds whichever socket is live right now, and `notify.ts` asks it per delivery.
`waitForReady()` additionally turns a reconnect from a failure into a short wait, since the
socket is usually back well within `NOTIFY_READY_TIMEOUT_MS`.

### Why the recipient is resolved through `onWhatsApp()`

Appending `@s.whatsapp.net` to the digits would usually work, but asking the server does two
things that matter: it returns the correct address under Baileys 7's LID scheme, and it turns a
typo or an unregistered number into a clear `failed` status instead of a message sent quietly
into nowhere.

### Authentication is deliberately minimal

One static key from config, compared with `!==`. No hashing, no rotation, no per-caller keys.

Two other guards carry the weight: the app **refuses to boot** with `NOTIFY_ENABLED=true` and no
key set, so a missing `.env` value can never silently become an open endpoint; and `NOTIFY_HOST`
defaults to `127.0.0.1`, so nothing off-machine can reach the port until you deliberately widen
it.

If you ever expose this publicly, upgrade to `crypto.timingSafeEqual` and per-caller keys, and
put TLS in front of it. A plain `!==` leaks key content through timing, which only matters once
an attacker can actually reach the port.

### Idempotency

External systems retry, and a timeout on their side does not mean the message was not sent.
Repeating a request with the same `Idempotency-Key` returns the original job instead of sending
a second WhatsApp message.

The store is in memory, so keys are forgotten on restart. That is an honest trade for a
single-process bot; back `jobStore.ts` with Redis or SQLite if you need it to survive deploys.

## Splitting into two repositories

The constraint that shapes everything: **Baileys is single-instance**. The `.auth/` credentials
grant one connection, and a second process using the same session kicks the first off with
`connectionReplaced`. So the split can never be "two processes that both send WhatsApp
messages". It has to be:

```
repo A: notification-gateway          repo B: whatsapp-sender
  HTTP edge, no WhatsApp                owns the Baileys socket
  gateway/ + contract.ts                worker/ + contract.ts + whatsapp/
                     \                 /
                      \               /
                    an HTTP call between them
```

What actually changes:

1. **Copy** `gateway/` and `contract.ts` into repo A. Nothing inside them changes — that is the
   payoff of the one-way dependency rule.
2. **Write** `HttpNotificationSender` in repo A, implementing the same `NotificationSender`
   interface by POSTing to repo B and rebuilding `QueueUnavailableError` from a 503.
3. **Keep** `worker/`, `whatsapp/` and `contract.ts` in repo B, and give it a small internal
   endpoint that calls `dispatcher.send()`.
4. **Delete** `wiring.ts`. Each repo grows its own composition root.
5. **Decide** how `contract.ts` is shared: copy it (fine for two repos), or publish it as a tiny
   package (better once there are more consumers).

Two things become real problems only after the split, and are worth knowing in advance. The
attachment stops being an in-memory `Buffer` handed between functions and becomes bytes crossing
a network, so repo A has to forward the file rather than pass a reference. And the in-memory
`jobStore` no longer serves `GET /notifications/:id` from repo A, so status has to be proxied to
repo B or moved to a shared store.

`npm run notify:server` is the guard against drift in the meantime. It boots the gateway with a
logging delivery function and no WhatsApp at all. If it ever stops working, something in
`gateway/` has grown a dependency it should not have.

## Files

| File | Role |
| ---- | ---- |
| `contract.ts` | Types and errors shared by both sides. Imports nothing |
| `gateway/app.ts` | Fastify factory. Does not call `listen()` — the caller decides where it binds |
| `gateway/routes.ts` | The three routes and the error-to-status mapping |
| `gateway/auth.ts` | The `x-api-key` hook |
| `gateway/parseMultipart.ts` | Multipart stream into fields and buffers |
| `gateway/schema.ts` | Zod validation, pure and independently testable |
| `gateway/phone.ts` | Recipient normalisation and the allowlist check |
| `worker/dispatcher.ts` | Accepts, queues, and runs deliveries in the background |
| `worker/jobStore.ts` | Job status and idempotency, with lazy expiry |
| `wiring.ts` | Composition root. The file that gets replaced on a split |
| `../whatsapp/notify.ts` | The delivery function: resolve, compress, send |
| `../whatsapp/socketGate.ts` | Holds the currently live socket |

## Tests

```bash
npm test
```

- `tests/unit/notifyPhone.test.ts` — recipient normalisation and the allowlist
- `tests/unit/notifyDispatcher.test.ts` — acceptance semantics, failure recording, idempotency,
  queue limits, timeouts
- `tests/unit/notifyGateway.test.ts` — the HTTP surface, driven over a real socket with `fetch`
  and `FormData` on an OS-assigned port

The gateway tests use a real server rather than Fastify's `inject()` because multipart handling
is most of what is worth testing, and only a real request exercises the actual encoder.
