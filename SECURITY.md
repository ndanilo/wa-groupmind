# Security Policy

## Supported versions

This is a small project with a single active line of development. Only the latest commit on
`master` receives security fixes.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub's
[Report a vulnerability](https://github.com/ndanilo/wa-groupmind/security/advisories/new)
form, which opens a draft advisory visible only to the maintainers.

Please include:

- What the problem is and where in the code it lives
- How to reproduce it, ideally with a minimal case
- What an attacker gets out of it
- Any fix or mitigation you have in mind

You can expect an acknowledgement within about a week. Once a fix is available it ships on
`master` and the advisory is published with credit, unless you would rather stay anonymous.

Please give us a reasonable window to fix the issue before disclosing it publicly.

## Out of scope

- **Account bans by WhatsApp.** Expected behaviour for an unofficial client — see
  [DISCLAIMER.md](DISCLAIMER.md).
- **Vulnerabilities in dependencies.** Report those upstream, to Baileys, LangChain, Fastify
  and so on. Do tell us if this project uses a dependency in a way that makes an upstream
  issue exploitable here.
- **Anything requiring an attacker to already have your `.auth/` folder or `.env`.** Those are
  credentials; their compromise is a total compromise by definition.

## Operator security notes

Things that are your responsibility, not bugs in this project:

**`AUTH_DIR` is password-equivalent.** The folder in `AUTH_DIR` (default `.auth/`) holds the
session keys for the linked WhatsApp account. Anyone who copies it can read and send messages
as that account, and rotating it means unlinking and pairing again. It is gitignored — keep it
that way, keep it off shared drives and out of backups you would not trust with a password,
and restrict it to the user the app runs as.

**Never commit `.env`.** It carries your OpenRouter key, Tavily key and `NOTIFY_API_KEY`. The
repository ignores it; verify with `git status` before you commit anything.

**The notification webhook is an authenticated send-as-you endpoint.** It is off by default.
When you enable it:

- `NOTIFY_API_KEY` is mandatory — the app refuses to boot without it. Generate a real one:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Keep `NOTIFY_HOST=127.0.0.1` unless there is a reverse proxy terminating TLS in front of it.
  Exposing it on `0.0.0.0` without TLS puts the API key on the wire in plaintext.
- Set `NOTIFY_ALLOWED_RECIPIENTS` so a leaked key cannot message arbitrary numbers.

**Run one instance.** WhatsApp permits a single connection per linked device. A second
instance evicts the first and can leave the session in a state that needs re-pairing.

**Watch your spend.** Every accepted request costs money at OpenRouter and Tavily. Keep
`INFOGRAPHIC_CONCURRENCY` low, keep `USER_COOLDOWN_MS` non-zero, and set `ALLOWED_GROUP_JIDS`
so strangers cannot spend your credit.
