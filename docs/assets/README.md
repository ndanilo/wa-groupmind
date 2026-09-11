# Brand and documentation assets

Images and the demo recording referenced by the three READMEs. Filenames are load-bearing —
the READMEs link to them by relative path, so renaming one breaks all three.

## Inventory

Every file here is in use. Nothing is kept "just in case" — an unreferenced image is dead weight
in a clone, so it gets deleted rather than parked.

| File | Format | Size | Used by |
| --- | --- | --- | --- |
| `logo.png` | PNG, transparent | 512x512 | Header of all three READMEs, rendered at 140px |
| `hero.jpg` | JPEG | 1600x893 | Banner under the title in all three READMEs |
| `ai-bot-demo.mp4` | H.264 | 1762x970, 44s | "What it does" — inline `<video>` of a real run |
| `ai-bot-demo.jpg` | JPEG | 1200x661 | `poster` frame for the recording (first-frame fallback) |
| `demo-answer.jpg` | JPEG | 1200x896 | "What it does" — the core ask-and-answer loop |
| `demo-infographic.jpg` | JPEG | 1200x896 | "Answer format" — a poster arriving in a thread |
| `demo-poster.jpg` | JPEG | 760x1362 | "Answer format" — a generated poster on its own |
| `demo-pairing.jpg` | JPEG | 1200x670 | "Linking the account" — the pairing code |
| `demo-webhook.jpg` | JPEG | 1200x670 | "Notification webhook" — curl in, message out |
| `social-preview.jpg` | JPEG | 1280x640 | GitHub link previews. Uploaded under Settings -> General -> Social preview, so it is the one file no markdown references |

There is deliberately no wordmark lockup. The `# wa-groupmind` heading already renders the name
in whatever colour the reader's theme calls for, which an image cannot do.

## Rules for new or replacement assets

These are not stylistic preferences. They keep the project on the safe side of trademark law,
and they are the reason the mockups can be published at all. See [DISCLAIMER.md](../../DISCLAIMER.md).

- **No green.** WhatsApp's brand green (`#25D366`) and the whole green-and-white family are out,
  as are teal and mint.
- **No chat-bubble shapes.** Message containers are squared rounded rectangles with a leading
  accent bar. No pointed tails, no teardrop corners.
- **No read receipts.** No single check, no double check, no "seen" markers.
- **No app chrome.** No title bar, call icons, search field, OS status bar or input box.
- **Square avatars**, never circles, never photographs of people.
- **No WhatsApp or Meta logo, wordmark, glyph or icon**, altered or otherwise.
- **Nothing implying endorsement** — no "official", no partner badges.

Using the word "WhatsApp" in prose to describe interoperability is nominative fair use and is
fine. Looking like WhatsApp is not.

## Palette

| Role | Hex |
| --- | --- |
| Background | `#0B1020` |
| Surface | `#1E1B4B` |
| Incoming surface | `#16162E` |
| Primary accent | `#7C3AED` |
| Secondary accent | `#22D3EE` |
| Highlight, used sparingly | `#F59E0B` |
| Text | `#F8FAFC` |
| Muted text | `#64648B` |

The five `demo-*` mockups are locked to this palette. Changing it means regenerating all of them.

`ai-bot-demo.mp4` is not a mockup. It is a screen recording of a test number and a private
test group (bot + operator only). Account identifiers in the log pane are masked before the
file is committed. The mockup rules above do not apply to it; do not restyle or recrop it to
look like the generated stills.

The READMEs embed it with a relative `<video src="docs/assets/ai-bot-demo.mp4">`. That plays in
Markdown previews and local HTML. GitHub.com sanitises `<video>` whose `src` is a path in the
repo; once this file is on `main`, drag it onto an issue or the README editor on github.com to
get a `user-attachments` URL and put that in `src` if the inline player is empty there.

## Regenerating

Product mockups are AI-generated from prompts that quote every visible string verbatim, the same
technique `renderImagePrompt` in [src/ai/infographic/prompt.ts](../../src/ai/infographic/prompt.ts)
uses on real posters. If you change a user-facing string in `MESSAGES`
([src/whatsapp/reply.ts](../../src/whatsapp/reply.ts)) or alter the answer format, the mockups go
stale and need regenerating.

Raw generator output is oversized and often JPEG regardless of the extension you save it under.
Run the optimiser to normalise formats, knock the flat background out of the logo files and
re-encode everything at web sizes:

```bash
node scripts/optimise-assets.mjs
```

It is idempotent, so anything already in its target format and size is skipped.
