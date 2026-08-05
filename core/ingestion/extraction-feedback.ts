import { EXTRACTION_OUTCOMES, type ExtractionOutcome } from './extract-document'

/**
 * What the treasurer is told while, and after, a document is read.
 *
 * The same discipline as `upload-feedback.ts`: every word rendered on the
 * extraction surface comes from here, so the copy can be tested and no
 * component phrases an outcome itself.
 *
 * **UX-DR12, verbatim: partial extraction is never displayed under any state.**
 * Nothing in this file carries a figure, a vendor name, a record's contents or a
 * count of records read *so far*. A document is being read or it has been read;
 * there is no half-read to show, because a half-read set is exactly what the
 * validator refuses and the repository never stores. Showing progress through
 * the figures themselves would invent a state the rest of the system does not
 * have.
 */

export interface ExtractionFeedback {
  /** The staged, named state (UX-DR12). */
  readonly status: string
  readonly message: string | null
  /**
   * True while the outcome can still change on its own.
   *
   * The surface uses this to decide whether to keep polling and whether to mark
   * the region busy — not to decide what to say, which is `status`'s job.
   */
  readonly settled: boolean
}

/**
 * What to show when the *request* was refused, rather than the document read.
 *
 * A 401 for an expired session or a 400 for a malformed id says nothing about
 * the document — so this deliberately does not describe one. It also does not
 * claim the document is queued: an earlier version left "Waiting to be read" on
 * screen after 40 futile retries, telling the treasurer their document was in a
 * queue when the request had been refused. Raised in review.
 */
export const EXTRACTION_STATUS_UNAVAILABLE = Object.freeze({
  status: 'Status unavailable',
  message: 'We could not check this document just now. Reload the page to try again.',
  settled: true,
}) satisfies ExtractionFeedback

/**
 * What a poll should do with an HTTP status and a parsed body.
 *
 * Pulled into `core/` so it can be tested without a DOM. The component that
 * used to decide this had no test harness, and it decided two things wrongly:
 * it retried permanent refusals forty times, and — after that was fixed — it
 * swallowed the endpoint's **valid 404 `not-found` outcome** as a refused
 * request, so the treasurer saw "Status unavailable" for a document that had
 * simply gone. Both raised in review.
 *
 * A body that *is* an outcome is always believed, whatever the status carrying
 * it. The status only decides what to do when the body is not one.
 */
export type PollDecision =
  | { readonly kind: 'outcome'; readonly outcome: ExtractionOutcome }
  /** No point asking again: the request itself was refused and will be next time. */
  | { readonly kind: 'refused' }
  /** Might work later — a 5xx, or a body that is not an outcome yet. */
  | { readonly kind: 'retry' }

/**
 * Statuses that will never become anything else by waiting.
 *
 * `404` is deliberately absent: the endpoint answers 404 for a document that is
 * gone, and that arrives with a real outcome in the body, handled above.
 */
const PERMANENT_REFUSALS: ReadonlySet<number> = new Set([400, 401, 403, 405, 410, 422])

export function pollDecision(status: number, body: unknown): PollDecision {
  if (isExtractionOutcome(body)) return { kind: 'outcome', outcome: body }
  if (PERMANENT_REFUSALS.has(status)) return { kind: 'refused' }

  return { kind: 'retry' }
}

/**
 * Is this parsed body an outcome?
 *
 * Checked against the vocabulary rather than for the presence of a field, so a
 * body carrying `outcome: "something-else"` is refused too.
 */
export function isExtractionOutcome(body: unknown): body is ExtractionOutcome {
  if (typeof body !== 'object' || body === null) return false

  const kind = (body as { outcome?: unknown }).outcome

  return typeof kind === 'string' && (EXTRACTION_OUTCOMES as readonly string[]).includes(kind)
}

export function extractionFeedback(outcome: ExtractionOutcome): ExtractionFeedback {
  switch (outcome.outcome) {
    case 'in-progress':
      // The staged name. Derived from `held` plus a live claim rather than
      // stored, which is why a crash shows this until the claim expires and
      // then shows "waiting to be read" again — both true, neither stuck.
      return {
        status: 'Reading',
        message: 'Reading the figures out of this document.',
        settled: false,
      }

    case 'read':
      // Deliberately no count. "3 figures recorded" reads as a result the
      // treasurer can check, and the place to check it is the document itself —
      // not a number in a status cell that cannot be reconciled with anything.
      return {
        status: 'Read',
        message: 'The figures from this document are recorded.',
        settled: true,
      }

    case 'unreadable':
      // The document opened and its figures could not be trusted. Distinct from
      // 1.4's unreadable-*file* copy, which is about a file that would not open
      // at all, and from the outage below.
      return {
        status: 'Could not be read',
        message:
          'This document opened, but its figures could not be read reliably. ' +
          'Upload a clearer scan, or export it as a spreadsheet.',
        settled: true,
      }

    case 'provider-unavailable':
      // Asks for nothing, exactly as `figures-not-stored` does. The document is
      // fine, and there is no action the treasurer can usefully take — telling
      // them to try again would make our outage their errand.
      //
      // It also promises nothing. An earlier version said "it will be read
      // shortly", which was false: this outcome is `settled`, the surface stops
      // polling on it, and no background job picks the document up. What is
      // true is that the document is kept and a later visit will try again,
      // because `provider_unavailable` stays claimable. Raised in review.
      return {
        status: 'Waiting to be read',
        message: 'This document could not be read just now. Nothing has been lost.',
        settled: true,
      }

    case 'no-provider-path':
      // A spreadsheet or CSV: the upload-time parser owns it, so nothing here
      // will ever run for it.
      //
      // This says only that, and deliberately not "the figures are recorded".
      // The outcome knows the *content type*; it carries no evidence that the
      // parse produced anything, so for a spreadsheet whose parse failed the
      // old copy asserted that financial figures were stored when they were
      // not. Raised in review.
      return {
        status: 'Nothing to read here',
        message: 'This file was read when it was uploaded.',
        settled: true,
      }

    case 'not-found':
      return {
        status: 'Not found',
        message: 'This document is no longer held.',
        settled: true,
      }

    default: {
      // A new `ExtractionOutcome` becomes a build error here rather than a blank
      // cell beside a filename. This is the guard that caught the missing case
      // in story 1.5b, and it is the only one in this project that reliably
      // does — neither ESLint nor Vitest type-checks.
      const unhandled: never = outcome

      throw new TypeError(`no extraction feedback for outcome ${JSON.stringify(unhandled)}`)
    }
  }
}
