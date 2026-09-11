import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { WAMessage, WASocket } from 'baileys'

/*
The ack is sent from the admission callback, which runs before the job body — so a throw
there rejected the whole request and the requester got an error instead of the answer that
was still perfectly gettable. Worth a test precisely because the failure was invisible: the
ack had no log line of its own either.

Nothing here touches the network. Env is set before the dynamic import because
src/config/env.ts snapshots process.env at module load.
*/
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key'
process.env.TAVILY_API_KEY ??= 'test-tavily-key'

const { sendAck } = await import('../../src/whatsapp/reply.js')

const GROUP = '120363000000000000@g.us'

const message = { key: { remoteJid: GROUP, id: 'ABC123' } } as unknown as WAMessage

/** Records what was sent. The first `failures` sends throw, so a retry can be observed. */
function fakeSocket(failWith?: Error, failures = Number.POSITIVE_INFINITY) {
  const sent: Array<{ jid: string; text: string }> = []
  let attempts = 0
  const sock = {
    async sendMessage(jid: string, content: { text?: string }) {
      attempts += 1
      if (failWith && attempts <= failures) throw failWith
      sent.push({ jid, text: content.text ?? '' })
      return undefined
    },
  } as unknown as WASocket

  return { sent, sock, attempts: () => attempts }
}

describe('sendAck', () => {
  it('sends the text wording by default', async () => {
    const { sent, sock } = fakeSocket()

    await sendAck(sock, GROUP, message)

    assert.equal(sent.length, 1)
    assert.equal(sent[0]?.jid, GROUP)
    assert.match(sent[0]?.text ?? '', /Looking that up/)
  })

  it('matches the wording to an image request', async () => {
    const { sent, sock } = fakeSocket()

    await sendAck(sock, GROUP, message, true)

    assert.match(sent[0]?.text ?? '', /infographic/)
  })

  it('retries a blip rather than dropping the ack', async () => {
    const { sent, sock, attempts } = fakeSocket(new Error('connection closed'), 1)

    await sendAck(sock, GROUP, message)

    // The ack used to get a single attempt while the answer behind it got three, so a blip
    // lost the ack and kept the answer -- exactly the "no ack, then a reply" the group saw.
    assert.equal(attempts(), 2)
    assert.equal(sent.length, 1)
    assert.match(sent[0]?.text ?? '', /Looking that up/)
  })

  it('never lets a failed ack take the answer down with it', async () => {
    const { sock } = fakeSocket(new Error('connection closed'))

    // Resolving is the whole point: rejecting here aborts the job before research starts.
    await assert.doesNotReject(() => sendAck(sock, GROUP, message))
  })
})
