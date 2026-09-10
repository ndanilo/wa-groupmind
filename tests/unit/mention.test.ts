import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Contact, WAMessage } from 'baileys'

import {
  evaluateMention,
  isBotMentioned,
  parseQuestion,
  selfIdentities,
  textOf,
} from '../../src/whatsapp/mention.js'

const botPn = '5511999999999@s.whatsapp.net'
const botLid = '123456789012345@lid'

const botContact = (): Contact => ({
  id: botPn,
  lid: botLid,
})

const groupJid = '120363000000000000@g.us'

function makeMessage(overrides: {
  text?: string
  mentionedJid?: string[]
  fromMe?: boolean
  participant?: string
  participantAlt?: string
  caption?: boolean
  ageSeconds?: number
}): WAMessage {
  const ageSeconds = overrides.ageSeconds ?? 5
  const timestamp = Math.floor(Date.now() / 1000) - ageSeconds
  const mentionedJid = overrides.mentionedJid ?? [botPn]
  const text = overrides.text ?? `@5511999999999 qual a Selic?`

  const message = overrides.caption
    ? {
        imageMessage: {
          caption: text,
          contextInfo: { mentionedJid },
        },
      }
    : {
        extendedTextMessage: {
          text,
          contextInfo: { mentionedJid },
        },
      }

  return {
    key: {
      remoteJid: groupJid,
      fromMe: overrides.fromMe ?? false,
      id: 'TEST',
      participant: overrides.participant ?? '5511888888888@s.whatsapp.net',
      participantAlt: overrides.participantAlt,
    },
    messageTimestamp: timestamp,
    message,
  } as WAMessage
}

describe('selfIdentities', () => {
  it('collects both PN and LID', () => {
    const ids = selfIdentities(botContact())
    assert.equal(ids.size, 2)
    assert.ok([...ids].some((id) => id.includes('5511999999999')))
    assert.ok([...ids].some((id) => id.includes('123456789012345')))
  })

  it('returns empty for undefined user', () => {
    assert.equal(selfIdentities(undefined).size, 0)
  })
})

describe('parseQuestion', () => {
  it('strips mention tokens and trims', () => {
    assert.equal(parseQuestion('@5511999999999 qual a Selic?', 500), 'qual a Selic?')
  })

  it('returns empty when only a mention is present', () => {
    assert.equal(parseQuestion('@5511999999999', 500), '')
  })

  it('truncates long questions', () => {
    const long = `@5511 ${'a'.repeat(600)}`
    assert.equal(parseQuestion(long, 50).length, 50)
  })
})

describe('isBotMentioned', () => {
  const self = selfIdentities(botContact())

  it('matches a PN mention', () => {
    assert.equal(isBotMentioned(makeMessage({ mentionedJid: [botPn] }), self), true)
  })

  it('matches a LID mention against the bot LID', () => {
    assert.equal(isBotMentioned(makeMessage({ mentionedJid: [botLid] }), self), true)
  })

  it('ignores mentions of other people', () => {
    assert.equal(
      isBotMentioned(makeMessage({ mentionedJid: ['5511777777777@s.whatsapp.net'] }), self),
      false,
    )
  })

  it('detects mentions inside an image caption', () => {
    assert.equal(
      isBotMentioned(makeMessage({ caption: true, mentionedJid: [botPn] }), self),
      true,
    )
  })
})

describe('textOf', () => {
  it('reads extended text', () => {
    assert.equal(textOf(makeMessage({})), '@5511999999999 qual a Selic?')
  })

  it('reads an image caption', () => {
    assert.equal(
      textOf(makeMessage({ caption: true, text: '@5511999999999 olá' })),
      '@5511999999999 olá',
    )
  })
})

describe('evaluateMention', () => {
  const self = selfIdentities(botContact())

  it('returns a request for a valid group mention', () => {
    const result = evaluateMention(makeMessage({}), groupJid, 'notify', self)
    assert.equal(result.kind, 'request')
    if (result.kind === 'request') {
      assert.equal(result.request.question, 'qual a Selic?')
      assert.ok(result.request.requester.includes('5511888888888'))
    }
  })

  it('returns usage when the question is empty', () => {
    const result = evaluateMention(
      makeMessage({ text: '@5511999999999' }),
      groupJid,
      'notify',
      self,
    )
    assert.equal(result.kind, 'usage')
  })

  it('skips non-group chats', () => {
    const result = evaluateMention(
      makeMessage({}),
      '5511888888888@s.whatsapp.net',
      'notify',
      self,
    )
    assert.equal(result.kind, 'skip')
  })

  it('skips append (backlog) upserts', () => {
    const result = evaluateMention(makeMessage({}), groupJid, 'append', self)
    assert.equal(result.kind, 'skip')
    if (result.kind === 'skip') assert.equal(result.reason, 'not notify')
  })

  it('skips own messages', () => {
    const result = evaluateMention(makeMessage({ fromMe: true }), groupJid, 'notify', self)
    assert.equal(result.kind, 'skip')
  })

  it('skips stale messages', () => {
    const result = evaluateMention(makeMessage({ ageSeconds: 120 }), groupJid, 'notify', self)
    assert.equal(result.kind, 'skip')
    if (result.kind === 'skip') assert.ok(result.reason.startsWith('stale'))
  })

  it('skips when the bot is not mentioned', () => {
    const result = evaluateMention(
      makeMessage({ mentionedJid: ['5511777777777@s.whatsapp.net'] }),
      groupJid,
      'notify',
      self,
    )
    assert.equal(result.kind, 'skip')
  })
})
