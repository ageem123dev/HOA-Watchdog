/**
 * AC4 — the story's real proof: a catalog query answers for one association and
 * returns none of another's rows.
 *
 * ## The vacuity this file is built to avoid
 *
 * A test that seeds association A, queries as A and finds A's rows passes
 * whether or not the predicate exists — A's rows are all there is. So B gets
 * records **in the same tables, under the same unit number, for the same year**,
 * and the assertion is that A's answer excludes them. Delete
 * `assessment.association_id = $1` from `dues_status@1` and this file goes red:
 * the query matches both boards' assessments and returns two rows.
 *
 * The same unit number in two associations is only representable since migration
 * 025 made the identity key `(association_id, normalised_number)`. Under the
 * global index this file could not have been written, which is why task 5 ran
 * before task 4.
 *
 * ## The figures
 *
 * A owes 4800 and has paid 1750. B owes 3300 and has paid 900. No figure of A's
 * equals or divides a figure of B's, so an answer that has mixed the two, or
 * taken the wrong board's, cannot come out looking right by coincidence.
 *
 * Requires a database and skips without one.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createCatalogExecutor } from './catalog-executor-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && readerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  catalog isolation tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL, ' +
      'WATCHDOG_READER_DATABASE_URL and DATABASE_URL must all be set.\n',
  )
}

const RUN_PREFIX = `x${randomBytes(4).toString('hex')}`

interface Board {
  associationId: string
  actorId: string
}

describeWithDatabase('a catalog query, with two associations in the database', () => {
  const writer = new Client({ connectionString: writerUrl })
  const owner = new Client({ connectionString: adminUrl })
  const executor = createCatalogExecutor()

  /** The same number on both boards' rolls. That is the whole point. */
  const unitNumber = `${RUN_PREFIX}-4B`

  /** Undefined until `beforeAll` assigns them; the teardown must not assume otherwise. */
  let a: Board | undefined
  let b: Board | undefined

  /**
   * One association with a unit, an assessment and its payments — the smallest
   * complete shape `dues_status@1` reads.
   */
  async function seedBoard(label: string, owed: string, payments: string[]): Promise<Board> {
    const association = await writer.query<{ id: string }>(
      'insert into association (name) values ($1) returning id',
      [`${RUN_PREFIX}-${label}`],
    )
    const associationId = association.rows[0]!.id

    const member = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id)
            values ($1, 'scrypt$1$1$1$x$y', $2) returning id`,
      [`${RUN_PREFIX}-${label}@example.com`, associationId],
    )
    const actorId = member.rows[0]!.id

    const unit = await writer.query<{ id: string }>(
      'insert into unit (unit_number, association_id) values ($1, $2) returning id',
      [unitNumber, associationId],
    )
    const unitId = unit.rows[0]!.id

    await writer.query(
      `insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle, association_id)
            values ($1, 2026, $2, 'six_monthly', $3)`,
      [unitId, owed, associationId],
    )

    // `payment.document_id` is NOT NULL, and `content_hash` must satisfy
    // `document_content_hash_is_sha256`.
    const document = await writer.query<{ id: string }>(
      `insert into document
         (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id)
       values ($1, $2, 'deposits.csv', 'text/csv', 512, $3, $4) returning id`,
      [randomBytes(32).toString('hex'), `${RUN_PREFIX}/${label}/deposits.csv`, actorId, associationId],
    )
    const documentId = document.rows[0]!.id

    for (const amount of payments) {
      await writer.query(
        `insert into payment (unit_id, document_id, paid_on, amount, association_id)
              values ($1, $2, '2026-03-02', $3, $4)`,
        [unitId, documentId, amount, associationId],
      )
    }

    return { associationId, actorId }
  }

  beforeAll(async () => {
    await writer.connect()
    await owner.connect()

    a = await seedBoard('a', '4800.00', ['900.00', '500.00', '350.00'])
    b = await seedBoard('b', '3300.00', ['900.00'])
  })

  afterAll(async () => {
    // Children before parents, and `query_log` needs the owner: migration 020
    // revokes DELETE on it from the writer.
    // Optional access, because `a` and `b` are only assigned if `beforeAll` got
    // that far. Reading `a!.actorId` on a partial setup throws a `TypeError`
    // here, and vitest then reports *that* instead of the seed failure that
    // caused it — the original error, which is the one worth reading, is lost.
    const actors = [a?.actorId, b?.actorId].filter(Boolean)
    if (actors.length > 0) {
      await owner.query('delete from query_log where actor_id = any($1::uuid[])', [actors])
    }
    await writer.query('delete from payment where unit_id in (select id from unit where unit_number = $1)', [unitNumber])
    await writer.query('delete from assessment where unit_id in (select id from unit where unit_number = $1)', [unitNumber])
    await writer.query('delete from unit where unit_number = $1', [unitNumber])
    await writer.query('delete from document where storage_key like $1', [`${RUN_PREFIX}/%`])
    await owner.query('delete from board_member where email like $1', [`${RUN_PREFIX}-%`])
    await owner.query('delete from association where name like $1', [`${RUN_PREFIX}-%`])
    await writer.end()
    await owner.end()
  })

  const ask = (actorId: string) =>
    executor.execute({
      entryId: 'dues_status',
      version: 1,
      parameters: { unitNumber, assessmentYear: 2026 },
      actorId,
    })

  it('has genuinely put the same unit number on both boards', async () => {
    // Guards the guard. If this seed silently failed, every assertion below
    // would pass by there being nothing to leak.
    const { rows } = await writer.query<{ n: number }>(
      'select count(*)::int as n from unit where unit_number = $1',
      [unitNumber],
    )

    expect(rows[0]!.n).toBe(2)
  })

  it("answers association A with A's figures and nobody else's", async () => {
    const { rows } = await ask(a!.actorId)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      annualAmount: '4800.00',
      amountPaid: '1750.00',
      balanceOutstanding: '3050.00',
      paymentCount: '3',
    })
  })

  it("answers association B with B's figures and nobody else's", async () => {
    const { rows } = await ask(b!.actorId)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      annualAmount: '3300.00',
      amountPaid: '900.00',
      balanceOutstanding: '2400.00',
      paymentCount: '1',
    })
  })

  /**
   * Stated as its own assertion because it is the sentence the story makes:
   * the two boards ask the identical question and get different answers, and
   * neither can see the other's ledger.
   */
  it('gives the two boards different answers to the identical question', async () => {
    const [first, second] = await Promise.all([ask(a!.actorId), ask(b!.actorId)])

    expect(first.rows).toHaveLength(1)
    expect(second.rows).toHaveLength(1)
    expect(first.rows[0]!.annualAmount).not.toBe(second.rows[0]!.annualAmount)
    expect(first.rows[0]!.amountPaid).not.toBe(second.rows[0]!.amountPaid)
  })

  /**
   * The association is derived from the actor, so "asking as somebody else" is
   * the only lever a caller has — and it moves them to *that* board's records,
   * never to a mixture. There is no request field that widens the answer.
   */
  it('records each execution against the association it answered for', async () => {
    const { provenanceId } = await ask(a!.actorId)

    const { rows } = await writer.query<{ association_id: string }>(
      'select association_id from query_log where id = $1',
      [provenanceId],
    )

    expect(rows[0]!.association_id).toBe(a!.associationId)
  })
})
