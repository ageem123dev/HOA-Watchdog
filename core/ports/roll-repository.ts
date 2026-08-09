/**
 * The port through which an uploaded assessment roll becomes rows.
 *
 * A write port, and the **only** thing in this system that may create a unit.
 * `core/ports/unit-directory.ts` and `core/ports/assessment-directory.ts` both
 * argue in their own docblocks that the absence of a write method *is* their
 * design, and both have tests that fail when a method is added. Neither may gain
 * one: a deposit naming a unit nobody recorded must produce a question for a
 * human, not a new unit, and that holds because the deposit path cannot reach
 * this port at all.
 *
 * Single ownership of unit identity, in the manner AD-14 fixes single ownership
 * of vendor identity.
 */

import type { RollRow } from '../extraction/roll'

/**
 * Two rolls disagree about who held one unit from one day.
 *
 * Its own error because it is the one conflict this path cannot resolve without
 * inventing history. Closing the earlier tenure at the new start would produce
 * `[d,d)` — an empty range, which `unit_membership_has_a_start` refuses, since
 * every empty `daterange` has a null lower bound. Deleting another document's
 * tenure would let one upload silently overwrite what a different one recorded.
 *
 * So the document is refused and a human decides. The message names the unit,
 * because "a roll could not be applied" is not something a treasurer can act on.
 */
export class ConflictingTenureError extends Error {
  constructor(
    readonly unitNumber: string,
    readonly heldFrom: string,
    /**
     * Which conflict this is. The remedy differs, so the sentence does too — a
     * treasurer told only "there is a conflict" has to go and find out which of
     * the two situations they are in.
     */
    readonly source: 'another-document' | 'this-roll' = 'another-document',
  ) {
    super(
      source === 'this-roll'
        ? `This roll gives unit ${unitNumber} more than one holder from ${heldFrom}. ` +
            'Correct the duplicate rows and upload it again.'
        : `Another document already records who held unit ${unitNumber} from ${heldFrom}. ` +
            'Remove that roll, or correct this one, before uploading it again.',
    )
    this.name = 'ConflictingTenureError'
  }
}

export interface RollRepository {
  /**
   * Apply a roll: create or update what it states, in one transaction.
   *
   * **Called `apply`, deliberately not `replace`**, because the grain differs per
   * table and a name promising uniform replacement would be a lie in the
   * signature — the difference *is* the hazard this story was written around:
   *
   * - **`unit`** is upserted on `normalised_number` and **never deleted**.
   *   `unit_membership`, `assessment` and `payment` all reference it with no
   *   `on delete` action, so a delete fails loudly on any unit that has been
   *   paid — and the `on delete cascade` reached for to make that delete
   *   succeed would erase every payment ever recorded against it. A unit
   *   dropped from a corrected roll therefore stays; removing one is a decision
   *   a human makes, never a side effect of an upload.
   * - **`unit_holder` and `unit_membership`** are owned by the document that
   *   wrote them (migration 019) and are deleted and re-written on re-apply.
   *   That is the only formulation that is exactly idempotent without matching a
   *   holder by name, which migration 012 forbids in as many words.
   * - **`assessment`** is upserted on `(unit_id, assessment_year)`, the grain
   *   `assessment_one_per_unit_year` already names.
   *
   * A tenure recorded by a *different* document is closed rather than replaced,
   * so a unit changing hands leaves the previous membership ended on the day the
   * next begins — story 2.1's acceptance criterion, met by the writer rather
   * than assumed of the data.
   *
   * **An empty list is refused**, not obeyed, for the reason
   * `PaymentRepository.replace` refuses one: it reads identically to "the
   * document stated nothing", and obeying it would delete the tenures this
   * document wrote and call the deletion a roll.
   *
   * @throws {RangeError} when `rows` is empty
   * @throws {ConflictingTenureError} when another document already records a
   *   tenure for one of these units beginning on the same day
   */
  apply(documentId: string, rows: readonly RollRow[]): Promise<void>
}
