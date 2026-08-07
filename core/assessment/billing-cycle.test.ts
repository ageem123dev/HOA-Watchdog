/**
 * The billing cycle vocabulary, and its agreement with migration 013.
 *
 * The parity tests here read the migration rather than restating its list, for
 * the reason migration 007's own comment gives: "a second statement of a shape
 * is only safe when something fails on disagreement." Two places naming the same
 * three values is fine; two places that can quietly disagree is not.
 *
 * Structured after `core/extraction/record.test.ts`, which established this shape
 * against migration 006 — including the empty-list guard, which exists because a
 * comparison of nothing to nothing shipped twice during story 1.4.
 *
 * The migration is read with `readFileSync` at runtime rather than imported, so
 * nothing under `core/` gains an outward import (`core/ports/boundary.test.ts`).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { BILLING_CYCLES, type BillingCycle } from './billing-cycle'

const migration = (): string =>
  readFileSync(join(process.cwd(), 'migrations', '013_assessment.sql'), 'utf8')

/** Quoted values inside a named `check (... in (...))` clause. */
function declaredList(constraint: string): string[] {
  // Case-insensitive: every migration here is written in lower-case SQL, but the
  // keywords are not the thing being asserted, and a future `CHECK (… IN (…))`
  // would make this parser silently match nothing — which the vacuity control
  // below would then catch as a failure whose cause looks like drift. Raised by
  // review. The constraint name is what anchors the match, not the keywords.
  const clause = new RegExp(`${constraint} check \\(\\s*[a-z_]+ in \\(([^)]*)\\)`, 'i').exec(
    migration(),
  )

  expect(clause, `migration 013 no longer declares ${constraint}`).not.toBeNull()

  const values = Array.from(clause![1]!.matchAll(/'([^']+)'/g), (m) => m[1]).filter(
    (v): v is string => v !== undefined,
  )

  // Without this the comparison below can pass by comparing nothing to nothing.
  expect(values.length, `${constraint} parsed to an empty list`).toBeGreaterThan(0)

  return values
}

describe('the billing cycle vocabulary', () => {
  describe('agreement with migration 013', () => {
    it('publishes exactly the cycles the database admits', () => {
      // Set equality, so it fails in BOTH directions. A one-way check — every
      // constant appears in the SQL — passes when the migration carries a fourth
      // value the application has never heard of, and a row written with it
      // would be admitted by the database and unhandled by every consumer.
      expect([...BILLING_CYCLES].sort()).toEqual(declaredList('assessment_cycle_known').sort())
    })

    it('parses a real list out of the migration, so the comparison is not vacuous', () => {
      // The control for the instrument. If the regex stopped matching — a
      // renamed constraint, a reformatted clause — `declaredList` would return
      // nothing and the equality above would compare two empty arrays.
      expect(declaredList('assessment_cycle_known').length).toBe(3)
    })
  })

  describe('the constant itself', () => {
    it('is frozen, so a caller cannot extend the vocabulary at runtime', () => {
      // The database would reject a fourth cycle; this makes the application
      // unable to invent one in the first place, which is the earlier failure.
      expect(Object.isFrozen(BILLING_CYCLES)).toBe(true)
    })

    it('names the three cycles the domain actually has', () => {
      // Stated once here, on purpose: the agreement test above proves the
      // migration matches, but two files agreeing on the *wrong* list would
      // satisfy it. This is the anchor.
      expect([...BILLING_CYCLES].sort()).toEqual(['annual', 'monthly', 'six_monthly'])
    })

    it('types a cycle as a union of its members, not as string', () => {
      // The first version of this assigned a literal to a `BillingCycle`
      // variable and claimed that stopped the type widening. It does not: an
      // assignment only proves assignability, and `const c: string = 'x'`
      // compiles just as happily. The comment asserted a property the code did
      // not check — the shape this project keeps finding. Raised by review.
      //
      // `string extends BillingCycle` is true only when the type is already as
      // wide as `string`, in which case the annotation resolves to `never` and
      // this line stops compiling. Verified by widening it: `tsc --noEmit` goes
      // from the baseline 8 errors to 9.
      const notWidened: string extends BillingCycle ? never : true = true

      const cycle: BillingCycle = 'six_monthly'

      expect(notWidened).toBe(true)
      expect(BILLING_CYCLES).toContain(cycle)
    })
  })
})
