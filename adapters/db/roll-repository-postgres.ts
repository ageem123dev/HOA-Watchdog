import { Pool, type PoolClient } from 'pg'

import type { RollRow } from '../../core/extraction/roll'
import { ConflictingTenureError, type RollRepository } from '../../core/ports/roll-repository'
import { writerPool } from './pool'

/**
 * The `RollRepository` port backed by Postgres.
 *
 * Connects as `watchdog_writer`, and is the only thing in this system that may
 * create a unit. Everything else that touches units reads.
 *
 * **Every statement below is set-based.** `extraction-repository-postgres.ts`
 * and `payment-repository-postgres.ts` both insert one row per record in a
 * `for` loop and both carry an open action item for it; a roll is the same shape
 * and there is no reason to add a third. The cost is a little array marshalling
 * and the benefit is a fixed number of round trips whatever the association's
 * size.
 */

export function createRollRepository(options: { pool?: Pool } = {}): RollRepository {
  const pool = () => options.pool ?? writerPool()

  return {
    async apply(documentId: string, rows: readonly RollRow[]): Promise<void> {
      // Refused rather than obeyed, for the reason `PaymentRepository.replace`
      // refuses one: an empty list reads identically to "the document stated
      // nothing", and obeying it would delete the tenures this document wrote
      // and call the deletion a roll.
      if (rows.length === 0) {
        throw new RangeError(
          'apply requires at least one row; clearing a document needs a deliberate removal',
        )
      }

      const unitNumbers = rows.map((row) => row.unitNumber)
      const holderNames = rows.map((row) => row.holderName)
      const heldFrom = rows.map((row) => row.heldFrom)
      const years = rows.map((row) => row.assessmentYear)
      const amounts = rows.map((row) => row.annualAmount)
      const cycles = rows.map((row) => row.billingCycle)

      const client: PoolClient = await pool().connect()
      let released = false

      try {
        await client.query('begin')

        // Lock the parent row first, as the payment repository does. Two
        // applications of the same document would otherwise both delete, both
        // insert, and leave the document holding two readings at once.
        const locked = await client.query('select 1 from document where id = $1 for update', [
          documentId,
        ])

        // `select ... for update` matches nothing and succeeds when the id is
        // unknown, so the transaction ran on and met a raw 23503 from
        // `unit_holder` several statements later. Said plainly here instead.
        // Raised by review.
        if (locked.rowCount === 0) {
          throw new Error(`document ${documentId} was not found, so its roll cannot be applied`)
        }

        // Units, upserted and never deleted.
        //
        // `distinct on (unit_normalised_number(x))` matters: one roll may state
        // the same unit for two years, and `on conflict do update` raises 21000
        // if a single statement affects one row twice. Deduplicating by *the
        // database's* folding rather than by core's is deliberate — the two
        // disagree (JavaScript's `\s` matches U+3000 and migration 011's
        // character set does not), and only one of them decides identity here.
        //
        // The spelling is updated to the roll's, because migration 011 stores
        // `unit_number` as the treasurer typed it and this roll is the most
        // recent thing they typed.
        await client.query(
          `insert into unit (unit_number)
           select distinct on (unit_normalised_number(x)) x
             from unnest($1::text[]) with ordinality as t(x, n)
            order by unit_normalised_number(x), n
           on conflict (normalised_number) do update set unit_number = excluded.unit_number`,
          [unitNumbers],
        )

        const { rows: resolved } = await client.query<{ reference: string; id: string }>(
          `select r.reference as "reference", unit.id as "id"
             from unnest($1::text[]) as r(reference)
             join unit on unit.normalised_number = unit_normalised_number(r.reference)`,
          [unitNumbers],
        )

        // Keyed by the reference as given, exactly as `unitIdsFor` is and for
        // the same reason: the database decides which unit, the caller decides
        // the key, and the two foldings never have to agree.
        const unitIds = new Map(resolved.map((row) => [row.reference, row.id]))
        const rowUnitIds = rows.map((row) => {
          const unitId = unitIds.get(row.unitNumber)
          if (unitId === undefined) {
            // Unreachable: the upsert above created every one of these. Stated
            // rather than assumed, because a silent `undefined` here would
            // become a null unit_id and a not-null violation with no cause in it.
            throw new Error(`unit ${row.unitNumber} was not created by this roll`)
          }
          return unitId
        })

        // A roll contradicting itself about who holds a unit.
        //
        // The tenure insert below keeps one row per `(unit, held_from)`, because
        // a roll stating one unit for two years states one tenure twice. That
        // deduplication is right when the rows agree and **silently wrong when
        // they do not** — it would keep whichever the sort happened to put
        // first and drop the other holder without a word. Raised by review.
        //
        // Checked here rather than in the reader because it is only a
        // contradiction once the spellings have been resolved to one unit, and
        // the database is what resolves them.
        const claimedBy = new Map<string, string>()
        for (const [index, row] of rows.entries()) {
          const key = `${rowUnitIds[index]!}|${row.heldFrom}`
          const already = claimedBy.get(key)

          if (already !== undefined && already !== row.holderName) {
            throw new ConflictingTenureError(row.unitNumber, row.heldFrom, 'this-roll')
          }

          claimedBy.set(key, row.holderName)
        }

        // What this document wrote last time, removed before it writes again.
        // Memberships first: they reference the holders.
        await client.query('delete from unit_membership where document_id = $1', [documentId])
        await client.query('delete from unit_holder where document_id = $1', [documentId])

        // A tenure another document records that this one cannot be fitted
        // against. Two shapes, and the second was missed at first:
        //
        //   * it begins on **exactly** this day. Closing it at the new start
        //     would produce `[d,d)` — an empty range, which
        //     `unit_membership_has_a_start` refuses because every empty
        //     daterange has a null lower bound — and deleting it would let one
        //     upload silently overwrite what another recorded.
        //
        //   * this day falls **inside** a tenure that is already closed. The
        //     close-update below only touches open ranges, and the insert would
        //     then compute a range overlapping the bounded one — so the document
        //     failed with a raw 23P01 instead of a sentence naming the unit.
        //     Raised by CodeRabbit.
        //
        // The date reported is **the roll's**, not the recorded tenure's. They
        // are equal for the exact-start case and differ for the other: a row
        // stating 2022-01-01 against a recorded `[2019-03-01, 2026-07-01)` would
        // otherwise be told to correct 2019-03-01, which is not a date on the
        // treasurer's document at all. Raised by review.
        //
        // `not upper_inf(...)` is what keeps ordinary succession out of this:
        // an open tenure contains every later day, and a unit changing hands is
        // exactly that — handled by closing it, not by refusing the document.
        // `@>` is half-open like the column, so a start landing on the day a
        // closed tenure *ended* is not contained and is admitted.
        const { rows: conflicts } = await client.query<{
          unit_number: string
          held_from: string
        }>(
          `select u.unit_number as "unit_number",
                  to_char(r.held_from, 'YYYY-MM-DD') as "held_from"
             from unnest($1::uuid[], $2::date[]) as r(unit_id, held_from)
             join unit_membership m
               on m.unit_id = r.unit_id
              and m.held_during @> r.held_from
              and (lower(m.held_during) = r.held_from or not upper_inf(m.held_during))
             join unit u on u.id = m.unit_id
            limit 1`,
          [rowUnitIds, heldFrom],
        )

        const conflict = conflicts[0]
        if (conflict !== undefined) {
          throw new ConflictingTenureError(conflict.unit_number, conflict.held_from)
        }

        // A still-open tenure that began earlier is closed on the day this one
        // begins — story 2.1's "closed with an end date rather than overwritten".
        //
        // Closed at the **earliest** of the roll's new starts that falls after
        // it, computed per membership rather than joined. `update ... from
        // unnest(...)` matches every qualifying row and picks one arbitrarily,
        // so a roll stating two tenures for one unit could close the recorded
        // one at the later date — leaving the earlier new tenure overlapping,
        // and the exclusion constraint taking the whole document. Raised by
        // review; the regression test states three tenures in a row.
        await client.query(
          `update unit_membership m
              set held_during = daterange(
                    lower(m.held_during),
                    (select min(r.held_from)
                       from unnest($1::uuid[], $2::date[]) as r(unit_id, held_from)
                      where r.unit_id = m.unit_id
                        and r.held_from > lower(m.held_during))
                  )
            where upper_inf(m.held_during)
              and exists (
                    select 1
                      from unnest($1::uuid[], $2::date[]) as r(unit_id, held_from)
                     where r.unit_id = m.unit_id
                       and r.held_from > lower(m.held_during)
                  )`,
          [rowUnitIds, heldFrom],
        )

        // Holders and tenures in one statement, with the ids minted in the CTE
        // so the two inserts can be correlated.
        //
        // `returning` does not promise to echo input order, so pairing two
        // separate inserts by position would be undefined behaviour that happens
        // to work. Generating the key up front removes the question.
        //
        // **One tenure per unit per start date, not one per row.** A roll may
        // state the same unit for two years — an assessment each, one tenure —
        // and inserting a membership per row put two identical ranges on one
        // unit and tripped `unit_membership_no_overlap`. Found by the test for
        // two assessment years, which is why that test asserts through the real
        // constraint rather than against a fake.
        //
        // The upper bound is computed, not assumed: a tenure runs until the
        // earliest *other* tenure for that unit beginning after it, whether that
        // one is already recorded or is a sibling in this same roll. `least`
        // returns the smaller of the two and ignores a null, so a tenure with
        // nothing after it stays open. That is what lets a roll uploaded out of
        // order land as `[2019-03-01, 2026-07-01)` rather than overlapping the
        // tenure already recorded.
        await client.query(
          `with input as (
             select distinct on (unit_id, held_from)
                    uuidv7() as holder_id, unit_id, full_name, held_from
               from unnest($1::uuid[], $2::text[], $3::date[]) with ordinality
                    as t(unit_id, full_name, held_from, n)
              order by unit_id, held_from, n
           ),
           bounded as (
             select input.*,
                    least(
                      (select min(lower(m.held_during))
                         from unit_membership m
                        where m.unit_id = input.unit_id
                          and lower(m.held_during) > input.held_from),
                      (select min(sibling.held_from)
                         from input sibling
                        where sibling.unit_id = input.unit_id
                          and sibling.held_from > input.held_from)
                    ) as held_until
               from input
           ),
           new_holder as (
             insert into unit_holder (id, full_name, document_id)
             select holder_id, full_name, $4 from bounded
           )
           insert into unit_membership (unit_id, holder_id, held_during, document_id)
           select unit_id, holder_id, daterange(held_from, held_until), $4 from bounded`,
          [rowUnitIds, holderNames, heldFrom, documentId],
        )

        // Upserted at the grain `assessment_one_per_unit_year` already names. A
        // corrected roll states a new amount for a year already recorded, and
        // the correction is the point.
        await client.query(
          `insert into assessment (unit_id, assessment_year, annual_amount, billing_cycle)
           select distinct on (unit_id, assessment_year)
                  unit_id, assessment_year, annual_amount, billing_cycle
             from unnest($1::uuid[], $2::int[], $3::numeric[], $4::text[]) with ordinality
                  as t(unit_id, assessment_year, annual_amount, billing_cycle, n)
            order by unit_id, assessment_year, n
           on conflict (unit_id, assessment_year)
           do update set annual_amount = excluded.annual_amount,
                         billing_cycle = excluded.billing_cycle`,
          [rowUnitIds, years, amounts, cycles],
        )

        await client.query('commit')
      } catch (error) {
        // Rolled back so a failure midway leaves the previous roll intact. If
        // the rollback itself fails the connection is still inside a
        // transaction, and releasing it returns a poisoned client to the pool
        // for the next caller to inherit — destroyed instead.
        let rollbackFailed = false
        try {
          await client.query('rollback')
        } catch {
          rollbackFailed = true
        }
        client.release(rollbackFailed)
        released = true
        throw error
      } finally {
        if (!released) client.release()
      }
    },
  }
}
