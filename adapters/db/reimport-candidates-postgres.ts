/**
 * The documents a mapping change might affect, from Postgres (story 5.7, AC4).
 *
 * `core/ports/reimport-candidates.ts` is the contract and explains why this
 * returns candidates rather than matches — which of them a changed mapping
 * actually affects is decided from each document's own bytes, in
 * `core/mapping/reimport.ts`.
 *
 * ## Why the join
 *
 * `document_kind` lives on `extraction` (migration 006), not on `document`.
 * There is no column on the document row saying what kind it was read as, so
 * "every deposit export this association holds" is a join.
 *
 * **`distinct` is load-bearing.** One document produces one extraction row per
 * record it contained, so a statement with forty lines joins forty times. Without
 * it this returns that document forty times and `reimport` re-imports it forty
 * times — each one replacing the last, so the rows would end up correct and the
 * treasurer would be shown forty outcomes for one file, after forty fetches from
 * object storage.
 *
 * ## The writer pool, for a read
 *
 * Migration 003 revoked `watchdog_reader`'s blanket SELECT so read access is
 * explicit, and nothing has granted it `document` or `extraction` for this
 * purpose. This read also exists only to serve a write — the re-import — so it
 * belongs to the writer's transaction boundary rather than the catalog's.
 *
 * ## The association is derived, not passed
 *
 * 5.1's rule, and the stakes are unusually plain here: this list decides whose
 * financial history gets rewritten. A caller able to name the association could
 * point a re-import at another board's documents.
 */

import type { Reimportable, ReimportCandidates } from '@/core/ports/reimport-candidates'

import { writerPool } from './pool'

interface Row {
  readonly id: string
  readonly storage_key: string
  readonly filename: string
  readonly content_type: string
}

export function createReimportCandidates(): ReimportCandidates {
  return {
    async importedUnder(member, kind): Promise<readonly Reimportable[]> {
      /**
       * `order by d.id` is not decoration. `select distinct` has no defined
       * order, and this order is what the treasurer reads: `reimport` preserves
       * it in the per-document outcome list. Without it the same change reports
       * its documents differently after a plan change or a vacuum. Raised by
       * CodeRabbit.
       *
       * The explanation lives here rather than inside the SQL because a backtick
       * in a template literal ends the string - which is how the first version
       * of this comment turned the query into a syntax error that the text
       * assertions could not see, since they only read the file.
       */
      const found = await writerPool().query<Row>(
        `select distinct d.id, d.storage_key, d.filename, d.content_type
           from document d
           join extraction e on e.document_id = d.id
          where d.association_id = (select association_id from board_member where id = $1)
            and e.document_kind = $2
          order by d.id`,
        [member, kind],
      )

      return found.rows.map((row) => ({
        id: row.id,
        storageKey: row.storage_key,
        filename: row.filename,
        contentType: row.content_type,
      }))
    },
  }
}
