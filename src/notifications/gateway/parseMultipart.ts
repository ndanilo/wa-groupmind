import type { FastifyRequest } from 'fastify'

import type { NotificationAttachment } from '../contract.js'

/*
Reading the multipart body into plain data.

Two things here are easy to get wrong in Node:

1. Every file part must be fully consumed, even one we intend to discard. A multipart body is a
   single stream of parts; abandoning one mid-way leaves the parser waiting for bytes nobody is
   reading, and the request hangs until it times out.

2. The bytes have to be in memory before the handler responds. Returning 202 ends the request,
   which destroys the stream, so a worker that tried to read it later would find it closed. That
   is the whole reason NOTIFY_MAX_FILE_BYTES exists: peak memory is roughly that ceiling times
   NOTIFY_CONCURRENCY. Spooling to a temp file is the upgrade path if you ever need bigger.
*/

export type ParsedForm = {
  fields: Record<string, string>
  attachments: NotificationAttachment[]
}

export async function parseNotificationForm(request: FastifyRequest): Promise<ParsedForm> {
  const fields: Record<string, string> = {}
  const attachments: NotificationAttachment[] = []

  for await (const part of request.parts()) {
    if (part.type !== 'file') {
      fields[part.fieldname] = String(part.value)
      continue
    }

    // Drains the part. Throws FST_REQ_FILE_TOO_LARGE once the configured fileSize is passed,
    // which the route turns into a 413.
    const bytes = await part.toBuffer()

    // Browsers submit an empty file input as a part with a blank filename. Nothing to send.
    if (!part.filename) continue

    attachments.push({
      fileName: part.filename,
      mediaType: part.mimetype || 'application/octet-stream',
      bytes,
    })
  }

  return { fields, attachments }
}
