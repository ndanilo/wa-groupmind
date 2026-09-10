# Privacy

wa-groupmind is software you run yourself. The maintainers operate no service, receive no
data and have no access to anything you run. **You are the data controller** for every
message this bot touches — under the GDPR (EU/UK), the LGPD (Brazil), and equivalent laws
elsewhere. This document exists so you know exactly what you are controlling.

Nothing here is legal advice.

## What the bot processes

Once linked, the account receives every message in every group it belongs to. Baileys hands
all of them to the app; the app then filters.

| Data | Where it comes from | What happens to it |
| --- | --- | --- |
| Message text | Every group the linked account is in | Held in memory; discarded unless the message is an @mention |
| Sender JID / LID | Message metadata | Used to tag the reply and enforce the per-user cooldown; held in memory |
| Group JID | Message metadata | Used for the `ALLOWED_GROUP_JIDS` check |
| Question text | The part of an @mention after the handle | **Sent to third parties** (below) |
| Session credentials | WhatsApp pairing | Written to `AUTH_DIR` (default `.auth/`) |
| Generated posters | The image model | Written to `IMAGE_OUTPUT_DIR` when `SAVE_GENERATED_IMAGES=true` |

Only messages that are in a group **and** @mention the bot start a run. Direct messages,
status broadcasts, channels, the bot's own messages and reconnect backlogs are dropped before
anything else happens.

## What leaves your machine

Answering a question means sending it to third-party providers, which for most operators
means an international transfer outside the EU and Brazil:

| Provider | What is sent | Purpose |
| --- | --- | --- |
| [OpenRouter](https://openrouter.ai/privacy) (and the upstream model it routes to) | The question text, research notes, and the image prompt | Classification, research, answer writing, image generation |
| [Tavily](https://tavily.com/privacy) | Search queries derived from the question, and URLs to extract | Web search and page extraction |

Sender identifiers, group identifiers and unrelated group messages are **not** sent to either
provider — only the question and what the research produces from it. Even so, a question can
easily contain personal data if someone types it in, and you have no control over that.

Both providers are independent controllers of what they receive. Their retention and training
policies are theirs, not this project's. Read them before you deploy, and check whether the
model you selected in `CHAT_MODEL` / `IMAGE_MODEL` is served by a provider that trains on
inputs.

## What is written to disk

| Path | Contents | Notes |
| --- | --- | --- |
| `AUTH_DIR` (default `.auth/`) | WhatsApp session credentials | **Password-equivalent.** Grants full access to the linked account. Never commit it, never copy it off the host |
| `IMAGE_OUTPUT_DIR` (default `generated-images/`) | Posters plus a JSON sidecar per run | Only when `SAVE_GENERATED_IMAGES=true` |
| stdout / your log collector | pino structured logs | Message bodies appear **only** when `LOG_MESSAGE_CONTENT=true` |

There is no database. Nothing else is persisted. Deleting these folders removes everything the
app has kept.

## Settings that limit exposure

| Setting | Default | Effect |
| --- | --- | --- |
| `LOG_MESSAGE_CONTENT` | `false` | Keeps other people's message text out of your logs. Leave it off outside debugging |
| `ALLOWED_GROUP_JIDS` | _(all groups)_ | Restrict the bot to groups whose members know it is there |
| `SAVE_GENERATED_IMAGES` | `true` | Set to `false` to stop writing posters to disk |
| `NOTIFY_ALLOWED_RECIPIENTS` | _(any)_ | Restrict who the outbound webhook may message |
| `REQUEST_MAX_AGE_SECONDS` | `60` | Stops a reconnect backlog from re-processing old messages |

## Your obligations as the operator

If you deploy this where it can read other people's messages, at minimum:

1. **Tell the group.** Members must know an automated bot is present, what it does, and where
   their questions go. A pinned message naming the providers is the usual minimum.
2. **Have a lawful basis.** Consent is the realistic one for a group chat. Legitimate interest
   may work in a workplace context — document the assessment either way.
3. **Do not deploy into groups you do not administer** without the admins' agreement.
4. **Practise data minimisation.** Keep `LOG_MESSAGE_CONTENT=false`, set `ALLOWED_GROUP_JIDS`,
   and delete `generated-images/` when you no longer need it.
5. **Handle data-subject requests.** Access, deletion and objection requests come to you.
   Since the app stores no message history, this is usually a matter of clearing the folders
   above and removing the bot from the group.
6. **Account for the international transfer** in your records of processing, and check whether
   your jurisdiction requires a transfer mechanism for it.
7. **Do not use it on special-category data** — health, biometrics, political opinions,
   anything similar — without advice specific to your situation.

## Children

WhatsApp requires users to be at least 13 (16 in parts of the EU). This project is not
designed or intended for use in groups involving children.

## Reporting a privacy problem

If you believe wa-groupmind leaks or mishandles data, report it as a security issue — see
[SECURITY.md](SECURITY.md).
