import type { BillingCycle } from '../../core/assessment/billing-cycle'
import type { ReceivedPayment } from '../../core/detection/dues-shortfall'
import type { DuesReader, UnitDues } from '../../core/ports/dues-reader'
import { writerPool } from './pool'

/**
 * The `DuesReader` port backed by Postgres.
 *
 * ## Two queries for a whole document, whatever it holds
 *
 * One for the units and what they owe, one for the payments. Not one per unit —
 * see the port's note, and story 4.3's merge request for why.
 *
 * ## The holder comes from containment, never from recency
 *
 * `held_during @> $2::date`. The obvious alternative — the most recent
 * membership row — attributes a former holder's arrears to whoever lives there
 * now, and the epic names that as *"the kind of error a fiduciary tool cannot
 * make"*. Migration 012's gist exclusion on `(unit_id, held_during)` guarantees
 * at most one row matches, so this is a lookup rather than a choice.
 *
 * ## The roll is the driving table, and that was a correction
 *
 * `from assessment`, not `from payment`. Driving off the uploaded deposit's own
 * payments would have meant a unit that paid **nothing** — the first case FR-7
 * names — appeared on no deposit and was never checked. Found by the
 * acceptance-criteria audit, through an end-to-end test that could not raise the
 * finding it was written for.
 *
 * A unit with no assessment for the year is therefore absent rather than present
 * owing nothing. Nothing was owed, so nothing can be missing.
 *
 * ## The writer credential
 *
 * Shared with the other detectors' adapters, for the reason
 * `invoice-reader-postgres.ts` gives: `watchdog_reader` is the LLM-driven query
 * path's role and has no business running detection.
 */

interface UnitRow {
  unit_id: string
  unit_number: string
  annual_amount: string
  billing_cycle: string
  holder_name: string | null
}

interface PaymentRow {
  unit_id: string
  paid_on: string
  amount: string
}

export function createDuesReader(): DuesReader {
  return {
    async evaluationDateFor(documentId: string): Promise<string | null> {
      // **`at time zone 'UTC'`, and the cast is the whole point.** `to_char` on
      // a `timestamptz` renders it in the *session's* timezone, so the same
      // document answered 2026-07-01 here and 2026-06-30 on a connection set to
      // America/Los_Angeles — measured, not reasoned about. This day decides
      // which instalments have fallen due, so a session setting nobody thinks
      // about would move an arrears finding by a month.
      //
      // Pinning it to UTC makes the answer a property of the document. Raised
      // by CodeRabbit against a comment that already warned about rendering an
      // instant as a day and then did it anyway.
      const { rows } = await writerPool().query<{ on: string }>(
        `select to_char(uploaded_at at time zone 'UTC', 'YYYY-MM-DD') as on
           from document where id = $1`,
        [documentId],
      )

      return rows[0]?.on ?? null
    },

    async yearsCoveredBy(documentId: string): Promise<readonly number[]> {
      // `extract` off the `date` column rather than off a timestamp: `paid_on`
      // is a calendar day, so no timezone can move it across a year boundary.
      // `::int` because `extract` returns numeric, which `pg` hands back as a
      // string, and a string year would build the period range `"2026"-01-01`.
      const { rows } = await writerPool().query<{ year: number }>(
        `select distinct extract(year from p.paid_on)::int as year
           from payment p
          where p.document_id = $1
          order by year`,
        [documentId],
      )

      return rows.map((row) => row.year)
    },

    async duesForYear(year: number, on: string): Promise<readonly UnitDues[]> {
      // Bound parameters throughout (AD-8). `on` reaches a `::date` cast and a
      // range containment, both of which would be an injection point spelled
      // any other way.
      const { rows: units } = await writerPool().query<UnitRow>(
        `select u.id            as unit_id,
                u.unit_number   as unit_number,
                a.annual_amount::text as annual_amount,
                a.billing_cycle as billing_cycle,
                h.full_name     as holder_name
           from assessment a
           join unit u on u.id = a.unit_id
           left join unit_membership m
                  on m.unit_id = u.id
                 and m.held_during @> $2::date
           left join unit_holder h on h.id = m.holder_id
          where a.assessment_year = $1
          order by u.unit_number`,
        [year, on],
      )

      if (units.length === 0) return []

      // Every payment for those units in the year, not only the ones this
      // document carried: a unit's standing is the sum of what arrived.
      const { rows: payments } = await writerPool().query<PaymentRow>(
        `select p.unit_id,
                to_char(p.paid_on, 'YYYY-MM-DD') as paid_on,
                p.amount::text as amount
           from payment p
          where p.unit_id = any($1::uuid[])
            and p.paid_on >= make_date($2::int, 1, 1)
            and p.paid_on <  make_date($2::int + 1, 1, 1)
          order by p.paid_on, p.id`,
        [units.map((unit) => unit.unit_id), year],
      )

      const byUnit = new Map<string, ReceivedPayment[]>()
      for (const payment of payments) {
        const forUnit = byUnit.get(payment.unit_id) ?? []
        forUnit.push({ paidOn: payment.paid_on, amount: payment.amount })
        byUnit.set(payment.unit_id, forUnit)
      }

      return units.map((unit) => ({
        unitId: unit.unit_id,
        unitNumber: unit.unit_number,
        // Not nullable, and that is structural: the query selects *from*
        // `assessment`, so a unit without one is absent rather than present
        // owing nothing. Both columns are `not null` on that table.
        assessment: {
          annualAmount: unit.annual_amount,
          billingCycle: unit.billing_cycle as BillingCycle,
          assessmentYear: year,
        },
        payments: byUnit.get(unit.unit_id) ?? [],
        holderName: unit.holder_name,
      }))
    },
  }
}
