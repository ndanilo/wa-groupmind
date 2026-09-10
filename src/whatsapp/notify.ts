import type { WASocket } from 'baileys'

import { errorFields, logger } from '../lib/logger.js'
import type { Notification, NotificationAttachment } from '../notifications/contract.js'
import { compressForWhatsApp } from './media.js'
import { sendWithRetry } from './reply.js'
import type { SocketGate } from './socketGate.js'

const log = logger.child({ module: 'notify' })

/*
Delivering a notification over WhatsApp.

This is the only place the webhook touches Baileys. It is handed to the dispatcher as a plain
function, which is why nothing under src/notifications/ needs to import this file -- and why the
dispatcher can be tested with a two-line fake instead of a socket.
*/

export class UnknownRecipientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnknownRecipientError'
  }
}

export type NotificationDeliveryOptions = {
  gate: SocketGate
  /** How long to wait for a reconnecting socket before giving up on the job. */
  readyTimeoutMs: number
}

export function createNotificationDelivery(
  options: NotificationDeliveryOptions,
): (notification: Notification) => Promise<void> {
  return async (notification: Notification): Promise<void> => {
    // Asked for on every delivery, never cached: reconnects replace the socket entirely.
    const sock = await options.gate.waitForReady(options.readyTimeoutMs)
    const jid = await resolveJid(sock, notification.to)

    log.info(
      {
        to: notification.to,
        jid,
        attachments: notification.attachments.length,
        messageChars: notification.message?.length ?? 0,
      },
      'delivering notification',
    )

    await deliver(sock, jid, notification)
  }
}

/**
 * Turns the caller's recipient into an address WhatsApp accepts.
 *
 * Asking the server rather than just appending `@s.whatsapp.net` does two useful things: it is
 * the only way to learn the real address under Baileys 7's LID scheme, and it turns a typo or an
 * unregistered number into a clear failure instead of a message sent quietly into nowhere.
 */
async function resolveJid(sock: WASocket, to: string): Promise<string> {
  // Groups and any address the caller already knows are used verbatim.
  if (to.includes('@')) return to

  const results = (await sock.onWhatsApp(to)) ?? []
  const match = results[0]
  if (!match?.exists) {
    throw new UnknownRecipientError(`${to} is not registered on WhatsApp`)
  }
  return match.jid
}

async function deliver(sock: WASocket, jid: string, notification: Notification): Promise<void> {
  const { message, attachments } = notification

  if (attachments.length === 0) {
    // Validation already guaranteed there is text when there are no files.
    await sendWithRetry(sock, jid, { text: message ?? '' }, undefined)
    return
  }

  // The text rides along as the first attachment's caption, so the recipient sees one message
  // rather than a stray line of text followed by an unexplained file.
  for (const [index, attachment] of attachments.entries()) {
    await sendAttachment(sock, jid, attachment, index === 0 ? message : undefined)
  }
}

async function sendAttachment(
  sock: WASocket,
  jid: string,
  attachment: NotificationAttachment,
  caption: string | undefined,
): Promise<void> {
  const captionField = caption ? { caption } : {}

  if (isCompressibleImage(attachment.mediaType)) {
    const image = await compress(attachment)
    await sendWithRetry(
      sock,
      jid,
      { image: image.bytes, mimetype: image.mediaType, ...captionField },
      undefined,
    )
    return
  }

  // Everything else -- PDFs, spreadsheets, animated GIFs -- goes as a document, which preserves
  // the file and its name instead of guessing at a media type WhatsApp may reject.
  await sendWithRetry(
    sock,
    jid,
    {
      document: attachment.bytes,
      mimetype: attachment.mediaType,
      fileName: attachment.fileName,
      ...captionField,
    },
    undefined,
  )
}

/** GIF is excluded on purpose: re-encoding it to JPEG would silently drop the animation. */
function isCompressibleImage(mediaType: string): boolean {
  return mediaType.startsWith('image/') && mediaType !== 'image/gif'
}

/**
 * Downscaling is an optimisation, not a requirement, so a file sharp cannot read is still worth
 * sending as-is rather than failing the whole notification.
 */
async function compress(
  attachment: NotificationAttachment,
): Promise<{ bytes: Buffer; mediaType: string }> {
  try {
    return await compressForWhatsApp({
      bytes: attachment.bytes,
      mediaType: attachment.mediaType,
    })
  } catch (error: unknown) {
    log.warn(
      { fileName: attachment.fileName, mediaType: attachment.mediaType, ...errorFields(error) },
      'could not compress upload, sending the original',
    )
    return { bytes: attachment.bytes, mediaType: attachment.mediaType }
  }
}
