import { jidDecode } from 'baileys'
import type { WAMessage, WASocket } from 'baileys'

import { config } from '../config/env.js'
import { logger } from '../lib/logger.js'
import type { InfographicBrief } from '../ai/infographic/schema.js'
import type { GeneratedImage } from '../ai/services/ImageService.js'
import { compressForWhatsApp } from './media.js'

const log = logger.child({ module: 'reply' })

/**
 * Every user-facing string the bot sends. Edit here to change wording;
 * never interpolate stack traces or provider text into these.
 *
 * `usage` is a function so the mention handle can come from `BOT_DISPLAY_NAME`.
 */
const MESSAGES = {
  /** Sent when the wording clearly asks for a picture. */
  ackImage: 'Researching and putting the infographic together, back in a moment…',
  /** Default ack: at this point the reply is still most likely text. */
  ackText: 'Looking that up, one moment…',
  /**
   * Sent once when the research runs long, so a hard question does not look like a dead bot.
   *
   * A deep question can legitimately take minutes, and the only thing worse than waiting is
   * waiting with no idea whether anything is still happening — people re-ask, and the per-user
   * gate then answers them with "one at a time", which reads like a refusal.
   */
  researchSlow: 'This one needs more sources — still digging. Back shortly.',
  usage: (botName: string) =>
    `Mention me with a question, like:\n@${botName} what is the current inflation rate?`,
  inFlight: 'Still finishing your last one — one request at a time, please.',
  cooldown: (remainingMs: number) => {
    const seconds = Math.max(1, Math.ceil(remainingMs / 1000))
    return `Please wait ${seconds}s before asking again.`
  },
  queueFull: 'My queue is full right now. Try again in a few minutes.',
  researchFailed: "I couldn't research that right now. Try again shortly.",
  imageFailed: 'I found the answer, but the artwork failed. Try again shortly.',
  emptyAnswer: "I couldn't put an answer together for that. Try rephrasing?",
  jobTimeout: 'That took longer than expected. Try again shortly.',
  unknown: 'Something went wrong on my side. Try again shortly.',
} as const

export type ErrorKind =
  | 'usage'
  | 'inFlight'
  | 'cooldown'
  | 'queueFull'
  | 'research'
  | 'image'
  | 'emptyAnswer'
  | 'timeout'
  | 'unknown'

function errorText(kind: ErrorKind, remainingMs?: number): string {
  switch (kind) {
    case 'usage':
      return MESSAGES.usage(config.botDisplayName)
    case 'inFlight':
      return MESSAGES.inFlight
    case 'cooldown':
      return MESSAGES.cooldown(remainingMs ?? config.userCooldownMs)
    case 'queueFull':
      return MESSAGES.queueFull
    case 'research':
      return MESSAGES.researchFailed
    case 'image':
      return MESSAGES.imageFailed
    case 'emptyAnswer':
      return MESSAGES.emptyAnswer
    case 'timeout':
      return MESSAGES.jobTimeout
    case 'unknown':
      return MESSAGES.unknown
  }
}

/** Caption from the brief. Rankings include the numbered list so WhatsApp stays useful even if image text is hard to read. */
export function captionFromBrief(brief: InfographicBrief): string {
  const title = brief.title.trim()
  const subtitle = brief.subtitle.trim()
  const header = subtitle ? `*${title}*\n${subtitle}` : `*${title}*`

  if (brief.layout === 'ranking' && brief.items.length > 0) {
    const lines = brief.items.map((item, index) => {
      const badge = item.badge && item.badge !== '—' ? ` _(${item.badge})_` : ''
      return `${index + 1}. *${item.name}*${badge}`
    })
    return `${header}\n\n${lines.join('\n')}`
  }

  return header
}

/** Leading @token WhatsApp uses to highlight a mention in the message body. */
function mentionToken(jid: string): string {
  const decoded = jidDecode(jid)
  return decoded?.user ? `@${decoded.user}` : ''
}

/**
 * Immediate "working on it" reply.
 *
 * `expectsImage` comes from the free keyword pass, so the wording can match the likely
 * outcome without waiting for (or paying for) the classifier.
 */
