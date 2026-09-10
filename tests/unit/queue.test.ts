import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  AdmissionControl,
  JobTimeoutError,
  QueueFullError,
  TaskQueue,
  UserCooldownError,
  UserInFlightError,
} from '../../src/lib/queue.js'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Drains everything already scheduled, without putting a clock on it.
 *
 * Ordering assertions must not race a `setTimeout`: on a loaded machine the timer
 * overruns, the job under test finishes early, and the assertion reads the wrong
 * state. Yielding a few times is deterministic.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/** A job body that occupies its worker until the test explicitly releases it. */
const gate = () => {
  let release = (): void => {}
  const held = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { held, release }
}

describe('TaskQueue', () => {
  it('respects concurrency', async () => {
    const queue = new TaskQueue({ concurrency: 2, maxQueued: 10 })
    let running = 0
    let peak = 0

    const job = async () => {
      running += 1
      peak = Math.max(peak, running)
      await delay(40)
      running -= 1
    }

    await Promise.all([queue.run(job), queue.run(job), queue.run(job), queue.run(job)])
    assert.equal(peak, 2)
    assert.equal(queue.running, 0)
  })

  it('runs waiting jobs in FIFO order', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxQueued: 10 })
    const order: number[] = []

    const blocker = gate()
    const first = queue.run(async () => {
      order.push(1)
      await blocker.held
    })

    // Let the first job claim the only worker before enqueueing the rest.
    await settle()

    const second = queue.run(async () => {
      order.push(2)
    })
    const third = queue.run(async () => {
      order.push(3)
    })

    blocker.release()
    await Promise.all([first, second, third])
    assert.deepEqual(order, [1, 2, 3])
  })

  it('rejects when the waiting list is full', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxQueued: 1 })

    const running = gate()
    const queued = gate()

    const blocker = queue.run(async () => running.held)
    await settle()
    const waiting = queue.run(async () => queued.held)
    await settle()

    await assert.rejects(() => queue.run(async () => undefined), QueueFullError)

    running.release()
    queued.release()
    await Promise.all([blocker, waiting])
  })

  it('drain waits until idle', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxQueued: 5 })
    let done = false
    void queue.run(async () => {
      await delay(40)
      done = true
    })
    await queue.drain()
    assert.equal(done, true)
  })
})

describe('AdmissionControl', () => {
  it('rejects a second concurrent job from the same user', async () => {
    const queue = new TaskQueue({ concurrency: 2, maxQueued: 5 })
    const admission = new AdmissionControl(queue, {
      cooldownMs: 0,
      jobTimeoutMs: 5_000,
    })

    const job = gate()
    const first = admission.admit('user-a', async () => job.held)
    await settle()

    await assert.rejects(() => admission.admit('user-a', async () => undefined), UserInFlightError)

    job.release()
    await first
  })

  it('allows different users concurrently', async () => {
    const queue = new TaskQueue({ concurrency: 2, maxQueued: 5 })
    const admission = new AdmissionControl(queue, {
      cooldownMs: 0,
      jobTimeoutMs: 5_000,
    })

    const results = await Promise.all([
      admission.admit('user-a', async () => 'a'),
      admission.admit('user-b', async () => 'b'),
    ])
    assert.deepEqual(results, ['a', 'b'])
  })

  it('does not cooldown after a failed job', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxQueued: 5 })
    const admission = new AdmissionControl(queue, {
      cooldownMs: 60_000,
      jobTimeoutMs: 5_000,
    })

    await assert.rejects(
      () =>
        admission.admit('user-a', async () => {
          throw new Error('boom')
        }),
      /boom/,
    )

    const result = await admission.admit('user-a', async () => 'ok')
    assert.equal(result, 'ok')
  })

  it('enforces per-user cooldown after a successful finish', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxQueued: 5 })
    const admission = new AdmissionControl(queue, {
      cooldownMs: 200,
      jobTimeoutMs: 5_000,
    })

    await admission.admit('user-a', async () => 'ok')
    await assert.rejects(() => admission.admit('user-a', async () => 'nope'), UserCooldownError)
  })

  it('calls onAdmitted before waiting for a worker', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxQueued: 5 })
    const admission = new AdmissionControl(queue, {
      cooldownMs: 0,
      jobTimeoutMs: 5_000,
    })

    const events: string[] = []

    // Held open explicitly rather than for a fixed duration, so the only worker
    // stays occupied no matter how the scheduler behaves.
    let releaseBlocker = (): void => {}
    const held = new Promise<void>((resolve) => {
      releaseBlocker = () => resolve()
    })

    const blocker = admission.admit('blocker', async () => {
      events.push('blocker-run')
      await held
    })
    await settle()

    const second = admission.admit(
      'user-a',
      async () => {
        events.push('user-run')
        return 'done'
      },
      async () => {
        events.push('user-ack')
      },
    )

    await settle()
    assert.ok(events.includes('user-ack'), 'acked as soon as it was admitted')
    assert.ok(!events.includes('user-run'), 'did not start while the only worker was busy')

    releaseBlocker()
    await Promise.all([blocker, second])
    assert.deepEqual(events, ['blocker-run', 'user-ack', 'user-run'])
  })

  it('times out a hung job', async () => {
    const queue = new TaskQueue({ concurrency: 1, maxQueued: 5 })
    const admission = new AdmissionControl(queue, {
      cooldownMs: 0,
      jobTimeoutMs: 40,
    })

    await assert.rejects(
      () => admission.admit('user-a', async () => delay(200)),
      JobTimeoutError,
    )
  })
})
