/**
 * The port through which a caller asks who held a unit, and when.
 *
 * Two questions, because those are the two this story answers: who held a unit
 * on a given date, and the whole history of a unit. An arrears finding needs the
 * first — naming the person who held 4B in March, not whoever holds it today —
 * and a treasurer looking at a disputed year needs the second.
 *
 * **This port can only read.** Recording a unit, recording a person, and closing
 * a membership when a unit changes hands are all data entry, and no story before
 * 2.4 needs them done from the application. A write method here would satisfy
 * the same acceptance criteria and delete that argument; the absence is the
 * design, because a caller cannot quietly reach for a method that was never
 * declared. `core/ports/quarantine-queue.ts` makes the same case for itself.
 */

/**
 * One person's tenure of one unit.
 *
 * `holderName` and not a holder id: every consumer of this so far is showing a
 * person to a human or naming one in a finding, and an id would send each of
 * them back to the database for the name.
 */
export interface UnitHolding {
  readonly holderName: string

  /**
   * The first day of the tenure, as `YYYY-MM-DD`.
   *
   * A string, and deliberately not a `Date`. `pg` turns a Postgres `date` into a
   * JS `Date` at *local* midnight, so a membership beginning 2024-07-01 reads
   * back as 2024-06-30T23:00:00Z for anyone west of UTC — and every comparison
   * downstream is then off by a day for half the world. "Held from 1 July" is a
   * calendar date, not an instant, and the type says so.
   */
  readonly heldFrom: string

  /**
   * The first day the person no longer held it, as `YYYY-MM-DD`, or `null` if
   * they still hold it.
   *
   * Half-open, matching the schema: a unit sold on 1 July has `heldUntil` of
   * `2024-07-01` on the outgoing membership and `heldFrom` of `2024-07-01` on
   * the incoming one. No overlap, no gap, and no day that belongs to nobody.
   *
   * `null` means still held rather than a far-future sentinel date, because a
   * sentinel is a value that sorts and compares and is eventually reached.
   */
  readonly heldUntil: string | null
}

export interface UnitDirectory {
  /**
   * Who held the unit on that date, or `null` if nobody did.
   *
   * At most one, and that is the database's guarantee rather than this
   * adapter's: migration 012's `exclude using gist (unit_id with =,
   * held_during with &&)` makes two memberships covering one date for one unit
   * unrepresentable, and `migrations/unit-membership.test.ts` proves it fires.
   * No defensive check is written here for a case that cannot be produced
   * without dropping that constraint — a guard nothing can make fail is a guard
   * that proves nothing, which this project has now deleted several of.
   *
   * `null` also covers a unit number that matches no unit at all. Nothing in
   * this epic needs to tell those two apart, so nothing here invents an error
   * contract for it; the distinction belongs to whichever surface first lets a
   * treasurer type a unit number and get it wrong.
   *
   * `unitNumber` is matched as a treasurer would type it — `4b ` finds `4B`.
   */
  heldBy(unitNumber: string, on: string): Promise<UnitHolding | null>

  /**
   * Every tenure of the unit, earliest first, or an empty list.
   *
   * The order is fixed by the query and not by the caller, so two renders of an
   * unchanged history cannot disagree. Nothing downstream re-sorts: a second
   * ordering rule is a second answer to "which came first".
   */
  historyFor(unitNumber: string): Promise<readonly UnitHolding[]>

  /**
   * The units these references name, keyed by **the reference as given**.
   *
   * One call for a whole document, not one per line. A CSV bank feed is
   * hundreds of lines, and a lookup per line is hundreds of round trips before
   * ingestion can write anything.
   *
   * It does **not** run inside the write transaction, and an earlier draft of
   * this note said it did. This port is answered on the reader connection
   * (AD-4); the payment write opens its own transaction on the writer. So the
   * cost being avoided is latency before the write, not a lock held during it —
   * a distinction worth keeping straight, because the wrong version of it
   * invites someone to "fix" this by passing a `PoolClient` in.
   *
   * A reference nobody recognises is **absent from the map**, not present with
   * a null. `resolveLine` holds on a miss, and a null entry would make "we
   * looked and found nothing" indistinguishable from "we never looked".
   *
   * Keyed by the caller's own string, and that is the load-bearing part.
   * Matching is done by the database through `unit_normalised_number()`; the
   * caller re-keys with core's `fold` before handing a lookup to `resolveLine`.
   * So the database decides *which unit* and core decides *the key*, and the
   * two foldings never have to agree — which matters, because they do not:
   * JavaScript's `\s` matches U+3000 and migration 011's character set does
   * not. Returning the database's normalised spelling here would turn that
   * disagreement from harmless into a silent miss.
   *
   * Still a read. Nothing here can create a unit, so a deposit naming a unit
   * nobody has recorded produces a question for a human rather than a new row.
   */
  unitIdsFor(references: readonly string[]): Promise<ReadonlyMap<string, string>>
}
