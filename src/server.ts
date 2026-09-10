import { logger } from './lib/logger.js'
import { createDispatcher, startNotificationServer } from './notifications/wiring.js'

/*
The gateway, running on its own with no WhatsApp attached. Start it with `npm run notify:server`.

Two reasons this exists. It lets you develop and test the HTTP contract without pairing a phone
or spending a real message. More importantly it is the proof that the decoupling is real: the
same gateway and the same worker are used here, with nothing swapped out but the delivery
function. If this file ever stops compiling, the boundary has been broken somewhere.

Deliveries are logged instead of sent, and because the real dispatcher is still in play, the
queue, the job store and GET /notifications/:id all behave exactly as they do in production.
*/

const log = logger.child({ module: 'notify:standalone' })

const dispatcher = createDispatcher(async (notification) => {
  log.info(
    {
      to: notification.to,
      message: notification.message,
      attachments: notification.attachments.map((file) => ({
        fileName: file.fileName,
        mediaType: file.mediaType,
        bytes: file.bytes.length,
      })),
    },
    'would deliver to whatsapp',
  )
})

let started: Awaited<ReturnType<typeof startNotificationServer>>
try {
  started = await startNotificationServer(dispatcher)
} catch (error: unknown) {
  const code = (error as { code?: unknown }).code
  log.error(
    {
      error: error instanceof Error ? error.message : String(error),
      // By far the most common cause: the bot is already up with NOTIFY_ENABLED=true and is
      // serving this very endpoint, so the standalone copy is both redundant and unable to bind.
      ...(code === 'EADDRINUSE'
        ? {
            hint:
              'the bot may already be running with NOTIFY_ENABLED=true and serving this endpoint ' +
              '(use it directly), otherwise set NOTIFY_PORT to a free port',
          }
        : {}),
    },
    'standalone notification gateway failed to start',
  )
  process.exit(1)
}

const { app, address } = started
log.info({ address }, 'standalone notification gateway listening (deliveries are logged only)')

let shuttingDown = false

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    log.info({ signal }, 'received signal')
    void (async () => {
      await app.close()
      await dispatcher.drain()
    })()
  })
}
