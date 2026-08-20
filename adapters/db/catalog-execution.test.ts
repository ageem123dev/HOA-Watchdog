/**
 * `dues_status@1` end to end, against the real database.
 *
 * Story 2.7's first learning, applied here: "a green unit test proves a part
 * works; only a test that runs the path proves the parts are connected." Three
 * epic-2 stories were written because something built correctly was called by
 * nothing. This file is what stops story 3.1 becoming the fourth.
 *
 * A fake pool cannot answer for any of the four things that matter here —
 * `unit_normalised_number()` folding `4b ` to `4B`, `numeric` arriving as a
 * decimal string rather than a float, the reader role actually holding SELECT on
 * all three tables, and the provenance row landing under a different role on a
 * different connection.
 *
 * **The ordering assertion is not here.** If the provenance write fails, logging
 * first and logging last are indistinguishable from outside — both reject, both
 * return nothing. `catalog-executor-postgres.test.ts` watches the query runner
 * to tell them apart; this file proves the wiring is real.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { duesStatusV1 } from '../../catalog/entries/dues-status-v1'
import { createCatalogExecutor } from './catalog-executor-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  catalog execution tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and ' +
      'WATCHDOG_READER_DATABASE_URL must both be set.\n',
  )
}

/**
 * `unit`, `assessment` and `payment` are the tables every epic-2 database test
 * seeds into, and `unit.test.ts` records the run where two files deleted each
 * other's rows.
 *
 * Lower-case and starting with a letter, because this prefix also has to satisfy
 * `query_log_entry_id_shaped` when it is used to find this run's log rows.
 */
const RUN_PREFIX = `c${randomBytes(4).toString('hex')}`

/**
 * A `date` column as the calendar date it is, rather than as an instant.
 *
 * `pg` turns `paid_on` into a JS `Date` at **local** midnight, so asserting
 * against `new Date('2026-07-11T00:00:00.000Z')` passes only in UTC and fails by
 * the offset everywhere else. The first draft did exactly that and failed by
 * five hours. A `date` has no time and no zone; comparing the calendar day is
 * comparing what the column actually holds.
 */
