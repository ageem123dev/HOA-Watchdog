import type { CheckedDocuments, DocumentsChecked } from '../../core/ports/checked-documents'
import type { FindingReader, UnreviewedFinding, UnreviewedQueue } from '../../core/ports/finding-reader'
import { writerPool } from './pool'

interface FindingRow {
  id: string
  finding_type: string
  subject_id: string
  period_from: string
  period_until: string
  evidence: unknown
  raised_on: string
  total: string
}

interface CheckedRow {
  count: string
  latest_upload_on: string | null
}

/**
 * The dashboard's read of the finding register.
 *
 * Three things about the SQL below are decisions rather than style.
 *
 * **The ends of the `daterange` are projected, never the range itself.** node-pg
 * has no parser for `daterange`, so `select period` hands back the literal
 * `[2099-04-01,2099-05-01)` — a string that happens to have brackets in it, and
 * any code treating it as structured is parsing punctuation. `lower` and `upper`
 * give the two calendar days the port declares.
 *
 * **Every date goes through `at time zone 'UTC'`.** `to_char` on a `timestamptz`
 * renders in the *session's* timezone, so the same finding answers 2099-05-02
 * here and 2099-05-01 on a connection set to America/Los_Angeles. Story 4.4
 * shipped that defect in two readers and fixed it in both; this is the third
 * place it would have appeared.
 *
 * **The order carries a tie-break.** One detection run raises several findings
 * on the same `now()`, and without a second key Postgres may return them in
 * either order — so the board's queue would reshuffle between two refreshes of
 * a register that had not changed. `id desc` settles it, and uuidv7 makes that
 * agree with the primary sort rather than fight it.
 */
/**
 * The most rows one read may ask for.
 *
 * Not a page size — the caller still chooses that. This is the point past which
 * a request stops being a dashboard queue and becomes a bulk export, which is
 * story 4.7's job and belongs on a surface built to stream it.
 */
const MOST_ROWS = 200

export function createFindingReader(): FindingReader {
  return {
    async unreviewed(limit: number): Promise<UnreviewedQueue> {
      if (!Number.isInteger(limit) || limit < 1 || limit > MOST_ROWS) {
        // Two failures, one refusal, and they fail in opposite directions.
        //
        // A limit below one returns no rows over a non-zero total — the exact
        // disagreement `core/findings/dashboard-view.ts` had to be hardened
        // against, which renders "nothing needs your attention" over an
        // outstanding queue.
        //
        // A limit above `MOST_ROWS` is the bound not being one. The port made
        // `limit` required because "an optional bound is one a caller forgets",
        // and a caller passing a million has forgotten it just as thoroughly.
        // The register is append-only and permanent, so that request gets worse
        // every year the association runs. Raised by Argus.
        //
        // Refused here rather than clamped: a caller that asked for more than
        // this wanted something other than a dashboard queue, and quietly
        // giving them a page of it would answer a question they did not ask.
        throw new RangeError(
          `a findings limit must be a whole number between 1 and ${MOST_ROWS}, not ${limit}`,
        )
      }

      // One statement, so the rows and the count describe the same snapshot.
      // Two round trips could disagree if a finding were reviewed between
      // them, and that disagreement is what the union of these two numbers
      // exists to prevent.
      //
      // **`finding_state_recent_idx` does not serve this query, and that was
      // measured rather than assumed.** `explain (analyze, buffers)` at 32 rows
      // gives a sequential scan feeding a `WindowAgg` and then a sort — and the
      // window function is the structural half of that: `count(*) over ()` has
      // to see every unreviewed row, so `limit` bounds what is *returned*, not
      // what is read. The index cannot short-circuit that at any size.
      //
      // Accepted rather than optimised. Splitting into an index-scanned page
      // plus a separate count would use the index and lose the shared snapshot,
      // which is the property this surface actually needs. The register is one
      // row per finding for one association; if it ever grows enough to matter,
      // the fix is a cheaper total, not a second round trip.
      const { rows } = await writerPool().query<FindingRow>(
        `select f.id,
                f.finding_type,
                f.subject_id,
                to_char(lower(f.period), 'YYYY-MM-DD')                    as period_from,
                to_char(upper(f.period), 'YYYY-MM-DD')                    as period_until,
                f.evidence,
                to_char(f.raised_at at time zone 'UTC', 'YYYY-MM-DD')     as raised_on,
                count(*) over ()                                          as total
           from finding f
          where f.state = 'unreviewed'
          order by f.raised_at desc, f.id desc
          limit $1`,
        [limit],
      )

      const findings: readonly UnreviewedFinding[] = rows.map((row) => ({
        id: row.id,
        findingType: row.finding_type,
        subjectId: row.subject_id,
        period: { from: row.period_from, until: row.period_until },
        evidence: row.evidence,
        raisedOn: row.raised_on,
      }))

      // **`count(*) over ()` counts the rows the window function saw, which is
      // every matching row — `limit` is applied after it.** With no rows at all
      // there is no row to carry it, and zero is then the right answer rather
      // than a fallback: the register held nothing to count.
      return { findings, total: Number(rows[0]?.total ?? 0) }
    },
  }
}

/**
 * How much has actually been looked at.
 *
 * `extraction_state = 'read'` on both halves, and that is the whole point. A
 * document that is still held, or that could not be opened, was *not* checked —
 * counting it would tell a board member the system examined something it failed
 * to read, on the one surface whose job is to say what was looked at.
 *
 * The date describes the same set as the count for the same reason: an "as of"
 * taken from the newest upload of any kind would date the figure beside it to a
 * document that never contributed to it.
 */
export function createCheckedDocuments(): CheckedDocuments {
  return {
    async checked(): Promise<DocumentsChecked> {
      const { rows } = await writerPool().query<CheckedRow>(
        `select count(*)                                                       as count,
                to_char(max(uploaded_at) at time zone 'UTC', 'YYYY-MM-DD')     as latest_upload_on
           from document
          where extraction_state = 'read'`,
      )

      // An aggregate over no rows still returns one row, with `max` null — so
      // there is always a row here, and `latest_upload_on` is how "nothing has
      // arrived" arrives.
      const row = rows[0]
      if (row === undefined) throw new Error('counting checked documents returned no row')

      return { count: Number(row.count), latestUploadOn: row.latest_upload_on }
    },
  }
}
