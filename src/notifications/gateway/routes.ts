import type { FastifyInstance, FastifyReply } from 'fastify'

import { QueueUnavailableError, type NotificationSender } from '../contract.js'
import { parseNotificationForm } from './parseMultipart.js'
import { buildNotification, NotificationValidationError, type ValidationLimits } from './schema.js'

/** Hint for the caller's retry logic when the queue is momentarily full. */
const RETRY_AFTER_SECONDS = '30'

export type NotificationRouteDeps = {
  sender: NotificationSender
  limits: ValidationLimits
}

/**
 * `@fastify/multipart` reports its limit violations through error codes rather than types, so the
 * mapping to status codes is a lookup. Anything unrecognised is rethrown for the error handler.
 */
const UPLOAD_ERROR_STATUS: Record<string, number> = {
  FST_REQ_FILE_TOO_LARGE: 413,
  FST_FILES_LIMIT: 400,
  FST_PARTS_LIMIT: 400,
  FST_FIELDS_LIMIT: 400,
  FST_INVALID_MULTIPART_CONTENT_TYPE: 415,
}

function uploadErrorReply(reply: FastifyReply, error: unknown): FastifyReply | undefined {
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string') return undefined

  const status = UPLOAD_ERROR_STATUS[code]
  if (status === undefined) return undefined

  return reply.code(status).send({
    error: 'invalid_upload',
    code,
    message: error instanceof Error ? error.message : 'upload rejected',
  })
}

export function registerNotificationRoutes(app: FastifyInstance, deps: NotificationRouteDeps): void {
  const { sender, limits } = deps

  app.post('/notifications', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(415).send({
        error: 'unsupported_media_type',
        message: 'expected multipart/form-data',
      })
    }

    let form
    try {
      form = await parseNotificationForm(request)
    } catch (error: unknown) {
      const mapped = uploadErrorReply(reply, error)
      if (mapped) return mapped
      throw error
    }

    let notification
    try {
      notification = buildNotification(form.fields, form.attachments, limits)
    } catch (error: unknown) {
      if (error instanceof NotificationValidationError) {
        return reply.code(400).send({ error: 'invalid_request', issues: error.issues })
      }
      throw error
    }

    const idempotencyKey = request.headers['idempotency-key']

    try {
      const accepted = await sender.send(
        notification,
        typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
      )
      request.log.info(
        {
          id: accepted.id,
          to: notification.to,
          attachments: notification.attachments.length,
          messageChars: notification.message?.length ?? 0,
        },
        'notification accepted',
      )
      return reply.code(202).send(accepted)
    } catch (error: unknown) {
      if (error instanceof QueueUnavailableError) {
        return reply
          .code(503)
          .header('retry-after', RETRY_AFTER_SECONDS)
          .send({ error: 'queue_full', message: error.message })
      }
      throw error
    }
  })

  // Lets a caller that got a 202 find out how the delivery actually went.
  app.get<{ Params: { id: string } }>('/notifications/:id', async (request, reply) => {
    const record = await sender.status(request.params.id)
    if (!record) {
      return reply.code(404).send({ error: 'not_found', message: 'unknown or expired job id' })
    }
    return record
  })
}
