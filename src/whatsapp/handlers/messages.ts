import { getContentType, isJidGroup, isJidNewsletter, isJidStatusBroadcast } from 'baileys'
import type { WAMessage, WASocket } from 'baileys'

import { config } from '../../config/env.js'
import { logger } from '../../lib/logger.js'
import { textOf } from '../mention.js'
import {
  handleInfographicMessage,
  type InfographicRuntime,
} from '../infographic.js'

const log = logger.child({ module: 'messages' })

/** Traffic that is never worth reporting, plus own messages unless asked for. */
const skipReason = (jid: string, msg: WAMessage): string | undefined => {
  if (isJidStatusBroadcast(jid)) return 'status broadcast'
  if (isJidNewsletter(jid) === true) return 'newsletter'
  if (msg.key.fromMe && !config.logOwnMessages) return 'own message'
  return undefined
}

export const registerMessageHandlers = (
  sock: WASocket,
  runtime: InfographicRuntime,
): void => {
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
      const jid = msg.key.remoteJid
      if (!jid) {
        log.debug({ type }, 'ignored message without a chat id')
        continue
      }

      // Logged rather than dropped silently, so `LOG_LEVEL=debug` shows the monitor is alive.
      const skip = skipReason(jid, msg)
      if (skip !== undefined) {
        log.debug({ chat: jid, type }, `ignored ${skip}`)
        continue
      }

      const isGroup = isJidGroup(jid) === true

      log.info(
        {
          chat: jid,
          direction: msg.key.fromMe ? 'outgoing' : 'incoming',
          from: isGroup ? msg.key.participant : jid,
          pushName: msg.pushName ?? undefined,
          kind: getContentType(msg.message ?? undefined),
          // 'append' means synced from another of your devices rather than delivered live.
          ...(type === 'append' ? { synced: true } : {}),
          ...(config.logMessageContent ? { text: textOf(msg) } : {}),
        },
        isGroup ? 'group message' : 'direct message',
      )

      // Never await the pipeline here — a 2-minute image render would stall Baileys.
      handleInfographicMessage(sock, runtime, msg, jid, type).catch((error: unknown) => {
        log.error({ error, chat: jid }, 'infographic handler failed')
      })
    }
  })
}
