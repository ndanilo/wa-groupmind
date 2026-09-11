import type { WASocket } from 'baileys'

/** WhatsApp is not connected, so nothing can be sent right now. */
export class TransportUnavailableError extends Error {
  constructor(message = 'whatsapp transport is not connected') {
    super(message)
    this.name = 'TransportUnavailableError'
  }
}

/*
Holds the socket that is live right now.

WhatsAppConnection builds a brand new WASocket on every reconnect (start() reassigns this.socket
and calls itself again after a drop), so anything that captures a reference keeps writing into a
dead socket from the first disconnect onwards. Every sender therefore asks the gate per send
rather than holding one -- webhook deliveries, and the bot's own replies, which are the ones
most exposed to it: a research run can span minutes and several reconnects.

waitForReady() also downgrades a reconnect from a failure to a short wait. A reply that lands
mid-reconnect is worth holding for a few seconds instead of rejecting outright, since the socket
usually comes back well inside that window -- and for a reply, rejecting means throwing away an
answer that has already been paid for.
*/

type Waiter = {
  resolve: (socket: WASocket) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export class SocketGate {
  private socket: WASocket | undefined
  private readonly waiters = new Set<Waiter>()

  get isReady(): boolean {
    return this.socket !== undefined
  }

  /** The live socket, or undefined while disconnected. */
  current(): WASocket | undefined {
    return this.socket
  }

  /** Called by WhatsAppConnection once a connection is open. */
  publish(socket: WASocket): void {
    this.socket = socket
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(socket)
    }
    this.waiters.clear()
  }

  /**
   * Called when the connection drops. Waiters are intentionally left in place: a reconnect is
   * usually seconds away, and the whole point of waiting is to ride it out.
   */
  clear(): void {
    this.socket = undefined
  }

  /** Shutdown. Unlike clear(), this releases anyone still waiting so drain() cannot hang. */
  stop(reason = 'whatsapp connection is shutting down'): void {
    this.socket = undefined
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new TransportUnavailableError(reason))
    }
    this.waiters.clear()
  }

  async waitForReady(timeoutMs: number): Promise<WASocket> {
    if (this.socket) return this.socket
    if (timeoutMs <= 0) throw new TransportUnavailableError()

    return new Promise<WASocket>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(
            new TransportUnavailableError(
              `whatsapp did not reconnect within ${timeoutMs}ms`,
            ),
          )
        }, timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }
}
