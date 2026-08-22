/**
 * The bounded slice a preview reads (story 5.5, AC7 and the honest half of AC5).
 *
 * Two counts that must be able to differ: how many rows were read, and how many
 * the file has. Computed by one expression they can only ever agree, and the
 * screen can then only say "20 of 20" — which is the reassurance UX-DR24
 * forbids, wearing a number.
 *
 * Every fixture row carries its own index, so a slice taken from the wrong end
 * or reordered is visible in the assertion rather than hidden behind rows that
 * all look alike.
 */

import { describe, expect, it } from 'vitest'

import { boundedSample, PREVIEW_ROW_LIMIT } from './sample-rows'

const HEADER = ['Date', 'Amount', 'Unit']

/** `n` data rows, each naming its own 1-based index. */
const sampleOf = (n: number): readonly (readonly string[])[] => [
  HEADER,
  ...Array.from({ length: n }, (_, i) => [`row-${i + 1}`, `${i + 1}.00`, `unit-${i + 1}`]),
]

describe('the limit itself', () => {
  it('is a positive whole number of rows', () => {
    // Asserted because everything below is expressed in terms of it, and a
    // limit of 0 would make every "bounded" assertion trivially true.
    expect(Number.isInteger(PREVIEW_ROW_LIMIT)).toBe(true)
    expect(PREVIEW_ROW_LIMIT).toBeGreaterThan(0)
  })
})

describe('a file smaller than the limit', () => {
  it('reads every data row', () => {
    const { rows, totalDataRows } = boundedSample(sampleOf(3))

    expect(rows).toHaveLength(4)
    expect(totalDataRows).toBe(3)
  })

  it('keeps the header row at the front', () => {
    expect(boundedSample(sampleOf(3)).rows[0]).toEqual(HEADER)
  })
})

describe('a file larger than the limit', () => {
  const OVER = PREVIEW_ROW_LIMIT + 7

  it('reads exactly the limit in data rows, not counting the header', () => {
    const { rows } = boundedSample(sampleOf(OVER))

    // The off-by-one that matters: bounding the rectangle rather than the data
    // rows gives `PREVIEW_ROW_LIMIT - 1` rows while the screen says the limit.
    expect(rows).toHaveLength(PREVIEW_ROW_LIMIT + 1)
    expect(rows.slice(1)).toHaveLength(PREVIEW_ROW_LIMIT)
  })

  it('reports the file total, unclamped', () => {
    const { totalDataRows } = boundedSample(sampleOf(OVER))

    // Clamped by the same expression as the slice, this reads
    // PREVIEW_ROW_LIMIT and "20 of 143" becomes "20 of 20".
    expect(totalDataRows).toBe(OVER)
    expect(totalDataRows).toBeGreaterThan(PREVIEW_ROW_LIMIT)
  })

  it('takes the first rows, in order', () => {
    const { rows } = boundedSample(sampleOf(OVER))

    // The whole sequence, not just its ends: a slice that kept the first and
    // last while dropping or reordering the middle would satisfy those two.
    // Raised by `ocr`.
    expect(rows.slice(1).map((row) => row[0])).toEqual(
      Array.from({ length: PREVIEW_ROW_LIMIT }, (_, i) => `row-${i + 1}`),
    )
    // And not the tail: a slice from the end would start at row-8 here.
    expect(rows.flat()).not.toContain(`row-${OVER}`)
  })
})

describe('the boundary itself', () => {
  it('reads all of a file at exactly the limit', () => {
    const { rows, totalDataRows } = boundedSample(sampleOf(PREVIEW_ROW_LIMIT))

    expect(rows.slice(1)).toHaveLength(PREVIEW_ROW_LIMIT)
    expect(totalDataRows).toBe(PREVIEW_ROW_LIMIT)
  })

  it('drops exactly one row at one past the limit', () => {
    const { rows, totalDataRows } = boundedSample(sampleOf(PREVIEW_ROW_LIMIT + 1))

    expect(rows.slice(1)).toHaveLength(PREVIEW_ROW_LIMIT)
    expect(totalDataRows).toBe(PREVIEW_ROW_LIMIT + 1)
  })
})

describe('files with nothing to slice', () => {
  it('keeps the header and reports no data rows for a header-only file', () => {
    const { rows, totalDataRows } = boundedSample([HEADER])

    expect(rows).toEqual([HEADER])
    expect(totalDataRows).toBe(0)
  })

  it('keeps an empty header row rather than inventing one', () => {
    // `[[]]` is a rectangle with a header of no columns. The implementation
    // reaches `header ?? []` here, and nothing exercised it. Raised by `ocr`.
    const { rows, totalDataRows } = boundedSample([[]])

    expect(rows).toEqual([[]])
    expect(totalDataRows).toBe(0)
  })

  it('returns nothing for an empty rectangle', () => {
    const { rows, totalDataRows } = boundedSample([])

    expect(rows).toEqual([])
    expect(totalDataRows).toBe(0)
  })
})

describe('the limit is a parameter, so a caller can be explicit', () => {
  it('honours a limit passed in', () => {
    const { rows, totalDataRows } = boundedSample(sampleOf(10), 4)

    expect(rows.slice(1)).toHaveLength(4)
    expect(rows[1]?.[0]).toBe('row-1')
    expect(totalDataRows).toBe(10)
  })
})
