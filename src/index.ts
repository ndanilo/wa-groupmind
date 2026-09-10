import { config } from './config/env.js'
import { logger } from './lib/logger.js'
import { createInfographicRuntime } from './whatsapp/infographic.js'
import { WhatsAppConnection } from './whatsapp/connection.js'
import { SocketGate } from './whatsapp/socketGate.js'
import type { NotificationService } from './notifications/wiring.js'

const runtime = createInfographicRuntime()

// Only built when the webhook is on, so the default path is exactly what it always was.
const gate = config.notifyEnabled ? new SocketGate() : undefined

const connection = new WhatsAppConnection((error) => {
  logger.error({ error: error.message }, 'shutting down')
  process.exitCode = 1
  void shutdown()
}, runtime, gate)

let notifications: NotificationService | undefined
let shuttingDown = false

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  try {
    // Closes the HTTP listener before draining, so nothing new is admitted mid-teardown.
    await notifications?.stop()
    // Let in-flight infographics finish (or time out) before tearing down the socket.
    await runtime.drain()
    await connection.stop()
  } finally {
    // Baileys leaves timers behind that would keep the event loop alive. Without this the
    // process survives Ctrl+C and the leftover instance fights the next run for the session.
    process.exit(process.exitCode === undefined ? 0 : Number(process.exitCode))
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    logger.info({ signal }, 'received signal')
    void shutdown()
  })
}

// Imported dynamically so Fastify is never even loaded unless the webhook is enabled.
if (gate) {
  const { startNotificationService } = await import('./notifications/wiring.js')
  try {
    notifications = await startNotificationService(gate)
  } catch (error: unknown) {
    // Nearly always a missing NOTIFY_API_KEY or a port already in use. Both deserve one clear
    // line rather than the stack trace a top-level throw would print.
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'notification webhook failed to start',
    )
    process.exit(1)
  }
}

await connection.start()
