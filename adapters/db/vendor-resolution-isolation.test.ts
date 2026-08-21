/**
 * Resolving a vendor name two associations both use.
 *
 * Migration 025 made the vendor identity key `(association_id,
 * normalised_name)`, so two boards may each pay an "ACME Plumbing" and they are
 * two different vendors. `confirmAsNew` inserts with
 * `on conflict (association_id, normalised_name) do nothing` and, when that
 * conflicts, falls back to reading the existing row.
 *
 * **That fallback read is the whole subject of this file.** Written without an
 * association predicate it matches by name across every board, so a document
 * would be attached to another association's vendor — and nothing downstream
 * would look wrong, because the id is real and the name is right. Found by
 * `ocr` reviewing story 5.1b, and it was introduced by that story: task 5 made
 * the INSERT association-scoped and left its paired SELECT global.
 *
 * Requires a database and skips without one.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createVendorResolution } from './vendor-resolution-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  vendor resolution isolation tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL ' +
      'and DATABASE_URL must both be set.\n',
  )
}

const REPO_ROOT = process.cwd()

const RUN_PREFIX = `v${randomBytes(4).toString('hex')}`

/** The name both boards use. */
const VENDOR_NAME = `${RUN_PREFIX} Plumbing`

interface Board {
  associationId: string
  firstDocument: string
  secondDocument: string
}

describeWithDatabase('resolving a vendor name that two associations both use', () => {
  const writer = new Client({ connectionString: writerUrl })
  const owner = new Client({ connectionString: adminUrl })

  let a: Board
  let b: Board

  async function seedBoard(label: string): Promise<Board> {
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
    const uploadedBy = member.rows[0]!.id

    const document = async (n: number) => {
      const { rows } = await writer.query<{ id: string }>(
        `insert into document
           (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id)
         values ($1, $2, 'invoice.pdf', 'application/pdf', 1024, $3, $4) returning id`,
        [
          randomBytes(32).toString('hex'),
          `${RUN_PREFIX}/${label}/${n}.pdf`,
          uploadedBy,
          associationId,
        ],
      )
      return rows[0]!.id
    }

    return { associationId, firstDocument: await document(1), secondDocument: await document(2) }
  }

  beforeAll(async () => {
    await writer.connect()
    await owner.connect()

    // A first, deliberately. Under the unscoped read the fallback takes
    // whichever row the scan reaches first, and A's is the older one.
    a = await seedBoard('a')
    b = await seedBoard('b')
  })

  afterAll(async () => {
    await writer.query('delete from quarantine_item where document_id in (select id from document where storage_key like $1)', [`${RUN_PREFIX}/%`])
    await writer.query('delete from extraction where document_id in (select id from document where storage_key like $1)', [`${RUN_PREFIX}/%`])
    await writer.query('delete from document where storage_key like $1', [`${RUN_PREFIX}/%`])
    await writer.query('delete from vendor where display_name like $1', [`${RUN_PREFIX}%`])
    await owner.query('delete from board_member where email like $1', [`${RUN_PREFIX}-%`])
    await owner.query('delete from association where name like $1', [`${RUN_PREFIX}-%`])
    await writer.end()
    await owner.end()
  })

  /**
   * `confirmAsNew` answers `already-resolved` and writes nothing unless there is
   * a hold to clear — the guard that stops a second confirmation minting a
   * duplicate identity. So each document needs one before it can be confirmed.
   */
  const hold = async (documentId: string, associationId: string) => {
    await writer.query(
      `insert into quarantine_item (document_id, extracted_name, association_id)
            values ($1, $2, $3)`,
      [documentId, VENDOR_NAME, associationId],
    )
  }

  const associationOf = async (vendorId: string) => {
    const { rows } = await writer.query<{ association_id: string }>(
      'select association_id from vendor where id = $1',
      [vendorId],
    )
    return rows[0]!.association_id
  }

  it('gives each association its own vendor for the same name', async () => {
    const resolution = createVendorResolution()

    await hold(a.firstDocument, a.associationId)
    await hold(b.firstDocument, b.associationId)

    const first = await resolution.confirmAsNew(a.firstDocument, VENDOR_NAME)
    const second = await resolution.confirmAsNew(b.firstDocument, VENDOR_NAME)

    expect(first.outcome).toBe('created')
    expect(second.outcome).toBe('created')
    expect(first).not.toEqual(second)
  })

  /**
   * The regression. B's second document names a vendor B already has, so the
   * INSERT conflicts and the fallback read runs — the one path where an
   * unscoped predicate can hand back another board's vendor.
   */
  it("matches B's second document to B's vendor, not to A's of the same name", async () => {
    const resolution = createVendorResolution()

    // Its own holds, for both documents. `confirmAsNew` consumes a hold, so a
    // test that relied on one seeded for an earlier case would get
    // `already-resolved` — no `vendorId`, and any assertion guarded on its
    // presence would quietly not run. That is what the first version of this
    // test did, and `argus` caught it.
    await hold(b.firstDocument, b.associationId)
    await hold(b.secondDocument, b.associationId)

    const first = await resolution.confirmAsNew(b.firstDocument, VENDOR_NAME)
    const second = await resolution.confirmAsNew(b.secondDocument, VENDOR_NAME)

    // `matched`, not `created` — and this assertion is what proves the test
    // exercised the path it is about. B's vendor already exists, so the INSERT
    // conflicts and the fallback SELECT runs; had it come back `created`, the
    // fallback never executed and everything below would prove nothing.
    expect(second.outcome).toBe('matched')

    expect(first).toHaveProperty('vendorId')
    expect(second).toHaveProperty('vendorId')

    const firstId = (first as { vendorId: string }).vendorId
    const secondId = (second as { vendorId: string }).vendorId

    expect(await associationOf(secondId)).toBe(b.associationId)
    expect(secondId).toBe(firstId)
  })

  /**
   * The deterministic half, and it is here because the behavioural test above
   * is **not** deterministic.
   *
   * The fallback `SELECT` has no `ORDER BY`, so with the association predicate
   * removed Postgres may return either board's vendor. It returned A's both
   * times this was checked against the pre-fix code, which is evidence and not
   * a guarantee — a regression test that catches the defect most of the time
   * is a regression test that eventually stops catching it, silently. Raised by
   * CodeRabbit on MR !71.
   *
   * Reading the adapter's source is a weaker kind of assertion on its own; the
   * pair is the point. This one cannot flake, and the one above cannot be
   * satisfied by text that never runs.
   */
  it('constrains the fallback lookup to the document association, in the SQL itself', () => {
    const source = readFileSync(join(REPO_ROOT, 'adapters/db/vendor-resolution-postgres.ts'), 'utf8')

    const fallback = source.slice(source.indexOf('const existing'))

    expect(fallback).toMatch(/select id from vendor/i)
    expect(fallback).toMatch(/association_id\s*=\s*\(\s*select association_id from document/i)
  })

  it('leaves two vendors standing, one per association', async () => {
    const { rows } = await writer.query<{ n: number }>(
      'select count(*)::int as n from vendor where display_name like $1',
      [`${RUN_PREFIX}%`],
    )

    expect(rows[0]!.n).toBe(2)
  })
})
