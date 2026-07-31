import { describe, expect, it } from 'vitest'
import type { ConfigEntry } from './config-entries'
import {
  FORBIDDEN_CREDENTIAL_PATTERNS,
  describeViolations,
  findForbiddenCredentials,
} from './forbidden-credentials'

const at = (name: string, value?: string): ConfigEntry =>
  value === undefined ? { source: 'test', name } : { source: 'test', name, value }

/**
 * Assembled at runtime rather than written as a literal. The detector needs a
 * string of exactly this shape to be exercised honestly, but a processor-key
 * literal sitting in a tracked file is what secret scanners and push protection
 * exist to stop — and being blocked by one would be the correct outcome.
 */
const processorKeyLike = (mode: 'live' | 'test'): string =>
  ['sk', mode, '4eC39HqLyjWDarjtT1zdp7dc'].join('_')

const LIVE_KEY_BODY = '4eC39HqLyjWDarjtT1zdp7dc'

/**
 * Credentials that would put this system on an external financial rail. Each of
 * these must be detected; NFR-2 is the absence of every one of them.
 */
const FORBIDDEN_NAMES = [
  'STRIPE_SECRET_KEY',
  'PLAID_SECRET',
  'PLAID_CLIENT_ID',
  'QUICKBOOKS_REFRESH_TOKEN',
  'QBO_CLIENT_SECRET',
  'INTUIT_CLIENT_SECRET',
  'APPFOLIO_API_SECRET',
  'DWOLLA_APP_SECRET',
  'BANK_API_TOKEN',
  'ACH_CLIENT_SECRET',
  'WIRE_API_KEY',
  'PAYPAL_CLIENT_SECRET',
  'SQUARE_ACCESS_TOKEN',
  'ADYEN_API_KEY',
  'BRAINTREE_PRIVATE_KEY',
  'PAYOUT_API_KEY',
  'PAYMENT_API_SECRET',
  'LEDGER_WRITE_TOKEN',
]

/**
 * Credentials this system legitimately holds, or names from its own domain
 * vocabulary. A detector that flags any of these gets deleted by the first
 * developer it inconveniences, and NFR-2 dies with it.
 */
const PERMITTED_NAMES = [
  'ANTHROPIC_API_KEY',
  'GEMINI_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'DATABASE_URL',
  'WATCHDOG_WRITER_DATABASE_URL',
  'WATCHDOG_READER_DATABASE_URL',
  'BANK_STATEMENT_BUCKET',
  'PAYMENT_DUE_DAY',
  'ASSESSMENT_PERIOD_START',
  'NODE_ENV',
  'CI',
  'PATH',
]

describe('FORBIDDEN_CREDENTIAL_PATTERNS', () => {
  it('is not empty — an empty table would make the guard silently vacuous', () => {
    expect(FORBIDDEN_CREDENTIAL_PATTERNS.length).toBeGreaterThan(0)
  })

  it('gives every pattern a unique id', () => {
    const ids = FORBIDDEN_CREDENTIAL_PATTERNS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('gives every pattern at least one of a name or value matcher', () => {
    for (const pattern of FORBIDDEN_CREDENTIAL_PATTERNS) {
      expect(pattern.namePattern ?? pattern.valuePattern, `pattern ${pattern.id}`).toBeDefined()
    }
  })

  it('uses no global-flagged matcher, whose lastIndex would skip alternating entries', () => {
    for (const pattern of FORBIDDEN_CREDENTIAL_PATTERNS) {
      expect(pattern.namePattern?.global ?? false, `pattern ${pattern.id} name`).toBe(false)
      expect(pattern.valuePattern?.global ?? false, `pattern ${pattern.id} value`).toBe(false)
    }
  })
})

describe('findForbiddenCredentials', () => {
  it('reports no violations for an environment holding only permitted names', () => {
    expect(findForbiddenCredentials(PERMITTED_NAMES.map((n) => at(n, 'value')))).toEqual([])
  })

  it.each(PERMITTED_NAMES)('does not flag the permitted name %s', (name) => {
    expect(findForbiddenCredentials([at(name, 'some-value')])).toEqual([])
  })

  it.each(FORBIDDEN_NAMES)('flags the forbidden name %s', (name) => {
    const violations = findForbiddenCredentials([at(name, 'redacted')])

    expect(violations.length).toBeGreaterThan(0)
    expect(violations[0]).toMatchObject({ source: 'test', name, matchedOn: 'name' })
    expect(violations[0]?.reason).not.toBe('')
  })

  it('matches names case-insensitively', () => {
    expect(findForbiddenCredentials([at('plaid_secret', 'x')])).toHaveLength(1)
  })

  it('flags a payment-processor key hidden under an innocuous name', () => {
    const violations = findForbiddenCredentials([at('MISC_TOKEN', processorKeyLike('live'))])

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ name: 'MISC_TOKEN', matchedOn: 'value' })
  })

  it('flags a test-mode processor key too — its presence still means a rail exists', () => {
    expect(
      findForbiddenCredentials([at('MISC_TOKEN', processorKeyLike('test'))]),
    ).toHaveLength(1)
  })

  it('does not flag prose that merely mentions a rail', () => {
    expect(findForbiddenCredentials([at('NOTE', 'we deliberately hold no stripe or plaid key')])).toEqual([])
  })

  it('reports an entry with no value, matching on the name alone', () => {
    const violations = findForbiddenCredentials([at('PLAID_SECRET')])

    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ matchedOn: 'name' })
  })

  it('returns no violations for no entries', () => {
    expect(findForbiddenCredentials([])).toEqual([])
  })

  it('finds a violation at the end of a long clean list', () => {
    const entries = [...PERMITTED_NAMES.map((n) => at(n, 'v')), at('PLAID_SECRET', 'v')]

    expect(findForbiddenCredentials(entries)).toHaveLength(1)
  })

  it('reports every violating entry, not just the first', () => {
    const violations = findForbiddenCredentials([
      at('PLAID_SECRET', 'a'),
      at('CLEAN', 'b'),
      at('APPFOLIO_API_SECRET', 'c'),
    ])

    expect(violations.map((v) => v.name)).toEqual(['PLAID_SECRET', 'APPFOLIO_API_SECRET'])
  })

  it('reports both matches when an entry violates on its name and its value', () => {
    const violations = findForbiddenCredentials([
      at('STRIPE_SECRET_KEY', processorKeyLike('live')),
    ])

    expect(violations.map((v) => v.matchedOn)).toEqual(['name', 'value'])
  })

  it('is stable across repeated calls, so no matcher carries state between runs', () => {
    const entries = [at('PLAID_SECRET', 'a'), at('CLEAN', 'b'), at('DWOLLA_APP_SECRET', 'c')]

    expect(findForbiddenCredentials(entries)).toEqual(findForbiddenCredentials(entries))
  })

  it('cross-check: every reported violation is independently reproducible from the table', () => {
    const entries = [...FORBIDDEN_NAMES, ...PERMITTED_NAMES].map((n) => at(n, 'v'))

    for (const violation of findForbiddenCredentials(entries)) {
      const pattern = FORBIDDEN_CREDENTIAL_PATTERNS.find((p) => p.id === violation.patternId)
      const entry = entries.find((e) => e.name === violation.name)

      expect(pattern, `unknown patternId ${violation.patternId}`).toBeDefined()
      expect(entry, `violation names an entry that was never supplied`).toBeDefined()

      const matcher =
        violation.matchedOn === 'name' ? pattern?.namePattern : pattern?.valuePattern
      const subject = violation.matchedOn === 'name' ? entry?.name : entry?.value
      expect(matcher?.test(subject ?? '')).toBe(true)
    }
  })

  it('rejects a non-array argument rather than silently reporting nothing', () => {
    expect(() => findForbiddenCredentials(undefined as never)).toThrow(TypeError)
  })

  it('rejects a malformed entry rather than skipping it', () => {
    expect(() => findForbiddenCredentials([{ source: 'test' } as never])).toThrow(TypeError)
  })
})

