/**
 * Who an alert goes to.
 *
 * The rule was decided on 2026-08-12 and is deliberately the simplest one
 * available: **every board member who is not disabled, and nobody else.** No
 * recipient model, no per-member preferences, no severity routing, and no
 * unsubscribe. For a pilot serving a handful of directors that is the right
 * amount of machinery, and it was chosen rather than defaulted into.
 *
 * Two consequences follow, and both are honest rather than incidental. A
 * director who has left the board keeps their audit trail and stops receiving
 * mail — the same rule sign-in already applies through `disabled_at`. And the
 * volume of findings *is* the volume of email; if that becomes unwelcome the
 * answer is a recipient model, not a quieter detector.
 *
 * ## A separate port from `UserDirectory`
 *
 * That one is authentication: look a member up by the address they typed, and
 * upgrade a hash whose parameters have fallen behind. Adding "list every address
 * on the board" to it would hand the sign-in path an enumeration of the whole
 * directory, and `finding.ts` already argues why that is the wrong shape — a
 * capability nothing declares is a capability nothing can quietly acquire.
 *
 * ## No `limit`, and this is the one read here that has none
 *
 * Every other read in this directory is bounded, because every other read is
 * over a table that grows without bound. The board is not: it is a handful of
 * directors, fixed by the association rather than by usage.
 *
 * And the failure a limit would cause is precisely the failure this whole story
 * exists to prevent. A bounded read silently drops a director from a warning,
 * with nothing anywhere reporting that they were dropped — the alert looks sent,
 * the delivery row looks complete, and one person simply never hears. An
 * unbounded read of a bounded table is the safer of the two mistakes available,
 * and saying so here is what stops a later reader "fixing" it.
 */

export interface BoardRecipients {
  /**
   * Every address that should receive an alert, in a stable order.
   *
   * Stable because the addresses are written into the delivery record, and a
   * record whose order shuffles between reads is one a reader cannot diff
   * against another. Empty is a real answer — an association with no enabled
   * directors — and it is the caller's job to treat that as "nobody to tell"
   * rather than as a send with no recipients. Migration 023 refuses the latter.
   */
  active(): Promise<readonly string[]>
}
