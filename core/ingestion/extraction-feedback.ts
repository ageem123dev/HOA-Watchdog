import type { ExtractionOutcome } from './extract-document'

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
  /**
   * True when trying again could plausibly help.
   *
   * Distinct from `settled`: an unreadable document is settled and retrying
   * cannot help, while a provider outage is settled *for now* and retrying can.
   */
  readonly retryable: boolean
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
        retryable: false,
      }

    case 'read':
      // Deliberately no count. "3 figures recorded" reads as a result the
      // treasurer can check, and the place to check it is the document itself —
      // not a number in a status cell that cannot be reconciled with anything.
      return {
        status: 'Read',
        message: 'The figures from this document are recorded.',
        settled: true,
        retryable: false,
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
        retryable: false,
      }

    case 'provider-unavailable':
      // Asks for nothing, exactly as `figures-not-stored` does. The document is
      // fine, nothing is lost, and there is no action the treasurer can usefully
      // take — telling them to try again would make our outage their errand.
      return {
        status: 'Waiting to be read',
        message: 'This document could not be read just now. It will be read shortly.',
        settled: true,
        retryable: true,
      }

    case 'no-provider-path':
      // A spreadsheet or CSV, already read at upload by the deterministic
      // parser. Reaching this state means something asked the wrong question,
      // and the honest answer is that there is nothing to wait for.
      return {
        status: 'Read',
        message: 'The figures from this document are recorded.',
        settled: true,
        retryable: false,
      }

    case 'not-found':
      return {
        status: 'Not found',
        message: 'This document is no longer held.',
        settled: true,
        retryable: false,
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
