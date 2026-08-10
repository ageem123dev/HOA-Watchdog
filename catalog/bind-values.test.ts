import { describe, expect, it } from 'vitest'

import { bindValues } from './bind-values'
import { duesStatusV1 } from './entries/dues-status-v1'
import type { CatalogEntry } from './entry'

/**
 * An entry with an **optional** bound parameter.
 *
 * The catalog holds no such entry today, and that is the point of writing one
 * here: `dues_status@1` requires both of its parameters, so its own tests can
 * never reach the case where a bound name is absent from the supplied values.
 * The first entry that declares an optional filter would meet it in production.
 */
const WITH_AN_OPTIONAL: CatalogEntry = {
  id: 'unit_payments',
  version: 1,
  sql: 'select 1 from payment where unit_id = $1 and ($2::date is null or paid_on >= $2::date)',
  parameters: {
    type: 'object',
    properties: {
      unitNumber: { type: 'string', description: 'Required.' },
      since: { type: 'string', description: 'Optional lower bound.' },
    },
    required: ['unitNumber'],
    additionalProperties: false,
  },
  bind: ['unitNumber', 'since'],
}

describe('binding a parameter set to a query', () => {
  it('orders the values as the entry declares, not as the caller wrote them', () => {
    expect(duesStatusV1.bind).toEqual(['unitNumber', 'assessmentYear'])

    expect(bindValues(duesStatusV1, { assessmentYear: 2026, unitNumber: '4B' })).toEqual([
      '4B',
      2026,
    ])
  })

  /**
   * This function's contract, not a driver workaround. pg 8.22.0 maps both
   * `null` and `undefined` to SQL NULL — verified, after an earlier version of
   * this comment claimed it throws — so what the assertion protects is the value
   * every *other* caller sees: a fake in a test, a logger, a future driver.
   */
  it('binds an omitted optional parameter as null, never as undefined', () => {
    const values = bindValues(WITH_AN_OPTIONAL, { unitNumber: '4B' })

    expect(values).toEqual(['4B', null])
    expect(values[1]).not.toBeUndefined()
  })

  it('binds an explicitly null optional parameter as null', () => {
    expect(bindValues(WITH_AN_OPTIONAL, { unitNumber: '4B', since: null })).toEqual(['4B', null])
  })

  it('binds a supplied optional parameter as itself', () => {
    expect(bindValues(WITH_AN_OPTIONAL, { unitNumber: '4B', since: '2026-01-01' })).toEqual([
      '4B',
      '2026-01-01',
    ])
  })

  /**
   * `??` rather than `||`. A unit number of `'0'` is a unit number and a year of
   * `0` is a value; `||` would replace both with `null` and the query would
   * filter on nothing while looking like it filtered on something.
   */
  it.each([
    ['an empty string', '', ''],
    ['a zero', 0, 0],
    ['false', false, false],
  ])('binds %s as itself rather than as null', (_label, supplied, expected) => {
    expect(bindValues(duesStatusV1, { unitNumber: supplied, assessmentYear: 2026 })[0]).toBe(
      expected,
    )
  })

  /**
   * The hole this closes exists only where `bindValues` and `validateParameters`
   * disagree. `validateParameters` skips the type check for a declared parameter
   * that is absent as an *own* property, so an inherited optional one is never
   * checked — and a plain read here would bind that unchecked value straight
   * into the query. Both sides use `Object.hasOwn`; this is the assertion that
   * says so.
   */
  it('does not bind an optional parameter inherited from a prototype', () => {
    const inherited = Object.create({ since: 'never validated' }) as Record<string, unknown>
    inherited.unitNumber = '4B'

    expect(bindValues(WITH_AN_OPTIONAL, inherited)).toEqual(['4B', null])
  })

  it('binds nothing for an entry with no placeholders', () => {
    const noParameters: CatalogEntry = {
      id: 'unit_count',
      version: 1,
      sql: 'select count(*) as "unitCount" from unit',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      bind: [],
    }

    expect(bindValues(noParameters, {})).toEqual([])
  })
})
