import { toAlertEmail } from '../findings/alert-email'
import type { BoardRecipients } from '../ports/board-recipients'
import type { FindingAlertLedger } from '../ports/finding-alert'
import type { FindingDetail, FindingReader } from '../ports/finding-reader'
import type { MailSender } from '../ports/mail'

/**
 * Telling the board what it has not been told.
 *
 * `run-detection.ts` is the model for this file and has already argued most of
 * what is below — absent collaborators mean do nothing, one failure must not
 * stop the rest, reporting a failure must not become the failure, and nothing
 * here may fail an upload whose document really was read. Read that header
 * before changing this one.
 *
 * ## Where it differs, and why the default is louder
 *
 * `run-detection.ts` swallows a failure and accepts that "the finding is missed
 * until detection runs again". The same posture here would be wrong, because
 * the two failures are not alike:
 *
 * - A missed **detection** is recovered by the next upload. AD-13 makes
 *   re-running a no-op, so the finding simply appears later.
 * - A missed **alert** is recovered by nothing. The dashboard still shows the
 *   finding, the upload still succeeds, and the board is simply never told —
 *   which is indistinguishable from a month in which nothing was found.
 *
 * So a failure here is *recorded against the finding* as well as reported, the
 * claim is left unsent, and a later run takes it over. That is the whole of the
 * recovery story, and it is why `recordFailure` exists rather than a bare
 * `catch`.
 *
 * ## After detection, and it has to be
 *
 * A finding cannot be mailed before it is raised. `extract-document.ts` calls
 * this immediately after `runDetection`, in the same fail-soft discipline: the
 * records are already stored, the document was read, and nothing this function
 * does may report that success as a failure.
 */

/**
 * How long a claim is honoured before another run may take it over.
 *
 * Long enough that a send in flight is never stolen — the mail adapter's own
 * timeout is fifteen seconds — and short enough that a process which died
 * mid-send does not leave the board unwarned for the rest of the day.
 *
 * The cost of being wrong in each direction is asymmetric, and that is what set
 * the number. Too short means a duplicate email, which is a nuisance. Too long
 * means silence, which is the thing this story exists to remove.
 */
export const ALERT_RETRY_AFTER_MS = 15 * 60_000

/**
 * The most alerts one run will send.
 *
 * A bound rather than a page size. Without it the first upload after a backlog
 * builds up would send every outstanding alert at once, from inside a request a
 * treasurer is waiting on — and each one is a network round trip.
 *
 * What is left over is not lost: it has no delivery row, so the next run picks
 * it up. The outcome says how many were left rather than letting a caller read
 * a full batch as "everything went".
 */
export const MOST_ALERTS_PER_RUN = 25

export interface NotifyDependencies {
  readonly findings?: FindingReader
  readonly alerts?: FindingAlertLedger
  readonly recipients?: BoardRecipients
  readonly mail?: MailSender
  /** Where a board member's browser reaches this application. Absolute. */
  readonly baseUrl?: string
  /**
   * Injected, because the staleness boundary is computed from it and a test
   * cannot wait fifteen minutes for a claim to go stale.
   */
  readonly now?: () => Date
  /**
   * **The second argument is a finding id.** `ingest.ts` shipped a version that
   * handed a document id to a callback whose parameter was named `filename` —
   * both are strings, so it type-checked and logged a uuid under the wrong
   * label. The label is the only thing that makes the line legible to whoever
   * is working out why a board was not warned.
   */
  readonly onError?: (error: unknown, findingId: string) => void
}

export interface NotifyOutcome {
  /** Alerts that went, and were recorded as having gone. */
  readonly sent: number
  /** Alerts this run owned and could not deliver. Each keeps its claim, unsent. */
  readonly failed: number
  /** Findings another run already owned. Neither a failure nor a send. */
  readonly skipped: number
  /** At least this many were left for the next run. Zero means the batch was not full. */
  readonly remaining: number
}

const NOTHING: NotifyOutcome = { sent: 0, failed: 0, skipped: 0, remaining: 0 }

/**
 * Report a failure without letting the report become one.
 *
 * `onError` is caller-supplied, and a logger with a broken transport is an
 * ordinary thing to have. Thrown from here it escapes into an ingestion path
 * that has already stored the document's records — the exact defect
 * `run-detection.ts` was fixed for.
 */