function asCalendarDate(value: unknown): string | null {
  if (!(value instanceof Date)) return null

  const pad = (n: number) => String(n).padStart(2, '0')

  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

describeWithDatabase('running dues_status@1', () => {
  let writer: Client
  let owner: Client | null = null
  let actorId = ''
  let unitNumber = ''

  const executor = createCatalogExecutor()

  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()

    if (adminUrl) {
      owner = new Client({ connectionString: adminUrl })
      await owner.connect()
    }

    const member = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$1$1$1$x$y', '00000000-0000-7000-8000-000000000001') returning id`,
      [`${RUN_PREFIX}@example.com`],
    )
    actorId = member.rows[0]!.id

    // The figures are chosen to discriminate, per story 2.7's third learning.
    // 4800 owed, 1750 paid, 3050 outstanding: no two of the three are equal, and
    // none of them is a multiple of another, so a query returning the wrong one
    // of the three cannot pass by coincidence. Three payments, not one, so
    // `paymentCount` and `lastPaidOn` mean something — and the largest payment
    // is not the latest, so a `max(amount)` written where `max(paid_on)` was
    // meant would be visible.
    unitNumber = `${RUN_PREFIX}-4B`
    const unit = await writer.query<{ id: string }>(
      'insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
      [unitNumber],
    )
    const unitId = unit.rows[0]!.id

    await writer.query(
      `insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle, association_id) values ($1, 2026, '4800.00', 'six_monthly', '00000000-0000-7000-8000-000000000001')`,
      [unitId],
    )

    // `payment.document_id` is NOT NULL, so a payment needs a document to hang
    // off. The columns and the seeding shape are `payment-repository-postgres.test.ts`'s;
    // `content_hash` must satisfy `document_content_hash_is_sha256`.
    const contentHash = randomBytes(32).toString('hex')
    const document = await writer.query<{ id: string }>(
      `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id) values ($1, $2, 'deposits.csv', 'text/csv', 512, $3, '00000000-0000-7000-8000-000000000001')
       returning id`,
      [contentHash, `${RUN_PREFIX}/deposits.csv`, actorId],
    )
    const documentId = document.rows[0]!.id

    for (const [paidOn, amount] of [
      ['2026-01-15', '900.00'],
      ['2026-03-02', '500.00'],
      ['2026-07-11', '350.00'],
    ] as const) {
      await writer.query(
        'insert into payment (unit_id, document_id, paid_on, amount, association_id) values ($1, $2, $3, $4, \'00000000-0000-7000-8000-000000000001\')',
        [unitId, documentId, paidOn, amount],
      )
    }

    // A payment in the next year, against the same unit. It must not be counted:
    // the entry attributes a payment to the year its `paid_on` falls in, and
    // without this row a query missing the year filter entirely would pass.
    await writer.query(
      'insert into payment (unit_id, document_id, paid_on, amount, association_id) values ($1, $2, $3, $4, \'00000000-0000-7000-8000-000000000001\')',
      [unitId, documentId, '2027-01-09', '2000.00'],
    )
  })

  afterAll(async () => {
    if (owner) {
      // Scoped to this run's actor, not to the entry id. `entry_id =
      // 'dues_status'` would delete every provenance row that entry has ever
      // produced — a concurrent run's, another developer's, and on any database
      // holding real history, the audit trail itself. Cleanup that can destroy
      // the thing under test is the same defect this file's subject exists to
      // prevent, and it was written here before it was noticed.
      await owner.query('delete from query_log where actor_id = $1', [actorId])
      await owner.query('delete from payment where unit_id in (select id from unit where unit_number like $1)', [`${RUN_PREFIX}%`])
      await owner.query('delete from assessment where unit_id in (select id from unit where unit_number like $1)', [`${RUN_PREFIX}%`])
      await owner.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}%`])
      await owner.query('delete from document where storage_key like $1', [`${RUN_PREFIX}%`])
      await owner.query('delete from board_member where email like $1', [`${RUN_PREFIX}%`])
      await owner.end()
    }
    await writer?.end()
  })

  describe('the answer', () => {
    it('returns the annual amount, what arrived, and the balance it derives', async () => {
      const execution = await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: { unitNumber, assessmentYear: 2026 },
        actorId,
      })

      expect(execution.rows).toHaveLength(1)

      const { lastPaidOn, ...figures } = execution.rows[0]!
      expect(figures).toEqual({
        unitNumber,
        assessmentYear: 2026,
        annualAmount: '4800.00',
        amountPaid: '1750.00',
        balanceOutstanding: '3050.00',
        paymentCount: '3',
      })
      expect(asCalendarDate(lastPaidOn)).toBe('2026-07-11')
    })

    /**
     * AD-6, as an assertion rather than as a claim. The balance is arithmetic
     * the reasoning model is structurally forbidden from performing (AD-7), so
     * an entry that returned only the two operands would make the honest answer
     * unreachable.
     */
    it('derives the balance in SQL rather than leaving it to be subtracted', async () => {
      expect(duesStatusV1.sql).toMatch(/annual_amount\s*-\s*coalesce\(sum\(payment\.amount\)/)
    })

    /**
     * AC8. `pg` maps `numeric` to a decimal string; a `::float8` anywhere on this
     * path would turn 4800.00 into 4800 and lose 0.10 entirely. Asserted as a
     * type check because the equality above would still pass for `4800` against
     * a loosely written expectation.
     */
    it('carries every amount as a decimal string, never a number', async () => {
      const execution = await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: { unitNumber, assessmentYear: 2026 },
        actorId,
      })

      const row = execution.rows[0]!
      for (const field of ['annualAmount', 'amountPaid', 'balanceOutstanding'] as const) {
        expect(typeof row[field], `${field} crossed the boundary as a ${typeof row[field]}`).toBe(
          'string',
        )
      }
    })

    it('matches the unit as a treasurer would type it', async () => {
      const execution = await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: { unitNumber: `${unitNumber.toLowerCase()}  `, assessmentYear: 2026 },
        actorId,
      })

      expect(execution.rows[0]).toMatchObject({ unitNumber, annualAmount: '4800.00' })
    })

    /**
     * A unit that has paid nothing reads `0.00`, not a missing row and not a
     * `null`. The left join is what produces the row at all, and `count(payment.id)`
     * rather than `count(*)` is what stops it claiming one payment was made:
     * `count(*)` counts the join's own row and would return 1.
     */
    it('answers for a unit that has paid nothing', async () => {
      const bare = `${RUN_PREFIX}-9Z`
      const unit = await writer.query<{ id: string }>(
        'insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
        [bare],
      )
      await writer.query(
        `insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle, association_id) values ($1, 2026, '600.00', 'annual', '00000000-0000-7000-8000-000000000001')`,
        [unit.rows[0]!.id],
      )

      const execution = await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: { unitNumber: bare, assessmentYear: 2026 },
        actorId,
      })

      expect(execution.rows[0]).toEqual({
        unitNumber: bare,
        assessmentYear: 2026,
        annualAmount: '600.00',
        amountPaid: '0.00',
        balanceOutstanding: '600.00',
        paymentCount: '0',
        lastPaidOn: null,
      })
    })

    it('returns no rows for a unit and year with no assessment', async () => {
      const execution = await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: { unitNumber, assessmentYear: 1999 },
        actorId,
      })

      expect(execution.rows).toEqual([])
    })
  })

  describe('the provenance record it leaves', () => {
    it('writes one row naming the entry, the version, the parameters and the SQL', async () => {
      const parameters = { unitNumber, assessmentYear: 2026 }
      const execution = await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters,
        actorId,
      })

      const { rows } = await writer.query(
        `select actor_id, entry_id, entry_version, parameters, sql_text
           from query_log where id = $1`,
        [execution.provenanceId],
      )

      expect(rows).toHaveLength(1)
      expect(rows[0]).toEqual({
        actor_id: actorId,
        entry_id: 'dues_status',
        entry_version: 1,
        parameters,
        sql_text: duesStatusV1.sql,
      })
    })

    /**
     * The SQL in the trail has to be the SQL that ran, character for character —
     * AD-14's "the pair must always resolve to exactly one SQL text, forever"
     * is worth nothing if the recorded text is a normalised or truncated copy.
     */
    it('records the SQL text exactly, not a normalised copy of it', async () => {
      const execution = await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: { unitNumber, assessmentYear: 2026 },
        actorId,
      })

      const { rows } = await writer.query<{ sql_text: string }>(
        'select sql_text from query_log where id = $1',
        [execution.provenanceId],
      )

      expect(rows[0]!.sql_text).toBe(duesStatusV1.sql)
      expect(rows[0]!.sql_text).toContain('unit_normalised_number($2)')
    })

    it('records one row per execution, not one per entry', async () => {
      const before = await countLogRows()
      await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: { unitNumber, assessmentYear: 2026 },
        actorId,
      })
      await executor.execute({
        entryId: 'dues_status',
        version: 1,
        parameters: { unitNumber, assessmentYear: 2026 },
        actorId,
      })

      expect(await countLogRows()).toBe(before + 2)
    })

    /**
     * A rejected request is not an execution. Nothing ran, so nothing is
     * recorded — and the caller is told which parameter was wrong, which is
     * information it can act on without the trail's help.
     */
    it('records nothing for a request the catalog refuses', async () => {
      const before = await countLogRows()

      await expect(
        executor.execute({
          entryId: 'dues_status',
          version: 1,
          parameters: { unitNumber, assessmentYear: '2026' },
          actorId,
        }),
      ).rejects.toThrow(/assessmentYear.*integer/i)

      expect(await countLogRows()).toBe(before)
    })
  })

  async function countLogRows(): Promise<number> {
    const { rows } = await writer.query<{ count: string }>(
      "select count(*) as count from query_log where entry_id = 'dues_status' and actor_id = $1",
      [actorId],
    )

    return Number(rows[0]!.count)
  }
})
