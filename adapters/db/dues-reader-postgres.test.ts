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

import { detectDuesShortfalls } from '../../core/detection/detect-dues-shortfalls'
import { createFindingRegister } from './finding-postgres'
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

/**
 * The reader is scoped to the *year*, not to the document.
 *
 * Each test therefore filters to its own unit: the roll is shared, so a query
 * for 2026 sees every unit any test in this file assessed. Story 4.3 learned
 * this the expensive way, with eleven tests failing on each other's fixtures.
 */
const readYear = (on = '2026-07-01') => createDuesReader().duesForYear(YEAR, on)

const readUnit = async (unitId: string, on = '2026-07-01') =>
  (await readYear(on)).find((unit) => unit.unitId === unitId)

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

    const dues = await readUnit(unit)

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

    const dues = await readUnit(unit)

    expect(dues!.payments.map((payment) => payment.amount)).toEqual(['600.00', '600.00'])
  })

  it('leaves out payments from another assessment year', async () => {
    const document = await seedDocument('year-boundary')
    const unit = await seedUnit('year-boundary')
    await seedAssessment(unit, '1200.00', 'annual')
    await seedPayment(unit, document, '2026-01-01', '11.00')
    await seedPayment(unit, document, '2025-12-31', '22.00')
    await seedPayment(unit, document, '2027-01-01', '33.00')

    const dues = await readUnit(unit)

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

    const inMarch = await readUnit(unit, '2026-03-01')
    const inJuly = await readUnit(unit, '2026-07-01')

    expect(inMarch!.holderName).toBe(`${RUN_PREFIX} Former Holder`)
    expect(inJuly!.holderName).toBe(`${RUN_PREFIX} Current Holder`)
  })

  it('returns the unit with no holder rather than dropping it', async () => {
    // A gap in the roll is not a reason to stop reporting that money is short.
    const document = await seedDocument('no-holder')
    const unit = await seedUnit('no-holder')
    await seedAssessment(unit, '600.00', 'annual')
    await seedPayment(unit, document, '2026-01-05', '10.00')

    const dues = await readUnit(unit)

    expect(dues).toMatchObject({ unitId: unit, holderName: null })
  })

  it('leaves out a unit with no assessment for the year entirely', async () => {
    // **This case used to assert a null assessment**, back when the query was
    // driven off the deposit's payments. Now the roll is the driving table, so
    // "nothing was owed" is expressed by the unit not being there — which is
    // the stronger form: the detector cannot forget to check for it.
    const document = await seedDocument('unassessed')
    const unit = await seedUnit('unassessed')
    await seedPayment(unit, document, '2026-01-05', '10.00')

    expect(await readUnit(unit)).toBeUndefined()
  })

  it('leaves out a unit assessed only for a different year', async () => {
    const document = await seedDocument('other-year')
    const unit = await seedUnit('other-year')
    await seedAssessment(unit, '999.00', 'annual', YEAR - 1)
    await seedPayment(unit, document, '2026-01-05', '10.00')

    expect(await readUnit(unit)).toBeUndefined()
  })

  it('includes a unit that has paid nothing at all', async () => {
    // **The case the acceptance-criteria audit found missing, and the first one
    // FR-7 names.** A unit that has never paid appears on no deposit, so a
    // reader scoped to the uploaded document would never have seen it — the
    // detector would have been unable to report the very thing it exists for.
    const unit = await seedUnit('silent')
    await seedAssessment(unit, '1200.00', 'monthly')

    const dues = await readUnit(unit)

    expect(dues).toMatchObject({ unitId: unit })
    expect(dues!.payments).toEqual([])
  })

  it('returns each assessed unit once, however many times it paid', async () => {
    const document = await seedDocument('many')
    const first = await seedUnit('many-a')
    const second = await seedUnit('many-b')
    await seedAssessment(first, '1200.00', 'monthly')
    await seedAssessment(second, '600.00', 'annual')
    // Two payments for one unit must not duplicate it.
    await seedPayment(first, document, '2026-01-05', '100.00')
    await seedPayment(first, document, '2026-02-05', '100.00')
    await seedPayment(second, document, '2026-01-05', '600.00')

    const dues = await readYear()
    const mine = dues.filter((unit) => unit.unitId === first || unit.unitId === second)

    expect(mine.map((unit) => unit.unitNumber)).toEqual([
      `${RUN_PREFIX}-many-a`,
      `${RUN_PREFIX}-many-b`,
    ])
  })

  it('hands amounts back as exact decimal strings', async () => {
    // Story 2.2's rule, and the reason the rule compares decimal strings: a
    // cent lost here is a cent of arrears invented or forgiven.
    const document = await seedDocument('exact')
    const unit = await seedUnit('exact')
    await seedAssessment(unit, '1000.00', 'monthly')
    await seedPayment(unit, document, '2026-01-05', '83.34')

    const dues = await readUnit(unit)

    expect(dues!.assessment!.annualAmount).toBe('1000.00')
    expect(dues!.payments[0]!.amount).toBe('83.34')
  })

  describe('raising the shortfall end to end', () => {
    /**
     * **A year of its own, and that is forced by the rescope.**
     *
     * Detection now covers the whole roll for a year, so counts like `raised`
     * and `subjectsChecked` are global. Sharing 2026 with the reader tests
     * above — and with the 26 units already in this database — would make every
     * assertion here depend on data no test in this file owns, and would leave
     * findings on units it never seeded. A far-future year contains nothing but
     * what these tests put in it.
     */
    const E2E_YEAR = 2099

    async function seedDeposit(label: string): Promise<string> {
      const { rows } = await writer.query<{ id: string }>(
        `insert into document
           (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, uploaded_at)
         values ($1, $2, $3, 'text/csv', 512, $4, '2099-07-01T09:00:00Z')
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

    const detect = (documentId: string) =>
      detectDuesShortfalls(documentId, {
        dues: createDuesReader(),
        findings: createFindingRegister(),
      })

    async function findingsFor(unitId: string) {
      const { rows } = await writer.query<{
        finding_type: string
        period: string
        state: string
        evidence: {
          kind: string
          expected: string
          received: string
          shortfall: string
          holderName: string | null
          unitNumber: string
        }
      }>(
        `select finding_type, period::text, state, evidence
           from finding where subject_id = $1 order by period`,
        [unitId],
      )

      return rows
    }

    it('raises one finding keyed on the unit and the assessment year', async () => {
      // Uploaded 2099-07-01, which is the evaluation date, so a monthly payer
      // owes seven instalments of 100.00 and has paid one.
      const document = await seedDeposit('e2e-raise')
      const unit = await seedUnit('e2e-raise')
      await seedAssessment(unit, '1200.00', 'monthly', E2E_YEAR)
      await seedPayment(unit, document, '2099-01-05', '100.00')
      await seedHolder(unit, `${RUN_PREFIX} Reese Calloway`, '[2099-01-01,)')

      await detect(document)

      const [finding] = await findingsFor(unit)
      expect(finding).toMatchObject({
        finding_type: 'unit_dues_shortfall',
        period: '[2099-01-01,2100-01-01)',
        state: 'unreviewed',
      })
      expect(finding!.evidence).toMatchObject({
        kind: 'below-expected',
        expected: '700.00',
        received: '100.00',
        shortfall: '600.00',
        holderName: `${RUN_PREFIX} Reese Calloway`,
      })
    })

    it('running detection again yields one finding, not two', async () => {
      // **AC7, and the reason story 4.1 came first.** One *row*, guaranteed by
      // `finding_identity` rather than by this code remembering what it did.
      const document = await seedDeposit('e2e-twice')
      const unit = await seedUnit('e2e-twice')
      await seedAssessment(unit, '1200.00', 'annual', E2E_YEAR)
      await seedPayment(unit, document, '2099-01-05', '400.00')

      await detect(document)
      await detect(document)

      expect(await findingsFor(unit)).toHaveLength(1)
    })

    it('amends the one finding as a unit pays down its arrears', async () => {
      // **The reason this story ships one finding type rather than two**, and
      // the case that found the rescope: this unit appears on no deposit at all
      // until the second half of the test, and a reader scoped to the uploaded
      // document would never have seen it.
      const document = await seedDeposit('e2e-amend')
      const unit = await seedUnit('e2e-amend')
      await seedAssessment(unit, '1200.00', 'annual', E2E_YEAR)

      await detect(document)
      expect((await findingsFor(unit))[0]!.evidence).toMatchObject({
        kind: 'not-recorded',
        received: '0.00',
      })

      await seedPayment(unit, document, '2099-02-05', '500.00')
      await detect(document)

      const rows = await findingsFor(unit)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.evidence).toMatchObject({
        kind: 'below-expected',
        received: '500.00',
        shortfall: '700.00',
      })
    })

    it('raises nothing for a unit that is not on the roll', async () => {
      const document = await seedDeposit('e2e-unassessed')
      const unit = await seedUnit('e2e-unassessed')
      await seedPayment(unit, document, '2099-01-05', '10.00')

      await detect(document)

      expect(await findingsFor(unit)).toHaveLength(0)
    })

    it('never flags a unit for its billing cycle alone', async () => {
      // **AC2 through the real database.** Same annual figure, different
      // cycles, each having paid exactly what its own schedule expects by
      // 1 July. Neither is a finding, and it is the criterion this story is
      // most likely to regress on.
      const document = await seedDeposit('e2e-cycles')
      const monthly = await seedUnit('e2e-monthly')
      const annual = await seedUnit('e2e-annual')
      await seedAssessment(monthly, '1200.00', 'monthly', E2E_YEAR)
      await seedAssessment(annual, '1200.00', 'annual', E2E_YEAR)
      await seedPayment(monthly, document, '2099-01-05', '700.00')
      await seedPayment(annual, document, '2099-01-05', '1200.00')

      await detect(document)

      expect(await findingsFor(monthly)).toHaveLength(0)
      expect(await findingsFor(annual)).toHaveLength(0)
    })
  })
})
