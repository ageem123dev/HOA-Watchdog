/**
 * Migration 012: who holds a unit, and when.
 *
 * The story exists for one assertion in here: two memberships for one unit
 * cannot overlap, and the *database* is what refuses them. AC3 says so in as
 * many words -- "rejected by the database, not by application code" -- so the
 * test that matters inserts a real overlap and reads the SQLSTATE back.
 *
 * Comments are stripped before matching the migration text, because stories
 * 1.6a and 1.6c each shipped a test that matched the migration's own
 * explanation rather than its SQL, and task 1 of this story shipped two that
 * matched an index's *name* rather than the column it indexed.
 */

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  unit membership migration tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

const CHECK_VIOLATION = '23514'
const NOT_NULL_VIOLATION = '23502'
const FOREIGN_KEY_VIOLATION = '23503'
const EXCLUSION_VIOLATION = '23P01'
const INSUFFICIENT_PRIVILEGE = '42501'

/**
 * Every unit, holder and membership this file creates carries this prefix, and
 * its cleanup deletes only rows carrying it.
 *
 * Vitest runs test files in parallel, and this file writes to `unit` -- the same
 * table `unit.test.ts` owns. Both first cleaned up with `like '%-%'`, which
 * matches anything containing a dash, so each deleted the other's rows mid-run.
 * See the longer note in `unit.test.ts`; the mechanism was proved, not guessed.
 */
const RUN_PREFIX = `m${randomBytes(4).toString('hex')}`

const MIGRATION = readFileSync(join(__dirname, '012_unit_membership.sql'), 'utf8')

/** The statements only -- see the header. */
const executable = (sql: string) =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

