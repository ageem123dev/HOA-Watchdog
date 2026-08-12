
import type { QueryLog, QueryLogEntry } from '../../core/ports/query-log'
import { writerPool } from './pool'

/**
 * The `QueryLog` port backed by Postgres.
 *
 * Connects as **`watchdog_writer`**, and this is the one place in the query path
 * that does. Everything else on the path runs as `watchdog_reader`, which cannot
 * write anything at all — so the provenance record AD-12 demands would be
 * impossible to make if this adapter shared that connection. Two roles, one
 * request, which is what AD-4's "roles separate by pipeline stage" produces here.
 *
 * The writer's reach over this table is narrower than over any other: migration
 * 020 revokes UPDATE, DELETE and TRUNCATE, so the only statement this adapter
 * could issue is the INSERT below. That is not a comment about discipline — an
 * UPDATE written here fails with a `42501` on the first call.
 */


/** One pool per process, built on first use — see the `next build` note in `../auth/env.ts`. */

export function createQueryLog(): QueryLog {
  return {
    async record(entry: QueryLogEntry): Promise<string> {
      // `executed_at` is not in the column list. The database's `now()` default
      // stamps it, so the time in the audit trail is the database's and not a
      // caller's — an actor that could choose its own timestamp could put a
      // query outside the window an auditor is looking at.
      //
      // `parameters` is passed as a JSON string and cast; `pg` would otherwise
      // send a JS object as a record literal. The cast is to `jsonb`, matching
      // the column, so migration 020's `jsonb_typeof(parameters) = 'object'`
      // check is what refuses an array or a scalar rather than this code.
      const { rows } = await writerPool().query<{ id: string }>(
        `insert into query_log (actor_id, entry_id, entry_version, parameters, sql_text)
         values ($1, $2, $3, $4::jsonb, $5)
         returning id`,
        [
          entry.actorId,
          entry.entryId,
          entry.entryVersion,
          JSON.stringify(entry.parameters),
          entry.sqlText,
        ],
      )

      // `rows[0]` is present or the INSERT did not happen: a failed insert
      // rejects rather than returning an empty set. The guard is here because
      // `noUncheckedIndexedAccess` is on and returning `undefined as string`
      // would hand a caller a provenance id that identifies nothing.
      const written = rows[0]
      if (!written) {
        throw new Error('the provenance record was not written and the query must not run')
      }

      return written.id
    },
  }
}
