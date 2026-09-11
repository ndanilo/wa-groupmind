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
| `ai-bot-demo.gif` | GIF, 6fps | 900x495, 44s | "What it does" — the recording, playing inline in all three READMEs |
| `ai-bot-demo.mp4` | H.264 | 1762x970, 44s | Same recording at full resolution, linked from the line above the GIF |
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

The demo recording is not a mockup. It is a real run against a test number in a private test
group (bot + operator only), so the mockup rules above do not apply to it — do not restyle or
recrop it to look like the generated stills. Account identifiers in the log pane are masked
before it is committed: the phone number, both LIDs and the group JID never reach the repo.

## Why the demo ships twice

GitHub.com strips a `<video>` tag whose `src` is a path inside the repository, which leaves an
empty gap where the player should be. An `<img>` pointing at a GIF is an ordinary image to that
sanitiser, so the GIF is what actually animates on the rendered README.

The trade-off is that a GIF large enough to keep the pino log legible would be tens of
megabytes, so `ai-bot-demo.gif` is 900px at 6fps and the log pane is only impressionistic at
that size. The MP4 stays alongside it, linked in the sentence above the GIF, for anyone who
wants to read the log lines.

Both come from the same source recording. Regenerate the GIF after replacing the MP4:

```bash
ffmpeg -i docs/assets/ai-bot-demo.mp4 -vf "fps=6,scale=900:-1:flags=lanczos,palettegen=max_colors=80:stats_mode=diff" -update 1 -frames:v 1 palette.png
ffmpeg -i docs/assets/ai-bot-demo.mp4 -i palette.png -lavfi "fps=6,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -loop 0 docs/assets/ai-bot-demo.gif
```

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
