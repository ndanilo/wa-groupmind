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
export const MESSAGES = {
  /** Sent when the wording clearly asks for a picture. */
  ackImage: 'Pesquisando e montando o infográfico, já volto…',
  /** Default ack: at this point the reply is still most likely text. */
  ackText: 'Pesquisando, já te respondo…',
  usage: (botName: string) =>
    `Me marca com uma pergunta, tipo:\n@${botName} qual a taxa Selic atual?`,
  inFlight: 'Ainda estou terminando o seu anterior — um pedidinho de cada vez.',
  cooldown: (remainingMs: number) => {
    const seconds = Math.max(1, Math.ceil(remainingMs / 1000))
    return `Aguarde ${seconds}s antes de pedir de novo.`
  },
  queueFull: 'Estou com a fila cheia agora. Tenta de novo em alguns minutos.',
  researchFailed: 'Não consegui pesquisar isso agora. Tenta de novo daqui a pouco.',
  imageFailed: 'Pesquisei, mas a arte falhou. Tenta de novo daqui a pouco.',
  emptyAnswer: 'Não consegui montar uma resposta pra isso. Tenta reformular?',
  jobTimeout: 'Demorou mais do que o esperado. Tenta de novo daqui a pouco.',
  unknown: 'Algo deu errado por aqui. Tenta de novo daqui a pouco.',
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