function report(deps: NotifyDependencies, error: unknown, findingId: string): void {
  try {
    deps.onError?.(error, findingId)
  } catch {
    // Nowhere left to report it: the thing that reports is what broke.
  }
}

export async function notifyFindings(deps: NotifyDependencies): Promise<NotifyOutcome | null> {
  const { findings, alerts, recipients, mail, baseUrl } = deps

  // All-or-nothing, unlike `runDetection`'s per-detector gate. There is one
  // capability here and it needs every collaborator: a reader with no mailer
  // can only spend queries, and a mailer with no ledger would send the same
  // warning on every upload forever.
  if (
    findings === undefined ||
    alerts === undefined ||
    recipients === undefined ||
    mail === undefined ||
    baseUrl === undefined
  ) {
    return null
  }

  const now = deps.now ?? (() => new Date())
  const staleBefore = new Date(now().getTime() - ALERT_RETRY_AFTER_MS)

  let awaiting: readonly FindingDetail[]
  let addresses: readonly string[]
  try {
    // The board first and once. It cannot change inside a run, and reading it
    // per finding is a round trip per finding for the same answer.
    //
    // Sequential rather than through `Promise.all`, the choice `run-detection.ts`
    // records: each of these checks out a connection from a pool of five shared
    // by the whole process, and concurrent uploads multiply that.
    awaiting = await findings.awaitingAlert(MOST_ALERTS_PER_RUN)
    addresses = await recipients.active()
  } catch (error) {
    // A read that failed is not a finding that failed, so there is no id to
    // name. The upload still succeeded and must still look like it.
    report(deps, error, '')

    return NOTHING
  }

  // Nobody to tell is not the same as a send with no recipients. Claiming here
  // would take ownership of something that cannot happen, and the claim would
  // have to go stale before anybody else could try — so an association that
  // disabled its last director would silence itself for fifteen minutes at a
  // time. Migration 023 refuses the delivery row either way.
  if (addresses.length === 0 || awaiting.length === 0) return NOTHING

  let sent = 0
  let failed = 0
  let skipped = 0

  for (const finding of awaiting) {
    try {
      // One statement decides ownership. `false` means somebody else has it —
      // neither a failure nor a send, because counting it as either would make
      // the outcome say something untrue about what this run did.
      if (!(await alerts.claim(finding.id, staleBefore))) {
        skipped += 1
        continue
      }

      const email = toAlertEmail(finding, baseUrl)

      // **The send, then the record, and never the other way round.** A record
      // written first would say the board was warned about a message that then
      // failed, and nothing would ever retry it.
      await mail.send({ to: addresses, subject: email.subject, text: email.text })

      try {
        await alerts.recordSent(finding.id, addresses)
      } catch (error) {
        // The email is in an inbox and the row that would stop it being sent
        // again was not written. This is the case that spends the at-least-once
        // guarantee, and it is counted as sent because it was: the duplicate
        // that may follow is the price, and it is the right way round.
        report(deps, error, finding.id)
      }

      sent += 1
    } catch (error) {
      failed += 1
      report(deps, error, finding.id)

      // Recorded against the finding as well as reported, so the claim goes
      // stale rather than the failure being forgotten. Guarded in turn: the
      // ledger being unreachable is very often *why* the send failed, and a
      // throw here would end the batch for every finding behind this one.
      try {
        await alerts.recordFailure(finding.id, describe(error))
      } catch (recordingError) {
        report(deps, recordingError, finding.id)
      }
    }
  }

  return {
    sent,
    failed,
    skipped,
    // A full batch means there may be more behind it. The reader is bounded and
    // cannot say how many, so "at least one" is the honest answer — and saying
    // nothing would let a caller read a capped run as a complete one.
    remaining: awaiting.length === MOST_ALERTS_PER_RUN ? 1 : 0,
  }
}

/**
 * What is written into the delivery record.
 *
 * The message only, never the stack and never the error object. This lands in a
 * column an operator reads, and `MailNotSentError` is already written to carry
 * no recipient and no credential — a stack would carry whatever the provider
 * put in its rejection.
 */
function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : 'the send failed'
}
