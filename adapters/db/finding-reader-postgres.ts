import type { CheckedDocuments, DocumentsChecked } from '../../core/ports/checked-documents'
import {
  MOST_REGISTER_ROWS,
  type FindingDetail,
  type FindingReader,
  type FindingRecord,
  type RegisterFilter,
  type ReviewedRegister,
  type UnreviewedQueue,
} from '../../core/ports/finding-reader'
import { isFindingId } from '../../core/findings/finding-id'
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

/**
 * Declared independently rather than extending `FindingRow`.
 *
 * Inheriting it dragged in `total`, which forced the single-finding query to
 * select a dummy `0 as total` — and `0` is an int4, so node-pg hands back a
 * number where the interface promises a string. A field that is a lie is worse
 * for being unread: the next person to use it inherits the lie. Raised by Argus.
 */
interface DetailRow {
  id: string
  finding_type: string
  subject_id: string
  period_from: string
  period_until: string
  evidence: unknown
  raised_on: string
  reviewer_name: string | null
  reviewed_on: string | null
}

interface CheckedRow {
  count: string
  latest_upload_on: string | null
}

/**
 * The most rows one read may ask for.
 *
 * Not a page size — the caller still chooses that. This is the point past which
 * a request stops being a dashboard queue and becomes a bulk export, which is
 * story 4.7's job and belongs on a surface built to stream it.
 */
const MOST_ROWS = MOST_REGISTER_ROWS

/**
 * A board member's search text, as a `LIKE` pattern that matches it literally.
 *
 * **`%` and `_` are wildcards, and a vendor name is not a pattern.** Left
 * unescaped, a search for `%` matches every row and reports the whole register
 * as a hit; `_` quietly matches any single character, so `_oastal` finds
 * `Coastal` — a search that appears to work while answering a different
 * question. Found by the test for it, which the first version of this query
 * failed.
 *
 * The backslash goes first. Escaping it after the wildcards would escape the
 * backslashes this function just added, which turns `\%` back into a literal
 * backslash followed by a live wildcard.
 *
 * Built here rather than inline in the SQL because five predicates share it, and
 * five copies of an escape chain is five chances for one of them to drift —
 * which is the argument story 4.6 recorded when it found the same table copied
 * into two files.
 */
