/**
 * An assessment roll, applied against the real database.
 *
 * The real one and not a fake pool, because what is under test is exactly what a
 * fake cannot answer for: `unit_normalised_number()` deciding that `4b` and `4B`
 * are one unit, the unique index that makes a second one impossible, and the
 * exclusion constraint that refuses two overlapping tenures.
 *
 * **The assertion the story exists for is `a payment written before a re-upload
 * is still there afterwards`.** AD-13 says a re-applied roll replaces its rows;
 * read literally against this schema that means deleting units, which fails on
 * any unit that has been paid — and the `on delete cascade` reached for to make
 * the delete succeed would erase the ledger this product exists to check.
 */

import { randomBytes } from 'node:crypto'
import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { RollRow } from '../../core/extraction/roll'
import { ConflictingTenureError } from '../../core/ports/roll-repository'
import { createRollRepository } from './roll-repository-postgres'

const writerUrl = process.env.WATCHDOG_WRITER_DATABASE_URL
const configured = Boolean(writerUrl)

const describeWithDatabase = configured ? describe : describe.skip

if (!configured) {
  console.warn(
    '\n  roll repository tests SKIPPED: WATCHDOG_WRITER_DATABASE_URL must be set.\n',
  )
}

/** Several files write to `unit`; see the note in `unit.test.ts`. */
const RUN_PREFIX = `rr${randomBytes(4).toString('hex')}`

