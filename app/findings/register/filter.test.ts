/**
 * Reading the register's filter out of the URL.
 *
 * Tested as a pure function for the reason `app/access-log/filter.ts` gives:
 * importing the page pulls in `auth`, and therefore `next-auth` and
 * `next/server`, and the suite cannot load the file at all.
 *
 * Two of the cases below are defects `app/access-log/filter.ts` already paid
 * for. They are re-asserted rather than assumed, because this is a second
 * filter and the first one's tests do not run against it.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_LIMIT, filterFrom } from './filter'

describe('the search', () => {
  it('is taken from the URL', () => {
    expect(filterFrom({ search: 'Coastal' }).search).toBe('Coastal')
  })

  it('is trimmed, so a stray space does not narrow the register to nothing', () => {
    expect(filterFrom({ search: '  Coastal  ' }).search).toBe('Coastal')
  })

  it.each([undefined, '', '   '])('is absent when the box held %o', (search) => {
    // An empty string is not a filter. It arrives on every submit of a blank
    // form, and treating it as one narrows the register to findings matching
    // nothing — presented to a board member as an empty register.
    expect(filterFrom({ search }).search).toBeUndefined()
  })

  it('takes the first of a repeated parameter rather than the array', () => {
    // `?search=a&search=b` is a URL anyone can type or a form can produce.
    // The array reaches `.trim()` and throws, taking the page with it.
    expect(filterFrom({ search: ['Coastal', 'Harbour'] }).search).toBe('Coastal')
  })

  it('survives a repeated parameter whose first value is blank', () => {
    expect(filterFrom({ search: ['', 'Harbour'] }).search).toBeUndefined()
  })
})

describe('the limit', () => {
  it('defaults when nobody asked for one', () => {
    expect(filterFrom({}).limit).toBe(DEFAULT_LIMIT)
  })

  it('is taken from the URL when it is a whole number', () => {
    expect(filterFrom({ limit: '25' }).limit).toBe(25)
  })

  it('truncates before it range-checks, not after', () => {
    // **The order is the defect.** Range-checking first turns `0.5` into a
    // limit of 0, which the adapter then clamps *up* to 1 — so a reader who
    // mistyped a decimal got a single row of a permanent record with no
    // indication why. Raised by CodeRabbit on the access log; verified there
    // before fixing.
    expect(filterFrom({ limit: '0.5' }).limit).toBe(DEFAULT_LIMIT)
  })

  it.each(['0', '-5', 'abc', '', 'Infinity', 'NaN'])(
    'falls back to the default for %o rather than erroring the page',
    (limit) => {
      // This is a read-only surface reached by a URL people edit and share. An
      // error page because somebody mistyped a number is a worse answer than
      // the register.
      expect(filterFrom({ limit }).limit).toBe(DEFAULT_LIMIT)
    },
  )

  it('is bounded from above, because the adapter refuses more', () => {
    // The port declares the ceiling and the adapter rejects past it. A URL
    // asking for more must not become a rejected promise on a page a board
    // member opened.
    expect(filterFrom({ limit: '100000' }).limit).toBeLessThanOrEqual(200)
  })

  it('takes the first of a repeated parameter', () => {
    expect(filterFrom({ limit: ['25', '50'] }).limit).toBe(25)
  })
})

describe('what the filter is for', () => {
  it('carries both fields together, so the export can be handed the same one', () => {
    const filter = filterFrom({ search: 'Coastal', limit: '25' })

    expect(filter).toEqual({ search: 'Coastal', limit: 25 })
  })

  it('omits search entirely rather than setting it undefined', () => {
    // `exactOptionalPropertyTypes` aside, a key that is present and undefined
    // reads as "searched for nothing" to anything enumerating the object —
    // including the query string the export is built from.
    expect(Object.keys(filterFrom({ limit: '25' }))).toEqual(['limit'])
  })
})
