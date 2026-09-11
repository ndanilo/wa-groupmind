/*
Bounded worker pool with a FIFO waiting list.

Hand-rolled rather than pulling in p-queue: the per-user gating layered on top is
custom, and the whole thing is small enough to unit-test without a dependency.
*/

export class QueueFullError extends Error {
  constructor(message = 'queue is full') {
    super(message)
    this.name = 'QueueFullError'
  }
}

export class JobTimeoutError extends Error {
  constructor(message = 'job timed out') {
    super(message)
    this.name = 'JobTimeoutError'
  }
}

export type TaskQueueOptions = {
  concurrency: number
  maxQueued: number
}

type Waiter = {
  start: () => void
}

export class TaskQueue {
  private readonly concurrency: number
  private readonly maxQueued: number
  /** Jobs currently executing `fn`. */
  private active = 0
  /**
   * Jobs that have entered `run()` but not yet finished — includes those waiting
   * for a worker and those mid-`onEnqueued`. Kept so `drain()` cannot miss a job
   * that has not incremented `active` yet.
   */
  private pending = 0
  private readonly waiting: Waiter[] = []

  constructor(options: TaskQueueOptions) {
    this.concurrency = Math.max(1, options.concurrency)
    this.maxQueued = Math.max(0, options.maxQueued)
  }

  get size(): number {
    return this.waiting.length
  }

  get running(): number {
    return this.active
  }

  /**
   * Runs `fn` when a worker slot is free.
   * Throws QueueFullError immediately when the waiting list is at capacity —
   * before `onEnqueued` runs, so callers can ack only after acceptance.
   *
   * @param onEnqueued fires once the job is accepted (running or waiting), before
   *   any wait for a free worker.
   */
  async run<T>(fn: () => Promise<T>, onEnqueued?: () => Promise<void>): Promise<T> {
    // Synchronous reservation: concurrent callers must see this job before any await.
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxQueued) {
        throw new QueueFullError()
      }
    }

    this.pending += 1

    let waitForSlot: Promise<void> | undefined
    if (this.active >= this.concurrency) {
      waitForSlot = new Promise<void>((resolve) => {
        this.waiting.push({ start: resolve })
      })
    } else {
      // Claim a running slot before yielding so peer callers observe concurrency.
      this.active += 1
    }

    try {
      // Accepted into the pool. Safe to ack.
      await onEnqueued?.()

      if (waitForSlot) {
        await waitForSlot
        this.active += 1
      }

      return await fn()
    } finally {
      this.active -= 1
      this.pending -= 1
      const next = this.waiting.shift()
      next?.start()
    }
  }

  /** Resolves when every in-flight and waiting job has finished. */
  async drain(): Promise<void> {
    while (this.pending > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

export type AdmissionOptions = {
  cooldownMs: number
  jobTimeoutMs: number
}

export class UserInFlightError extends Error {
  constructor(message = 'user already has a job in flight') {
    super(message)
    this.name = 'UserInFlightError'
  }
}

export class UserCooldownError extends Error {
  readonly remainingMs: number

  constructor(remainingMs: number, message = 'user is in cooldown') {
    super(message)
    this.name = 'UserCooldownError'
    this.remainingMs = remainingMs
  }
}

/**
 * Per-user admission control layered on a TaskQueue.
 *
 * Records the in-flight entry *before* awaiting so two fast messages cannot both pass,
 * mirroring the cooldown trick used by the old auto-reply.
 */
export class AdmissionControl {
  private readonly inFlight = new Map<string, number>()
  private readonly lastFinishedAt = new Map<string, number>()
  private readonly cooldownMs: number
  private readonly jobTimeoutMs: number
  private readonly queue: TaskQueue

  constructor(queue: TaskQueue, options: AdmissionOptions) {
    this.queue = queue
    this.cooldownMs = options.cooldownMs
    this.jobTimeoutMs = options.jobTimeoutMs
  }

  get queueSize(): number {
    return this.queue.size
  }

  get running(): number {
    return this.queue.running
  }

  /**
   * @param fn receives a signal that aborts when the job times out. Honouring it is what
   *   stops a timed-out run from continuing to spend money on an answer nobody will read.
   * @param onAdmitted runs after the per-user gate passes and the job is accepted
   *   into the worker pool (possibly still waiting) — the right place for an
   *   immediate ack. Never runs if QueueFullError / cooldown / in-flight reject.
   */
  async admit<T>(
    userId: string,
    fn: (signal: AbortSignal) => Promise<T>,
    onAdmitted?: () => Promise<void>,
  ): Promise<T> {
    const flying = this.inFlight.get(userId) ?? 0
    if (flying > 0) throw new UserInFlightError()

    const last = this.lastFinishedAt.get(userId)
    if (this.cooldownMs > 0 && last !== undefined) {
      const elapsed = Date.now() - last
      if (elapsed < this.cooldownMs) {
        throw new UserCooldownError(this.cooldownMs - elapsed)
      }
    }

    // Recorded before awaiting so concurrent messages cannot both slip through.
    this.inFlight.set(userId, flying + 1)

    try {
      const result = await this.queue.run(
        () => withTimeout(fn, this.jobTimeoutMs),
        onAdmitted,
      )
      // Cooldown only after a successful finish — failed runs must be retryable immediately.
      this.lastFinishedAt.set(userId, Date.now())
      return result
    } finally {
      const remaining = (this.inFlight.get(userId) ?? 1) - 1
      if (remaining <= 0) this.inFlight.delete(userId)
      else this.inFlight.set(userId, remaining)
    }
  }

  drain(): Promise<void> {
    return this.queue.drain()
  }
}

/**
 * Races `fn` against the clock, and aborts it when the clock wins.
 *
 * Rejecting the outer promise is not enough on its own: the work behind it keeps running, so a
 * timed-out research run goes on calling a paid model and a paid search API long after the
 * requester has been told it gave up — and outside the worker pool's concurrency limit, because
 * the slot is released as soon as this rejects.
 */
function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController()
  if (ms <= 0) return fn(controller.signal)

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort(new JobTimeoutError())
      reject(new JobTimeoutError())
    }, ms)

    fn(controller.signal).then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
