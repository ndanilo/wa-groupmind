# AGENTS.md

Guidance for AI coding agents working in this repository. Cursor users also get these as
scoped rules under `.cursor/rules/`.

## What this is

wa-groupmind is a WhatsApp group bot: `@bot <question>` becomes a researched answer, as text
or as a generated infographic. Baileys for WhatsApp, a LangGraph.js graph for research and
generation. It is a **public open-source repository** that links a real WhatsApp account —
which drives most of the rules below.

## Commands

Windows PowerShell: chain with `;`, not `&&`. Node 24 (`.nvmrc`); CI also runs 22.

```powershell
npm run dev        # watch mode
npm run typecheck  # tsc --noEmit
npm test           # node:test, 186 tests, no network
npm run build      # emit to dist/
```

**Typecheck, test and build must all pass before you call a change done.** Run them yourself
rather than telling the user to.

## Architecture

| Path | Role |
| --- | --- |
| `src/whatsapp/` | Baileys socket, @mention detection, reply senders |
| `src/ai/` | Self-contained LangGraph assistant (graph, nodes, services, tools) |
| `src/notifications/` | Optional outbound HTTP webhook, off by default |
| `src/lib/` | Shared pino logger and the bounded worker queue |
| `src/config/env.ts` | The only file that reads `process.env` |

Boundaries that must hold:

- `src/config/env.ts` is the single reader of `process.env`. New settings go there with a
  default, then into `.env.example` and all three READMEs.
- `src/notifications/gateway/` never imports from `src/whatsapp/` or `src/ai/`.
- `src/notifications/worker/` never imports anything HTTP.
- `src/notifications/contract.ts` imports nothing.

The notification subsystem is deliberately extractable into its own repository.

## Never commit real data

This repository is public and anything committed is permanent.

- No credentials in code, tests, docs or comments — every key comes from `process.env` through
  `src/config/env.ts`.
- No real phone numbers, JIDs or group IDs. Placeholders: `5511999999999`,
  `5511999999999@s.whatsapp.net`, `123456789012345@lid`, `120363000000000000@g.us`.
- No real names, emails or message content from actual conversations in fixtures, and no links
  to real articles about identifiable people — use `example.com`.
- Never read, print, copy or commit `.env` or the `AUTH_DIR` folder (`.auth/`). The auth folder
  is password-equivalent: it grants full access to the linked WhatsApp account.
- `LOG_MESSAGE_CONTENT` defaults to `false` deliberately. Do not flip it, and do not add
  logging of message bodies, sender identifiers or group names at `info` or above.

Anything that changes what data leaves the machine or lands on disk must be reflected in
`PRIVACY.md`.

## Code style

Strict ESM TypeScript with `nodenext`, so relative imports carry the `.js` extension
(`import { config } from '../config/env.js'`) even in `.ts` source. `import type` for
type-only imports. `async`/`await`, named exports, `pino` child loggers instead of
`console.log`. `noUncheckedIndexedAccess` is on — handle `T | undefined` rather than asserting
it away.

Comments explain *why*, not *what*. No speculative abstractions, no new dependencies or
tooling unless asked.

Tests use `node:test` in `tests/unit/`, never touch the network, and set env vars before the
dynamic import because `src/config/env.ts` snapshots `process.env` at module load.

## Documentation is trilingual

`README.md` (English) is canonical, with `README.pt-BR.md` and `README.es.md` alongside it.
**A user-facing change must land in all three.** Translate prose; never translate code,
commands, paths, env var names, env var values or model slugs.

## Out of bounds

Do not add features whose main purpose is spam, bulk messaging, scraping, surveillance, or
evading WhatsApp's anti-automation measures. See `DISCLAIMER.md`.
