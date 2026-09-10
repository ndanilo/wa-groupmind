# Contributing

Thanks for considering a contribution. This is a small, deliberately minimal project — the
bar for new code is that it earns its place.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md), and you accept the
constraints in [DISCLAIMER.md](DISCLAIMER.md).

## Before you start

Open an issue first for anything beyond a bug fix or a typo. It is much cheaper to disagree
about an approach in an issue than in a finished pull request.

Contributions that make the project better at spam, bulk messaging, scraping, evading
WhatsApp's anti-automation measures, or anything else in the prohibited-uses list will be
closed without discussion.

## Setup

Node 24 is what the project is developed and tested against; the CI matrix also covers 22.

```bash
git clone https://github.com/ndanilo/wa-groupmind.git
cd wa-groupmind
npm install
cp .env.example .env
```

You do not need a linked WhatsApp account or any API key to run the test suite.

## Before you open a pull request

All three must pass:

```bash
npm run typecheck
npm test
npm run build
```

CI runs exactly these on Node 22 and 24, so a green local run is a green CI run.

## Never commit real data

This is the one rule with no exceptions. Reviewers will check.

- No API keys, tokens or credentials — not in code, not in tests, not in docs, not in a commit
  you plan to amend away.
- No real phone numbers, WhatsApp JIDs or group IDs. Use obvious placeholders:
  `5511999999999`, `120363000000000000@g.us`, `123456789012345@lid`.
- No real names, email addresses or message content from actual conversations.
- No links to real news articles about identifiable people in test fixtures — use
  `example.com`.
- Never commit `.env` or the `AUTH_DIR` folder. Both are gitignored; confirm with
  `git status` anyway.

If you commit a secret by accident, treat it as leaked: rotate it immediately, then tell us.

## Code style

There is no linter, so match the code around you.

- TypeScript, strict, ESM. Relative imports carry the `.js` extension (`./foo.js`), which is
  what `nodenext` resolution requires even in `.ts` source.
- `async`/`await`, not raw promise chains.
- `src/config/env.ts` is the only file that reads `process.env`. Add new settings there with a
  default, and document them in `.env.example` and all three READMEs.
- Respect the module boundaries. `src/notifications/gateway/` never imports from
  `src/whatsapp/` or `src/ai/`; `src/notifications/worker/` never imports HTTP. The
  notification subsystem is deliberately extractable into its own repository.
- Comments explain *why*, not *what*. If a line needs a comment to say what it does, rename
  something instead.
- Solve the problem in front of you. No speculative abstractions.

## Tests

Tests use the built-in `node:test` runner and live in `tests/unit/`. Anything with branching
logic — parsing, formatting, queueing, validation — needs a test. Nothing in the suite may
touch the network.

## Documentation

`README.md` is canonical. **Any user-facing change must be mirrored into
[README.pt-BR.md](README.pt-BR.md) and [README.es.md](README.es.md).** A pull request that
updates only the English README is incomplete.

Translation-only pull requests are very welcome, including for languages we do not have yet.

## Commits and pull requests

Write commit subjects in the imperative mood: "add Spanish intent keywords", not "added" or
"adds". Keep a pull request to one concern, and describe what changed and why in the body.

## Licence

Contributions are accepted under the [MIT License](LICENSE) that covers the project.
