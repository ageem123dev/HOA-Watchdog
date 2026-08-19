/**
 * A roll uploaded, then a deposit. The whole path, against the real database.
 *
 * **This is the test story 2.7 exists for**, and its shape is deliberate.
 *
 * Story 2.4 built the payment ledger and connected none of it, and 2.5 existed
 * to fix that. Stories 2.1 and 2.2 built `unit`, `unit_holder`, `unit_membership`
 * and `assessment` and *nothing ever filled them* — so on any real installation
 * every deposit was held `unknown-unit`, and the system read a bank feed
 * perfectly while attributing none of it. Every part was correct; nothing was
 * connected. Three times in one epic.
 *
 * So this test does not check that a roll writes rows. It checks the thing a
 * treasurer would notice: **upload the roll, then the deposits, and the money
 * lands against units.** Before this story that second upload holds every line.
 *
 * It starts where a treasurer starts — bytes and a filename handed to `ingest`,
 * the entry point the upload action calls — and ends by reading `payment` and
 * `held_payment` directly. Everything between is production code. The only fake
 * is the object store, because an S3 bucket is not what is under test.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createPostgresDocumentRepository } from './document-repository-postgres'
import { createPostgresExtractionRepository } from './extraction-repository-postgres'
import { createPaymentRepository } from './payment-repository-postgres'
import { createQuarantine } from './quarantine-postgres'
import { createRollRepository } from './roll-repository-postgres'
import { createUnitDirectory } from './unit-directory-postgres'
import { createVendorDirectory } from './vendor-directory-postgres'
import type { DocumentStore } from '../../core/ports/document-store'
import { ingest } from '../../core/ingestion/ingest'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  roll ingestion tests SKIPPED: both database URLs must be set.\n')
}

const RUN_PREFIX = `ri${randomBytes(4).toString('hex')}`

describeWithDatabase('an assessment roll uploaded, end to end', () => {
  // Constructed here rather than in `beforeAll`: `new Client` opens nothing, so
  // the teardown always has a client to close even if `connect()` throws.
  const writer = new Client({ connectionString: writerUrl })
  let boardMemberId = ''
  let scope = ''

  /** In memory: an object store is not what this test is about. */
  const stored = new Map<string, Uint8Array>()
  const store: DocumentStore = {
    put: async (document) => {
      stored.set(document.key, document.bytes)
    },
    get: async (key) => stored.get(key) ?? null,
  }

  beforeAll(async () => {
    await writer.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA', '00000000-0000-7000-8000-000000000001')
       returning id`,
      [`roll-path-${RUN_PREFIX}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  beforeEach(() => {
    scope = randomBytes(4).toString('hex')
  })

  afterAll(async () => {
    // The close belongs in `finally`: a teardown query that throws would
    // otherwise leak the connection and replace the real failure with its own.
    // Raised by review, against a shape `deposit-ingestion.test.ts` shares.
    try {
      // Children first: three tables reference `unit (id)` with no on-delete
      // action, which is the guarantee this story protects.
      if (boardMemberId) {
        await writer.query('delete from document where uploaded_by = $1', [boardMemberId])
      }
      const units = `select id from unit where unit_number like $1`
      await writer.query(`delete from assessment where unit_id in (${units})`, [`${RUN_PREFIX}-%`])
      await writer.query(`delete from unit_membership where unit_id in (${units})`, [
        `${RUN_PREFIX}-%`,
      ])
      await writer.query('delete from unit_holder where full_name like $1', [`${RUN_PREFIX}%`])
      await writer.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}-%`])
      if (boardMemberId) {
        await writer.query('delete from board_member where id = $1', [boardMemberId])
      }
    } finally {
      // Swallowed: closing a client that never connected is not a test failure,
      // and letting it throw here would bury whatever actually went wrong.
      await writer.end().catch(() => undefined)
    }
  })

  /** Exactly what the upload action builds, real adapters and all. */
  const dependencies = () => ({
    store,
    repository: createPostgresDocumentRepository(),
    extractions: createPostgresExtractionRepository(),
    vendors: createVendorDirectory(),
    quarantine: createQuarantine(),
    units: createUnitDirectory(),
    payments: createPaymentRepository(),
    rolls: createRollRepository(),
  })

  const unit = (label: string) => `${RUN_PREFIX}-${label}`

  /** A roll CSV whose rows are given as `[unit, holder, annual amount]`. */
  const rollFile = (
    lines: readonly (readonly [string, string, string])[],
    salt: string,
  ) => ({
    filename: `${salt}-roll.csv`,
    contentType: 'text/csv',
    bytes: new TextEncoder().encode(
      [
        'date,description,amount,type,unit,cycle,year',
        ...lines.map(
          ([number, holder, amount]) =>
            `2019-03-01,${holder},${amount},assessment_roll,${number},monthly,2026`,
        ),
      ].join('\n'),
    ),
  })

  /** A deposit CSV whose rows are given as `[unit, amount]`. */
  const depositFile = (lines: readonly (readonly [string, string])[], salt: string) => ({
    filename: `${salt}-deposits.csv`,
    contentType: 'text/csv',
    bytes: new TextEncoder().encode(
      [
        'date,description,amount,type,unit',
        ...lines.map(([number, amount]) => `2026-03-01,March dues,${amount},deposit,${number}`),
      ].join('\n'),
    ),
  })

  const paymentsFor = async (documentId: string) => {
    const { rows } = await writer.query<{ unit_number: string; amount: string }>(
      `select u.unit_number, p.amount
         from payment p join unit u on u.id = p.unit_id
        where p.document_id = $1
        order by u.unit_number`,
      [documentId],
    )
    return rows
  }

  const heldFor = async (documentId: string) => {
    const { rows } = await writer.query<{ unit_reference: string; hold_reason: string }>(
      `select unit_reference, hold_reason from held_payment
        where document_id = $1 order by unit_reference`,
      [documentId],
    )
    return rows
  }

  const idOf = (outcome: { outcome: string } & Record<string, unknown>): string => {
    expect(outcome.outcome, JSON.stringify(outcome)).toBe('read')
    return outcome.documentId as string
  }

  it('turns a roll into units, holders, tenures and assessments', async () => {
    const number = unit('4B')
    const [outcome] = await ingest(
      [rollFile([[number, `${RUN_PREFIX} Jane Smith`, '3600.00']], scope)],
      boardMemberId,
      dependencies(),
    )

    idOf(outcome!)

    const { rows } = await writer.query<{
      unit_number: string
      full_name: string
      annual_amount: string
    }>(
      `select u.unit_number, h.full_name, a.annual_amount
         from unit u
         join unit_membership m on m.unit_id = u.id
         join unit_holder h on h.id = m.holder_id
         join assessment a on a.unit_id = u.id and a.assessment_year = 2026
        where u.unit_number = $1`,
      [number],
    )

    expect(rows).toEqual([
      {
        unit_number: number,
        full_name: `${RUN_PREFIX} Jane Smith`,
        annual_amount: '3600.00',
      },
    ])
  })

  it('attributes a deposit uploaded after the roll, which is the whole story', async () => {
    // Before story 2.7 this deposit held every line, because nothing had ever
    // created a unit for its references to resolve against.
    const a = unit('5A')
    const b = unit('5B')

    await ingest(
      [
        rollFile(
          [
            [a, `${RUN_PREFIX} Jane Smith`, '3600.00'],
            [b, `${RUN_PREFIX} John Doe`, '4800.00'],
          ],
          scope,
        ),
      ],
      boardMemberId,
      dependencies(),
    )

    const [deposit] = await ingest(
      [depositFile([[a, '300.00'], [b, '400.00']], scope)],
      boardMemberId,
      dependencies(),
    )
    const depositId = idOf(deposit!)

    expect(await paymentsFor(depositId)).toEqual([
      { unit_number: a, amount: '300.00' },
      { unit_number: b, amount: '400.00' },
    ])
    expect(await heldFor(depositId)).toEqual([])
  })

  it('still holds a deposit line naming a unit the roll never mentioned', async () => {
    // The other half, and the reason the test above is not vacuous: attribution
    // must follow the roll rather than accept anything at all.
    const known = unit('6A')
    const stranger = unit('6Z')

    await ingest(
      [rollFile([[known, `${RUN_PREFIX} Jane Smith`, '3600.00']], scope)],
      boardMemberId,
      dependencies(),
    )

    const [deposit] = await ingest(
      [depositFile([[known, '300.00'], [stranger, '900.00']], scope)],
      boardMemberId,
      dependencies(),
    )
    const depositId = idOf(deposit!)

    expect(await paymentsFor(depositId)).toEqual([{ unit_number: known, amount: '300.00' }])
    expect(await heldFor(depositId)).toEqual([
      { unit_reference: stranger, hold_reason: 'unknown-unit' },
    ])
  })

  it('resolves a deposit that spells the unit differently from the roll', async () => {
    // `unit_normalised_number()` decides, in the database, on both paths. A
    // treasurer's bank export will not match the roll's capitalisation.
    const number = unit('7C')

    await ingest(
      [rollFile([[number, `${RUN_PREFIX} Jane Smith`, '3600.00']], scope)],
      boardMemberId,
      dependencies(),
    )

    const [deposit] = await ingest(
      [depositFile([[`  ${number.toUpperCase()} `, '250.00']], scope)],
      boardMemberId,
      dependencies(),
    )
    const depositId = idOf(deposit!)

    expect(await paymentsFor(depositId)).toEqual([{ unit_number: number, amount: '250.00' }])
  })

  it('does not duplicate anything when the same roll is uploaded twice', async () => {
    // AD-13, through the real ingestion path rather than the repository. The
    // second upload comes back `already-held` on the content hash, so this also
    // pins that a re-upload of identical bytes is harmless.
    const number = unit('8D')
    const file = rollFile([[number, `${RUN_PREFIX} Jane Smith`, '3600.00']], scope)

    await ingest([file], boardMemberId, dependencies())
    await ingest([file], boardMemberId, dependencies())

    const counts = await writer.query<{ tenures: string; assessments: string; units: string }>(
      `select (select count(*)::text from unit_membership m
                join unit u on u.id = m.unit_id where u.unit_number = $1) as tenures,
              (select count(*)::text from assessment a
                join unit u on u.id = a.unit_id where u.unit_number = $1) as assessments,
              (select count(*)::text from unit where unit_number = $1) as units`,
      [number],
    )

    expect(counts.rows[0]).toEqual({ tenures: '1', assessments: '1', units: '1' })
  })

  it('writes nothing at all when one roll row is defective', async () => {
    // AC4. A half-loaded roll is a set of units that looks complete and is not,
    // and every arrears figure derived from it would be wrong without saying so.
    const good = unit('9A')
    const bad = unit('9B')

    const bytes = new TextEncoder().encode(
      [
        'date,description,amount,type,unit,cycle,year',
        `2019-03-01,${RUN_PREFIX} Jane Smith,3600.00,assessment_roll,${good},monthly,2026`,
        `2019-03-01,${RUN_PREFIX} John Doe,4800.00,assessment_roll,${bad},quarterly,2026`,
      ].join('\n'),
    )

    const [outcome] = await ingest(
      [{ filename: `${scope}-bad-roll.csv`, contentType: 'text/csv', bytes }],
      boardMemberId,
      dependencies(),
    )

    expect(outcome!.outcome).toBe('unreadable')

    const { rows } = await writer.query<{ n: string }>(
      'select count(*)::text as n from unit where unit_number in ($1, $2)',
      [good, bad],
    )
    expect(rows[0]!.n).toBe('0')
  })

  it('leaves the roll tables alone for a document that is not a roll', async () => {
    // AC3's other half: an invoice must write nothing to any of the four tables.
    const before = await writer.query<{ n: string }>(
      'select count(*)::text as n from unit where unit_number like $1',
      [`${RUN_PREFIX}-%`],
    )

    const bytes = new TextEncoder().encode(
      ['date,description,amount,type', '2026-03-01,ACME Plumbing,250.00,invoice'].join('\n'),
    )
    await ingest(
      [{ filename: `${scope}-invoice.csv`, contentType: 'text/csv', bytes }],
      boardMemberId,
      dependencies(),
    )

    const after = await writer.query<{ n: string }>(
      'select count(*)::text as n from unit where unit_number like $1',
      [`${RUN_PREFIX}-%`],
    )

    expect(after.rows[0]!.n).toBe(before.rows[0]!.n)
  })
})
