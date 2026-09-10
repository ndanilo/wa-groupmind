# whatsapp-infographic

A WhatsApp group bot that turns `@bot <pergunta>` into a researched answer — as text by
default, or as an infographic poster when you ask for one.
Built on [Baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp and a self-contained
LangGraph.js graph (OpenRouter + Tavily) for routing, research and image generation.

> [!WARNING]
> Baileys is an unofficial reverse-engineered client. It is not affiliated with or endorsed by
> WhatsApp or Meta, and using it can get an account banned. Pair a **test number**, never a
> personal or business-critical one. The folder in `AUTH_DIR` holds credentials that grant
> full access to the linked account — treat it like a password and keep it out of git.
>
> Each run costs money on OpenRouter (chat + image) and Tavily (search). Keep concurrency
> low and prefer an allowlisted set of groups.

## Stack

| Concern   | Choice                                              |
| --------- | --------------------------------------------------- |
| Runtime   | Node.js 22+ (developed on 24), ESM                  |
| Language  | TypeScript, strict, `nodenext` resolution           |
| WhatsApp  | `baileys` 7.x                                       |
| Orchestration | `@langchain/langgraph` `StateGraph` with conditional routing |
| AI chat   | OpenRouter via `@langchain/openai` + tool-calling agent |
| Web search| Tavily (`@langchain/tavily`)                        |
| Images    | OpenRouter `POST /images`                           |
| Logging   | `pino`, pretty-printed in development               |

## Getting started

```bash
npm install
cp .env.example .env
# fill OPENROUTER_API_KEY, TAVILY_API_KEY, and PHONE_NUMBER (if pairing by code)
npm run dev
```

There are two ways to link the account, selected with `PAIRING_MODE`.

**Pairing code (`PAIRING_MODE=code`)** — recommended when QR scanning fails. Set `PHONE_NUMBER`
to the number you are linking, digits with country code and no `+`. The terminal prints an
8-character code; enter it under **Settings → Linked devices → Link with phone number instead**.

**QR code (`PAIRING_MODE=qr`)** — prints a QR in the terminal to scan from
**Settings → Linked devices → Link a device**.

Credentials land in `.auth/` once linked, so later runs reconnect without pairing again.

## Group questions

Only **group** messages that **@mention the bot** trigger a run. Direct chats are ignored.

```
@Bot quais as notícias de hoje?            -> bold topic list
@Bot explica a alta do dólar               -> prose explanation
@Bot faz um infográfico da taxa Selic      -> poster
```

What happens:

1. The bot checks the mention, strips the `@…` token, and takes the rest as the question.
2. If the question is empty it replies with a short PT-BR usage hint.
3. On accept it sends an immediate quoted ack and starts a typing indicator.
4. The graph routes the question (see below), researching and generating only what is needed.
5. The reply comes back **quoted**: text tagging the requester, or an image whose caption is
   `*title*` + subtitle (plus the numbered list for rankings).
6. On any failure, nothing is sent except a friendly PT-BR error (quoted, tagging the
   requester). Stack traces stay in the log.

### The graph

Text is the default. An image costs a research loop, a brief and an image generation, so
that branch only runs when the question actually asks for a picture.

```
             +--> writeAnswer --------------------------------> END
  classify --+
             +--> research --+--> writeAnswer ----------------> END
                             |
                             +--> writeBrief -> styleRefs -> renderPrompt
                                             -> generateImage -> persist -> END
```

`classify` decides two things: **mode** (`text` or `image`) and **needsResearch**.

- A free keyword pass (`src/ai/graph/intent.ts`) catches the obvious asks — `infográfico`,
  `imagem`, `arte`, `pôster`, `desenha`, `gera uma imagem`, `draw`, `chart`… An image request
  always implies research, so it short-circuits without paying for a model call.
- Anything ambiguous goes to a temperature-0 classifier with structured output. If it fails,
  the fallback is researched text: a researched answer is never wrong, an unwanted image costs
  money.
- `needsResearch` is `false` only for small talk or self-contained language tasks (translate
  this, what does this word mean). In that case the answer stage runs under a prompt that
  forbids stating anything time-sensitive, since it has no web access on that path.

`styleRefs` and `persist` are plain nodes that no-op internally on `USE_IMAGE_REFERENCES` and
`SAVE_GENERATED_IMAGES`, which keeps the graph shape honest in Studio.

### Answer format

Text answers come in two shapes, and the **default is a scannable topic list** — three to six
bold headlines with one line of concrete fact each. That is what people actually read in a
group chat.

Prose is **opt-in**: `detectAnswerDepth` in `src/ai/graph/intent.ts` looks for an explicit ask
(`detalha`, `explica`, `explique`, `aprofunda`, `esclarece`, `analisa`, `por que`,
`como <sujeito> funciona/aconteceu/conseguiu`, `mais detalhes`, `explain`, `detailed`…) and only
then switches to paragraphs, with a larger character budget.

Both budgets (`ANSWER_LIMITS` in `src/ai/services/LLMService.ts`) cover the **body only**. The
trailing `Fontes:` block — up to five bare URLs — is split off, kept out of the budget and
re-attached afterwards, so trimming a long answer drops the weakest topic instead of the sources.

Every text reply then goes through `toWhatsAppText` (`src/ai/lib/whatsappText.ts`), which
rewrites whatever markdown the model leaked into the only syntax WhatsApp renders: `**x**` and
`## x` become `*x*`, bullets become `•`, `[texto](url)` becomes `texto: url`, fences and tables
flatten. The prompts forbid markdown, but a prompt is not a guarantee.

Depth is deliberately **not** delegated to the classifier. Asked to judge it, the model called
an ordinary "quais as notícias de hoje" *detailed* and produced exactly the wall of prose this
format exists to avoid. A regex is deterministic, unit-tested, and biased the right way — the
cost of missing a vague "go deeper" is that the reader rephrases with "explica".

### Inspecting a run

```bash
npm run langchain:server
```

Opens LangGraph Studio against the same compiled graph (`langgraph.json` →
`src/ai/graph/studio.ts`). Invoke it with just a question:

```json
{ "question": "quais as melhores séries de 2026?" }
```

Studio renders the routing decision, every node's state update and each tool call, which
beats reading the pino output when a run goes sideways.

### Concurrency

Several people can ask at once. Requests share a bounded in-process worker pool:

| Rule | Default |
| ---- | ------- |
| Concurrent graph runs | `INFOGRAPHIC_CONCURRENCY=3` |
| Extra waiting slots | `INFOGRAPHIC_MAX_QUEUED=10` |
| Max 1 in-flight per user | — |
| Per-user cooldown after a finish | `USER_COOLDOWN_MS=60000` |
| Hard job timeout | `JOB_TIMEOUT_MS=300000` |

When the queue is full or a user is already running / in cooldown, the bot answers with a
specific PT-BR message instead of starting another paid run.

### Safety gates

- Groups only; status broadcasts and channels are skipped.
- Live messages only (`notify`); reconnect backlogs (`append`) are ignored.
- Messages older than `REQUEST_MAX_AGE_SECONDS` are ignored.
- Own messages are never answered (avoids a self-reply loop).
- Optional `ALLOWED_GROUP_JIDS` allowlist.

## Notification webhook

An optional HTTP endpoint that lets an external system send a WhatsApp message — with an
attached file — through this app. No AI involved, and completely separate from the bot above:
that one is inbound and reactive, this one is outbound only.

**Off by default.** Set `NOTIFY_ENABLED=true` and `NOTIFY_API_KEY` to turn it on.

```bash
curl -X POST http://127.0.0.1:3001/notifications \
  -H "x-api-key: $NOTIFY_API_KEY" \
  -F "to=5511987654321" \
  -F "message=Deploy finished" \
  -F "file=@chart.png;type=image/png"
```

```
{"id":"7d27fa53-f6fb-4d87-bb97-70a028bc0593","status":"queued"}
```

`202` means queued, not delivered — a send takes seconds and can land mid-reconnect, so the
caller is released immediately and `GET /notifications/:id` reports how it actually went.
Notifications run on their own worker pool, so they cannot starve the `@mention` pipeline.

The HTTP layer is deliberately isolated from WhatsApp so it can move to its own repository
later. **[Full documentation, design decisions and the repo-split guide →](src/notifications/README.md)**

## Scripts

| Script              | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `npm run dev`       | Run from TypeScript; reloads only when `./src` changes |
| `npm run dev:stable`| Same, **without** file watch (safer for long WhatsApp sessions) |
| `npm run typecheck` | Type check without emitting                            |
| `npm run build`     | Compile to `dist/`                                     |
| `npm start`         | Run the compiled build (expects `npm run build` first) |
| `npm test`          | Unit tests (`node:test`)                               |
| `npm run langchain:server` | LangGraph Studio against the assistant graph    |
| `npm run notify:server` | Notification webhook alone, deliveries logged not sent |

## Configuration

Read from `.env`; see `.env.example` for the full commented list.

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PAIRING_MODE` | `qr` | `qr` or `code` |
| `PHONE_NUMBER` | — | Digits with country code, required for `code` |
| `AUTH_DIR` | `.auth` | Session credentials folder |
| `LOG_LEVEL` | `info` | pino level |
| `ALLOWED_GROUP_JIDS` | _(all)_ | Comma-separated group JIDs |
| `REQUEST_MAX_AGE_SECONDS` | `60` | Ignore older messages |
| `MAX_QUESTION_LENGTH` | `500` | Cap after stripping mentions |
| `INFOGRAPHIC_CONCURRENCY` | `3` | Parallel graph runs |
| `INFOGRAPHIC_MAX_QUEUED` | `10` | Waiting-list size |
| `USER_COOLDOWN_MS` | `5000` | Gap after a *successful* job from the same user (`0` disables) |
| `JOB_TIMEOUT_MS` | `300000` | Hard ceiling per job |
| `BOT_DISPLAY_NAME` | `bobesponja-ai` | Handle shown in usage hints (`@name …`) |
| `SEND_ACK` | `true` | Immediate "pesquisando…" reply (wording adapts to text vs image) |
| `TYPING_INDICATOR` | `true` | Composing presence while working |
| `SAVE_GENERATED_IMAGES` | `true` | Write posters under `IMAGE_OUTPUT_DIR` |
| `USE_IMAGE_REFERENCES` | `true` | Editorial topics: fetch real news photos as style refs |
| `IMAGE_REFERENCE_COUNT` | `2` | How many photo URLs to pass to the image model |
| `OPENROUTER_API_KEY` | — | **Required** for generation |
| `TAVILY_API_KEY` | — | **Required** for web search |
| `CHAT_MODEL` | `deepseek/deepseek-v4-flash-0731` | OpenRouter chat slug |
| `IMAGE_MODEL` | `bytedance-seed/seedream-4.5` | OpenRouter image slug |
| `IMAGE_ASPECT_RATIO` | `9:16` | Portrait by default |
| `IMAGE_RESOLUTION` | `2K` | Below 2K labels get unreadable |
| `IMAGE_OUTPUT_FORMAT` | `jpeg` | Smaller WhatsApp payloads |
| `OUTPUT_LANGUAGE` | `pt-BR` | Language of every reply, and the region Tavily boosts (`pt-BR` → `brazil`) |

WhatsApp can still pair without the AI keys. The first `@bot` request without them fails
with a research error reply and a clear log line.

Notification webhook (all optional, all inert while `NOTIFY_ENABLED=false`):

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `NOTIFY_ENABLED` | `false` | Master switch. Off means Fastify is never even loaded |
| `NOTIFY_HOST` | `127.0.0.1` | Loopback by default; widen only behind a TLS proxy |
| `NOTIFY_PORT` | `3001` | |
| `NOTIFY_API_KEY` | — | **Required** when enabled; the app refuses to boot without it |
| `NOTIFY_MAX_FILE_BYTES` | `10485760` | Per file (10 MB) |
| `NOTIFY_MAX_FILES` | `4` | Attachments per request |
| `NOTIFY_MAX_MESSAGE_LENGTH` | `4096` | |
| `NOTIFY_CONCURRENCY` | `2` | Its own worker pool, separate from the bot's |
| `NOTIFY_MAX_QUEUED` | `50` | Waiting-list size before `503` |
| `NOTIFY_ALLOWED_RECIPIENTS` | _(any)_ | Comma-separated numbers or JIDs |
| `NOTIFY_DEFAULT_COUNTRY_CODE` | — | Prepended to local numbers, e.g. `55` |
| `NOTIFY_JOB_TTL_MS` | `3600000` | How long a finished job stays queryable |
| `NOTIFY_READY_TIMEOUT_MS` | `30000` | How long a send waits for a reconnecting socket |
| `NOTIFY_JOB_TIMEOUT_MS` | `120000` | Whole-job ceiling |

## Project structure

```
src/
  index.ts                      entry, shared runtime, graceful shutdown
  server.ts                     notification webhook alone (no WhatsApp)
  config/env.ts                 the only place that reads process.env
  lib/
    logger.ts                   shared pino logger
    queue.ts                    bounded worker pool + per-user admission
  whatsapp/
    connection.ts               socket lifecycle: pairing, reconnect, teardown
    handlers/messages.ts        messages.upsert: log, then route mentions
    mention.ts                  @bot detection (PN + LID) and question parsing
    reply.ts                    PT-BR ack / text / image / error senders
    infographic.ts              orchestrates queue + graph + replies
    socketGate.ts               publishes the currently live socket
    notify.ts                   outbound delivery for the webhook
  notifications/                HTTP webhook — see its own README
    contract.ts                 shared types; imports nothing
    wiring.ts                   composition root
    gateway/                    Fastify edge; never imports whatsapp/ or ai/
    worker/                     queue + job store; never imports HTTP
  ai/                           self-contained LangGraph assistant
    config.ts                   AI settings derived from env
    graph/
      graph.ts                  StateGraph wiring, routing, runAssistant()
      state.ts                  AssistantState (StateSchema)
      intent.ts                 free keyword pass for image intent
      studio.ts                 LangGraph Studio entry point
      nodes/                    one file per node, services injected
    services/                   LLMService, ImageService
    infographic/                Zod brief schema + image prompt builder
    tools/                      datetime + Tavily search/extract
    lib/imageStore.ts           optional disk persistence
```

## How the connection behaves

- **Run only one instance.** WhatsApp allows a single connection per linked device, so a second
  instance kicks the first off with `conflict / replaced`. When that happens the loser exits
  immediately rather than reconnecting.
- **Credentials are saved on every `creds.update`**, otherwise the next start asks to pair again.
- **Transient drops reconnect** with exponential backoff, capped at `MAX_RECONNECT_ATTEMPTS`.
- **Dead credentials** clear the auth folder and exit — only pairing again can fix them.
- **Ctrl+C drains the queue** then exits for real. Baileys leaves timers behind, so shutdown
  forces the process to exit; otherwise a lingering instance fights the next run for the session.

If you see a repeating `conflict / replaced` loop, a previous instance is still alive. On Windows:

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*src/index.ts*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## License

[MIT](LICENSE)
