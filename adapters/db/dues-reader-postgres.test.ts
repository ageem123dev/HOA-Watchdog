/**
 * Reading what a unit owed and what arrived, against a real database (AC5, AC11).
 *
 * Three things here are only true in Postgres: what `held_during @>` returns for
 * a unit that changed hands mid-year, what a `left join` gives back for a unit
 * with no assessment, and whether `numeric(14,2)` survives the trip out as an
 * exact decimal string. Asserting any of them anywhere else asserts a guess.
 */

import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createDuesReader } from './dues-reader-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const adminUrl = process.env.DATABASE_URL
const configured = Boolean(writerUrl && adminUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn('\n  dues reader tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL and DATABASE_URL must both be set.\n')
}

const RUN_PREFIX = `dues-${randomBytes(4).toString('hex')}`
const YEAR = 2026

let writer: Client
let owner: Client
let memberId: string
const documents: string[] = []
const units: string[] = []

async function seedDocument(label: string): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into document
       (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, uploaded_at)
     values ($1, $2, $3, 'text/csv', 512, $4, '2026-07-01T09:00:00Z')
     returning id`,
    [
      randomBytes(32).toString('hex'),
      `${RUN_PREFIX}/${label}`,
      `${RUN_PREFIX}-${label}.csv`,
      memberId,
    ],
  )
  const id = rows[0]!.id
  documents.push(id)

  return id
}

/** A unit scoped to this run, so parallel test files never share one. */
async function seedUnit(label: string): Promise<string> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into unit (unit_number) values ($1) returning id`,
    [`${RUN_PREFIX}-${label}`],
  )
  const id = rows[0]!.id
  units.push(id)

  return id
}

async function seedAssessment(unitId: string, annual: string, cycle: string, year = YEAR) {
  await writer.query(
    `insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle)
     values ($1, $2, $3::numeric, $4)`,
    [unitId, year, annual, cycle],
  )
}

async function seedPayment(unitId: string, documentId: string, paidOn: string, amount: string) {
  await writer.query(
    `insert into payment (unit_id, document_id, paid_on, amount)
     values ($1, $2, $3::date, $4::numeric)`,
    [unitId, documentId, paidOn, amount],
  )
}

async function seedHolder(unitId: string, name: string, during: string): Promise<void> {
  const { rows } = await writer.query<{ id: string }>(
    `insert into unit_holder (full_name) values ($1) returning id`,
    [name],
  )
  await writer.query(
    `insert into unit_membership (unit_id, holder_id, held_during)
     values ($1, $2, $3::daterange)`,
    [unitId, rows[0]!.id, during],
  )
}

const read = (documentId: string, on = '2026-07-01') =>
  createDuesReader().duesForDocument(documentId, YEAR, on)

