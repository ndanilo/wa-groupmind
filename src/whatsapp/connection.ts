import { rm } from 'node:fs/promises'

import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
} from 'baileys'
import type { ConnectionState, WASocket } from 'baileys'
import qrcode from 'qrcode-terminal'

import { config } from '../config/env.js'
import { logger } from '../lib/logger.js'
import { registerMessageHandlers } from './handlers/messages.js'
import type { InfographicRuntime } from './infographic.js'
import { selfIdentities } from './mention.js'
import type { SocketGate } from './socketGate.js'

const log = logger.child({ module: 'connection' })

/** The stored credentials are dead; they must be cleared and the account paired again. */
const REPAIRING_REQUIRED = new Set<number>([
  DisconnectReason.loggedOut,
  DisconnectReason.badSession,
  DisconnectReason.multideviceMismatch,
])

/**
 * Stop, but keep the credentials, because reconnecting would make things worse.
 * `connectionReplaced` in particular: retrying kicks off the replacement war it reports.
 */
const STOP_KEEPING_CREDENTIALS = new Map<number, string>([
  [
    DisconnectReason.connectionReplaced,
    'another connection took over this session -- only one instance may run at a time',
  ],
  [DisconnectReason.forbidden, 'WhatsApp has blocked this account'],
])

/** `lastDisconnect.error` is a Boom at runtime, but only `Error` is guaranteed by the types. */
const statusCodeOf = (error: Error | undefined): number | undefined => {
  const output = (error as { output?: { statusCode?: unknown } } | undefined)?.output
  return typeof output?.statusCode === 'number' ? output.statusCode : undefined
}

export class WhatsAppConnection {
  private readonly onFatal: (error: Error) => void
  private readonly runtime: InfographicRuntime
  private readonly gate: SocketGate | undefined
  private socket: WASocket | undefined
  private attempts = 0
  private stopped = false
  private pairingCodeRequested = false

  /**
   * @param onFatal called when the session cannot be recovered and the caller should shut down.
   * @param runtime shared graph + queue that survives reconnects.
   * @param gate optional publisher of the live socket, for senders that are not driven by an
   *   incoming message. Omitted when the notification webhook is disabled.
   */
  constructor(
    onFatal: (error: Error) => void,
    runtime: InfographicRuntime,
    gate?: SocketGate,
  ) {
    this.onFatal = onFatal
    this.runtime = runtime
    this.gate = gate
  }

  async start(): Promise<void> {
    this.pairingCodeRequested = false
    const { state, saveCreds } = await useMultiFileAuthState(config.authDir)

    // Only an unlinked session needs a phone number; a stored one resumes without pairing.
    if (!state.creds.registered && config.pairingMode === 'code' && !config.phoneNumber) {
      throw new Error(
        'Pairing by code (the default) requires PHONE_NUMBER: digits with country code, ' +
          'no "+" or spaces, e.g. 5511999999999. Set PAIRING_MODE=qr to scan a QR instead.',
      )
    }

    const { version, isLatest } = await fetchLatestBaileysVersion()
    log.info(
      { version: version.join('.'), registered: state.creds.registered, isLatest },
      'starting socket',
    )

    const sock = makeWASocket({
      auth: state,
      version,
      browser: Browsers.appropriate('Chrome'),
      logger: logger.child({ module: 'baileys' }),
      // Stay invisible and skip the full history dump so the phone keeps delivering
      // notifications as usual.
      markOnlineOnConnect: false,
      syncFullHistory: false,
    })

    this.socket = sock
    sock.ev.on('creds.update', saveCreds)
    // An unhandled rejection inside an event callback would take down the process.
    sock.ev.on('connection.update', (update) => {
      this.onConnectionUpdate(update).catch((error: unknown) => {
        this.onFatal(error instanceof Error ? error : new Error(String(error)))
      })
    })

    registerMessageHandlers(sock, this.runtime)
  }

  /** Closes the socket without clearing credentials, so the next start resumes the session. */
  async stop(): Promise<void> {
    this.stopped = true
    // Releases anyone waiting on a reconnect that is no longer coming.
    this.gate?.stop()
    await this.socket?.end(undefined)
    this.socket = undefined
  }

  private async onConnectionUpdate(update: Partial<ConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update

    if (qr) await this.offerPairing(qr)

    if (connection === 'open') {
      this.attempts = 0
      const ids = selfIdentities(this.socket?.user)
      this.runtime.setSelf(ids)
      if (this.socket) this.gate?.publish(this.socket)
      log.info({ me: this.socket?.user?.id, lid: this.socket?.user?.lid }, 'connected')
      return
    }

    // Stop handing out a socket that is on its way down. Waiters stay parked for the reconnect.
    if (connection === 'close') this.gate?.clear()

    if (connection !== 'close' || this.stopped) return

    const code = statusCodeOf(lastDisconnect?.error)

    if (code !== undefined && REPAIRING_REQUIRED.has(code)) {
      log.error({ code, reason: DisconnectReason[code] }, 'credentials are no longer valid')
      await this.clearAuth()
      throw new Error(
        `WhatsApp session ended (${DisconnectReason[code] ?? code}). Restart to pair again.`,
      )
    }

    if (code !== undefined) {
      const stopReason = STOP_KEEPING_CREDENTIALS.get(code)
      if (stopReason !== undefined) {
        throw new Error(`${stopReason} (${DisconnectReason[code] ?? code})`)
      }
    }

    if (this.attempts >= config.maxReconnectAttempts) {
      throw new Error(`Giving up after ${this.attempts} reconnect attempts`)
    }

    this.attempts += 1
    const delayMs = Math.min(1_000 * 2 ** this.attempts, 60_000)
    log.warn({ code, attempt: this.attempts, delayMs }, 'connection closed, reconnecting')
    await new Promise((resolve) => setTimeout(resolve, delayMs))

    if (!this.stopped) await this.start()
  }

  /**
   * Called on every `qr` update, which is also the earliest point the socket is ready to
   * request a pairing code -- doing it before that fails with "Connection Closed".
   */
  private async offerPairing(qr: string): Promise<void> {
    if (config.pairingMode === 'qr') {
      // Rendered into the log message so the code cannot interleave with async log output.
      qrcode.generate(qr, { small: true }, (rendered) => {
        log.info(`scan in WhatsApp > Linked devices > Link a device\n${rendered}`)
      })
      return
    }

    // WhatsApp refreshes the challenge every 20s; one code per socket is enough.
    if (this.pairingCodeRequested || !this.socket) return
    this.pairingCodeRequested = true

    const code = await this.socket.requestPairingCode(config.phoneNumber)
    const grouped = code.match(/.{1,4}/g)?.join('-') ?? code
    log.info(
      `on ${config.phoneNumber}, open WhatsApp > Linked devices > Link with phone number instead,\n` +
        `then enter this code:\n\n    ${grouped}\n`,
    )
  }

  private async clearAuth(): Promise<void> {
    await rm(config.authDir, { recursive: true, force: true })
    log.info({ dir: config.authDir }, 'cleared stored credentials')
  }
}
