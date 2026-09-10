import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  InvalidRecipientError,
  isRecipientAllowed,
  normaliseRecipient,
} from '../../src/notifications/gateway/phone.js'

describe('normaliseRecipient', () => {
  it('passes a group jid straight through', () => {
    const result = normaliseRecipient('120363012345678901@g.us')
    assert.deepEqual(result, { kind: 'jid', value: '120363012345678901@g.us' })
  })

  it('passes an individual jid straight through', () => {
    const result = normaliseRecipient('5511999999999@s.whatsapp.net')
    assert.equal(result.kind, 'jid')
  })

  it('strips formatting from a phone number', () => {
    const result = normaliseRecipient('+55 (11) 98765-4321')
    assert.deepEqual(result, { kind: 'phone', value: '5511987654321' })
  })

  it('prepends the default country code to a local number', () => {
    const result = normaliseRecipient('11987654321', { defaultCountryCode: '55' })
    assert.deepEqual(result, { kind: 'phone', value: '5511987654321' })
  })

  it('leaves a number that already carries its country code alone', () => {
    const result = normaliseRecipient('5511987654321', { defaultCountryCode: '55' })
    assert.deepEqual(result, { kind: 'phone', value: '5511987654321' })
  })

  it('does not invent a country code when none is configured', () => {
    const result = normaliseRecipient('11987654321')
    assert.deepEqual(result, { kind: 'phone', value: '11987654321' })
  })

  it('rejects an address on an unknown domain', () => {
    assert.throws(() => normaliseRecipient('someone@example.com'), InvalidRecipientError)
  })

  it('rejects a number with too few digits', () => {
    assert.throws(() => normaliseRecipient('1234567'), InvalidRecipientError)
  })

  it('rejects a number past the E.164 ceiling', () => {
    assert.throws(() => normaliseRecipient('1234567890123456'), InvalidRecipientError)
  })

  it('rejects an empty recipient', () => {
    assert.throws(() => normaliseRecipient('   '), InvalidRecipientError)
  })
})

describe('isRecipientAllowed', () => {
  const recipient = { kind: 'phone', value: '5511987654321' } as const

  it('allows anyone when the list is empty', () => {
    assert.equal(isRecipientAllowed(recipient, []), true)
  })

  it('matches an exact entry', () => {
    assert.equal(isRecipientAllowed(recipient, ['5511987654321']), true)
  })

  it('matches an entry written with formatting', () => {
    assert.equal(isRecipientAllowed(recipient, ['+55 (11) 98765-4321']), true)
  })

  it('rejects a recipient that is not listed', () => {
    assert.equal(isRecipientAllowed(recipient, ['5511000000000']), false)
  })

  it('matches a group jid entry', () => {
    const group = { kind: 'jid', value: '120363012345678901@g.us' } as const
    assert.equal(isRecipientAllowed(group, ['120363012345678901@g.us']), true)
  })
})