describe('describeViolations', () => {
  it('names the source, the entry and the reason for each violation', () => {
    const message = describeViolations(
      findForbiddenCredentials([{ source: 'ci.yml', name: 'PLAID_SECRET', value: 'x' }]),
    )

    expect(message).toContain('ci.yml')
    expect(message).toContain('PLAID_SECRET')
    expect(message).toContain('Plaid')
  })

  it('never echoes the secret value it found', () => {
    const message = describeViolations(
      findForbiddenCredentials([
        { source: 'ci.yml', name: 'MISC_TOKEN', value: processorKeyLike('live') },
      ]),
    )

    expect(message).toContain('MISC_TOKEN')
    expect(message).not.toContain(LIVE_KEY_BODY)
  })

  it('returns an empty string when there is nothing to report', () => {
    expect(describeViolations([])).toBe('')
  })
})

/**
 * Prefixing an environment variable by stage or scope is the most common
 * multi-environment convention there is — this project already uses it for
 * NEXT_PUBLIC_*. A detector anchored to the start of the name is
 * disabled by the first team that adopts the convention.
 */
const PREFIXED_FORBIDDEN_NAMES = [
  'PROD_PLAID_SECRET',
  'NEXT_PUBLIC_PLAID_CLIENT_ID',
  'MY_STRIPE_SECRET_KEY',
  'HOA_QUICKBOOKS_REFRESH_TOKEN',
  'APP_APPFOLIO_API_SECRET',
  'STAGING_DWOLLA_APP_SECRET',
  'PROD_BANK_API_TOKEN',
]

/**
 * Names built from this product's own vocabulary that sit close to the
 * forbidden shapes. Square footage, payment due dates and wire tokenisation
 * notes are condominium-management words, not credentials.
 */
const NEAR_MISS_PERMITTED_NAMES = [
  'SQUARE_FOOTAGE_KEY',
  'UNIT_SQUARE_FOOTAGE',
  'PAYMENT_KEYS_ORDER',
  'WIRE_TOKENIZED_DISPLAY',
  'BANK_TOKENIZATION_NOTES',
  'ACH_ACCESSIBILITY_LABEL',
]

describe('findForbiddenCredentials — reach', () => {
  it.each(PREFIXED_FORBIDDEN_NAMES)('flags %s despite the leading prefix', (name) => {
    expect(findForbiddenCredentials([at(name, 'redacted')]).length).toBeGreaterThan(0)
  })

  it.each(NEAR_MISS_PERMITTED_NAMES)('does not flag the domain term %s', (name) => {
    expect(findForbiddenCredentials([at(name, 'some-value')])).toEqual([])
  })

  it('flags an uppercased processor key, since name matching is already case-insensitive', () => {
    expect(
      findForbiddenCredentials([at('MISC', processorKeyLike('live').toUpperCase())]).length,
    ).toBeGreaterThan(0)
  })
})