describe('the migration says what it does', () => {
  it('creates both tables', () => {
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/create\s+table\s+unit_holder\s*\(/i)
    expect(sql).toMatch(/create\s+table\s+unit_membership\s*\(/i)
  })

  it('creates btree_gist, which the exclusion constraint cannot work without', () => {
    // C9. `exclude using gist` needs btree_gist to use `=` on a uuid. It must be
    // the migration runner that creates it: watchdog_writer gets
    // `42501 permission denied to create extension`. Verified against the live
    // database while writing this story.
    expect(executable(MIGRATION)).toMatch(/create\s+extension\s+if\s+not\s+exists\s+btree_gist/i)
  })

  it('excludes overlaps per unit, naming both columns', () => {
    // C1 and C2 together. Matched on both operators, because an exclusion on
    // `held_during` alone passes every overlap test in this file and makes it
    // impossible for two different units to be held over the same dates -- which
    // is every association.
    expect(executable(MIGRATION)).toMatch(
      /exclude\s+using\s+gist\s*\(\s*unit_id\s+with\s+=\s*,\s*held_during\s+with\s+&&\s*\)/i,
    )
  })

  it('does not make a holder name unique', () => {
    // B4. The association's second John Smith must be recordable. A unique name
    // would silently hand the first one the second one's unit.
    expect(executable(MIGRATION)).not.toMatch(/unique[^;]*\bfull_name\b/i)
    expect(executable(MIGRATION)).not.toMatch(/\bfull_name\b[^;]*unique/i)
  })

  it('grants select on both tables to watchdog_reader', () => {
    const sql = executable(MIGRATION)

    expect(sql).toMatch(/grant\s+select\s+on\s+unit_holder\s+to\s+watchdog_reader/i)
    expect(sql).toMatch(/grant\s+select\s+on\s+unit_membership\s+to\s+watchdog_reader/i)
  })

  it('grants the reader nothing that writes', () => {
    expect(executable(MIGRATION)).not.toMatch(
      /grant\s+[^;]*\b(insert|update|delete|truncate|all)\b[^;]*\bto\s+watchdog_reader/i,
    )
  })

  it('strips comments without eating statements', () => {
    // The control for the instrument, as in unit.test.ts.
    const sample = ['-- create table decoy (', 'create table unit_membership (', '  id uuid'].join(
      '\n',
    )

    expect(executable(sample)).toMatch(/create\s+table\s+unit_membership\s*\(/i)
    expect(executable(sample)).not.toMatch(/decoy/i)
  })
})

describeWithDatabase('who holds a unit, and when', () => {
  let writer: Client
  let rival: Client
  let reader: Client
  let scope = ''

  const named = (suffix: string) => `${RUN_PREFIX}-${scope}-${suffix}`

  /** A unit and a holder to hang memberships on, both scoped to this test. */
  const givenUnitAndHolder = async () => {
    const unit = await writer.query<{ id: string }>(
      'insert into unit (unit_number) values ($1) returning id',
      [named('4B')],
    )
    const holder = await writer.query<{ id: string }>(
      'insert into unit_holder (full_name) values ($1) returning id',
      [named('Ada Lovelace')],
    )
    return { unitId: unit.rows[0]!.id, holderId: holder.rows[0]!.id }
  }

  const heldFromOn = (
    client: Client,
    unitId: string,
    holderId: string,
    from: string | null,
    to: string | null,
  ) =>
    client.query(
      'insert into unit_membership (unit_id, holder_id, held_during) values ($1, $2, daterange($3::date, $4::date))',
      [unitId, holderId, from, to],
    )

  const heldFrom = (unitId: string, holderId: string, from: string | null, to: string | null) =>
    heldFromOn(writer, unitId, holderId, from, to)

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    // A second connection, for the concurrency tests at the end of this file.
    // Two statements on one client are serialised by the client itself, so a
    // single connection cannot demonstrate anything about two writers at once.
    rival = new Client({ connectionString: writerUrl })
    reader = new Client({ connectionString: readerUrl })
    await writer.connect()
    await rival.connect()
    await reader.connect()
  })

  beforeEach(() => {
    // Per test, not per run -- the queue adapter's suite scoped per run and its
    // tests promptly stopped being independent.
    scope = randomBytes(4).toString('hex')
  })

  afterAll(async () => {
    // Children first: unit_membership references both of the others.
    await writer.query(
      'delete from unit_membership where unit_id in (select id from unit where unit_number like $1)',
      [`${RUN_PREFIX}-%`],
    )
    await writer.query('delete from unit_holder where full_name like $1', [`${RUN_PREFIX}-%`])
    await writer.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}-%`])
    await writer.end()
    await rival.end()
    await reader.end()
  })

  describe('the holder', () => {
    it('stores a name and reads it back unchanged', async () => {
      await writer.query('insert into unit_holder (full_name) values ($1)', [named('Ada Lovelace')])

      const { rows } = await writer.query<{ full_name: string }>(
        'select full_name from unit_holder where full_name = $1',
        [named('Ada Lovelace')],
      )
      expect(rows[0]?.full_name).toBe(named('Ada Lovelace'))
    })

    it('records two different people who share a name', async () => {
      // B4, and the one place in this migration where the obvious constraint is
      // the bug. Two rows, both retrievable, no rejection.
      await writer.query('insert into unit_holder (full_name) values ($1)', [named('John Smith')])
      await writer.query('insert into unit_holder (full_name) values ($1)', [named('John Smith')])

      const { rows } = await writer.query<{ n: string }>(
        'select count(*)::text n from unit_holder where full_name = $1',
        [named('John Smith')],
      )
      expect(rows[0]?.n).toBe('2')
    })

    it('refuses a blank name', async () => {
      // B2, measured the way migration 009 measures and 006 did not.
      await expect(
        writer.query('insert into unit_holder (full_name) values ($1)', ['   ']),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('refuses a name that is only padding around one character', async () => {
      await expect(
        writer.query('insert into unit_holder (full_name) values ($1)', [`x${' '.repeat(300)}`]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('refuses an oversized name', async () => {
      // B3.
      await expect(
        writer.query('insert into unit_holder (full_name) values ($1)', ['A'.repeat(201)]),
      ).rejects.toMatchObject({ code: CHECK_VIOLATION })
    })

    it('lets watchdog_reader read it but not write it', async () => {
      // B5 and B6.
      await writer.query('insert into unit_holder (full_name) values ($1)', [named('Grace Hopper')])

      const { rows } = await reader.query<{ full_name: string }>(
        'select full_name from unit_holder where full_name = $1',
        [named('Grace Hopper')],
      )
      expect(rows[0]?.full_name).toBe(named('Grace Hopper'))

      await expect(
        reader.query('insert into unit_holder (full_name) values ($1)', [named('Nobody')]),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })
  })

  describe('the membership', () => {
    it('records who held a unit over a period', async () => {
      const { unitId, holderId } = await givenUnitAndHolder()

      await heldFrom(unitId, holderId, '2024-01-01', '2024-07-01')

      const { rows } = await writer.query<{ held_during: string }>(
        'select held_during::text from unit_membership where unit_id = $1',
        [unitId],
      )
      expect(rows[0]?.held_during).toBe('[2024-01-01,2024-07-01)')
    })

    it('refuses two overlapping memberships for one unit', async () => {
      // C1, the assertion this story exists for.
      const { unitId, holderId } = await givenUnitAndHolder()
      await heldFrom(unitId, holderId, '2024-01-01', '2024-07-01')

      await expect(heldFrom(unitId, holderId, '2024-06-01', '2024-12-01')).rejects.toMatchObject({
        code: EXCLUSION_VIOLATION,
      })
    })

    it('refuses two open-ended memberships for one unit', async () => {
      // C4. The likeliest real data-entry error: a sale recorded without closing
      // the previous membership. Two unbounded uppers overlap from the later
      // start date onwards -- verified before this test was written.
      const { unitId, holderId } = await givenUnitAndHolder()
      await heldFrom(unitId, holderId, '2024-01-01', null)

      await expect(heldFrom(unitId, holderId, '2024-07-01', null)).rejects.toMatchObject({
        code: EXCLUSION_VIOLATION,
      })
    })

    it('accepts adjacent memberships that meet on the day of sale', async () => {
      // C3. Sold on 1 July: one membership ends and the next begins that day,
      // with no overlap and no gap. Half-open ranges are what make this
      // expressible; an inclusive upper bound would collide here.
      const { unitId, holderId } = await givenUnitAndHolder()
      await heldFrom(unitId, holderId, '2024-01-01', '2024-07-01')
      await heldFrom(unitId, holderId, '2024-07-01', null)

      const { rows } = await writer.query<{ n: string }>(
        'select count(*)::text n from unit_membership where unit_id = $1',
        [unitId],
      )
      expect(rows[0]?.n).toBe('2')
    })

    it('accepts overlapping memberships on two different units', async () => {
      // C2, the beside-case. An exclusion on `held_during` alone passes every
      // test above and makes this impossible -- which is every association with
      // more than one unit.
      const first = await givenUnitAndHolder()
      const second = await writer.query<{ id: string }>(
        'insert into unit (unit_number) values ($1) returning id',
        [named('5B')],
      )

      await heldFrom(first.unitId, first.holderId, '2024-01-01', '2024-12-01')
      await heldFrom(second.rows[0]!.id, first.holderId, '2024-01-01', '2024-12-01')

      const { rows } = await writer.query<{ n: string }>(
        'select count(*)::text n from unit_membership where unit_id in ($1, $2)',
        [first.unitId, second.rows[0]!.id],
      )
      expect(rows[0]?.n).toBe('2')
    })

    it('refuses a membership covering no dates', async () => {
      // C5. `[d,d)` is an empty range, not a one-day one -- verified.
      const { unitId, holderId } = await givenUnitAndHolder()

      await expect(heldFrom(unitId, holderId, '2024-01-01', '2024-01-01')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      })
    })

    it('refuses a membership with no start date', async () => {
      // C6. The surviving half of a half-open check that would otherwise never
      // fire: Postgres canonicalises daterange to `[)` before any check runs, so
      // asserting `not upper_inc` proves nothing. An unbounded *lower* is the one
      // case that can actually arrive.
      const { unitId, holderId } = await givenUnitAndHolder()

      await expect(heldFrom(unitId, holderId, null, '2024-07-01')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
      })
    })

    it('refuses a membership with no period at all', async () => {
      // C8.
      const { unitId, holderId } = await givenUnitAndHolder()

      await expect(
        writer.query(
          'insert into unit_membership (unit_id, holder_id, held_during) values ($1, $2, null)',
          [unitId, holderId],
        ),
      ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION })
    })

    it('refuses a membership for a unit that does not exist', async () => {
      // C7, first half. Asserted separately from the holder key below: one test
      // covering "a bad reference" would pass with either key missing.
      const { holderId } = await givenUnitAndHolder()

      await expect(
        heldFrom('00000000-0000-0000-0000-000000000000', holderId, '2024-01-01', '2024-07-01'),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })
    })

    it('refuses a membership for a holder that does not exist', async () => {
      // C7, second half.
      const { unitId } = await givenUnitAndHolder()

      await expect(
        heldFrom(unitId, '00000000-0000-0000-0000-000000000000', '2024-01-01', '2024-07-01'),
      ).rejects.toMatchObject({ code: FOREIGN_KEY_VIOLATION })
    })

    it('lets watchdog_reader read it but not write it', async () => {
      // C10.
      const { unitId, holderId } = await givenUnitAndHolder()
      await heldFrom(unitId, holderId, '2024-01-01', '2024-07-01')

      const { rows } = await reader.query<{ n: string }>(
        'select count(*)::text n from unit_membership where unit_id = $1',
        [unitId],
      )
      expect(rows[0]?.n).toBe('1')

      await expect(
        reader.query(
          'insert into unit_membership (unit_id, holder_id, held_during) values ($1, $2, daterange($3::date, null))',
          [unitId, holderId, '2025-01-01'],
        ),
      ).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE })
    })

    it('carries the exclusion constraint itself, naming both columns', async () => {
      // Cross-check. The overlap rejection above proves *a* constraint fired;
      // this proves it is the one this migration claims. Matched on
      // pg_get_constraintdef -- the constraint's definition -- and not on its
      // name, because task 1 shipped two assertions that matched an index's name
      // and stayed green with the index on the wrong column.
      const { rows } = await writer.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def
           from pg_constraint
          where conrelid = 'unit_membership'::regclass and contype = 'x'`,
      )

      expect(rows.map((r) => r.def).join('\n')).toMatch(
        /exclude using gist \(unit_id with =, held_during with &&\)/i,
      )
    })

    it('still refuses an overlap inside a transaction, and a savepoint leaves it usable', async () => {
      // C11's companion, and the finding this story verified before claiming it:
      // a constraint violation aborts the enclosing transaction, so the next
      // statement fails with 25P02 and a test reports the wrong cause. The write
      // path story 2.4 will build has to know this. Proved here rather than
      // asserted in prose.
      const { unitId, holderId } = await givenUnitAndHolder()
      await heldFrom(unitId, holderId, '2024-01-01', '2024-07-01')

      await writer.query('begin')
      try {
        await writer.query('savepoint attempt')
        await expect(heldFrom(unitId, holderId, '2024-06-01', '2024-12-01')).rejects.toMatchObject({
          code: EXCLUSION_VIOLATION,
        })
        await writer.query('rollback to savepoint attempt')

        // The transaction survived: this query runs rather than raising 25P02.
        const { rows } = await writer.query<{ n: string }>(
          'select count(*)::text n from unit_membership where unit_id = $1',
          [unitId],
        )
        expect(rows[0]?.n).toBe('1')
      } finally {
        await writer.query('rollback')
      }
    })
  })

  describe('two writers at once', () => {
    /**
     * Whether a promise is still pending after `ms`.
     *
     * This is the evidence, not decoration. A concurrency test that merely
     * observes "one of them failed" would pass against a database that
     * serialised the two inserts completely, and against one that never
     * overlapped them at all -- which is how story 1.5d shipped a `Promise.all`
     * concurrency test that passed against a deliberately racy implementation.
     * Asserting the second insert is *blocked while the first is uncommitted*
     * is what distinguishes a real lock from a lucky ordering.
     */
    const stillPending = async (promise: Promise<unknown>, ms: number) => {
      const marker = Symbol('pending')
      // The timer is cleared on the way out. `Promise.race` settles as soon as
      // either side does, but it does not cancel the loser -- so the beside-case
      // below, where the insert returns in milliseconds, would otherwise leave a
      // 750ms handle alive after the assertion has already been made. Raised by
      // review; no regression test accompanies it because the only observable is
      // a live handle inside Node, and reaching for `process._getActiveHandles()`
      // to assert it would test the runtime rather than this file.
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const raced = await Promise.race([
          promise.then(
            () => 'resolved',
            () => 'rejected',
          ),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(marker), ms)
          }),
        ])
        return raced === marker
      } finally {
        clearTimeout(timer)
      }
    }

    it('makes the second of two concurrent overlapping writers wait, then refuses it', async () => {
      // AC3's real claim: rejected *by the database*, not by application code.
      // An application-level "check then insert" passes every other test in this
      // file and fails exactly here -- both writers would read an empty table,
      // both would find no overlap, and both would insert.
      const { unitId, holderId } = await givenUnitAndHolder()

      await writer.query('begin')
      await rival.query('begin')
      try {
        await heldFrom(unitId, holderId, '2024-01-01', '2024-07-01')

        // Issued while the first is still uncommitted. The gist index the
        // exclusion constraint builds is what makes this block rather than
        // succeed.
        const contended = heldFromOn(rival, unitId, holderId, '2024-06-01', '2024-12-01').then(
          () => 'inserted' as const,
          (error: { code?: string }) => error,
        )

        expect(await stillPending(contended, 750)).toBe(true)

        await writer.query('commit')

        expect(await contended).toMatchObject({ code: EXCLUSION_VIOLATION })
      } finally {
        await writer.query('rollback').catch(() => undefined)
        await rival.query('rollback').catch(() => undefined)
      }
    })

    it('lets two concurrent writers on different units through without waiting', async () => {
      // The beside-case, and the one that stops the test above from being
      // satisfied by a constraint that serialises every membership in the
      // association. If the exclusion were not scoped by `unit_id`, this insert
      // would block on the other unit's uncommitted row exactly as the one above
      // does -- so `stillPending` must come back false here for the same reason
      // it must come back true there.
      const first = await givenUnitAndHolder()
      const second = await writer.query<{ id: string }>(
        'insert into unit (unit_number) values ($1) returning id',
        [named('5B')],
      )

      await writer.query('begin')
      await rival.query('begin')
      try {
        await heldFrom(first.unitId, first.holderId, '2024-01-01', '2024-12-01')

        const other = heldFromOn(
          rival,
          second.rows[0]!.id,
          first.holderId,
          '2024-01-01',
          '2024-12-01',
        ).then(
          () => 'inserted' as const,
          (error: { code?: string }) => error,
        )

        expect(await stillPending(other, 750)).toBe(false)
        expect(await other).toBe('inserted')
      } finally {
        await writer.query('rollback').catch(() => undefined)
        await rival.query('rollback').catch(() => undefined)
      }
    })
  })
})
