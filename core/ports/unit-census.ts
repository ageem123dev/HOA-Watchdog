/**
 * Whether an association holds any units yet (story 5.8).
 *
 * ## Why this is not a method on `UnitDirectory`
 *
 * `UnitDirectory` answers questions *about* units — which unit a reference
 * names, who held it when. This answers whether the set is empty, which is a
 * question about the association's setup rather than about any unit. Story 5.7
 * learned the cost of the other choice: `importedUnder` was put on
 * `DocumentRepository` first, and `tsc` immediately named four unrelated fakes
 * that would have had to grow a method none of them calls.
 *
 * `UnitDirectory` is also injected into `ingest`, and this must not be — see
 * `app/upload/actions.ts` for why the check lives at the submission boundary.
 *
 * ## Boolean, not a count
 *
 * A count invites a caller to invent a threshold. There is one question here and
 * it has two answers: the roll has produced units, or it has not.
 */
export interface UnitCensus {
  /**
   * `true` when this member's association holds at least one unit.
   *
   * **`member`, not an association id.** The adapter reads the association from
   * that member in SQL — 5.1's rule — because this answer decides whether
   * deposits may be uploaded, and a caller able to name an association could
   * satisfy the check with another board's units.
   *
   * An unknown member answers `false`. That refuses the upload, which is the
   * safe direction: not knowing who is asking is not a reason to let deposits
   * through.
   */
  hasUnits(member: string): Promise<boolean>
}
