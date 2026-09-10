import type { FastifyInstance } from 'fastify'

import { config, requireNotifyApiKey } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { createNotificationDelivery } from '../whatsapp/notify.js'
import type { SocketGate } from '../whatsapp/socketGate.js'
import { buildNotificationServer, type NotificationServerConfig } from './gateway/app.js'
import {
  createNotificationDispatcher,
  type NotificationDelivery,
  type NotificationDispatcher,
} from './worker/dispatcher.js'

/*
The composition root: the one module that knows about all the others.

gateway/ and worker/ are deliberately ignorant of each other and of WhatsApp; this file is where
they are introduced. It is also the only file that reads the app's config object, which is what
keeps those folders portable.

When the gateway moves to its own repository, this is the file that gets replaced -- one half
becomes "build a server whose sender posts over HTTP", the other "build a worker that listens".
Nothing inside gateway/ or worker/ has to change.
*/

const log = logger.child({ module: 'notify' })

export type NotificationService = {
  dispatcher: NotificationDispatcher
  /** Where the server bound, for logging. */
  address: string
  /** Closes HTTP, releases anyone waiting on a reconnect, then drains in-flight sends. */
  stop(): Promise<void>
}

/** Maps the app's flat env config onto the narrow shape the gateway actually needs. */
function notificationServerConfig(): NotificationServerConfig {
  return {
    apiKey: requireNotifyApiKey(),
    maxFileBytes: config.notifyMaxFileBytes,
    maxFiles: config.notifyMaxFiles,
    maxMessageLength: config.notifyMaxMessageLength,
    allowedRecipients: config.notifyAllowedRecipients,
    defaultCountryCode: config.notifyDefaultCountryCode,
  }
}

export function createDispatcher(delivery: NotificationDelivery): NotificationDispatcher {
  return createNotificationDispatcher({
    delivery,
    concurrency: config.notifyConcurrency,
    maxQueued: config.notifyMaxQueued,
    jobTtlMs: config.notifyJobTtlMs,
    jobTimeoutMs: config.notifyJobTimeoutMs,
    logger: log,
  })
}

export async function startNotificationServer(
  dispatcher: NotificationDispatcher,
): Promise<{ app: FastifyInstance; address: string }> {
  const app = await buildNotificationServer({
    sender: dispatcher,
    config: notificationServerConfig(),
    logger: logger.child({ module: 'notify:http' }),
  })

  const address = await app.listen({ host: config.notifyHost, port: config.notifyPort })
  return { app, address }
}

/**
 * Wires the webhook to a live WhatsApp socket.
 *
 * Throws before binding when NOTIFY_API_KEY is missing, so an enabled-but-unprotected endpoint
 * can never come up.
 */
export async function startNotificationService(gate: SocketGate): Promise<NotificationService> {
  const dispatcher = createDispatcher(
    createNotificationDelivery({ gate, readyTimeoutMs: config.notifyReadyTimeoutMs }),
  )

  const { app, address } = await startNotificationServer(dispatcher)

  log.info(
    {
      address,
      concurrency: config.notifyConcurrency,
      maxQueued: config.notifyMaxQueued,
      allowlist: config.notifyAllowedRecipients.length || 'any',
    },
    'notification webhook listening',
  )

  return {
    dispatcher,
    address,
    async stop() {
      // Order matters. Stop accepting first, then release anyone parked waiting for a reconnect
      // that is no longer coming, and only then wait for the sends still in flight.
      await app.close()
      gate.stop()
      await dispatcher.drain()
    },
  }
}
