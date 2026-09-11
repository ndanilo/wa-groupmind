/*
The agreement between the HTTP gateway and whatever ultimately delivers the message.

This file deliberately imports nothing. It is the only module both sides share, so when the
gateway moves into its own repository it travels along unchanged -- copied, or published as a
tiny package. Everything else on either side is free to diverge.
*/

/** One uploaded file, already read fully into memory by the gateway. */
export type NotificationAttachment = {
  fileName: string
  /** MIME type as reported by the uploader, e.g. `image/png`. */
  mediaType: string
  /** Buffer rather than Uint8Array: Baileys' media upload accepts Buffer only. */
  bytes: Buffer
}

export type Notification = {
  /** Digits with country code (5511999999999) or a full JID for groups (`...@g.us`). */
  to: string
  message?: string
  attachments: NotificationAttachment[]
}

export type NotificationStatus = 'queued' | 'sending' | 'sent' | 'failed'

export type NotificationRecord = {
  id: string
  status: NotificationStatus
  acceptedAt: number
  finishedAt?: number
  /** Present only when status is 'failed'. Already sanitised for the caller. */
  error?: string
}

/** What the caller gets back the moment the job is accepted -- not when it is delivered. */
export type NotificationAccepted = {
  id: string
  status: 'queued'
}

/**
 * The seam that makes the future repository split cheap.
 *
 * `send` resolves on ACCEPTANCE, never on delivery: a WhatsApp send takes seconds and can land
 * mid-reconnect, so promising delivery would force the caller to hold a request open for the
 * whole thing. That looser promise is also the only one a remote implementation could honestly
 * keep, which is exactly why the in-process and HTTP adapters stay interchangeable.
 *
 * Both methods are async so an implementation is free to cross a network.
 */
export interface NotificationSender {
  send(notification: Notification, idempotencyKey?: string): Promise<NotificationAccepted>
  status(id: string): Promise<NotificationRecord | undefined>
}

/**
 * The sender cannot take more work right now; the caller should retry later (HTTP 503).
 *
 * Over a network an error class cannot survive serialisation, so a future HTTP adapter would
 * rebuild this from the status code rather than receive the instance itself.
 */
export class QueueUnavailableError extends Error {
  constructor(message = 'notification queue is full') {
    super(message)
    this.name = 'QueueUnavailableError'
  }
}
