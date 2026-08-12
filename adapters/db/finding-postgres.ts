import {
  AlreadyReviewedError,
  FindingNotFoundError,
  type FindingObservation,
  type FindingRegister,
  type FindingReviewer,
  type RaisedFinding,
} from '../../core/ports/finding'
import { writerPool } from './pool'

/**
 * The finding ports backed by Postgres.
 *
 * Both connect as **`watchdog_writer`**, which is the only role migration 021
 * grants anything on this table — `watchdog_reader` is given nothing, so that
 * the LLM-driven query path cannot surface an unreviewed accusation about a
 * member in answer to a question about dues.
 *
 * The writer's reach here is narrower than the role name suggests: `delete` and
 * `truncate` are revoked, so no statement this module could grow would be able
 * to remove a row. That is not a comment about discipline. A `delete` written
 * below fails with a `42501` on its first call.
 *
 * ## Two ports, one module
 *
 * `core/ports/finding.ts` splits raising from reviewing because they are
 * separately grantable capabilities — a detector has no business signing off its
 * own findings. That separation lives in what an object *holds*, and it is
 * preserved here: `createFindingRegister()` cannot review and
 * `createFindingReviewer()` cannot raise. Splitting the file as well would
 * duplicate this header without separating anything further, since either
 * factory is equally importable from either place.
 */

/** The shared writer pool. Never a new one — see `pool.ts` for what fourteen cost. */
const pool = () => writerPool()

export function createFindingRegister(): FindingRegister {
  return {
    async raise(observation: FindingObservation): Promise<RaisedFinding> {
      // **The no-op is the database's, not this code's.** A read-then-write
      // would pass every sequential test and produce two rows the first time two
      // detection runs arrived together, which is the failure AD-13 orders this
      // story first to prevent.
      //
      // `do update` rather than `do nothing`, because a second run over
      // corrected data must be able to amend what the finding says — and because
      // `do nothing` returns no row at all on conflict, leaving the caller
      // without the id of the finding it just raised.
      //
      // The `set` list is one column long and that is the design: `state`,
      // `reviewed_by` and `reviewed_at` are untouched, so a re-upload cannot
      // resurrect a reviewed finding as unreviewed. That would undo a board
      // member's review by accident, which is dismissal wearing a different hat.
      //
      // `daterange(..., '[)')` is built by the database from two dates rather
      // than assembled as a string here, so a caller's value can never become
      // part of the range literal. Half-open because that is what Postgres
      // canonicalises to: the same month then has exactly one spelling, and the
      // key cannot be defeated by formatting.
      //
      // `xmax = 0` is true only on a row this statement inserted; a row it
      // updated carries the locking transaction's id. It is the one way to learn
      // which branch ran without a second round trip, and it is asserted against
      // a real database in `finding-postgres.test.ts` rather than trusted.
      const { rows } = await pool().query<{ id: string; inserted: boolean }>(
        `insert into finding (finding_type, subject_id, period, evidence)
         values ($1, $2, daterange($3::date, $4::date, '[)'), $5::jsonb)
         on conflict (finding_type, subject_id, period)
         do update set evidence = excluded.evidence
         returning id, (xmax = 0) as inserted`,
        [
          observation.findingType,
          observation.subjectId,
          observation.period.from,
          observation.period.until,
          JSON.stringify(observation.evidence),
        ],
      )

      // Present, or the statement did not run: a failed insert rejects rather
      // than returning an empty set. The guard exists because
      // `noUncheckedIndexedAccess` is on, and returning `undefined as string`
      // would hand a caller the id of a finding that does not exist.
      const written = rows[0]
      if (!written) throw new Error('raising the finding returned no row')

      return { id: written.id, wasAlreadyKnown: !written.inserted }
    },
  }
}

export function createFindingReviewer(): FindingReviewer {
  return {
    async markReviewed(findingId: string, reviewerId: string): Promise<void> {
      // `and state = 'unreviewed'` is the whole one-way guarantee, and it is in
      // the `where` clause rather than in a preceding read on purpose: two board
      // members clicking at the same moment both see an unreviewed finding, and
      // only the statement that matches the row as it stands can win. The loser
      // matches nothing and is told so below.
      //
      // `now()` rather than a parameter, for the reason `QueryLogEntry` omits
      // `executedAt`: the database stamps the time, so nobody can record that
      // they looked at something last Tuesday.
      const { rowCount } = await pool().query(
        `update finding
            set state = 'reviewed', reviewed_by = $2, reviewed_at = now()
          where id = $1 and state = 'unreviewed'`,
        [findingId, reviewerId],
      )

      if (rowCount === 1) return

      // An UPDATE matching nothing *succeeds*, and the two reasons it can match
      // nothing mean opposite things to whoever is reading the surface.
      // "Somebody got here first" is ordinary and the page should show the
      // review that exists; "no such finding" means the id came from somewhere
      // it should not have. Reporting either as the other hides a real fault
      // behind a routine one.
      const { rows } = await pool().query(`select 1 from finding where id = $1`, [findingId])

      if (rows.length === 0) throw new FindingNotFoundError(findingId)

      throw new AlreadyReviewedError(findingId)
    },
  }
}
