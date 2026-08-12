import {
  MAX_LIMIT,
  type QueryLogFilter,
  type QueryLogReader,
  type QueryLogRecord,
} from '../../core/ports/query-log-reader'
import { writerPool } from './pool'

/**
 * Reading the provenance log (story 3.8).
 *
 * ## It connects as `watchdog_writer`, and that is not a mistake
 *
 * The obvious instinct — a read adapter uses the reader role — is wrong here,
 * and migration 020 says so directly:
 *
 * > "Nothing is granted to `watchdog_reader`, and the silence is the decision.
 * > […] The role the LLM-driven query path executes under has no business
 * > reading the audit trail of its own queries."
 *
 * `watchdog_writer` may `insert` and `select` on this table and nothing else;
 * `watchdog_reader` may do nothing at all with it. So this adapter shares
 * `query-log-postgres.ts`'s credential — and an implementation that reached for
 * the reader pool would fail with a `42501` at runtime, in production, on a
 * surface a board member had just opened. That is why `test:db` exercises the
 * grant rather than trusting this comment.
 *
 * ## Filtering happens here, not in the browser
 *
 * A surface that fetched the whole trail and hid part of it would still have put
 * every question every board member has asked onto the wire. The `where` clause
 * is the privacy boundary, so it is built here from parameters — never by
 * interpolating a caller's string, which on *this* table would be an injection
 * into the audit trail itself.
 */

interface Row {
  id: string
  actor_id: string
  executed_at: Date
  entry_id: string
  entry_version: number
  parameters: Record<string, unknown>
  sql_text: string
}

export function createQueryLogReader(): QueryLogReader {
  return {
    async recent(filter: QueryLogFilter): Promise<readonly QueryLogRecord[]> {
      // Clamped rather than trusted. `limit` reaches this from a search
      // parameter, and a caller asking for ten million rows should get a page,
      // not an outage. Clamped at both ends: a zero or negative limit would
      // return nothing and read exactly like "no queries have been run".
      const limit = Math.min(Math.max(Math.trunc(filter.limit), 1), MAX_LIMIT)

      // Built by position, never by interpolation. `$1`-style placeholders are
      // what keep a filter value from becoming SQL — on the table that records
      // what SQL ran, which would be a uniquely bad place to allow it.
      const conditions: string[] = []
      const values: unknown[] = []

      if (filter.actorId !== undefined) {
        values.push(filter.actorId)
        conditions.push(`actor_id = $${values.length}`)
      }

      if (filter.entryId !== undefined) {
        values.push(filter.entryId)
        conditions.push(`entry_id = $${values.length}`)
      }

      const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''
      values.push(limit)

      const { rows } = await writerPool().query<Row>(
        `select id, actor_id, executed_at, entry_id, entry_version, parameters, sql_text
           from query_log
           ${where}
          order by executed_at desc, id desc
          limit $${values.length}`,
        values,
      )

      // `id desc` as the tie-break above, deliberately. `executed_at` alone is
      // not a total order — two queries in the same transaction can share a
      // timestamp — and an unstable order makes a paged audit trail show the
      // same row twice or skip one, which is the sort of defect that only
      // appears under load and destroys trust in the record.
      //
      // **And the tie-break is itself chronological**, which is what makes it a
      // fix rather than merely a stabiliser: migration 020 defaults `id` to
      // `uuidv7()`, and a v7 UUID sorts by creation time. A random v4 here would
      // give a stable order that was nonetheless the wrong one — two queries a
      // millisecond apart shown in an arbitrary sequence, in the document
      // somebody reads to establish what happened first. Raised as a flakiness
      // risk by Argus, on the assumption the id was random; it is not.
      return rows.map((row) => ({
        id: row.id,
        actorId: row.actor_id,
        executedAt: row.executed_at,
        entryId: row.entry_id,
        entryVersion: row.entry_version,
        parameters: row.parameters,
        sqlText: row.sql_text,
      }))
    },
  }
}
