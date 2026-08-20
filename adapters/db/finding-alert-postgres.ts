import type { BoardRecipients } from '../../core/ports/board-recipients'
import type { FindingAlertLedger } from '../../core/ports/finding-alert'
import { writerPool } from './pool'

/**
 * Owning an alert's send, and knowing who it goes to.
 *
 * Migration 023 is the authority on the rules these two obey; this file is the
 * statements that reach them. Read that header first — the claim's shape in
 * particular is a consequence of decisions argued there rather than a choice
 * made here.
 *
 * ## `writerPool()`, and do not "correct" it to `readerPool()`
 *
 * The recipient read below looks exactly like something that belongs on the
 * SELECT-only role, and it does not. Migration 003 revoked `watchdog_reader`'s
 * blanket SELECT so that read access became explicit per table, and it revoked
 * `board_member` by name — precisely so the LLM-driven query path cannot
 * enumerate the directors. Migration 023 says the same no for `finding_alert`.
 *
 * Pointing either read at `readerPool()` fails with a permission error, and the
 * dangerous repair is the obvious one: granting the reader SELECT, which hands
 * the Oracle's query path the board's addresses and the record of who was warned
 * about whom. **Those grants are the thing those migrations exist to withhold.**
 * If this genuinely needs revisiting it is an architecture decision, not a fix.
 */

/**
 * The longest failure this will store.
 *
 * Migration 023 caps the column at 2000 characters, and a provider that echoes
 * the request back in its error body would exceed it easily. Truncating here
 * rather than letting the insert throw is deliberate: the exception would come
 * from *recording that the send failed*, so the only record that it failed would
 * be lost to the failure of recording it — and the alert would look like one
 * nobody had ever tried, with no reason attached.
 */
const MOST_FAILURE_CHARACTERS = 2000

/**
 * What is stored when the provider fails without saying why.
 *
 * `finding_alert_failure_is_useful` refuses a blank reason, and a provider that
 * fails with an empty body produces exactly one. Recording *that the send
 * failed* would then throw on the constraint -- so the only record that it
 * failed would be lost to the failure of recording it, and the alert would look
 * like one nobody had ever tried. The same defect the length cap above prevents,
 * arriving from the other end.
 */
const UNEXPLAINED = 'the provider gave no reason'

/** A reason the column will accept: never blank, never longer than the cap. */
function storable(failure: string): string {
  const trimmed = failure.trim()

  return trimmed === '' ? UNEXPLAINED : trimmed.slice(0, MOST_FAILURE_CHARACTERS)
}

export function createFindingAlertLedger(): FindingAlertLedger {
  return {
    async claim(findingId: string, staleBefore: Date): Promise<boolean> {
      // **One statement, never a read followed by a write.** Two runs arriving
      // together would both read "unclaimed" and both believe they owned it;
      // the unique constraint is what arbitrates, and only an upsert lets it do
      // that. This is the same argument `FindingRegister.raise` makes for
      // returning `wasAlreadyKnown` instead of preceding itself with a select.
      //
      // The `where` on the `do update` is what makes staleness a takeover
      // rather than a stampede: a fresh claim held by a live run matches
      // nothing, so the conflicting insert updates no row and returns none.
      //
      // `sent_at is null` is checked as well as the claim's age, and it is not
      // redundant. Without it a delivered alert whose claim is old enough would
      // be re-claimed and re-sent forever, with staleness reopening a finished
      // delivery — which is the one thing this table exists to make impossible.
      const { rows } = await writerPool().query<{ id: string }>(
        // `association_id` from the finding this alert is about.
        `insert into finding_alert (finding_id, association_id)
         values ($1, (select association_id from finding where id = $1))
         on conflict (finding_id) do update
            set claimed_at = now(),
                failure    = null
          where finding_alert.sent_at is null
            and finding_alert.claimed_at < $2
         returning id`,
        [findingId, staleBefore],
      )

      return rows.length === 1
    },

    async recordSent(findingId: string, recipients: readonly string[]): Promise<void> {
      // The array is handed over as-is. Migration 023 refuses an empty list, a
      // list with a NULL in it, and a list containing a blank string, so a
      // caller that lost its recipients between sending and recording fails
      // loudly here rather than writing a delivery nobody can be found in.
      // Sanitising them into something acceptable would be this code deciding
      // what the record says about who was told.
      // **`and sent_at is null`, so a second delivery is a no-op rather than an
      // exception.** At-least-once means two runs can both reach the send, and
      // migration 023's trigger refuses to move a row that has already gone --
      // it *raises*, which would throw out of this call after the loser had
      // already put an email in somebody's inbox. The caller cannot tell that
      // from a send that failed, and would record a failure for a message that
      // was delivered twice.
      //
      // The first delivery's record stands. It is the one that says what
      // actually happened first.
      await writerPool().query(
        `update finding_alert
            set sent_at    = now(),
                recipients = $2,
                failure    = null
          where finding_id = $1
            and sent_at is null`,
        [findingId, [...recipients]],
      )
    },

    async recordFailure(findingId: string, failure: string): Promise<void> {
      // Guarded like `recordSent` above and for the same reason. "Sent, and
      // also failed" is unrepresentable -- the trigger raises rather than
      // allowing it -- so without this the losing run's failure path throws and
      // looks like the failure-recording itself broke. A no-op is the honest
      // outcome: somebody else delivered it, and there is nothing left to
      // record. Raised by Argus, whose reasoning about the resulting *state*
      // was wrong and whose fix was right.
      await writerPool().query(
        `update finding_alert
            set failure = $2
          where finding_id = $1
            and sent_at is null`,
        [findingId, storable(failure)],
      )
    },
  }
}

export function createBoardRecipients(): BoardRecipients {
  return {
    async active(): Promise<readonly string[]> {
      // **`disabled_at is null` is the whole rule**, and it is the same one
      // sign-in applies. A director who has left the board keeps their audit
      // trail and stops receiving mail.
      //
      // Ordered by email rather than left to the planner. The result is written
      // into the delivery record, and a record whose order shuffles between
      // reads is one nobody can diff against another. `created_at` would do the
      // same job and ties on it are representable; an address is unique by
      // constraint, so this order cannot tie.
      //
      // Unbounded, deliberately, and `core/ports/board-recipients.ts` argues
      // why: the board is a handful of directors fixed by the association, and
      // a limit here drops somebody from a warning with nothing reporting that
      // they were dropped.
      const { rows } = await writerPool().query<{ email: string }>(
        `select email
           from board_member
          where disabled_at is null
          order by email`,
      )

      return rows.map((row) => row.email)
    },
  }
}
