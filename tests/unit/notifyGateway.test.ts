import { describe, it, type TestContext } from 'node:test'
import assert from 'node:assert/strict'

import {
  QueueUnavailableError,
  type Notification,
  type NotificationRecord,
  type NotificationSender,
} from '../../src/notifications/contract.js'
import {
  buildNotificationServer,
  type NotificationServerConfig,
} from '../../src/notifications/gateway/app.js'

/*
Driven over a real socket with the global fetch and FormData rather than through Fastify's
inject(), because the multipart handling is most of what is worth testing here and only a real
request exercises the actual encoder. Port 0 asks the OS for a free port, so nothing collides.
*/

const API_KEY = 'test-api-key'

const baseConfig: NotificationServerConfig = {
  apiKey: API_KEY,
  maxFileBytes: 1024 * 1024,
  maxFiles: 3,
  maxMessageLength: 100,
  allowedRecipients: [],
  defaultCountryCode: '55',
}

type Capture = { notification: Notification; idempotencyKey: string | undefined }

const finishedRecord: NotificationRecord = {
  id: 'job-1',
  status: 'sent',
  acceptedAt: 1,
  finishedAt: 2,
}

function recordingSender(): { sender: NotificationSender; sent: Capture[] } {
  const sent: Capture[] = []
  return {
    sent,
    sender: {
      async send(notification, idempotencyKey) {
        sent.push({ notification, idempotencyKey })
        return { id: 'job-1', status: 'queued' }
      },
      async status(id) {
        return id === 'job-1' ? finishedRecord : undefined
      },
    },
  }
}

async function startServer(
  t: TestContext,
  sender: NotificationSender,
  overrides: Partial<NotificationServerConfig> = {},
): Promise<string> {
  const app = await buildNotificationServer({
    sender,
    config: { ...baseConfig, ...overrides },
  })
  const address = await app.listen({ host: '127.0.0.1', port: 0 })
  // Without this the listening socket keeps the test runner alive.
  t.after(() => app.close())
  return address
}

const post = (base: string, body: FormData, headers: Record<string, string> = {}) =>
  fetch(`${base}/notifications`, {
    method: 'POST',
    headers: { 'x-api-key': API_KEY, ...headers },
    body,
  })

