/**
 * The `UnitDirectory` adapter, against the real database.
 *
 * The question this story exists to answer is a boundary question: on the day a
 * unit changes hands, exactly one person held it. So the tests probe either side
 * of the sale date rather than picking one date in the middle of a tenure, which
 * would pass against an adapter that returned the first row it found.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createUnitDirectory } from './unit-directory-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  unit directory adapter tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

/**
 * Every row this file creates carries this prefix, and its cleanup deletes only
 * rows carrying it.
 *
 * Vitest runs test files in parallel and three files now write to `unit`. The
 * first versions of `unit.test.ts` and `unit-membership.test.ts` cleaned up with
 * `like '%-%'` and deleted each other's rows mid-run; see the note in
 * `migrations/unit.test.ts`.
 */
const RUN_PREFIX = `d${randomBytes(4).toString('hex')}`

describeWithDatabase('the unit directory', () => {
  let writer: Client
  let scope = ''

  const named = (suffix: string) => `${RUN_PREFIX}-${scope}-${suffix}`

  /**
   * A unit that changed hands on 1 July 2024.
   *
   * Half-open ranges, so the outgoing membership ends on the day the incoming
   * one begins. That single date is what every assertion below turns on.
   */
  const givenAUnitSoldOn1July = async () => {
    const unit = await writer.query<{ id: string }>(
      'insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
      [named('4B')],
    )
    const unitId = unit.rows[0]!.id

    for (const [name, from, to] of [
      ['Ada', '2024-01-01', '2024-07-01'],
      ['Grace', '2024-07-01', null],
    ] as const) {
      const holder = await writer.query<{ id: string }>(
        'insert into unit_holder (full_name, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
        [named(name)],
      )
      await writer.query(
        'insert into unit_membership (unit_id, holder_id, held_during, association_id) values ($1, $2, daterange($3::date, $4::date), \'00000000-0000-7000-8000-000000000001\')',
        [unitId, holder.rows[0]!.id, from, to],
      )
    }

    return { unitId }
  }

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
  })

  beforeEach(() => {
    scope = randomBytes(4).toString('hex')
  })

  afterAll(async () => {
    await writer.query(
      'delete from unit_membership where unit_id in (select id from unit where unit_number like $1)',
      [`${RUN_PREFIX}-%`],
    )
    await writer.query('delete from unit_holder where full_name like $1', [`${RUN_PREFIX}-%`])
    await writer.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}-%`])
    await writer.end()
  })

  describe('who held it on a date', () => {
    it('names the outgoing holder the day before the sale', async () => {
      // E2, lower side of the boundary.
      await givenAUnitSoldOn1July()

      const held = await createUnitDirectory().heldBy(named('4B'), '2024-06-30')

      expect(held?.holderName).toBe(named('Ada'))
    })

    it('names the incoming holder on the day of the sale itself', async () => {
      // E2, and the assertion the half-open range exists for. An inclusive upper
      // bound would give this date two answers; an off-by-one would give it the
      // wrong one.
      await givenAUnitSoldOn1July()

      const held = await createUnitDirectory().heldBy(named('4B'), '2024-07-01')

      expect(held?.holderName).toBe(named('Grace'))
    })

    it('still names the incoming holder the day after', async () => {
      // Beside the two above: an adapter that always returned the *last*
      // membership would pass the sale-day test and fail the one before it, and
      // one that returned the first would pass that and fail this.
      await givenAUnitSoldOn1July()

      const held = await createUnitDirectory().heldBy(named('4B'), '2024-07-02')

      expect(held?.holderName).toBe(named('Grace'))
    })

    it('names the current holder for a date years ahead', async () => {
      // E3. The open-ended membership has no upper bound and must keep
      // answering.
      await givenAUnitSoldOn1July()

      const held = await createUnitDirectory().heldBy(named('4B'), '2031-12-25')

      expect(held?.holderName).toBe(named('Grace'))
    })

    it('answers nobody for a date before anyone held it', async () => {
      // E4.
      await givenAUnitSoldOn1July()

      expect(await createUnitDirectory().heldBy(named('4B'), '2023-01-01')).toBeNull()
    })

    it('answers nobody for a unit that does not exist', async () => {
      // E4 and E11. Recorded in the port: this is deliberately the same answer
      // as "nobody held it then".
      expect(await createUnitDirectory().heldBy(named('nosuchunit'), '2024-07-01')).toBeNull()
    })

    it('finds the unit however the number was typed', async () => {
      // E1. `4b  ` off a hand-typed roll is the same property as `4B`, which is
      // what migration 011's normalisation is for. An adapter matching on the
      // raw column passes every other test in this file.
      await givenAUnitSoldOn1July()

      const held = await createUnitDirectory().heldBy(`  ${named('4B').toLowerCase()} `, '2024-07-01')

      expect(held?.holderName).toBe(named('Grace'))
    })

    it('returns the tenure as calendar dates, with null meaning still held', async () => {
      // D2 and D3. Strings, not Dates: `pg` would hand back local midnight and
      // shift the day for anyone west of UTC.
      await givenAUnitSoldOn1July()

      const held = await createUnitDirectory().heldBy(named('4B'), '2024-07-01')

      expect(held).toEqual({
        holderName: named('Grace'),
        heldFrom: '2024-07-01',
        heldUntil: null,
      })
    })

    it('gives the outgoing tenure the sale date as its end', async () => {
      // The other half of the half-open contract, and the cross-check on the
      // boundary: the same date is one tenure's end and the other's start.
      await givenAUnitSoldOn1July()

      const held = await createUnitDirectory().heldBy(named('4B'), '2024-06-30')

      expect(held).toEqual({
        holderName: named('Ada'),
        heldFrom: '2024-01-01',
        heldUntil: '2024-07-01',
      })
    })
  })

  describe('the history of a unit', () => {
    it('returns every tenure, earliest first', async () => {
      // E5, behaviourally. The query-text test in the sibling file proves the
      // order was asked for; this proves it is real. Neither is sufficient
      // alone -- the queue adapter found that a missing order clause was caught
      // by a behavioural test in only two runs of three.
      await givenAUnitSoldOn1July()

      const history = await createUnitDirectory().historyFor(named('4B'))

      expect(history).toEqual([
        { holderName: named('Ada'), heldFrom: '2024-01-01', heldUntil: '2024-07-01' },
        { holderName: named('Grace'), heldFrom: '2024-07-01', heldUntil: null },
      ])
    })

    it('returns nothing for a unit nobody has held', async () => {
      // E4.
      await writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', [named('9Z')])

      expect(await createUnitDirectory().historyFor(named('9Z'))).toEqual([])
    })

    it('returns nothing for a unit that does not exist', async () => {
      expect(await createUnitDirectory().historyFor(named('nosuchunit'))).toEqual([])
    })

    it('does not return another unit\'s memberships', async () => {
      // Beside the case above: a query that lost its `unit_id` filter would
      // return every membership in the association and still look ordered and
      // well-formed.
      await givenAUnitSoldOn1July()
      await writer.query('insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\')', [named('5B')])

      expect(await createUnitDirectory().historyFor(named('5B'))).toEqual([])
    })
  })
})
