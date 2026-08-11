/**
 * `dues_status@1` — what one unit owes for one year, and what has arrived.
 *
 * The first catalog entry, and the epic file says why it is this one: "With Epic
 * 2 built, `dues_status` becomes the natural first entry and exercises AD-6's
 * derived-values rule."
 *
 * ## AD-6, which is the point of the SELECT list
 *
 * "A catalog entry must return all values its answers reference, **including
 * derived ones**." So `balanceOutstanding` is computed here, in SQL, rather than
 * returned as two numbers for something downstream to subtract. AD-7 forbids the
 * reasoning model from producing a numeral that is not in the tool result, which
 * means a missing derived value is not a small gap — it makes the honest answer
 * unreachable and puts the model into a validator rejection loop.
 *
 * ## Two questions this deliberately does not answer
 *
 * **Nothing about instalments or arrears-to-date.** "What is overdue today"
 * needs the payment schedule, and `core/assessment/schedule.ts` already derives
 * it in TypeScript, with a remainder rule and its own tests. Restating that in
 * SQL would be a second statement of one shape with nothing failing on
 * disagreement — the mistake migration 007's comment records this project
 * learning. It belongs in a later entry that consumes the schedule.
 *
 * **Nothing about who held the unit.** That is the temporal join across
 * `unit_membership` and its exclusion constraint. A real question, and not this
 * one.
 *
 * ## The attribution rule, stated because it is a limitation
 *
 * `payment` records `paid_on` and no period. This entry therefore attributes a
 * payment to the assessment year its `paid_on` falls in, so a January 2027
 * payment settling 2026 dues counts against 2027. Fixing that means knowing
 * which period a payment settles, which is data the ingestion path does not
 * capture — and when it does, the fix is `dues_status@2`. It is never an edit
 * here: every `query_log` row naming `dues_status@1` claims to identify this
 * exact text, forever (AD-14).
 */

import type { CatalogEntry } from '../entry'

/**
 * Notes on the SQL, in the order a reader meets them.
 *
 * `unit_normalised_number($1)` rather than the raw column, so `4b ` off a roll
 * finds `4B`. Migration 011 defines the folding and pins its `search_path`;
 * `adapters/db/assessment-directory-postgres.ts` matches the same way, and the
 * two must not diverge.
 *
 * Columns are aliased to camelCase and named one by one. `select *` would carry
 * `normalised_number` — a comparison key no human has a use for — and both
 * tables' ids, which no caller needs and AD-16's reasoning says should not
 * travel toward the reasoning side for free.
 *
 * **No cast on any amount except to fix its scale.** `pg` maps `numeric` to a
 * decimal string, and that *is* the money contract: never a float, never a JS
 * `number`. The one cast present, `::numeric(14,2)`, is there because
 * `coalesce(sum(...), 0)` on a unit with no payments yields `0` rather than
 * `0.00`, and an answer that reads "paid 0" beside "owes 1200.00" is a
 * formatting inconsistency in a financial figure. It changes the scale and never
 * the type. A `::float8` anywhere here would silently undo the whole decision.
 *
 * `count(payment.id)` and not `count(*)`: on a left join with no matching
 * payment, `count(*)` returns 1 — one row, produced by the join — and the answer
 * would report a unit that has never paid as having made one payment.
 *
 * The year filter is a **half-open range on `paid_on`**, not
 * `extract(year from payment.paid_on) = …`. The two select the same rows; only
 * one of them can use an index on `paid_on`. Wrapping the column in a function
 * makes the predicate unsargable, so every dues question would scan `payment` in
 * full — on the table that grows fastest, and from the path a board member waits
 * on. There is no such index today, which is exactly why this is worth settling
 * now: an entry version is frozen once it runs in production (AD-14), and the
 * fix afterwards is a new version rather than an edit.
 */
export const duesStatusV1: CatalogEntry = {
  id: 'dues_status',
  version: 1,

  // What the model chooses on. It names the two things that make this entry the
  // wrong answer to a neighbouring question — it is *one* unit and *one* year,
  // and it is a year-to-date total rather than an instalment schedule. The
  // header above records why the schedule is deliberately not here.
  description:
    'What one unit owes for one assessment year, the payments received during that year, ' +
    'and the outstanding balance. Covers a single unit and a single year. Payments are ' +
    'counted by the year they were received in, not the year they settle, so this cannot ' +
    'answer which assessment a payment paid off. Does not say what is overdue today, does ' +
    'not break the year into instalments, and does not say who held the unit.',

  sql: `select unit.unit_number                                    as "unitNumber",
       assessment.assessment_year                            as "assessmentYear",
       assessment.annual_amount                              as "annualAmount",
       coalesce(sum(payment.amount), 0)::numeric(14,2)       as "amountPaid",
       (assessment.annual_amount - coalesce(sum(payment.amount), 0))::numeric(14,2)
                                                             as "balanceOutstanding",
       count(payment.id)                                     as "paymentCount",
       max(payment.paid_on)                                  as "lastPaidOn"
  from assessment
  join unit on unit.id = assessment.unit_id
  left join payment
    on payment.unit_id = unit.id
   and payment.paid_on >= make_date(assessment.assessment_year, 1, 1)
   and payment.paid_on <  make_date(assessment.assessment_year + 1, 1, 1)
 where unit.normalised_number = unit_normalised_number($1)
   and assessment.assessment_year = $2
 group by unit.unit_number, assessment.assessment_year, assessment.annual_amount`,

  parameters: {
    type: 'object',
    properties: {
      unitNumber: {
        type: 'string',
        description:
          'The unit number as it appears on the association roll, for example "4B". Matching ignores case and surrounding spaces.',
      },
      assessmentYear: {
        type: 'integer',
        description: 'The four-digit year the assessment is for, for example 2026.',
      },
    },
    required: ['unitNumber', 'assessmentYear'],
    additionalProperties: false,
  },

  bind: ['unitNumber', 'assessmentYear'],
}
