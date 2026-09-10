# Disclaimer

Read this before you run wa-groupmind. By using this software you accept everything below.

## No affiliation with WhatsApp or Meta

wa-groupmind is **not** affiliated with, associated with, authorised by, endorsed by, or in
any way officially connected to WhatsApp LLC, Meta Platforms, Inc., or any of their
subsidiaries or affiliates.

"WhatsApp" and "Meta" are registered trademarks of their respective owners. They appear in
this repository only to describe what the software interoperates with — nominative use, not
a claim of association. This project uses no WhatsApp or Meta logo, wordmark, colour scheme
or other trade dress. The official website is [whatsapp.com](https://www.whatsapp.com).

## The client is unofficial

wa-groupmind talks to WhatsApp through [Baileys](https://github.com/WhiskeySockets/Baileys),
an independently maintained, reverse-engineered implementation of the WhatsApp Web protocol.
There is no official or supported API behind it.

Consequences you should assume, not hope against:

- **Accounts get banned.** Meta detects and blocks automated clients. It can happen at any
  time, without warning or appeal, and it can take the phone number with it.
- **It breaks without notice.** WhatsApp changes its protocol whenever it likes. A working
  deployment can stop working overnight.
- **Pair a number you can afford to lose.** Never a personal number, never a number your
  business depends on.

## WhatsApp's Terms of Service

Automated and unauthorised access is restricted by the
[WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service) and the
[WhatsApp Business Terms](https://www.whatsapp.com/legal/business-terms). Running this
software may put you in breach of them.

**If you need automated WhatsApp messaging for anything commercial, use the official
[WhatsApp Business Platform](https://business.whatsapp.com/products/business-platform)
(Cloud API) instead.** It exists, it is supported, and it will not get your number banned.

Reading the Terms and deciding whether your use complies with them is your job, not this
project's. The maintainers do not condone or encourage any use that violates them.

## Prohibited uses

Do not use wa-groupmind for spam, bulk or unsolicited messaging, scraping, surveillance,
stalkerware, harassment, impersonation, or anything unlawful in your jurisdiction. Do not use
it to process other people's personal data without a lawful basis — see [PRIVACY.md](PRIVACY.md).

## You are the operator, and the operator is responsible

This project ships source code. It runs nothing, hosts nothing, sends nothing, and holds no
account. Everything happens on infrastructure you control, under credentials you supply,
against groups you choose to join.

You alone are responsible for how you deploy it, whose data it touches, what it costs you,
and any consequence — technical, contractual, financial or legal — that follows. That
includes account bans, third-party API charges (OpenRouter, Tavily), and any claim brought
by a third party.

## No warranty

The software is provided "as is", without warranty of any kind, express or implied, as set
out in [LICENSE](LICENSE). The authors and copyright holders are not liable for any claim,
damage or other liability arising from the software or its use. Nothing here is legal advice;
consult a qualified lawyer for your jurisdiction and use case.