export function likePattern(search: string): string {
  const literal = search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')

  return `%${literal}%`
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
 * One `DetailRow` as the domain sees it.
 *
 * Extracted rather than repeated. `byId` and `awaitingAlert` select the same
 * columns for the same reason -- the alert's text is built from the finding's
 * own evidence -- and two mappings of one row shape are two chances for the
 * email and the page to disagree about the same finding.
 */
function toDetail(row: DetailRow): FindingDetail {
  return {
    id: row.id,
    findingType: row.finding_type,
    subjectId: row.subject_id,
    period: { from: row.period_from, until: row.period_until },
    evidence: row.evidence,
    raisedOn: row.raised_on,
    // **`reviewed_at` is the discriminator, not `state`.**
    // `finding_review_is_attributed` refuses a reviewed row without a date, so
    // the date being present *is* the row being reviewed -- one fact read once,
    // rather than a state string and a timestamp that could be read as
    // disagreeing with each other.
    reviewed: row.reviewed_on === null ? null : { by: row.reviewer_name, on: row.reviewed_on },
  }
}

/**
 * The columns a `FindingDetail` is built from, shared by the two reads that
 * return one. `f` is the `finding` alias and `m` the `board_member` one.
 */
const DETAIL_COLUMNS = `f.id,
                f.finding_type,
                f.subject_id,
                to_char(lower(f.period), 'YYYY-MM-DD')                    as period_from,
                to_char(upper(f.period), 'YYYY-MM-DD')                    as period_until,
                f.evidence,
                to_char(f.raised_at at time zone 'UTC', 'YYYY-MM-DD')     as raised_on,
                m.display_name                                            as reviewer_name,
                to_char(f.reviewed_at at time zone 'UTC', 'YYYY-MM-DD')   as reviewed_on`

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

      const findings: readonly FindingRecord[] = rows.map((row) => ({
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

    async byId(id: string): Promise<FindingDetail | null> {
      // **Checked here rather than let Postgres reject it.** `finding.id` is a
      // `uuid`, so a malformed value raises 22P02 on the cast — and this id
      // comes straight off the URL path, where anything at all is reachable by
      // typing. A database error is the wrong answer to "is there a finding
      // here": the honest one is no, which is what the surface turns into a
      // 404.
      if (!isFindingId(id)) return null

      const { rows } = await writerPool().query<DetailRow>(
        `select f.id,
                f.finding_type,
                f.subject_id,
                to_char(lower(f.period), 'YYYY-MM-DD')                    as period_from,
                to_char(upper(f.period), 'YYYY-MM-DD')                    as period_until,
                f.evidence,
                to_char(f.raised_at at time zone 'UTC', 'YYYY-MM-DD')     as raised_on,
                m.display_name                                            as reviewer_name,
                to_char(f.reviewed_at at time zone 'UTC', 'YYYY-MM-DD')   as reviewed_on
           from finding f
           -- Left, because f.reviewed_by is null on every unreviewed finding,
           -- so an inner join would return no row for any of them -- which is
           -- most of the register.
           --
           -- An earlier version of this comment blamed display_name being
           -- nullable. That is false: an inner join filters on the join
           -- condition, not on the columns selected through it, so a matched
           -- member with no name still yields a row. Raised by Argus, and it is
           -- the same defect as story 4.3's migration comment -- a comment
           -- asserting something untrue about the database it sits in.
           --
           -- No backticks in here. This is a template literal, so one would end
           -- the string mid-query and the file would fail to parse -- which is
           -- how it was first written, and the suite reported it as 21 tests
           -- vanishing rather than as a syntax error.
           left join board_member m on m.id = f.reviewed_by
          where f.id = $1`,
        [id],
      )

      const row = rows[0]
      if (row === undefined) return null

      return toDetail(row)
    },

    async register(filter: RegisterFilter): Promise<ReviewedRegister> {
      const { limit } = filter

      // The same refusal `unreviewed` makes, and for the same reason: a bound
      // that is silently corrected is one the caller never learns they got
      // wrong.
      if (!Number.isInteger(limit) || limit < 1 || limit > MOST_ROWS) {
        throw new RangeError(`register limit must be a whole number from 1 to ${MOST_ROWS}: ${limit}`)
      }

      // **Absent, not empty.** A blank search box submits on every press, and a
      // filter of `''` would narrow the register to findings matching nothing
      // and present that as an empty register. `app/access-log/filter.ts` makes
      // the same distinction at the URL; this is the backstop for callers that
      // do not.
      const wanted = filter.search?.trim()
      const search = wanted === undefined || wanted === '' ? null : likePattern(wanted)

      const { rows } = await writerPool().query<DetailRow & { total: string }>(
        `select f.id,
                f.finding_type,
                f.subject_id,
                to_char(lower(f.period), 'YYYY-MM-DD')                    as period_from,
                to_char(upper(f.period), 'YYYY-MM-DD')                    as period_until,
                f.evidence,
                to_char(f.raised_at at time zone 'UTC', 'YYYY-MM-DD')     as raised_on,
                m.display_name                                            as reviewer_name,
                to_char(f.reviewed_at at time zone 'UTC', 'YYYY-MM-DD')   as reviewed_on,
                count(*) over ()                                          as total
           from finding f
           -- Left, and here it is equivalent to an inner join today. Saying so
           -- rather than inventing a reason: this query filters to reviewed
           -- rows, finding_review_is_attributed guarantees those carry a
           -- reviewed_by, and the foreign key declares no ON DELETE action --
           -- so a referenced member cannot be deleted and the join always
           -- matches. A nullable display_name does not change that: an inner
           -- join filters on the join condition, not on the columns selected
           -- through it.
           --
           -- Kept anyway, because both ways this stops being equivalent end
           -- with rows silently missing from a permanent record: the filter
           -- widening to take in unreviewed findings, or the key gaining
           -- ON DELETE SET NULL. Left costs nothing here and fails safe there.
           --
           -- The sibling query above needs it for a live reason; this one does
           -- not. Its comment was corrected once already for asserting
           -- something false about SQL, and the first version of this one
           -- repeated the mistake by claiming the member might have been
           -- removed. And no backticks: the warning below is not decorative,
           -- and this comment first carried three of them.
           left join board_member m on m.id = f.reviewed_by
          where f.state = 'reviewed'
            and (
              $2::text is null
              or f.finding_type ilike $2 escape '\\'
              or m.display_name ilike $2 escape '\\'
              -- **Values, never keys.** jsonpath reaches the named display
              -- fields at any depth, so a vendor inside the pairs array is
              -- found; a search for "vendor" is not answered with every spike
              -- finding because the key happens to be spelled vendorName.
              or exists (
                select 1
                  from jsonb_path_query(f.evidence, 'strict $.**.vendorName') as v
                 where v #>> '{}' ilike $2 escape '\\'
              )
              or exists (
                select 1
                  from jsonb_path_query(f.evidence, 'strict $.**.unitNumber') as v
                 where v #>> '{}' ilike $2 escape '\\'
              )
              or exists (
                select 1
                  from jsonb_path_query(f.evidence, 'strict $.**.holderName') as v
                 where v #>> '{}' ilike $2 escape '\\'
              )
            )
          -- Newest review first. The tie-break is not decoration: one detection
          -- run marks nothing, but a board member working through a queue
          -- stamps several rows inside the same second, and a register that
          -- reshuffles between two refreshes is one nobody can cite a line of.
          order by f.reviewed_at desc, f.id desc
          limit $1`,
        [limit, search],
      )

      const findings: readonly FindingDetail[] = rows.map((row) => ({
        id: row.id,
        findingType: row.finding_type,
        subjectId: row.subject_id,
        period: { from: row.period_from, until: row.period_until },
        evidence: row.evidence,
        raisedOn: row.raised_on,
        reviewed: row.reviewed_on === null ? null : { by: row.reviewer_name, on: row.reviewed_on },
      }))

      return { findings, total: Number(rows[0]?.total ?? 0) }
    },
    async awaitingAlert(limit: number): Promise<readonly FindingDetail[]> {
      // The same refusal the two reads above make, and for the same reason: an
      // unbounded read of a table that only ever grows is one that gets slower
      // every year the association runs.
      if (!Number.isInteger(limit) || limit < 1 || limit > MOST_ROWS) {
        throw new RangeError(
          `a findings limit must be a whole number between 1 and ${MOST_ROWS}, not ${limit}`,
        )
      }

      // **`not exists` against a delivered alert, and nothing about claims.**
      // A finding is a candidate when no send has *succeeded* for it. Whether a
      // run currently holds a claim is arbitration, and arbitration belongs to
      // `FindingAlertLedger.claim`, which settles it in one statement against a
      // unique constraint. A read that tried to exclude live claims would be
      // answering a question that has already changed by the time the caller
      // acts on the answer.
      //
      // **`state = 'unreviewed'`, and it is not redundant.** An alert exists to
      // make somebody look; if somebody has looked, there is nothing left for
      // it to do. Without this, mail unset for a week and then configured sends
      // the board an email for every finding they had already worked through --
      // and the link lands on the already-reviewed state, inviting a second
      // director to review what the register has answered. Found by the
      // whole-story integration pass: it is only reachable when the retry path
      // and this read are considered together, which no per-task review sees.
      //
      // **`sent_at is not null` inside the subquery, not `a.finding_id is
      // null` outside a join.** An alert row exists the moment a claim is
      // taken, so a plain anti-join would drop every finding a previous run had
      // claimed and failed to send -- which is exactly the set this read exists
      // to recover.
      //
      // **Oldest first**, the opposite of every other read here. The others
      // show a board member what is most recent; this one works through a
      // backlog, and a warning that has waited longest is the one closest to
      // being too late. `id` breaks the tie for the reason the other reads give
      // -- one detection run raises several findings on the same `now()`.
      // **The reviewer join always matches nothing here, and it stays.** An
      // unreviewed finding has `reviewed_by is null` -- migration 021's
      // `finding_review_is_attributed` guarantees it -- so the join below is
      // dead for this query. Raised by Argus, accurately.
      //
      // It is kept because removing it means this query can no longer use
      // `DETAIL_COLUMNS`, and a second column list is the drift `toDetail` was
      // extracted to make unrepresentable: two reads of one row shape are two
      // chances for the email and the page to disagree. A left join on an
      // always-null key is cheap, and it keeps producing correct data if the
      // state predicate is ever revisited.
      const { rows } = await writerPool().query<DetailRow>(
        `select ${DETAIL_COLUMNS}
           from finding f
           left join board_member m on m.id = f.reviewed_by
          where f.state = 'unreviewed'
            and not exists (
                  select 1
                    from finding_alert a
                   where a.finding_id = f.id
                     and a.sent_at is not null
                )
          order by f.raised_at asc, f.id asc
          limit $1`,
        [limit],
      )

      return rows.map(toDetail)
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
