import multipart from '@fastify/multipart'
import Fastify, {
  type FastifyBaseLogger,
  type FastifyError,
  type FastifyInstance,
} from 'fastify'

import type { NotificationSender } from '../contract.js'
import { apiKeyHook } from './auth.js'
import { registerNotificationRoutes } from './routes.js'
import type { ValidationLimits } from './schema.js'

/*
The HTTP edge, and the reason the future repository split is cheap.

Nothing under gateway/ imports from src/whatsapp/ or src/ai/. Everything this server needs --
the sender, its configuration, its logger -- arrives through buildNotificationServer(), so the
module has no idea whether messages are delivered in this process or over a network. Moving it
to its own repository is then a copy of this folder plus contract.ts, with a different
NotificationSender passed in.

The factory deliberately does not call listen(). Whoever builds the server decides where it
binds, which is what lets the tests run it on an ephemeral port.
*/

export type NotificationServerConfig = ValidationLimits & {
  apiKey: string
  maxFileBytes: number
  maxFiles: number
}

export type NotificationServerDeps = {
  sender: NotificationSender
  config: NotificationServerConfig
  /** Omit to silence the server entirely, which is what the tests do. */
  logger?: FastifyBaseLogger
}

export async function buildNotificationServer(
  deps: NotificationServerDeps,
): Promise<FastifyInstance> {
  const { sender, config, logger } = deps

  const app = Fastify(logger ? { loggerInstance: logger } : { logger: false })

  await app.register(multipart, {
    limits: {
      fileSize: config.maxFileBytes,
      files: config.maxFiles,
      // Generous but finite, so a malformed body cannot stream parts forever.
      fields: 20,
      parts: config.maxFiles + 20,
    },
    throwFileSizeLimit: true,
  })

  // Unauthenticated on purpose: a process supervisor or reverse proxy needs to probe liveness
  // without holding a copy of the API key.
  app.get('/health', async () => ({ status: 'ok' }))

  // Fastify encapsulation: hooks apply only to the context they are registered in, so wrapping
  // the real routes in their own plugin is what keeps /health outside the api key check.
  await app.register(async (secured) => {
    secured.addHook('onRequest', apiKeyHook(config.apiKey))
    registerNotificationRoutes(secured, { sender, limits: config })
  })

  // Fastify's default handler would echo the thrown message. Anything unhandled at this point is
  // a bug on our side, and its text has no business reaching an external caller.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500
    if (status >= 500) {
      request.log.error({ err: error }, 'notification request failed')
      return reply.code(status).send({ error: 'internal_error' })
    }
    return reply.code(status).send({ error: error.code ?? 'bad_request', message: error.message })
  })

  return app
}