describeWithDatabase('reading what a unit owed and what arrived', () => {
  beforeAll(async () => {
    writer = new Client({ connectionString: writerUrl })
    await writer.connect()
    owner = new Client({ connectionString: adminUrl })
    await owner.connect()

    const { rows } = await writer.query<{ id: string }>(
      `insert into board_member (email, password_hash)
       values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA') returning id`,
      [`dues-reader-${RUN_PREFIX}@example.test`],
    )
    memberId = rows[0]!.id
  })

  afterAll(async () => {
    try {
      if (units.length > 0) {
        await owner.query(`delete from finding where subject_id = any($1::uuid[])`, [units])
        await owner.query(`delete from payment where unit_id = any($1::uuid[])`, [units])
        await owner.query(`delete from assessment where unit_id = any($1::uuid[])`, [units])
        await owner.query(`delete from unit_membership where unit_id = any($1::uuid[])`, [units])
      }
      await owner.query(`delete from unit_holder where full_name like $1`, [`${RUN_PREFIX}%`])
      await owner.query(`delete from document where storage_key like $1`, [`${RUN_PREFIX}/%`])
      if (units.length > 0) {
        await owner.query(`delete from unit where id = any($1::uuid[])`, [units])
      }
      await owner.query(`delete from board_member where email like $1`, [`dues-reader-${RUN_PREFIX}%`])
    } finally {
      await Promise.allSettled([owner.end(), writer.end()])
    }
  })

  it('returns the unit, what it owes, and what arrived', async () => {
    const document = await seedDocument('basic')
    const unit = await seedUnit('basic')
    await seedAssessment(unit, '1200.00', 'monthly')
    await seedPayment(unit, document, '2026-01-05', '100.00')
    await seedPayment(unit, document, '2026-02-05', '100.00')

    const [dues] = await read(document)

    expect(dues).toMatchObject({
      unitId: unit,
      unitNumber: `${RUN_PREFIX}-basic`,
      assessment: { annualAmount: '1200.00', billingCycle: 'monthly', assessmentYear: YEAR },
    })
    expect(dues!.payments).toEqual([
      { paidOn: '2026-01-05', amount: '100.00' },
      { paidOn: '2026-02-05', amount: '100.00' },
    ])
  })

  it('counts payments the document did not carry', async () => {
    // A unit's standing is the sum of everything received for the year. A
    // deposit landing the second instalment must not read as though the first
    // never arrived.
    const january = await seedDocument('earlier')
    const july = await seedDocument('later')
    const unit = await seedUnit('carry')
    await seedAssessment(unit, '1200.00', 'monthly')
    await seedPayment(unit, january, '2026-01-05', '600.00')
    await seedPayment(unit, july, '2026-07-01', '600.00')

    const [dues] = await read(july)

    expect(dues!.payments.map((payment) => payment.amount)).toEqual(['600.00', '600.00'])
  })

  it('leaves out payments from another assessment year', async () => {
    const document = await seedDocument('year-boundary')
    const unit = await seedUnit('year-boundary')
    await seedAssessment(unit, '1200.00', 'annual')
    await seedPayment(unit, document, '2026-01-01', '11.00')
    await seedPayment(unit, document, '2025-12-31', '22.00')
    await seedPayment(unit, document, '2027-01-01', '33.00')

    const [dues] = await read(document)

    // Both edges, and both are the first or last day of the year — the two the
    // half-open range decides.
    expect(dues!.payments.map((payment) => payment.amount)).toEqual(['11.00'])
  })

  it('names the holder who held the unit at the evaluation date, not the current one', async () => {
    // **AC5, and the error the epic says a fiduciary tool cannot make.** The
    // unit changed hands on 1 June. Evaluated at 1 March, the arrears belong to
    // whoever held it then.
    const document = await seedDocument('changed-hands')
    const unit = await seedUnit('changed-hands')
    await seedAssessment(unit, '1200.00', 'monthly')
    await seedPayment(unit, document, '2026-01-05', '100.00')
    await seedHolder(unit, `${RUN_PREFIX} Former Holder`, '[2026-01-01,2026-06-01)')
    await seedHolder(unit, `${RUN_PREFIX} Current Holder`, '[2026-06-01,)')

    const [inMarch] = await read(document, '2026-03-01')
    const [inJuly] = await read(document, '2026-07-01')

    expect(inMarch!.holderName).toBe(`${RUN_PREFIX} Former Holder`)
    expect(inJuly!.holderName).toBe(`${RUN_PREFIX} Current Holder`)
  })

  it('returns the unit with no holder rather than dropping it', async () => {
    // A gap in the roll is not a reason to stop reporting that money is short.
    const document = await seedDocument('no-holder')
    const unit = await seedUnit('no-holder')
    await seedAssessment(unit, '600.00', 'annual')
    await seedPayment(unit, document, '2026-01-05', '10.00')

    const [dues] = await read(document)

    expect(dues).toMatchObject({ unitId: unit, holderName: null })
  })

  it('returns a null assessment rather than a zero for a unit not on the roll', async () => {
    // Nothing owed is not everything missing. A zero here would read as a
    // shortfall of the whole amount against a unit whose only mistake is not
    // being assessed yet.
    const document = await seedDocument('unassessed')
    const unit = await seedUnit('unassessed')
    await seedPayment(unit, document, '2026-01-05', '10.00')

    const [dues] = await read(document)

    expect(dues).toMatchObject({ unitId: unit, assessment: null })
  })

  it('ignores an assessment recorded for a different year', async () => {
    const document = await seedDocument('other-year')
    const unit = await seedUnit('other-year')
    await seedAssessment(unit, '999.00', 'annual', YEAR - 1)
    await seedPayment(unit, document, '2026-01-05', '10.00')

    const [dues] = await read(document)

    expect(dues!.assessment).toBeNull()
  })

  it('returns every unit the deposit touched, once each', async () => {
    const document = await seedDocument('many')
    const first = await seedUnit('many-a')
    const second = await seedUnit('many-b')
    await seedAssessment(first, '1200.00', 'monthly')
    await seedAssessment(second, '600.00', 'annual')
    // Two payments for the same unit on one document must not duplicate it.
    await seedPayment(first, document, '2026-01-05', '100.00')
    await seedPayment(first, document, '2026-02-05', '100.00')
    await seedPayment(second, document, '2026-01-05', '600.00')

    const dues = await read(document)

    expect(dues.map((unit) => unit.unitNumber)).toEqual([
      `${RUN_PREFIX}-many-a`,
      `${RUN_PREFIX}-many-b`,
    ])
  })

  it('reads nothing for a document that recorded no payments', async () => {
    const document = await seedDocument('empty')

    expect(await read(document)).toEqual([])
  })

  it('hands amounts back as exact decimal strings', async () => {
    // Story 2.2's rule, and the reason the rule compares decimal strings: a
    // cent lost here is a cent of arrears invented or forgiven.
    const document = await seedDocument('exact')
    const unit = await seedUnit('exact')
    await seedAssessment(unit, '1000.00', 'monthly')
    await seedPayment(unit, document, '2026-01-05', '83.34')

    const [dues] = await read(document)

    expect(dues!.assessment!.annualAmount).toBe('1000.00')
    expect(dues!.payments[0]!.amount).toBe('83.34')
  })
})
