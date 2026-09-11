import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { WASocket } from 'baileys'

/*
The gate is what stops a finished run from replying into a dead socket.

Baileys discards the whole socket on every reconnect, and a research run can outlive several of
them. A reply that captured the socket its question arrived on therefore lands nowhere -- and
because the error reply would use that same dead socket, the group gets nothing at all.

Nothing here touches the network.
*/

const { SocketGate } = await import('../../src/whatsapp/socketGate.js')

const socketNamed = (id: string) => ({ user: { id } }) as unknown as WASocket

describe('SocketGate', () => {
  it('hands back the socket that is live right now', async () => {
    const gate = new SocketGate()
    gate.publish(socketNamed('first'))

    assert.equal(gate.isReady, true)
    assert.equal((await gate.waitForReady(1_000)).user?.id, 'first')
  })

  it('gives a reply parked mid-reconnect the socket that comes back', async () => {
    const gate = new SocketGate()
    gate.publish(socketNamed('first'))
    gate.clear()

    const pending = gate.waitForReady(1_000)
    gate.publish(socketNamed('second'))

    // 'second', not 'first': the point of asking per send instead of holding a reference.
    assert.equal((await pending).user?.id, 'second')
  })

  it('gives up when the reconnect never comes', async () => {
    const gate = new SocketGate()

    await assert.rejects(() => gate.waitForReady(10), /did not reconnect/)
  })

  it('releases waiters on shutdown so a drain cannot hang', async () => {
    const gate = new SocketGate()
    const pending = gate.waitForReady(60_000)

    gate.stop()

    await assert.rejects(() => pending, /shutting down/)
  })
})