describe('notification gateway', () => {
  it('accepts a text-only notification', async (t) => {
    const { sender, sent } = recordingSender()
    const base = await startServer(t, sender)

    const form = new FormData()
    form.set('to', '11987654321')
    form.set('message', 'deploy finished')

    const response = await post(base, form)

    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), { id: 'job-1', status: 'queued' })
    assert.equal(sent.length, 1)
    // The default country code was applied at the edge.
    assert.equal(sent[0]?.notification.to, '5511987654321')
    assert.equal(sent[0]?.notification.message, 'deploy finished')
  })

  it('accepts a file and hands over its bytes intact', async (t) => {
    const { sender, sent } = recordingSender()
    const base = await startServer(t, sender)

    const form = new FormData()
    form.set('to', '5511987654321')
    form.set('message', 'chart attached')
    form.set('file', new Blob([Buffer.from('pretend-png-bytes')], { type: 'image/png' }), 'chart.png')

    const response = await post(base, form)
    assert.equal(response.status, 202)

    const attachment = sent[0]?.notification.attachments[0]
    assert.equal(attachment?.fileName, 'chart.png')
    assert.equal(attachment?.mediaType, 'image/png')
    assert.equal(attachment?.bytes.toString(), 'pretend-png-bytes')
  })

  it('accepts several files at once', async (t) => {
    const { sender, sent } = recordingSender()
    const base = await startServer(t, sender)

    const form = new FormData()
    form.set('to', '5511987654321')
    form.append('file', new Blob([Buffer.from('one')], { type: 'image/png' }), 'one.png')
    form.append('file', new Blob([Buffer.from('two')], { type: 'image/png' }), 'two.png')

    const response = await post(base, form)

    assert.equal(response.status, 202)
    assert.equal(sent[0]?.notification.attachments.length, 2)
  })

  it('forwards the idempotency key', async (t) => {
    const { sender, sent } = recordingSender()
    const base = await startServer(t, sender)

    const form = new FormData()
    form.set('to', '5511987654321')
    form.set('message', 'once only')

    await post(base, form, { 'idempotency-key': 'abc-123' })
    assert.equal(sent[0]?.idempotencyKey, 'abc-123')
  })

  it('rejects a request with no api key', async (t) => {
    const { sender, sent } = recordingSender()
    const base = await startServer(t, sender)

    const form = new FormData()
    form.set('to', '5511987654321')
    form.set('message', 'nope')

    const response = await fetch(`${base}/notifications`, { method: 'POST', body: form })

    assert.equal(response.status, 401)
    assert.equal(sent.length, 0)
  })

  it('rejects a request with the wrong api key', async (t) => {
    const { sender, sent } = recordingSender()
    const base = await startServer(t, sender)

    const form = new FormData()
    form.set('to', '5511987654321')
    form.set('message', 'nope')

    const response = await post(base, form, { 'x-api-key': 'wrong' })

    assert.equal(response.status, 401)
    assert.equal(sent.length, 0)
  })

  it('rejects a notification with neither message nor file', async (t) => {
    const { sender, sent } = recordingSender()
    const base = await startServer(t, sender)

    const form = new FormData()
    form.set('to', '5511987654321')

    const response = await post(base, form)

    assert.equal(response.status, 400)
    assert.equal(sent.length, 0)
  })

  it('rejects an unusable recipient', async (t) => {
    const { sender } = recordingSender()
    const base = await startServer(t, sender)

    const form = new FormData()
    form.set('to', 'not-a-number')
    form.set('message', 'hello')

    const response = await post(base, form)
    assert.equal(response.status, 400)
  })

  it('rejects a recipient outside the allowlist', async (t) => {
    const { sender } = recordingSender()
    const base = await startServer(t, sender, { allowedRecipients: ['5511000000000'] })

    const form = new FormData()
    form.set('to', '5511987654321')
    form.set('message', 'hello')

    const response = await post(base, form)
    assert.equal(response.status, 400)
  })

  it('rejects a message past the length limit', async (t) => {
    const { sender } = recordingSender()
    const base = await startServer(t, sender)

    const form = new FormData()
    form.set('to', '5511987654321')
    form.set('message', 'x'.repeat(baseConfig.maxMessageLength + 1))

    const response = await post(base, form)
    assert.equal(response.status, 400)
  })

  it('rejects a file over the size limit with 413', async (t) => {
    const { sender } = recordingSender()
    const base = await startServer(t, sender, { maxFileBytes: 64 })

    const form = new FormData()
    form.set('to', '5511987654321')
    form.set('file', new Blob([Buffer.alloc(2048, 1)], { type: 'image/png' }), 'big.png')

    const response = await post(base, form)
    assert.equal(response.status, 413)
  })

  it('rejects a body that is not multipart', async (t) => {
    const { sender } = recordingSender()
    const base = await startServer(t, sender)

    const response = await fetch(`${base}/notifications`, {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ to: '5511987654321', message: 'hello' }),
    })

    assert.equal(response.status, 415)
  })

  it('reports a full queue as 503 with a retry hint', async (t) => {
    const base = await startServer(t, {
      async send() {
        throw new QueueUnavailableError()
      },
      async status() {
        return undefined
      },
    })

    const form = new FormData()
    form.set('to', '5511987654321')
    form.set('message', 'hello')

    const response = await post(base, form)

    assert.equal(response.status, 503)
    assert.equal(response.headers.get('retry-after'), '30')
  })

  it('serves health without an api key', async (t) => {
    const { sender } = recordingSender()
    const base = await startServer(t, sender)

    const response = await fetch(`${base}/health`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })
  })

  it('reports the status of a known job', async (t) => {
    const { sender } = recordingSender()
    const base = await startServer(t, sender)

    const response = await fetch(`${base}/notifications/job-1`, {
      headers: { 'x-api-key': API_KEY },
    })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), finishedRecord)
  })

  it('returns 404 for an unknown job', async (t) => {
    const { sender } = recordingSender()
    const base = await startServer(t, sender)

    const response = await fetch(`${base}/notifications/missing`, {
      headers: { 'x-api-key': API_KEY },
    })

    assert.equal(response.status, 404)
  })
})
