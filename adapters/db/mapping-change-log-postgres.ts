/**
 * The record of a mapping change, in Postgres (story 5.7, AC6).
 *
 * `core/ports/mapping-change-log.ts` is the contract and migration 027 is the
 * authority on the rules. The three are one design.
 *
 * ## One insert, and nothing else
 *
 * Migration 027 revokes UPDATE and DELETE on this table, so an insert is the
 * only statement that can succeed. That is the point rather than a limitation:
 * the row says what happened, and something that can be rewritten does not.
 *
 * ## The association is derived, not passed
 *
 * `changed_by` is a member and the association is read from that member in SQL —
 * the rule `document-repository-postgres.ts` states as "a caller cannot supply
 * the wrong one". A scalar subquery inside VALUES, not `insert ... select`: the
 * select form inserts no row at all when the member does not exist, which would
 * turn an unknown member into a silently missing audit record. Here that is
 * worse than elsewhere, because the missing row is the evidence.
 *
 * ## The outcomes go in as one value
 *
 * `JSON.stringify` rather than passing the array: `node-postgres` maps a
 * JavaScript array to a Postgres *array*, and the column is `jsonb`. The two
 * disagree at the driver, not at the type checker.
 */

import type { MappingChange, MappingChangeLog } from '@/core/ports/mapping-change-log'

import { writerPool } from './pool'

export function createMappingChangeLog(): MappingChangeLog {
  return {
    async record(change: MappingChange): Promise<void> {
      await writerPool().query(
        `insert into mapping_change
           (association_id, document_kind, shape, previous_mapping, new_mapping, changed_by, documents)
         values ((select association_id from board_member where id = $1),
                 $2, $3, $4, $5, $1, $6)`,
        [
          change.changedBy,
          change.kind,
          change.shape,
          // Null, not the string "null": migration 027 leaves this column
          // nullable precisely so a first mapping records that nothing was
          // replaced, and a JSON null would be a value claiming otherwise.
          change.previous === null ? null : JSON.stringify(change.previous),
          JSON.stringify(change.next),
          JSON.stringify(change.documents),
        ],
      )
    },
  }
}
