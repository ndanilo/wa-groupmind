import type { NotificationRecord } from '../contract.js'

/*
Where a job's fate is remembered after the 202 has been sent.

Two jobs in one: it answers GET /notifications/:id, and it makes retries safe. External systems
retry aggressively -- a timeout on their side does not mean the message was not sent -- so a
repeated Idempotency-Key returns the original job instead of sending a second WhatsApp message.

In memory, so everything is forgotten on restart. That is an honest trade for a single-process
bot; a durable store (Redis, SQLite) is the swap if you ever need statuses to survive a deploy.

Expiry is lazy rather than on a timer, because an interval would keep the Node event loop alive
and fight the deliberate process.exit() this app uses to shut down.
*/

type StoredRecord = NotificationRecord & { idempotencyKey?: string }

/** Pruning walks every record, so it is throttled rather than run on each lookup. */
const PRUNE_INTERVAL_MS = 60_000

export type JobStoreOptions = {
  /** How long a finished job stays queryable. */
  ttlMs: number
  /** Injectable so tests can move time without sleeping. */
  now?: () => number
}

export class JobStore {
  private readonly records = new Map<string, StoredRecord>()
  private readonly keyToId = new Map<string, string>()
  private readonly ttlMs: number
  private readonly now: () => number
  private lastPrunedAt = 0

  constructor(options: JobStoreOptions) {
    this.ttlMs = options.ttlMs
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.records.size
  }

  create(id: string, idempotencyKey?: string): NotificationRecord {
    this.prune()
    const record: StoredRecord = { id, status: 'queued', acceptedAt: this.now() }
    if (idempotencyKey !== undefined) {
      record.idempotencyKey = idempotencyKey
      this.keyToId.set(idempotencyKey, id)
    }
    this.records.set(id, record)
    return record
  }

  find(id: string): NotificationRecord | undefined {
    this.prune()
    return this.records.get(id)
  }

  findByIdempotencyKey(key: string): NotificationRecord | undefined {
    this.prune()
    const id = this.keyToId.get(key)
    return id === undefined ? undefined : this.records.get(id)
  }

  markSending(id: string): void {
    const record = this.records.get(id)
    if (record) record.status = 'sending'
  }

  markSent(id: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.status = 'sent'
    record.finishedAt = this.now()
  }

  markFailed(id: string, error: string): void {
    const record = this.records.get(id)
    if (!record) return
    record.status = 'failed'
    record.finishedAt = this.now()
    record.error = error
  }

  /** Drops finished jobs past their TTL. Unfinished jobs are always kept. */
  private prune(): void {
    const now = this.now()
    if (now - this.lastPrunedAt < PRUNE_INTERVAL_MS) return
    this.lastPrunedAt = now

    for (const [id, record] of this.records) {
      if (record.finishedAt === undefined || now - record.finishedAt <= this.ttlMs) continue
      this.records.delete(id)
      if (record.idempotencyKey !== undefined) this.keyToId.delete(record.idempotencyKey)
    }
  }
}