describeWithDatabase('applying an assessment roll', () => {
  let pool: Pool
  let uploadedBy: string

  const unitNumber = (label: string) => `${RUN_PREFIX}-${label}`

  const row = (overrides: Partial<RollRow> & { unitNumber: string }): RollRow => ({
    holderName: `${RUN_PREFIX} Jane Smith`,
    heldFrom: '2019-03-01',
    annualAmount: '3600.00',
    billingCycle: 'monthly',
    assessmentYear: 2026,
    ...overrides,
  })

  /** A fresh document to hang a roll on. */
  async function newDocument(): Promise<string> {
    const hash = randomBytes(32).toString('hex')
    const { rows } = await pool.query<{ id: string }>(
      `insert into document (content_hash, storage_key, filename, content_type, byte_size, uploaded_by, association_id) values ($1, $2, 'roll.csv', 'text/csv', 512, $3, '00000000-0000-7000-8000-000000000001')
       returning id`,
      [hash, `documents/${hash}`, uploadedBy],
    )
    return rows[0]!.id
  }

  const unitIdFor = async (number: string): Promise<string | null> => {
    const { rows } = await pool.query<{ id: string }>(
      'select id from unit where normalised_number = unit_normalised_number($1)',
      [number],
    )
    return rows[0]?.id ?? null
  }

  const tenuresFor = async (number: string) => {
    const { rows } = await pool.query<{
      full_name: string
      held_from: string
      held_until: string | null
    }>(
      `select h.full_name,
              to_char(lower(m.held_during), 'YYYY-MM-DD') as held_from,
              to_char(upper(m.held_during), 'YYYY-MM-DD') as held_until
         from unit_membership m
         join unit_holder h on h.id = m.holder_id
         join unit u on u.id = m.unit_id
        where u.normalised_number = unit_normalised_number($1)
        order by lower(m.held_during)`,
      [number],
    )
    return rows
  }

  const assessmentsFor = async (number: string) => {
    const { rows } = await pool.query<{
      assessment_year: number
      annual_amount: string
      billing_cycle: string
    }>(
      `select a.assessment_year, a.annual_amount, a.billing_cycle
         from assessment a
         join unit u on u.id = a.unit_id
        where u.normalised_number = unit_normalised_number($1)
        order by a.assessment_year`,
      [number],
    )
    return rows
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: writerUrl, max: 4 })
    const { rows } = await pool.query<{ id: string }>(
      `insert into board_member (email, password_hash, association_id) values ($1, 'scrypt$256$8$1$c2FsdA$aGFzaA', '00000000-0000-7000-8000-000000000001') returning id`,
      [`${RUN_PREFIX}@example.test`],
    )
    uploadedBy = rows[0]!.id
  })

  afterAll(async () => {
    // Children first. `unit_membership`, `assessment` and `payment` all
    // reference `unit (id)` with no on-delete action, which is the guarantee
    // under test — so a teardown that deletes units directly fails with 23503.
    const units = `select id from unit where unit_number like $1`

    await pool.query(
      `delete from document where uploaded_by in
         (select id from board_member where email like $1)`,
      [`${RUN_PREFIX}%`],
    )
    await pool.query(`delete from assessment where unit_id in (${units})`, [`${RUN_PREFIX}%`])
    await pool.query(`delete from unit_membership where unit_id in (${units})`, [`${RUN_PREFIX}%`])
    await pool.query(`delete from unit_holder where full_name like $1`, [`${RUN_PREFIX}%`])
    await pool.query(`delete from unit where unit_number like $1`, [`${RUN_PREFIX}%`])
    await pool.query(`delete from board_member where email like $1`, [`${RUN_PREFIX}%`])
    await pool.end()
  })

  describe('the ordinary case', () => {
    it('creates the unit, the holder, the tenure and the assessment', async () => {
      const number = unitNumber('ordinary')
      const documentId = await newDocument()

      await createRollRepository({ pool }).apply(documentId, [row({ unitNumber: number })])

      expect(await unitIdFor(number)).not.toBeNull()

      // Checked by value, not by count. A row count passes against an insert
      // that wrote nulls into every column.
      expect(await tenuresFor(number)).toEqual([
        { full_name: `${RUN_PREFIX} Jane Smith`, held_from: '2019-03-01', held_until: null },
      ])
      expect(await assessmentsFor(number)).toEqual([
        { assessment_year: 2026, annual_amount: '3600.00', billing_cycle: 'monthly' },
      ])
    })

    it('stores the unit number as the roll spelled it', async () => {
      const number = unitNumber('Spelling')
      const documentId = await newDocument()

      await createRollRepository({ pool }).apply(documentId, [row({ unitNumber: number })])

      const { rows } = await pool.query<{ unit_number: string }>(
        'select unit_number from unit where normalised_number = unit_normalised_number($1)',
        [number],
      )

      expect(rows[0]!.unit_number).toBe(number)
    })

    it('writes several units in one roll', async () => {
      const documentId = await newDocument()
      const a = unitNumber('many-a')
      const b = unitNumber('many-b')

      await createRollRepository({ pool }).apply(documentId, [
        row({ unitNumber: a }),
        row({ unitNumber: b, holderName: `${RUN_PREFIX} John Doe`, annualAmount: '4800.00' }),
      ])

      expect(await tenuresFor(a)).toHaveLength(1)
      expect((await tenuresFor(b))[0]!.full_name).toBe(`${RUN_PREFIX} John Doe`)
      expect((await assessmentsFor(b))[0]!.annual_amount).toBe('4800.00')
    })

    it('names a document that does not exist, rather than failing on a foreign key', async () => {
      // The lock is a `select ... for update`, which matches nothing and
      // succeeds when the id is unknown — the transaction then ran on to a raw
      // 23503 from `unit_holder`. Raised by review.
      const absent = '00000000-0000-4000-8000-000000000000'

      await expect(
        createRollRepository({ pool }).apply(absent, [row({ unitNumber: unitNumber('ghost') })]),
      ).rejects.toThrow(/document .* was not found/i)
    })

    it('refuses an empty roll rather than deleting what the document wrote', async () => {
      const documentId = await newDocument()

      await expect(createRollRepository({ pool }).apply(documentId, [])).rejects.toThrow(
        /at least one row/i,
      )
    })
  })

  describe('the same roll, applied again', () => {
    it('does not duplicate the unit, the tenure or the assessment', async () => {
      const number = unitNumber('again')
      const documentId = await newDocument()
      const repository = createRollRepository({ pool })

      await repository.apply(documentId, [row({ unitNumber: number })])
      await repository.apply(documentId, [row({ unitNumber: number })])

      expect(await tenuresFor(number)).toHaveLength(1)
      expect(await assessmentsFor(number)).toHaveLength(1)

      const { rows } = await pool.query<{ n: string }>(
        'select count(*)::text as n from unit where normalised_number = unit_normalised_number($1)',
        [number],
      )
      expect(Number(rows[0]!.n)).toBe(1)
    })

    it('leaves a payment recorded against the unit exactly where it was', async () => {
      // The assertion this story was written around. If `apply` ever deletes and
      // re-creates units, this fails — either loudly on the foreign key, or
      // silently once someone "fixes" that with an on delete cascade, which
      // would take every payment ever recorded against the unit with it.
      const number = unitNumber('paid')
      const documentId = await newDocument()
      const repository = createRollRepository({ pool })

      await repository.apply(documentId, [row({ unitNumber: number })])

      const unitId = await unitIdFor(number)
      const depositId = await newDocument()
      await pool.query(
        `insert into payment (unit_id, document_id, paid_on, amount, association_id) values ($1, $2, '2026-03-01'::date, '300.00', '00000000-0000-7000-8000-000000000001')`,
        [unitId, depositId],
      )

      await repository.apply(documentId, [row({ unitNumber: number, annualAmount: '3900.00' })])

      const { rows } = await pool.query<{ unit_id: string; amount: string }>(
        'select unit_id, amount from payment where document_id = $1',
        [depositId],
      )

      expect(rows).toEqual([{ unit_id: unitId, amount: '300.00' }])
      // And the unit is the same row, not a replacement wearing the same number.
      expect(await unitIdFor(number)).toBe(unitId)
    })

    it('updates the assessment when a corrected roll states a new amount', async () => {
      const number = unitNumber('corrected')
      const documentId = await newDocument()
      const repository = createRollRepository({ pool })

      await repository.apply(documentId, [row({ unitNumber: number })])
      await repository.apply(documentId, [
        row({ unitNumber: number, annualAmount: '4200.00', billingCycle: 'annual' }),
      ])

      expect(await assessmentsFor(number)).toEqual([
        { assessment_year: 2026, annual_amount: '4200.00', billing_cycle: 'annual' },
      ])
    })

    it('keeps one assessment per year and adds the next year beside it', async () => {
      const number = unitNumber('two-years')
      const documentId = await newDocument()

      await createRollRepository({ pool }).apply(documentId, [
        row({ unitNumber: number }),
        row({ unitNumber: number, assessmentYear: 2027, annualAmount: '3700.00' }),
      ])

      expect(await assessmentsFor(number)).toEqual([
        { assessment_year: 2026, annual_amount: '3600.00', billing_cycle: 'monthly' },
        { assessment_year: 2027, annual_amount: '3700.00', billing_cycle: 'monthly' },
      ])
    })
  })

  describe('a unit already recorded in another spelling', () => {
    it('folds onto the existing unit rather than creating a second', async () => {
      const documentId = await newDocument()
      const repository = createRollRepository({ pool })

      await repository.apply(documentId, [row({ unitNumber: unitNumber('4B') })])
      const first = await unitIdFor(unitNumber('4B'))

      // A later tenure, deliberately. The same unit claimed from the same day
      // by a second document is the conflict case and has its own test; what is
      // under test here is only that `4b  ` folds onto `4B`.
      const other = await newDocument()
      await repository.apply(other, [
        row({ unitNumber: `${unitNumber('4b')}  `, heldFrom: '2026-07-01' }),
      ])

      expect(await unitIdFor(unitNumber('4B'))).toBe(first)
    })
  })

  describe('one roll, inconsistent about its own spelling', () => {
    it('resolves both spellings to the one unit', async () => {
      // Found by mutation: matching `unit.unit_number = reference` instead of
      // folding survived every other test here, because the upsert rewrites the
      // stored spelling to the roll's and a raw lookup then finds it. It only
      // fails when one roll spells the same unit two ways — the upsert keeps one
      // spelling, and the other row's raw lookup finds nothing.
      const documentId = await newDocument()

      await createRollRepository({ pool }).apply(documentId, [
        row({ unitNumber: unitNumber('7C'), assessmentYear: 2026 }),
        row({ unitNumber: unitNumber('7c'), assessmentYear: 2027, annualAmount: '3700.00' }),
      ])

      expect(await assessmentsFor(unitNumber('7C'))).toEqual([
        { assessment_year: 2026, annual_amount: '3600.00', billing_cycle: 'monthly' },
        { assessment_year: 2027, annual_amount: '3700.00', billing_cycle: 'monthly' },
      ])

      // One unit, not two, and one tenure — the years differ, the tenure does not.
      expect(await tenuresFor(unitNumber('7C'))).toHaveLength(1)
    })
  })

  describe('a unit that changes hands', () => {
    it('bounds two tenures stated by the same roll against each other', async () => {
      // Found by mutation: the upper bound looked only at tenures already
      // recorded, so two tenures for one unit arriving in the *same* roll
      // overlapped. A roll covering two years across a sale is exactly that.
      const number = unitNumber('sold-within')
      const documentId = await newDocument()

      await createRollRepository({ pool }).apply(documentId, [
        row({ unitNumber: number, heldFrom: '2019-03-01', assessmentYear: 2026 }),
        row({
          unitNumber: number,
          heldFrom: '2026-07-01',
          holderName: `${RUN_PREFIX} John Doe`,
          assessmentYear: 2027,
        }),
      ])

      expect(await tenuresFor(number)).toEqual([
        {
          full_name: `${RUN_PREFIX} Jane Smith`,
          held_from: '2019-03-01',
          held_until: '2026-07-01',
        },
        { full_name: `${RUN_PREFIX} John Doe`, held_from: '2026-07-01', held_until: null },
      ])
    })


    it('closes the previous tenure on the day the next begins', async () => {
      // Story 2.1's acceptance criterion, met by the writer: the previous
      // membership is closed with an end date rather than overwritten.
      const number = unitNumber('sold')
      const repository = createRollRepository({ pool })

      const first = await newDocument()
      await repository.apply(first, [row({ unitNumber: number, heldFrom: '2019-03-01' })])

      const second = await newDocument()
      await repository.apply(second, [
        row({ unitNumber: number, heldFrom: '2026-07-01', holderName: `${RUN_PREFIX} John Doe` }),
      ])

      expect(await tenuresFor(number)).toEqual([
        {
          full_name: `${RUN_PREFIX} Jane Smith`,
          held_from: '2019-03-01',
          held_until: '2026-07-01',
        },
        { full_name: `${RUN_PREFIX} John Doe`, held_from: '2026-07-01', held_until: null },
      ])
    })

    it('ends a backdated tenure where the one already recorded begins', async () => {
      // A roll uploaded out of order. Inserting an open range would overlap and
      // the exclusion constraint would refuse the document; the new tenure ends
      // where the recorded one starts instead.
      const number = unitNumber('backdated')
      const repository = createRollRepository({ pool })

      const later = await newDocument()
      await repository.apply(later, [
        row({ unitNumber: number, heldFrom: '2026-07-01', holderName: `${RUN_PREFIX} John Doe` }),
      ])

      const earlier = await newDocument()
      await repository.apply(earlier, [row({ unitNumber: number, heldFrom: '2019-03-01' })])

      expect(await tenuresFor(number)).toEqual([
        {
          full_name: `${RUN_PREFIX} Jane Smith`,
          held_from: '2019-03-01',
          held_until: '2026-07-01',
        },
        { full_name: `${RUN_PREFIX} John Doe`, held_from: '2026-07-01', held_until: null },
      ])
    })

    it('refuses a start that falls inside a tenure already closed', async () => {
      // Raised by CodeRabbit. The conflict check matched only an exact start, so
      // a date landing *within* a bounded tenure slipped past it: the close-update
      // skips bounded ranges, and the insert then computed a range overlapping
      // the recorded one. The result was a raw 23P01 rather than a sentence
      // naming the unit — the treasurer gets an unhelpable error for a document
      // that genuinely contradicts recorded history.
      const number = unitNumber('inside')
      const repository = createRollRepository({ pool })

      const first = await newDocument()
      await repository.apply(first, [row({ unitNumber: number, heldFrom: '2019-03-01' })])

      // Closes the first at 2026-07-01, leaving it bounded.
      const second = await newDocument()
      await repository.apply(second, [
        row({ unitNumber: number, heldFrom: '2026-07-01', holderName: `${RUN_PREFIX} John Doe` }),
      ])

      const third = await newDocument()
      // The date named must be the roll's row, not the recorded tenure's start —
      // 2019-03-01 appears nowhere on the treasurer's document. Raised by review.
      const refusal = await repository
        .apply(third, [
          row({ unitNumber: number, heldFrom: '2022-01-01', holderName: `${RUN_PREFIX} Third` }),
        ])
        .catch((error: unknown) => error)

      expect(refusal).toBeInstanceOf(ConflictingTenureError)
      expect((refusal as Error).message).toMatch(
        /another document already records .* from 2022-01-01/i,
      )

      // And the two recorded tenures are untouched.
      expect(await tenuresFor(number)).toHaveLength(2)
    })

    it('still admits a start on the day a closed tenure ended', async () => {
      // The boundary the rule above must not swallow. `held_during` is half-open,
      // so a tenure ending 2026-07-01 does not contain that day — the next one
      // begins on it, with no overlap and no gap.
      const number = unitNumber('abutting')
      const repository = createRollRepository({ pool })

      const first = await newDocument()
      await repository.apply(first, [row({ unitNumber: number, heldFrom: '2019-03-01' })])

      const second = await newDocument()
      await repository.apply(second, [
        row({ unitNumber: number, heldFrom: '2026-07-01', holderName: `${RUN_PREFIX} John Doe` }),
      ])

      expect(await tenuresFor(number)).toEqual([
        {
          full_name: `${RUN_PREFIX} Jane Smith`,
          held_from: '2019-03-01',
          held_until: '2026-07-01',
        },
        { full_name: `${RUN_PREFIX} John Doe`, held_from: '2026-07-01', held_until: null },
      ])
    })

    it('refuses two documents claiming one unit from the same day', async () => {
      // Closing the earlier tenure at the new start would make `[d,d)` — an
      // empty range, which `unit_membership_has_a_start` refuses because every
      // empty daterange has a null lower bound. Deleting the other document's
      // tenure would let one upload silently overwrite another's. So a human
      // decides, and the message says which unit.
      const number = unitNumber('conflict')
      const repository = createRollRepository({ pool })

      const first = await newDocument()
      await repository.apply(first, [row({ unitNumber: number, heldFrom: '2020-01-01' })])

      const second = await newDocument()

      const refusal = await repository
        .apply(second, [
          row({ unitNumber: number, heldFrom: '2020-01-01', holderName: `${RUN_PREFIX} Other` }),
        ])
        .catch((error: unknown) => error)

      expect(refusal).toBeInstanceOf(ConflictingTenureError)
      expect((refusal as Error).message).toMatch(
        /another document already records .* from 2020-01-01/i,
      )

      // And nothing from the refused document was written.
      expect(await tenuresFor(number)).toHaveLength(1)
    })
  })

  describe('what the port refuses on its own, without the reader in front of it', () => {
    /**
     * `readRows` already refuses a roll naming one unit twice for one year, so
     * these cases cannot arrive through an upload today. They are guarded here
     * anyway, and tested by calling the port directly, for the reason
     * `isStorableName` gives for itself: "the caller will not send that" is the
     * assumption a boundary exists to stop depending on. Every one of them
     * otherwise reaches Postgres as an opaque abort of the whole transaction.
     */
    it('drops a duplicate unit-year rather than aborting on a cardinality violation', async () => {
      // `on conflict` cannot affect one row twice: an un-deduplicated pair
      // raises 21000 and takes the whole roll with it.
      const number = unitNumber('dup-year')
      const documentId = await newDocument()

      await createRollRepository({ pool }).apply(documentId, [
        row({ unitNumber: number, annualAmount: '3600.00' }),
        row({ unitNumber: number, annualAmount: '9900.00' }),
      ])

      // The first row wins, deterministically — the spelling and the figure the
      // roll stated first, matching how vendor names are deduplicated.
      expect(await assessmentsFor(number)).toEqual([
        { assessment_year: 2026, annual_amount: '3600.00', billing_cycle: 'monthly' },
      ])
    })

    it('refuses a roll that contradicts itself about who holds a unit', async () => {
      // Two holders for one unit from one day. Silently keeping whichever row
      // came second is how real money ends up attributed to the wrong person.
      const number = unitNumber('contradiction')
      const documentId = await newDocument()

      // The message, not only the type. `ConflictingTenureError` carries two
      // remedies — correct this roll, or remove the other document — and
      // `toThrow(SomeType)` passes whichever one is reported. Raised by review.
      const refusal = await createRollRepository({ pool })
        .apply(documentId, [
          row({ unitNumber: number, assessmentYear: 2026 }),
          row({
            unitNumber: number,
            assessmentYear: 2027,
            holderName: `${RUN_PREFIX} Someone Else`,
          }),
        ])
        .catch((error: unknown) => error)

      expect(refusal).toBeInstanceOf(ConflictingTenureError)
      expect((refusal as Error).message).toMatch(/this roll gives unit .* more than one holder/i)
    })
  })

  describe('closing a tenure when the roll states more than one', () => {
    it('closes the recorded tenure at the earliest of the new ones in the roll', async () => {
      // `update ... from unnest(...)` matches every qualifying row and picks one
      // arbitrarily. With two new tenures for a unit that already has an open
      // one, closing it at the *later* date leaves the earlier new tenure
      // overlapping — and the exclusion constraint takes the whole document.
      const number = unitNumber('multi-close')
      const repository = createRollRepository({ pool })

      const first = await newDocument()
      await repository.apply(first, [row({ unitNumber: number, heldFrom: '2015-01-01' })])

      const second = await newDocument()
      await repository.apply(second, [
        row({ unitNumber: number, heldFrom: '2019-03-01', assessmentYear: 2026 }),
        row({
          unitNumber: number,
          heldFrom: '2026-07-01',
          holderName: `${RUN_PREFIX} John Doe`,
          assessmentYear: 2027,
        }),
      ])

      expect(await tenuresFor(number)).toEqual([
        {
          full_name: `${RUN_PREFIX} Jane Smith`,
          held_from: '2015-01-01',
          held_until: '2019-03-01',
        },
        {
          full_name: `${RUN_PREFIX} Jane Smith`,
          held_from: '2019-03-01',
          held_until: '2026-07-01',
        },
        { full_name: `${RUN_PREFIX} John Doe`, held_from: '2026-07-01', held_until: null },
      ])
    })
  })

  describe('what it costs', () => {
    it('issues a fixed number of statements whatever the length of the roll', async () => {
      // Both replace() paths in this repository loop one insert per row and
      // carry an open action item for it. A roll is the same shape and there is
      // no reason to add a third.
      const counting = { count: 0 }

      // A delegating wrapper, not a mutation of the pooled client.
      //
      // The first version reassigned `client.query` on whatever `pool.connect()`
      // handed back. That poisons the shared pool: the wrapper survives release,
      // so a client reused later is still counting. It produced two bugs in a
      // row — every statement counted twice once a client was checked out
      // twice, and then `newDocument()` adding one because it happened to get
      // the wrapped client — and the second was patched around with a
      // reset-after-setup rather than fixed. Raised by review on that fix.
      //
      // A proxy leaves the pooled client untouched, so nothing outside this
      // measurement can be counted and nothing leaks past it.
      const countingPool = {
        connect: async () => {
          const client = await pool.connect()

          return new Proxy(client, {
            get(target, property, receiver) {
              if (property === 'query') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (...args: any[]) => {
                  counting.count += 1
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  return (target.query as any)(...args)
                }
              }

              const value = Reflect.get(target, property, receiver)
              return typeof value === 'function' ? value.bind(target) : value
            },
          })
        },
      } as unknown as Pool

      const measure = async (length: number, label: string): Promise<number> => {
        const documentId = await newDocument()
        counting.count = 0

        await createRollRepository({ pool: countingPool }).apply(
          documentId,
          Array.from({ length }, (_, index) => row({ unitNumber: unitNumber(`${label}-${index}`) })),
        )
        return counting.count
      }

      const few = await measure(2, 'few')
      const many = await measure(12, 'many')

      // Equal, not merely "fewer than twelve". An absolute bound passes against
      // a loop that happens to be under it, and says nothing about growth — the
      // property worth pinning is that the count does not depend on the length
      // of the roll at all. Raised by review.
      expect(many).toBe(few)
      expect(few).toBeGreaterThan(0)
    })
  })
})
