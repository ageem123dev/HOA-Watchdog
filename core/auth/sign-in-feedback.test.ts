import { describe, expect, it } from 'vitest'
import { SIGN_IN_REASONS, isSignInReason, signInMessage } from './sign-in-feedback'

describe('signInMessage', () => {
  it.each(SIGN_IN_REASONS)('returns a message for the known reason %s', (reason) => {
    const message = signInMessage(reason)

    expect(typeof message).toBe('string')
    expect(message).not.toBe('')
  })

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty', ''],
  ])('reports nothing when the reason is %s', (_label, raw) => {
    expect(signInMessage(raw)).toBeNull()
  })

  it('falls back to the credentials message for an unrecognised reason', () => {
    expect(signInMessage('bogus')).toBe(signInMessage('credentials'))
  })

  /**
   * `raw in MESSAGES` walks the prototype chain, so an object index would return
   * `Object.prototype.toString` — a function — from something typed as returning
   * a string. Rendered as a React child that throws, which turns the product's
   * only public page into a 500 for anyone handed the right link.
   */
  it.each([
    'toString',
    'valueOf',
    'constructor',
    'hasOwnProperty',
    '__proto__',
    'isPrototypeOf',
    'propertyIsEnumerable',
  ])('returns a string, not a prototype member, for the reason %s', (raw) => {
    const message = signInMessage(raw)

    expect(typeof message).toBe('string')
    expect(message).toBe(signInMessage('credentials'))
  })

  it('never says sorry, per the project voice', () => {
    for (const reason of SIGN_IN_REASONS) {
      expect(signInMessage(reason)).not.toMatch(/sorry|apolog|unfortunately/i)
    }
  })

  it('distinguishes a provider outage from a wrong password', () => {
    expect(signInMessage('unavailable')).not.toBe(signInMessage('credentials'))
  })

  it('does not reveal whether an account exists', () => {
    expect(signInMessage('credentials')).not.toMatch(/no account|not found|unknown (email|user)/i)
  })
})

describe('isSignInReason', () => {
  it.each(SIGN_IN_REASONS)('accepts %s', (reason) => {
    expect(isSignInReason(reason)).toBe(true)
  })

  it.each(['toString', '__proto__', 'constructor', 'bogus', '', 'CREDENTIALS'])(
    'rejects %s',
    (raw) => {
      expect(isSignInReason(raw)).toBe(false)
    },
  )

  it.each([
    ['a number', 42],
    ['null', null],
    ['undefined', undefined],
    ['an object', {}],
  ])('rejects %s', (_label, raw) => {
    expect(isSignInReason(raw)).toBe(false)
  })
})
