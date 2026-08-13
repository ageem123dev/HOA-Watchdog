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
 * ## A missing assessment is a null, not a zero
 *
 * The join is a `left join` and `annual_amount` comes back null when no
 * assessment exists for that unit and year. Turning it into `0` here would make
 * "nothing was owed" indistinguishable from "everything is missing" — and the
 * second reads as a finding against a unit whose only mistake is not being on
 * the roll yet.
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
  annual_amount: string | null
  billing_cycle: string | null
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
      // `to_char`, not a `Date`. A calendar day rendered from an instant is the
      // day before for anyone west of Greenwich, and this day decides which
      // instalments have fallen due — an off-by-one here is an arrears finding
      // raised a month early. `invoice-reader-postgres.ts` names the same trap.
      const { rows } = await writerPool().query<{ on: string }>(
        `select to_char(uploaded_at, 'YYYY-MM-DD') as on from document where id = $1`,
        [documentId],
      )

      return rows[0]?.on ?? null
    },

    async duesForDocument(
      documentId: string,
      year: number,
      on: string,
    ): Promise<readonly UnitDues[]> {
      // Bound parameters throughout (AD-8). `on` reaches a `::date` cast and a
      // range containment, both of which would be an injection point spelled
      // any other way.
      const { rows: units } = await writerPool().query<UnitRow>(
        `select distinct
                u.id            as unit_id,
                u.unit_number   as unit_number,
                a.annual_amount::text as annual_amount,
                a.billing_cycle as billing_cycle,
                h.full_name     as holder_name
           from payment p
           join unit u on u.id = p.unit_id
           left join assessment a
                  on a.unit_id = u.id
                 and a.assessment_year = $2
           left join unit_membership m
                  on m.unit_id = u.id
                 and m.held_during @> $3::date
           left join unit_holder h on h.id = m.holder_id
          where p.document_id = $1
          order by u.unit_number`,
        [documentId, year, on],
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
        // Both columns come from the same row, so one being null means the
        // assessment is absent. `billing_cycle` is checked too rather than
        // asserted, because a non-null amount with a null cycle would otherwise
        // reach `deriveSchedule` and throw where returning null is the answer.
        assessment:
          unit.annual_amount === null || unit.billing_cycle === null
            ? null
            : {
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
