import { randomUUID } from 'node:crypto'

import { QueueFullError, TaskQueue } from '../../lib/queue.js'
import {
  QueueUnavailableError,
  type Notification,
  type NotificationAccepted,
  type NotificationRecord,
  type NotificationSender,
} from '../contract.js'
import { JobStore } from './jobStore.js'

/*
Accepts notifications, then delivers them in the background.

How the message actually reaches WhatsApp is injected as `delivery`, which is what keeps this
module free of any import from src/whatsapp/. It also means the tests drive it with a plain
function instead of a socket.

This gets its OWN TaskQueue instance rather than sharing the bot's, so a burst of notifications
cannot occupy the workers the @mention pipeline needs, and vice versa. Two independent bulkheads
beat one shared pool with priority rules.
*/

export type NotificationDelivery = (notification: Notification) => Promise<void>

/** The few logger methods used here, so the module does not depend on a logging library. */
export type DispatcherLogger = {
  info: (obj: object, msg: string) => void
  error: (obj: object, msg: string) => void
}

export type DispatcherOptions = {
  delivery: NotificationDelivery
  concurrency: number
  maxQueued: number
  jobTtlMs: number
  /** Guards against a hung upload holding a worker slot forever. */
  jobTimeoutMs: number
  logger?: DispatcherLogger
  now?: () => number
}

export type NotificationDispatcher = NotificationSender & {
  /** Resolves once every accepted job has finished. Used on shutdown. */
  drain(): Promise<void>
  readonly queued: number
  readonly running: number
}

export function createNotificationDispatcher(
  options: DispatcherOptions,
): NotificationDispatcher {
  const { delivery, jobTimeoutMs, logger } = options
  const queue = new TaskQueue({
    concurrency: options.concurrency,
    maxQueued: options.maxQueued,
  })
  const store = new JobStore({ ttlMs: options.jobTtlMs, ...(options.now ? { now: options.now } : {}) })

  /** Never throws: a delivery failure is a recorded outcome, not a queue error. */
  async function runJob(id: string, notification: Notification): Promise<void> {
    store.markSending(id)
    const startedAt = Date.now()
    try {
      await withTimeout(delivery(notification), jobTimeoutMs)
      store.markSent(id)
      logger?.info({ id, to: notification.to, elapsedMs: Date.now() - startedAt }, 'notification sent')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      store.markFailed(id, message)
      logger?.error(
        { id, to: notification.to, elapsedMs: Date.now() - startedAt, error: message },
        'notification delivery failed',
      )
    }
  }

  return {
    async send(
      notification: Notification,
      idempotencyKey?: string,
    ): Promise<NotificationAccepted> {
      // A retried request must not produce a second WhatsApp message.
      if (idempotencyKey !== undefined) {
        const existing = store.findByIdempotencyKey(idempotencyKey)
        if (existing) return { id: existing.id, status: 'queued' }
      }

      const id = randomUUID()

      /*
      TaskQueue.run() resolves when the job FINISHES, but the 202 has to go out the moment the
      job is accepted. The queue's existing onEnqueued hook fires at exactly that point -- it was
      added so the bot could ack only after admission -- so acceptance is bridged out through
      this promise while the job itself keeps running unwatched.
      */
      const accepted = new Promise<void>((resolve, reject) => {
        void queue
          .run(
            () => runJob(id, notification),
            async () => {
              store.create(id, idempotencyKey)
              resolve()
            },
          )
          .catch(reject)
      })

      try {
        await accepted
      } catch (error: unknown) {
        // Only reachable before onEnqueued ran, which for this queue means the waiting list was
        // full. Translated into the contract's own error so the gateway never imports src/lib.
        if (error instanceof QueueFullError) throw new QueueUnavailableError()
        throw error
      }

      return { id, status: 'queued' }
    },

    async status(id: string): Promise<NotificationRecord | undefined> {
      return store.find(id)
    },

    drain: () => queue.drain(),

    get queued() {
      return queue.size
    },

    get running() {
      return queue.running
    },
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return promise

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`delivery timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
