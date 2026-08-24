/**
 * Where a treasurer's column mapping is remembered (story 5.7).
 *
 * Migration 026 is the authority on the rules; this is the shape a caller
 * reaches them through. Read that file's header before changing anything here —
 * the two are one design, as `finding-alert.ts` says of its own pair.
 *
 * ## What identifies a mapping
 *
 * An association, a document kind, and the **shape** of the heading row it was
 * built against — `shapeKey` in `core/mapping/saved.ts`. All three are identity,
 * not filters: a mapping found across associations would import one board's file
 * under another board's column meanings, and one found across kinds would read a
 * deposit export as a roll.
 *
 * **The association is not a parameter.** `find` takes the *uploader* and `save`
 * carries the *saver*, and the adapter derives the association from that member
 * in SQL — the rule `document-repository-postgres.ts` states as "a caller cannot
 * supply the wrong one". Passing an association id would make tenancy something
 * a caller asserts rather than something the database establishes.
 *
 * ## Saving replaces, and says what it replaced
 *
 * A treasurer who re-maps a shape they have already mapped is *changing* it, and
 * story 5.7's whole second half turns on that being visible: the change is
 * recorded, and it re-imports what it affects. So `save` returns what was there
 * before rather than `void` — a caller that cannot see the previous mapping
 * cannot tell a first save from a change, and would have to read-then-write to
 * find out, which is the race this avoids.
 *
 * ## There is no `delete`
 *
 * Not because deletion is unthinkable, but because nothing in story 5.7 needs
 * it and a method declared here would be one nobody has decided the meaning of.
 * Deleting a mapping that documents were imported under raises the same question
 * this story answered for changing one, and it deserves the same deliberate
 * answer rather than an inherited default.
 */

import type { SavedMapping } from '../mapping/saved'

/**
 * What a save did.
 *
 * ## Why two fields and not one nullable mapping
 *
 * `save` used to return `SavedMapping | null`, with `null` meaning "nothing was
 * replaced". That conflated two different facts, and CodeRabbit found the case
 * where they come apart.
 *
 * The previous row is read by a CTE in the same statement as the upsert, against
 * that statement's snapshot. If another transaction inserts the same shape and
 * commits *after* that snapshot is taken, the CTE sees nothing while the
 * conflict still fires — so the statement performs an **update** and reports
 * "first save". A treasurer would then be told nothing was replaced, and the
 * documents already imported under the old mapping would never be re-imported.
 *
 * That is exactly the concurrency migration 026's unique index exists for: two
 * treasurers confirming the same wizard at once.
 *
 * So `replaced` comes from the row itself — `xmax = 0` is true only of a row the
 * statement inserted, the technique `finding-postgres.ts` already uses and
 * verifies against a real database. `previous` is the mapping when it could be
 * read, and `null` when it could not. A caller that needs to know *whether* a
 * change happened must read `replaced`, never `previous !== null`.
 */
export interface SaveResult {
  /** False only when this statement inserted the row. */
  readonly replaced: boolean
  /**
   * What was replaced, if it was visible. `null` when nothing was replaced —
   * and also when a concurrent write means it could not be read. Those two are
   * distinguished by `replaced`, not by this.
   */
  readonly previous: SavedMapping | null
}

export interface MappingStore {
  /**
   * The mapping for this association, kind and shape, or `null`.
   *
   * `null` is "nobody has mapped this shape", which is what sends an upload to
   * the wizard. It is not an error and must not be reported as one.
   */
  find(uploadedBy: string, kind: SavedMapping['kind'], shape: string): Promise<SavedMapping | null>

  /**
   * Remember `mapping`, replacing any mapping for the same identity.
   *
   * See the note above on why this is not `void`.
   */
  save(mapping: SavedMapping): Promise<SaveResult>
}
