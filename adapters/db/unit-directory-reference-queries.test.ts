/**
 * What resolving a document's references costs, and what it asks for.
 *
 * The sibling file proves the matching against a real database. This one proves
 * the properties a database cannot show you: that a document costs **one**
 * query rather than one per line, and that a document with nothing to resolve
 * costs none at all.
 *
 * That is worth its own file because the cost is the part most likely to rot. A
 * per-line lookup answers every question in `unit-directory-references.test.ts`
 * correctly -- it is only wrong in a way you can measure, as a CSV bank feed of
 * hundreds of lines goes round-trip by round-trip before ingestion writes
 * anything.
 */

import type { Pool } from 'pg'
import { describe, expect, it } from 'vitest'

import { createUnitDirectory } from './unit-directory-postgres'

interface Recorded {
  readonly text: string
  readonly values: readonly unknown[]
}

/** A pool that records what it was asked and answers with nothing. */
function recordingPool(rows: readonly { reference: string; id: string }[] = []): {
  pool: Pool
  queries: Recorded[]
} {
  const queries: Recorded[] = []

  const pool = {
    query: (text: string, values: readonly unknown[] = []) => {
      queries.push({ text, values })
      return Promise.resolve({ rows })
    },
  } as unknown as Pool

  return { pool, queries }
}

describe('what resolving a document of references costs', () => {
  it('asks once for a document, however many lines it has', async () => {
    const { pool, queries } = recordingPool()

    await createUnitDirectory({ pool }).unitIdsFor(['4A', '4B', '4C', '5A', '5B'])

    // One. A CSV bank feed is hundreds of lines, and per-line lookups would be
    // hundreds of round trips on the reader before the write can begin.
    expect(queries).toHaveLength(1)
  })

  it('sends the references as a single array parameter', async () => {
    const { pool, queries } = recordingPool()

    await createUnitDirectory({ pool }).unitIdsFor(['4A', '4B'])

    expect(queries[0]!.values).toEqual([['4A', '4B']])
  })

  it('folds through the migration function rather than comparing raw numbers', async () => {
    // Asserting the query text, as `unit-directory-connection.test.ts` does for
    // its siblings. A reference is matched by the same folding migration 011
    // defines, or `4b ` off a bank feed never finds `4B`.
    const { pool, queries } = recordingPool()

    await createUnitDirectory({ pool }).unitIdsFor(['4A'])

    expect(queries[0]!.text).toContain('unit_normalised_number')
  })

  it('asks nothing at all when there are no references', async () => {
    // A document with no deposit lines, or one where every line was blank.
    // Not merely wasteful: `= any(array[]::text[])` is a query issued to answer
    // a question with only one possible answer.
    const { pool, queries } = recordingPool()

    const found = await createUnitDirectory({ pool }).unitIdsFor([])

    expect(queries).toHaveLength(0)
    expect(found.size).toBe(0)
  })

  it('asks nothing when every reference is one the database cannot be sent', async () => {
    // Dropping the NUL references can empty the list, and the empty-list guard
    // has to be applied to what is actually sent rather than to what arrived.
    const { pool, queries } = recordingPool()

    const found = await createUnitDirectory({ pool }).unitIdsFor([`bad\u0000ref`])

    expect(queries).toHaveLength(0)
    expect(found.size).toBe(0)
  })

  it('sends each distinct reference once', async () => {
    // A deposit where forty lines name the same unit is one question.
    const { pool, queries } = recordingPool()

    await createUnitDirectory({ pool }).unitIdsFor(['4A', '4A', '4B', '4A'])

    expect(queries[0]!.values).toEqual([['4A', '4B']])
  })

  it('builds the map from the reference column, not the id column', async () => {
    // Narrower than it first looked. A fake pool answers with whatever it is
    // told, so this cannot see the SQL alias change and says nothing about
    // *which* column the query selects -- proved by mutation: aliasing
    // `unit.normalised_number` as `reference` leaves all seven of these green.
    // What it does pin is the map construction, which the same mutation run
    // shows it catches.
    //
    // The alias itself is pinned by `unit-directory-references.test.ts`, where
    // a real database supplies a spelling that differs from the input.
    const asWritten = '  4b '
    const { pool } = recordingPool([{ reference: asWritten, id: 'unit-1' }])

    const found = await createUnitDirectory({ pool }).unitIdsFor([asWritten])

    expect(found.get(asWritten)).toBe('unit-1')
  })
})
