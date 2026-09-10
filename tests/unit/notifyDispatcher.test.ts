import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { QueueUnavailableError, type Notification } from '../../src/notifications/contract.js'
import {
  createNotificationDispatcher,
  type DispatcherOptions,
  type NotificationDelivery,
} from '../../src/notifications/worker/dispatcher.js'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Drains everything already scheduled, without putting a clock on it.
 *
 * Ordering assertions must not race a `setTimeout`: on a loaded machine the timer
 * overruns, the delivery finishes early, and the assertion reads the wrong state.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/** A delivery that occupies its worker until the test explicitly releases it. */
const gate = () => {
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { held, release }
}

const notification = (to = '5511999999999'): Notification => ({
  to,
  message: 'hello',
  attachments: [],
})

const dispatcher = (delivery: NotificationDelivery, overrides: Partial<DispatcherOptions> = {}) =>
  createNotificationDispatcher({
    delivery,
    concurrency: 1,
    maxQueued: 5,
    jobTtlMs: 60_000,
    jobTimeoutMs: 5_000,
    ...overrides,
  })

describe('notification dispatcher', () => {
  it('accepts before the delivery has finished', async () => {
    const inFlight = gate()
    let finished = false
    const subject = dispatcher(async () => {
      await inFlight.held
      finished = true
    })

    const accepted = await subject.send(notification())

    // The whole point of 202: the caller is released while the send is still running.
    assert.equal(finished, false)
    assert.equal(accepted.status, 'queued')
    assert.ok(accepted.id)

    const record = await subject.status(accepted.id)
    assert.notEqual(record?.status, 'sent')

    inFlight.release()
    await subject.drain()
  })

  it('records a delivery that succeeded', async () => {
    const subject = dispatcher(async () => {})
    const accepted = await subject.send(notification())
    await subject.drain()

    const record = await subject.status(accepted.id)
    assert.equal(record?.status, 'sent')
    assert.ok(record?.finishedAt)
  })

  it('records a failed delivery instead of throwing at the caller', async () => {
    const subject = dispatcher(async () => {
      throw new Error('whatsapp said no')
    })

    // Accepting must still succeed: the caller is long gone by the time delivery is attempted.
    const accepted = await subject.send(notification())
    await subject.drain()

    const record = await subject.status(accepted.id)
    assert.equal(record?.status, 'failed')
    assert.match(record?.error ?? '', /whatsapp said no/)
  })

  it('reports a full queue as QueueUnavailableError', async () => {
    // Both deliveries wait on the same gate: the first occupies the only worker,
    // the second fills the only waiting slot.
    const held = gate()
    const subject = dispatcher(async () => held.held, { concurrency: 1, maxQueued: 1 })

    const first = subject.send(notification('5511000000001'))
    await settle()
    const second = subject.send(notification('5511000000002'))
    await settle()

    await assert.rejects(
      () => subject.send(notification('5511000000003')),
      QueueUnavailableError,
    )

    held.release()
    await Promise.all([first, second])
    await subject.drain()
  })

  it('replays the original job for a repeated idempotency key', async () => {
    let deliveries = 0
    const subject = dispatcher(async () => {
      deliveries += 1
    })

    const first = await subject.send(notification(), 'key-abc')
    const second = await subject.send(notification(), 'key-abc')

    assert.equal(second.id, first.id)
    await subject.drain()
    assert.equal(deliveries, 1)
  })

  it('treats a different idempotency key as a new job', async () => {
    const subject = dispatcher(async () => {})
    const first = await subject.send(notification(), 'key-a')
    const second = await subject.send(notification(), 'key-b')

    assert.notEqual(second.id, first.id)
    await subject.drain()
  })

  it('drain waits for in-flight deliveries', async () => {
    let done = false
    const subject = dispatcher(async () => {
      await delay(50)
      done = true
    })

    await subject.send(notification())
    await subject.drain()
    assert.equal(done, true)
  })

  it('fails a delivery that hangs past the job timeout', async () => {
    const subject = dispatcher(async () => delay(500), { jobTimeoutMs: 40 })

    const accepted = await subject.send(notification())
    await subject.drain()

    const record = await subject.status(accepted.id)
    assert.equal(record?.status, 'failed')
    assert.match(record?.error ?? '', /timed out/)
  })

  it('returns undefined for an unknown job id', async () => {
    const subject = dispatcher(async () => {})
    assert.equal(await subject.status('nope'), undefined)
  })
})
