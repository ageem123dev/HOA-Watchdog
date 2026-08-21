/**
 * A deposit uploaded becomes payments. The whole path, against the real
 * database.
 *
 * **This is the test the story exists for.** Story 2.4 built `payment`,
 * `held_payment`, `resolveLine`, a repository and a queue — all tested, all
 * green, and reachable from nothing. No review caught it, because every part was
 * correct in itself. A green unit test proves a part works; only a test that
 * runs the path proves the parts are connected.
 *
 * So this one deliberately starts where a treasurer starts — bytes and a
 * filename handed to `ingest`, the real entry point the upload action calls —
 * and ends by reading the two tables directly. Everything between is production
 * code: the tabular reader, the validator, the unit directory, `resolveLine`,
 * and the payment repository. The only fake is the object store, because an S3
 * bucket is not what is under test.
 *
 * The CSV path and not the provider path, because a CSV is what the pilot
 * uploads — and because `extract-document.ts` refuses one outright with
 * `no-provider-path`, so a test written there would have proved nothing about
 * the documents that really arrive.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createPostgresDocumentRepository } from './document-repository-postgres'
import { createPostgresExtractionRepository } from './extraction-repository-postgres'
import { createPaymentRepository } from './payment-repository-postgres'
import { createQuarantine } from './quarantine-postgres'
import { createUnitDirectory } from './unit-directory-postgres'
import { createVendorDirectory } from './vendor-directory-postgres'
import type { DocumentStore } from '../../core/ports/document-store'
import { ingest } from '../../core/ingestion/ingest'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const readerUrl = process.env.WATCHDOG_READER_DATABASE_URL
const configured = Boolean(writerUrl && readerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  deposit ingestion tests SKIPPED: both database URLs must be set.\n')
}

const RUN_PREFIX = `d${randomBytes(4).toString('hex')}`

describeWithDatabase('a deposit uploaded, end to end', () => {
  let writer: Client
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
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA', '00000000-0000-7000-8000-000000000001')
       returning id`,
      [`deposit-path-${RUN_PREFIX}@example.test`],
    )
    boardMemberId = rows[0]!.id
  })

  beforeEach(() => {
    scope = randomBytes(4).toString('hex')
  })

  afterAll(async () => {
    if (boardMemberId) {
      await writer.query('delete from document where uploaded_by = $1', [boardMemberId])
      await writer.query('delete from board_member where id = $1', [boardMemberId])
    }
    await writer.query('delete from unit where unit_number like $1', [`${RUN_PREFIX}-%`])
    await writer.end()
  })

  const newUnit = async (unitNumber: string): Promise<string> => {
    const { rows } = await writer.query<{ id: string }>(
      'insert into unit (unit_number, association_id) values ($1, \'00000000-0000-7000-8000-000000000001\') returning id',
      [unitNumber],
    )
    return rows[0]!.id
  }

  /** Exactly what the upload action builds, real adapters and all. */
  const dependencies = () => ({
    store,
    repository: createPostgresDocumentRepository(),
    extractions: createPostgresExtractionRepository(),
    vendors: createVendorDirectory(),
    quarantine: createQuarantine(),
    units: createUnitDirectory(),
    payments: createPaymentRepository(),
  })

  /** A deposit CSV whose rows are given as `[unit, amount]`. */
  const depositFile = (lines: readonly (readonly [string, string])[], salt: string) => ({
    filename: `${salt}-deposits.csv`,
    contentType: 'text/csv',
    documentKind: 'deposit' as const,
    bytes: new TextEncoder().encode(
      [
        'date,description,amount,unit',
        // The salt rides in a data column so two runs are different documents:
        // AD-13 keys on the content hash, and an identical file is deliberately
        // the *same* document.
        ...lines.map(([unit, amount]) => `2026-03-01,Dues ${salt},${amount},${unit}`),
      ].join('\n'),
    ),
  })

  const paymentsOf = async (documentId: string) =>
    (
      await writer.query<{ unit_id: string; amount: string; paid_on: string }>(
        `select unit_id, amount::text, to_char(paid_on, 'YYYY-MM-DD') as paid_on
           from payment where document_id = $1 order by amount`,
        [documentId],
      )
    ).rows

  const heldOf = async (documentId: string) =>
    (
      await writer.query<{ unit_reference: string | null; amount: string | null; hold_reason: string }>(
        `select unit_reference, amount::text, hold_reason
           from held_payment where document_id = $1 order by hold_reason`,
        [documentId],
      )
    ).rows

  it('stores a payment against the unit the deposit names', async () => {
    const unitId = await newUnit(`${RUN_PREFIX}-${scope}-4B`)

    const [outcome] = await ingest(
      [depositFile([[`${RUN_PREFIX}-${scope}-4B`, '250.00']], scope)],
      boardMemberId,
      dependencies(),
    )

    expect(outcome!.outcome).toBe('read')
    const documentId = (outcome as { documentId: string }).documentId

    // The assertion story 2.4's AC1 claimed and could not have made.
    expect(await paymentsOf(documentId)).toEqual([
      { unit_id: unitId, amount: '250.00', paid_on: '2026-03-01' },
    ])
  })

  it('holds a line naming a unit nobody has recorded', async () => {
    await newUnit(`${RUN_PREFIX}-${scope}-4B`)

    const [outcome] = await ingest(
      [depositFile([[`${RUN_PREFIX}-${scope}-nosuchunit`, '250.00']], scope)],
      boardMemberId,
      dependencies(),
    )

    const documentId = (outcome as { documentId: string }).documentId

    expect(await paymentsOf(documentId)).toEqual([])
    expect(await heldOf(documentId)).toEqual([
      {
        unit_reference: `${RUN_PREFIX}-${scope}-nosuchunit`,
        amount: '250.00',
        hold_reason: 'unknown-unit',
      },
    ])
  })

  it('splits a deposit that mixes lines it can attribute and lines it cannot', async () => {
    // The ordinary case, and the one where a partial write would be least
    // visible: a file where most lines resolve and one does not.
    const knownId = await newUnit(`${RUN_PREFIX}-${scope}-4B`)

    const [outcome] = await ingest(
      [
        depositFile(
          [
            [`${RUN_PREFIX}-${scope}-4B`, '250.00'],
            [`${RUN_PREFIX}-${scope}-ghost`, '175.00'],
          ],
          scope,
        ),
      ],
      boardMemberId,
      dependencies(),
    )

    const documentId = (outcome as { documentId: string }).documentId

    expect(await paymentsOf(documentId)).toEqual([
      { unit_id: knownId, amount: '250.00', paid_on: '2026-03-01' },
    ])
    // Both sides pinned by count, not just the payment side. Raised by review:
    // inspecting only `[0]` lets a regression that writes extra held rows pass,
    // and a duplicated hold is a treasurer asked the same question twice.
    const held = await heldOf(documentId)
    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({
      unit_reference: `${RUN_PREFIX}-${scope}-ghost`,
      amount: '175.00',
      hold_reason: 'unknown-unit',
    })
  })

  it('matches a reference the roll does not spell exactly', async () => {
    // AC2, through the whole path rather than against the adapter. This is the
    // assertion that fails if the database's folding and core's folding are
    // wired to different keys anywhere between the CSV and the row.
    const unitId = await newUnit(`${RUN_PREFIX}-${scope}-4B`)

    const [outcome] = await ingest(
      [depositFile([[`  ${RUN_PREFIX}-${scope}-4b `, '250.00']], scope)],
      boardMemberId,
      dependencies(),
    )

    const documentId = (outcome as { documentId: string }).documentId

    expect(await paymentsOf(documentId)).toEqual([
      { unit_id: unitId, amount: '250.00', paid_on: '2026-03-01' },
    ])
  })

  it('replaces rather than duplicating when the same deposit is uploaded twice', async () => {
    // AD-13 proved where it actually has to hold — through the real entry point,
    // not against a repository called directly. The same bytes are the same
    // document by content hash, so the second upload re-reads and replaces.
    const unitId = await newUnit(`${RUN_PREFIX}-${scope}-4B`)
    const file = depositFile(
      [
        [`${RUN_PREFIX}-${scope}-4B`, '250.00'],
        [`${RUN_PREFIX}-${scope}-ghost`, '175.00'],
      ],
      scope,
    )
    const deps = dependencies()

    const [first] = await ingest([file], boardMemberId, deps)
    const documentId = (first as { documentId: string }).documentId

    await ingest([file], boardMemberId, deps)

    // One of each, not two. A ledger that doubles a payment on a re-upload is
    // an arrears finding against somebody who paid.
    const payments = await paymentsOf(documentId)
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ unit_id: unitId, amount: '250.00' })
    expect(await heldOf(documentId)).toHaveLength(1)
  })

  it('writes nothing to either table for a document that is not a deposit', async () => {
    // AC3. An invoice upload must leave both tables alone — and a change that
    // wrote empty sets for every document would pass every other test here.
    const [outcome] = await ingest(
      [
        {
          filename: `${scope}-invoices.csv`,
          contentType: 'text/csv',
          documentKind: 'invoice' as const,
          bytes: new TextEncoder().encode(
            ['date,description,amount', `2026-03-01,Acme ${scope},250.00`].join('\n'),
          ),
        },
      ],
      boardMemberId,
      dependencies(),
    )

    expect(outcome!.outcome).toBe('read')
    const documentId = (outcome as { documentId: string }).documentId

    expect(await paymentsOf(documentId)).toEqual([])
    expect(await heldOf(documentId)).toEqual([])
  })

  it('reads a deposit whose every line is held', async () => {
    // Not a failure. An unfamiliar reference format or a new roll is ordinary,
    // and the document must still be recorded as read.
    const [outcome] = await ingest(
      [
        depositFile(
          [
            [`${RUN_PREFIX}-${scope}-ghost-a`, '250.00'],
            [`${RUN_PREFIX}-${scope}-ghost-b`, '175.00'],
          ],
          scope,
        ),
      ],
      boardMemberId,
      dependencies(),
    )

    expect(outcome!.outcome).toBe('read')
    const documentId = (outcome as { documentId: string }).documentId

    expect(await heldOf(documentId)).toHaveLength(2)

    const { rows } = await writer.query<{ extraction_state: string }>(
      'select extraction_state from document where id = $1',
      [documentId],
    )
    expect(rows[0]!.extraction_state).toBe('read')
  })

  it('never lets a NUL in a CSV reach the ledger at all', async () => {
    // Raised by review on the fix diff. `text` cannot hold a NUL: as a query
    // parameter it raises 22021, which aborts the transaction and takes every
    // payment in the document with it -- and reports as an outage rather than a
    // bad document, so it would be retried forever.
    //
    // On this path it never gets that far, and the test says so rather than
    // asserting what was expected: `assess` refuses the upload outright, so the
    // bytes are not even stored. The storability guard added for this hazard is
    // therefore unreachable *here* -- it earns its place on the provider path,
    // where the bytes are a valid PDF and the model supplies the NUL, and
    // `payment-ordering.test.ts` is where that is proved.
    const [outcome] = await ingest(
      [
        {
          filename: `${scope}-nul.csv`,
          contentType: 'text/csv',
          documentKind: 'deposit' as const,
          bytes: new TextEncoder().encode(
            [
              'date,description,amount,unit',
              `2026-03-01,Dues ${scope},250.00,4B\u0000X`,
            ].join('\n'),
          ),
        },
      ],
      boardMemberId,
      dependencies(),
    )

    expect(outcome!.outcome).toBe('rejected')
  })
})
