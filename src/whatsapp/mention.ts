import { areJidsSameUser, isJidGroup, jidNormalizedUser } from 'baileys'
import type { Contact, MessageUpsertType, WAMessage } from 'baileys'

import { config } from '../config/env.js'
import { logger } from '../lib/logger.js'

const log = logger.child({ module: 'mention' })

export type InfographicRequest = {
  jid: string
  question: string
  requester: string
  message: WAMessage
}

/** Digits-only @mention tokens WhatsApp inserts into message text. */
const MENTION_TOKEN = /@\d+/g

/**
 * Builds the set of normalised JIDs that identify this bot.
 *
 * WhatsApp is mid-migration to LID addressing, so the linked account has both a
 * phone-number JID (`@s.whatsapp.net`) and a LID (`@lid`). Mentions may use either.
 */
export function selfIdentities(user: Contact | undefined): Set<string> {
  const ids = new Set<string>()
  if (!user) return ids

  if (user.id) ids.add(jidNormalizedUser(user.id))
  if (user.lid) ids.add(jidNormalizedUser(user.lid))
  return ids
}

const sentAtSeconds = (msg: WAMessage): number => {
  const ts = msg.messageTimestamp
  if (ts === null || ts === undefined) return 0
  return typeof ts === 'number' ? ts : ts.toNumber()
}

/** Pulls plain text from conversation, extended text, or a media caption. */
export function textOf(msg: WAMessage): string | undefined {
  const content = msg.message
  if (!content) return undefined
  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    undefined
  )
}

/**
 * Collects mentionedJid lists from every content variant that can carry them.
 * Mentions in image captions still count.
 */
export function mentionedJids(msg: WAMessage): string[] {
  const content = msg.message
  if (!content) return []

  const contexts = [
    content.extendedTextMessage?.contextInfo,
    content.imageMessage?.contextInfo,
    content.videoMessage?.contextInfo,
    content.documentMessage?.contextInfo,
    content.buttonsResponseMessage?.contextInfo,
    content.listResponseMessage?.contextInfo,
    content.templateButtonReplyMessage?.contextInfo,
  ]

  const jids: string[] = []
  for (const ctx of contexts) {
    for (const jid of ctx?.mentionedJid ?? []) {
      if (jid) jids.push(jid)
    }
  }
  return jids
}

/** True when any mentioned JID matches any of the bot's identities. */
export function isBotMentioned(msg: WAMessage, self: Set<string>): boolean {
  if (self.size === 0) return false
  const mentioned = mentionedJids(msg)
  for (const mention of mentioned) {
    for (const id of self) {
      if (areJidsSameUser(mention, id)) return true
    }
  }
  return false
}

/**
 * Strips @digit mention tokens and collapses whitespace.
 * Returns the remaining question text, which may be empty.
 */
export function parseQuestion(text: string, maxLength: number): string {
  const cleaned = text.replace(MENTION_TOKEN, ' ').replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxLength) return cleaned
  return cleaned.slice(0, maxLength).trim()
}

/**
 * Resolves the group participant who sent the message.
 * Prefer the primary participant JID; fall back to participantAlt under LID addressing.
 */
export function requesterOf(msg: WAMessage): string | undefined {
  const key = msg.key
  return key.participant ?? key.participantAlt ?? undefined
}

export type MentionGateResult =
  | { kind: 'request'; request: InfographicRequest }
  | { kind: 'usage'; jid: string; requester: string; message: WAMessage }
  | { kind: 'skip'; reason: string }

/**
 * Applies every gate in order and returns a typed result.
 *
 * Callers that get `usage` should send the PT-BR usage hint; `request` proceeds
 * to the queue; `skip` is logged at debug and ignored.
 */
export function evaluateMention(
  msg: WAMessage,
  jid: string,
  type: MessageUpsertType,
  self: Set<string>,
): MentionGateResult {
  if (isJidGroup(jid) !== true) return { kind: 'skip', reason: 'not a group' }
  if (type !== 'notify') return { kind: 'skip', reason: 'not notify' }
  if (msg.key.fromMe) return { kind: 'skip', reason: 'own message' }

  const ageSeconds = Date.now() / 1000 - sentAtSeconds(msg)
  if (ageSeconds > config.requestMaxAgeSeconds) {
    return { kind: 'skip', reason: `stale (${Math.round(ageSeconds)}s)` }
  }

  if (
    config.allowedGroupJids.length > 0 &&
    !config.allowedGroupJids.includes(jid)
  ) {
    return { kind: 'skip', reason: 'group not allowlisted' }
  }

  if (!isBotMentioned(msg, self)) return { kind: 'skip', reason: 'bot not mentioned' }

  const requester = requesterOf(msg)
  if (!requester) return { kind: 'skip', reason: 'no requester' }

  const raw = textOf(msg) ?? ''
  const question = parseQuestion(raw, config.maxQuestionLength)

  if (!question) {
    log.debug({ chat: jid, requester }, 'mention with empty question')
    return { kind: 'usage', jid, requester, message: msg }
  }

  return {
    kind: 'request',
    request: { jid, question, requester, message: msg },
  }
}
