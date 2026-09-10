## What this changes

<!-- What changed and, more importantly, why. Link the issue it closes. -->

Closes #

## How it was verified

<!-- What you ran or observed. Note anything you could not test. -->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`

## Checklist

- [ ] No API keys, credentials, real phone numbers, JIDs, group IDs or real message content
      appear anywhere in this diff
- [ ] New settings go through `src/config/env.ts` and are documented in `.env.example`
- [ ] Module boundaries respected: `notifications/gateway/` imports nothing from `whatsapp/`
      or `ai/`, and `notifications/worker/` imports no HTTP
- [ ] Branching logic has a test, and no test touches the network
- [ ] User-facing documentation changes are mirrored in `README.pt-BR.md` and `README.es.md`
- [ ] I agree to license this contribution under the project's [MIT License](../LICENSE)
