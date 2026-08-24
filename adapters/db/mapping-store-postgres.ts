/**
 * The mapping a treasurer set up once, in Postgres (story 5.7).
 *
 * `core/ports/mapping-store.ts` is the contract and migration 026 is the
 * authority on the rules; this is the SQL between them. Read both before
 * changing anything here — the three are one design.
 *
 * ## The association is derived, never passed
 *
 * Neither method takes an association id. Both take a *member* and read the
 * association from that member inside the statement, so tenancy is something the
 * database establishes rather than something a caller asserts. This is the rule
 * document-repository-postgres.ts states about its own insert, and a mapping
 * needs it at least as badly: a mapping found across associations would import
 * one board's export under another board's column meanings, and because a
 * mapping is a list of *positions*, every value would still be plausible in the
 * field it landed in. Nothing would look wrong.
 *
 * A scalar subquery inside VALUES, not `insert ... select` from board_member —
 * the same choice, for the same reason. The select form inserts no row when the
 * member does not exist, which would make an unknown member indistinguishable
 * from a successful write.
 *
 * ## Why save is one statement
 *
 * It must report the mapping it replaced: a caller that cannot tell a first save
 * from a change cannot warn anybody it is about to re-import their documents,
 * and that warning is story 5.7's AC6. Reading first and writing after would
 * lose the race migration 026's unique index exists for — two treasurers
 * confirming the same wizard at once, where no read-then-write is correct.
 *
 * So the previous row is captured by a CTE evaluated against the statement's
 * snapshot, which is the state *before* the upsert. `returning` alone cannot do
 * this: on the conflict path it yields the new row, and the old one is gone.
 *
 * ## What this file does not do
 *
 * It does not validate the mapping. `core/mapping/draft.ts` owns what a valid
 * pairing is, and a second answer to that question living in the adapter is the
 * duplicated-rule defect this project has spent four review rounds on. The
 * column stores what the application agreed.
 */

import type { DraftMapping } from '@/core/mapping/draft'
import type { SavedMapping } from '@/core/mapping/saved'
import type { MappingStore, SaveResult } from '@/core/ports/mapping-store'

import { writerPool } from './pool'

interface Row {
  readonly shape: string
  readonly document_kind: string
  readonly saved_by: string
  readonly mapping: DraftMapping
}

/**
 * What `save`'s statement returns, which is not the same shape `find` returns.
 *
 * The previous-row columns come from scalar subqueries over a CTE that is empty
 * on a first save, so every one of them is nullable. Declaring them as `Row`
 * said otherwise and made `row.shape === null` a comparison between types with
 * no overlap - true today only because nothing narrows them. Raised by
 * CodeRabbit; a separate type is the honest description, and it is what lets the
 * narrowing below be checked rather than asserted.
 */
interface SaveRow {
  /** `xmax = 0` is true only of a row this statement inserted. */
  readonly inserted: boolean
  readonly shape: string | null
  readonly document_kind: string | null
  readonly saved_by: string | null
  readonly mapping: DraftMapping | null
}

const toMapping = (row: Row): SavedMapping => ({
  savedBy: row.saved_by,
  kind: row.document_kind as SavedMapping['kind'],
  shape: row.shape,
  mapping: row.mapping,
})

export function createMappingStore(): MappingStore {
  return {
    async find(uploadedBy, kind, shape) {
      const found = await writerPool().query<Row>(
        // All three of association, kind and shape are identity rather than
        // filters. Dropping the association clause would find another board's
        // mapping for the same export format — and a bank's CSV headings are
        // identical across every association banking there, so this is the
        // ordinary case, not a contrived one.
        `select shape, document_kind, saved_by, mapping
           from column_mapping
          where association_id = (select association_id from board_member where id = $1)
            and document_kind = $2
            and shape = $3`,
        [uploadedBy, kind, shape],
      )

      // An unknown member yields NULL from the subquery, `association_id = null`
      // matches nothing, and the caller is told no mapping exists. That is the
      // right answer for a read: it sends the upload to the wizard rather than
      // failing it, and no mapping is disclosed.
      const row = found.rows[0]
      return row === undefined ? null : toMapping(row)
    },

    async save(mapping): Promise<SaveResult> {
      const written = await writerPool().query<SaveRow>(
        // `previous` reads the pre-insert snapshot, so it holds the row this
        // statement is about to replace — the thing `returning` cannot give
        // back once the update has run.
        //
        // `saved_at = now()` is set explicitly on the conflict path: the column
        // default applies only to an insert, so without it a re-mapped shape
        // would keep the timestamp of the mapping it replaced and the record of
        // *when* the change happened would be wrong.
        `with previous as (
           select shape, document_kind, saved_by, mapping
             from column_mapping
            where association_id = (select association_id from board_member where id = $1)
              and document_kind = $2
              and shape = $3
         )
         insert into column_mapping (association_id, document_kind, shape, mapping, saved_by)
         values ((select association_id from board_member where id = $1), $2, $3, $4, $1)
         on conflict (association_id, document_kind, shape)
         do update set mapping = excluded.mapping,
                       saved_by = excluded.saved_by,
                       saved_at = now()
         returning (xmax = 0) as inserted,
                   (select shape from previous) as shape,
                   (select document_kind from previous) as document_kind,
                   (select saved_by from previous) as saved_by,
                   (select mapping from previous) as mapping`,
        [mapping.savedBy, mapping.kind, mapping.shape, JSON.stringify(mapping.mapping)],
      )

      /**
       * **`inserted`, not `previous === null`.** The CTE reads this statement's
       * snapshot, so a row another transaction inserts and commits *after* that
       * snapshot is invisible to it - while the conflict still fires, making
       * this an update. Deciding from `previous` alone would report "first save"
       * for a replacement: the treasurer would not be warned, and the documents
       * already imported under the old mapping would never be re-imported. That
       * is the concurrency migration 026's unique index exists for - two
       * treasurers confirming the same wizard at once. Raised by CodeRabbit.
       *
       * `xmax = 0` is true only of a row this statement inserted, the technique
       * `finding-postgres.ts` uses and verifies against a real database.
       */
      const row = written.rows[0]
      if (row === undefined) return { replaced: false, previous: null }

      return {
        replaced: !row.inserted,
        // Null when nothing was replaced, and also when a concurrent insert made
        // the previous row invisible to the CTE. `replaced` tells those apart.
        // Narrowed, not cast. `shape` is `not null` in migration 026, so a real
        // previous row can never present it as null - which makes it the one
        // column that distinguishes "there was a row" from "the CTE was empty".
        previous:
          row.shape === null || row.document_kind === null || row.saved_by === null || row.mapping === null
            ? null
            : toMapping({
                shape: row.shape,
                document_kind: row.document_kind,
                saved_by: row.saved_by,
                mapping: row.mapping,
              }),
      }
    },
  }
}
