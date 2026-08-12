import { describe, expect, it } from 'vitest'

import { DEFAULT_LIMIT, filterFrom } from './filter'

describe('what counts as a filter', () => {
  it('reads an actor and an entry', () => {
    expect(filterFrom({ actorId: 'user-7', entryId: 'dues_status' })).toEqual({
      actorId: 'user-7',
      entryId: 'dues_status',
      limit: DEFAULT_LIMIT,
    })
  })

  it('treats a blank box as no filter at all', () => {
    // A blank box arrives on every submit of an empty form. Treated as a filter,
    // it would select actors whose id is the empty string — nothing — and the
    // surface would report "no queries match this filter" on a log full of them.
    expect(filterFrom({ actorId: '', entryId: '   ' })).toEqual({ limit: DEFAULT_LIMIT })
  })

  it('trims, so a copied id with a trailing space still matches', () => {
    expect(filterFrom({ actorId: '  user-7  ' }).actorId).toBe('user-7')
  })

  it('takes the first when a parameter repeats', () => {
    expect(filterFrom({ actorId: ['user-7', 'user-9'] }).actorId).toBe('user-7')
  })
})

describe('the limit', () => {
  it('defaults when absent', () => {
    expect(filterFrom({}).limit).toBe(DEFAULT_LIMIT)
  })

  it('takes a number when given one', () => {
    expect(filterFrom({ limit: '25' }).limit).toBe(25)
  })

  it.each(['nonsense', '-5', '0', ''])('falls back to the default for %s', (value) => {
    // A read-only surface reached by a URL people edit and share. An error page
    // because somebody mistyped a number is a worse answer than a hundred rows.
    // Zero and negative matter especially: either would return no rows and read
    // exactly like "no queries have been run".
    expect(filterFrom({ limit: value }).limit).toBe(DEFAULT_LIMIT)
  })

  it('truncates a fractional limit rather than passing it to SQL', () => {
    expect(filterFrom({ limit: '10.9' }).limit).toBe(10)
  })
})
