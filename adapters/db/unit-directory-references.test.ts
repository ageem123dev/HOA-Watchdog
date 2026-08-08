/**
 * Resolving deposit references to units, against the real database.
 *
 * `unit_normalised_number` is the thing under test, so a fake pool cannot say
 * anything useful here — the whole question is whether `4b ` off a bank feed
 * finds the unit recorded as `4B`.
 *
 * The query-shape properties that do not need a database — how many queries a
 * document costs, what happens with no references at all — are in
 * `unit-directory-reference-queries.test.ts` beside this.
 */

import { randomBytes } from 'node:crypto'
import { Client, Pool } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createUnitDirectory } from './unit-directory-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  unit reference tests SKIPPED: both database URLs must be set.\n')
}

const RUN_PREFIX = `u${randomBytes(4).toString('hex')}`

describeWithDatabase('resolving deposit references to units', () => {
  let writer: Client
  let readerPool: Pool
  let scope = ''

  // Per test, because the unique index on `normalised_number` means two tests
  // both inserting `4B` collide -- and a suite whose tests must not share a
  // fixture is one test away from failing for a reason that is not the code's.
  beforeEach(() => {
    scope = randomBytes(3).toString('hex')
  })

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    readerPool = new Pool({ connectionString: readerUrl, max: 2 })
  })

  afterAll(async () => {
    await writer.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}-%`])
    await readerPool.end()
    await writer.end()
  })

  const newUnit = async (unitNumber: string): Promise<string> => {
    const { rows } = await writer.query<{ id: string }>(
      'insert into unit (unit_number) values ($1) returning id',
      [unitNumber],
    )
    return rows[0]!.id
  }

  const directory = () => createUnitDirectory({ pool: readerPool })

  it('answers with the unit a reference names', async () => {
    const number = `${RUN_PREFIX}-${scope}-4B`
    const unitId = await newUnit(number)

    const found = await directory().unitIdsFor([number])

    expect(found.get(number)).toBe(unitId)
  })

  it('matches a reference the roll does not spell exactly', async () => {
    // The whole reason this goes through `unit_normalised_number` rather than
    // an equality test on `unit_number`: a bank feed writes what the payer
    // typed, and the roll writes what the board typed.
    const unitId = await newUnit(`${RUN_PREFIX}-${scope}-4B`)

    const found = await directory().unitIdsFor([`  ${RUN_PREFIX}-${scope}-4b  `])

    expect(found.get(`  ${RUN_PREFIX}-${scope}-4b  `)).toBe(unitId)
  })

  it('leaves a reference nobody recognises out of the answer', async () => {
    // Absent, not present-and-null. `resolveLine` holds on a miss, and a null
    // entry would make "we looked and found nothing" and "we never looked"
    // indistinguishable to the caller.
    await newUnit(`${RUN_PREFIX}-${scope}-4B`)

    const found = await directory().unitIdsFor([`${RUN_PREFIX}-${scope}-nosuchunit`])

    expect(found.has(`${RUN_PREFIX}-${scope}-nosuchunit`)).toBe(false)
    expect(found.size).toBe(0)
  })

  it('answers every reference in one call, including ones it cannot match', async () => {
    const knownId = await newUnit(`${RUN_PREFIX}-${scope}-12`)

    const found = await directory().unitIdsFor([
      `${RUN_PREFIX}-${scope}-12`,
      `${RUN_PREFIX}-${scope}-absent`,
      `${RUN_PREFIX}-${scope}-12`,
    ])

    expect(found.get(`${RUN_PREFIX}-${scope}-12`)).toBe(knownId)
    expect(found.has(`${RUN_PREFIX}-${scope}-absent`)).toBe(false)
    // One entry, not two, for the reference that appeared twice.
    expect(found.size).toBe(1)
  })

  it('keys the answer by the reference it was given, not by the folded form', async () => {
    // The caller re-keys with core's own `fold`, and can only do that if it
    // gets its own string back. Returning the database's normalised form would
    // silently require the two foldings to agree -- and they do not: JS `\s`
    // matches U+3000 and migration 011's character set does not.
    const unitId = await newUnit(`${RUN_PREFIX}-${scope}-7C`)
    const asWritten = `  ${RUN_PREFIX}-${scope}-7c `

    const found = await directory().unitIdsFor([asWritten])

    expect([...found.keys()]).toEqual([asWritten])
    expect(found.get(asWritten)).toBe(unitId)
  })

  it('distinguishes two units that differ only past the fold', async () => {
    // Guards the reverse of the folding tests: proving `4b` finds `4B` says
    // nothing about whether the fold is too eager. Leading zeroes are the case
    // migration 011 explicitly refuses to fold.
    const plainId = await newUnit(`${RUN_PREFIX}-${scope}-7`)
    const paddedId = await newUnit(`${RUN_PREFIX}-${scope}-07`)

    const found = await directory().unitIdsFor([`${RUN_PREFIX}-${scope}-7`, `${RUN_PREFIX}-${scope}-07`])

    expect(found.get(`${RUN_PREFIX}-${scope}-7`)).toBe(plainId)
    expect(found.get(`${RUN_PREFIX}-${scope}-07`)).toBe(paddedId)
    expect(plainId).not.toBe(paddedId)
  })

  it('survives a reference carrying a NUL rather than losing the document', async () => {
    // `text` cannot hold a NUL, so passing one as a parameter raises 22021 and
    // aborts the transaction the ingest is running in -- one malformed line
    // would take every payment in the document with it. The same shape as the
    // defect migration 017 fixed.
    const unitId = await newUnit(`${RUN_PREFIX}-${scope}-9A`)

    // Written as an escape on purpose: a raw NUL byte in a source file makes it
    // unsearchable and is invisible in review.
    const withNul = `${RUN_PREFIX}-${scope}-\u00004B`

    const found = await directory().unitIdsFor([`${RUN_PREFIX}-${scope}-9A`, withNul])

    // The good reference still resolved -- that is the assertion that matters.
    // The bad line was dropped instead of taking the whole query down with it.
    expect(found.get(`${RUN_PREFIX}-${scope}-9A`)).toBe(unitId)
    expect(found.has(withNul)).toBe(false)
  })
})
