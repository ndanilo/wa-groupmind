/*
Turning whatever the caller typed into something addressable.

This lives in the gateway rather than the WhatsApp side so a malformed number is rejected with a
400 at the edge, instead of becoming a queued job that can only fail minutes later. Resolving
digits into a real JID stays with the transport, because only a live socket can confirm that a
number is actually registered on WhatsApp.
*/

/** WhatsApp's own address suffixes. A caller that already knows the JID can pass it through. */
const JID_SUFFIXES = ['@s.whatsapp.net', '@g.us', '@lid', '@newsletter'] as const

/**
 * Longest number still treated as "local", i.e. missing its country code.
 *
 * Brazil is the worst case that matters here: a mobile is DDD + 9 digits = 11, which becomes 13
 * once `55` is prepended. So anything above 11 digits is assumed to already carry a country code.
 * A caller who always sends full international numbers is unaffected by this rule.
 */
const NATIONAL_MAX_DIGITS = 11

/** E.164 allows at most 15 digits; below 8 nothing real exists. */
const MIN_DIGITS = 8
const MAX_DIGITS = 15

export class InvalidRecipientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRecipientError'
  }
}

export type Recipient =
  /** Already a full WhatsApp address; the transport uses it verbatim. */
  | { kind: 'jid'; value: string }
  /** Digits only, including country code. The transport still has to resolve it. */
  | { kind: 'phone'; value: string }

export type NormaliseOptions = {
  /** Digits only. Empty means callers must always include the country code themselves. */
  defaultCountryCode?: string
}

export function normaliseRecipient(raw: string, options: NormaliseOptions = {}): Recipient {
  const trimmed = raw.trim()
  if (!trimmed) throw new InvalidRecipientError('recipient is empty')

  const lowered = trimmed.toLowerCase()
  if (JID_SUFFIXES.some((suffix) => lowered.endsWith(suffix))) {
    const user = lowered.slice(0, lowered.lastIndexOf('@'))
    if (!user) throw new InvalidRecipientError(`recipient "${trimmed}" has no user part`)
    return { kind: 'jid', value: lowered }
  }

  // An unrecognised domain is far more likely a typo than an address we should try to deliver to.
  if (lowered.includes('@')) {
    throw new InvalidRecipientError(`recipient "${trimmed}" is not a WhatsApp address`)
  }

  const supplied = trimmed.replace(/\D/g, '')
  if (!supplied) throw new InvalidRecipientError(`recipient "${trimmed}" contains no digits`)

  const countryCode = (options.defaultCountryCode ?? '').replace(/\D/g, '')
  const digits =
    countryCode && supplied.length <= NATIONAL_MAX_DIGITS ? `${countryCode}${supplied}` : supplied

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
    throw new InvalidRecipientError(
      `recipient "${trimmed}" resolved to ${digits.length} digits, expected ${MIN_DIGITS}-${MAX_DIGITS} including the country code`,
    )
  }

  return { kind: 'phone', value: digits }
}

/**
 * Allowlist check, run after normalisation so `+55 11 99999-9999` and `5511999999999` are
 * recognised as the same entry. An empty list means every recipient is allowed.
 */
export function isRecipientAllowed(recipient: Recipient, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true

  return allowlist.some((entry) => {
    const candidate = entry.trim().toLowerCase()
    if (!candidate) return false
    if (candidate === recipient.value) return true
    // Let an allowlist written as bare digits match a JID, and vice versa.
    return candidate.replace(/\D/g, '') === recipient.value.replace(/\D/g, '')
  })
}
