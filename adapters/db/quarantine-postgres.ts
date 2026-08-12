import type { Quarantine } from '../../core/ports/quarantine'
import { writerPool } from './pool'

/**
 * The `Quarantine` port backed by Postgres.
 *
 * `hold` is idempotent by deferring to the database rather than by checking
 * first. Asking "is it already held?" and then inserting means two extractions
 * of one document can both read before either writes, both conclude the name is
 * new, and both insert -- which puts the same question in front of the
 * treasurer twice. `document-repository-postgres.ts` makes the same argument
 * about content hashes, and reaches the same answer: only the database can
 * settle it, so the unique index settles it and this defers.
 */

export function createQuarantine(): Quarantine {
  return {
    async hold(documentId: string, extractedName: string): Promise<void> {
      // `on conflict do nothing` against the composite unique index, which is
      // keyed on the normalised name -- so a second *spelling* of a name this
      // document already waits on is absorbed here too, not just an identical
      // repeat. That is the point of sharing migration 009's rule.
      await writerPool().query(
        `insert into quarantine_item (document_id, extracted_name)
         values ($1, $2)
         on conflict (document_id, normalised_name) do nothing`,
        [documentId, extractedName],
      )
    },

    async heldNames(documentId: string): Promise<readonly string[]> {
      const { rows } = await writerPool().query<{ extracted_name: string }>(
        'select extracted_name from quarantine_item where document_id = $1 order by created_at asc',
        [documentId],
      )

      return rows.map((row) => row.extracted_name)
    },
  }
}