export async function sendAck(
  sock: WASocket,
  jid: string,
  message: WAMessage,
  expectsImage = false,
): Promise<void> {
  if (!config.sendAck) return
  const text = expectsImage ? MESSAGES.ackImage : MESSAGES.ackText
  await sock.sendMessage(jid, { text }, { quoted: message })
}

/**
 * Best-effort composing heartbeat.
 *
 * The client stays invisible (`markOnlineOnConnect: false`), so presence may be
 * ignored. Failures are logged at debug and never thrown.
 */
/**
 * Best-effort "still working" nudge. Never throws: a failed nudge must not fail the run.
 *
 * Follows SEND_ACK rather than adding a setting of its own — someone who turned the opening ack off
 * has already said they do not want the bot narrating itself.
 */
export async function sendProgress(
  sock: WASocket,
  jid: string,
  message: WAMessage,
): Promise<void> {
  if (!config.sendAck) return

  try {
    await sock.sendMessage(jid, { text: MESSAGES.researchSlow }, { quoted: message })
  } catch (error: unknown) {
    log.debug({ error, chat: jid }, 'progress notice failed')
  }
}

export function startTyping(sock: WASocket, jid: string): () => void {
  if (!config.typingIndicator) return () => {}

  const tick = () => {
    sock.sendPresenceUpdate('composing', jid).catch((error: unknown) => {
      log.debug({ error, chat: jid }, 'typing indicator failed')
    })
  }

  tick()
  const timer = setInterval(tick, 8_000)

  return () => {
    clearInterval(timer)
    sock.sendPresenceUpdate('paused', jid).catch(() => {})
  }
}

/** Exported so the notification path retries on the same terms the bot's own replies do. */
export async function sendWithRetry(
  sock: WASocket,
  jid: string,
  content: Parameters<WASocket['sendMessage']>[1],
  options: Parameters<WASocket['sendMessage']>[2],
  attempts = 3,
): Promise<void> {
  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      await sock.sendMessage(jid, content, options)
      return
    } catch (error: unknown) {
      lastError = error
      log.warn({ error, chat: jid, attempt: i + 1 }, 'sendMessage failed, retrying')
      await new Promise((r) => setTimeout(r, 1_000 * 2 ** i))
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function sendInfographic(
  sock: WASocket,
  jid: string,
  message: WAMessage,
  image: GeneratedImage,
  brief: InfographicBrief,
): Promise<void> {
  const compact = await compressForWhatsApp(image)
  log.info(
    {
      chat: jid,
      beforeBytes: image.bytes.length,
      afterBytes: compact.bytes.length,
    },
    'compressed image for WhatsApp',
  )

  await sendWithRetry(
    sock,
    jid,
    {
      image: compact.bytes,
      mimetype: compact.mediaType,
      caption: captionFromBrief(brief),
    },
    { quoted: message },
  )
}

/** Sends the text answer as a quoted reply, tagging the requester. */
export async function sendAnswer(
  sock: WASocket,
  jid: string,
  message: WAMessage,
  requester: string,
  answer: string,
): Promise<void> {
  const token = mentionToken(requester)
  const text = token ? `${token} ${answer}` : answer

  await sendWithRetry(
    sock,
    jid,
    {
      text,
      mentions: [requester],
      // Answers end with source URLs, and Baileys would otherwise fetch the first one to
      // build a preview card. That needs the optional link-preview-js package, adds a
      // round trip to every send, and a card for one arbitrary source is not worth either.
      linkPreview: null,
    },
    { quoted: message },
  )
}

export async function sendError(
  sock: WASocket,
  jid: string,
  message: WAMessage,
  requester: string,
  kind: ErrorKind,
  remainingMs?: number,
): Promise<void> {
  const token = mentionToken(requester)
  const body = errorText(kind, remainingMs)
  const text = token ? `${token} ${body}` : body

  await sendWithRetry(
    sock,
    jid,
    { text, mentions: [requester] },
    { quoted: message },
  )
}
