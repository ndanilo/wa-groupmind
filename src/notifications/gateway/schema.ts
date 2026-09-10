import { z } from 'zod'

import type { Notification, NotificationAttachment } from '../contract.js'
import { isRecipientAllowed, normaliseRecipient, InvalidRecipientError } from './phone.js'

/*
Validation for the multipart form, kept separate from the parsing of it.

Splitting the two means this file is pure: give it fields and attachments, get back either a
valid Notification or a list of problems. That makes it trivial to unit test without spinning up
an HTTP server, and it is the piece most likely to grow as the contract gains fields.
*/

export class NotificationValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(issues.join('; '))
    this.name = 'NotificationValidationError'
    this.issues = issues
  }
}

/** Only the free-text fields. `to` is checked further by normaliseRecipient. */
const fieldsSchema = z.object({
  to: z.string().min(1, 'to is required'),
  message: z.string().optional(),
})

export type ValidationLimits = {
  maxMessageLength: number
  allowedRecipients: readonly string[]
  defaultCountryCode: string
}

export function buildNotification(
  fields: Record<string, string>,
  attachments: NotificationAttachment[],
  limits: ValidationLimits,
): Notification {
  const parsed = fieldsSchema.safeParse(fields)
  if (!parsed.success) {
    throw new NotificationValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`),
    )
  }

  const issues: string[] = []
  const message = parsed.data.message?.trim()

  // A notification with neither text nor a file has nothing to deliver, and WhatsApp would
  // reject the empty send anyway -- better to say so now than to queue a guaranteed failure.
  if (!message && attachments.length === 0) {
    issues.push('body: provide a message, a file, or both')
  }

  if (message && message.length > limits.maxMessageLength) {
    issues.push(`message: ${message.length} characters exceeds the ${limits.maxMessageLength} limit`)
  }

  let recipient
  try {
    recipient = normaliseRecipient(parsed.data.to, {
      defaultCountryCode: limits.defaultCountryCode,
    })
    if (!isRecipientAllowed(recipient, limits.allowedRecipients)) {
      issues.push(`to: recipient is not in NOTIFY_ALLOWED_RECIPIENTS`)
    }
  } catch (error: unknown) {
    issues.push(`to: ${error instanceof InvalidRecipientError ? error.message : String(error)}`)
  }

  if (issues.length > 0 || !recipient) throw new NotificationValidationError(issues)

  return {
    to: recipient.value,
    ...(message ? { message } : {}),
    attachments,
  }
}
