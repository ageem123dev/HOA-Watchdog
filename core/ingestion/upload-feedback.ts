import { ACCEPTED_FORMAT_LABELS, MAX_DOCUMENT_BYTES, type RejectionReason } from './acceptance'
import type { IngestOutcome } from './ingest'

/**
 * What a treasurer reads after an upload.
 *
 * Modelled on `core/auth/sign-in-feedback.ts`, and in `core/` for the same
 * reason: a React component is an awkward place to assert that a sentence still
 * matches the PRD, and a function is not.
 *
 * Voice, per EXPERIENCE.md: plain language inside formal structure. Say what
 * happened and what to do next. Never apologise, and never imply certainty the
 * system does not have.
 */

export interface UploadFeedback {
  /** Short enough to sit in a row beside a filename. */
  readonly status: string
  readonly message: string | null
  /** Whether this row should offer the treasurer a way to supply another file. */
  readonly offerReplacement: boolean
}

/**
 * FR-1, quoted exactly. AC4 says verbatim, and a test compares this against the
 * sentence in `docs/prd/prd.md` rather than trusting the comment above it.
 */
const UNREADABLE_MESSAGE =
  'This file cannot be read. It might be password protected or corrupted. ' +
  'Please upload an unlocked or clearer version.'

/**
 * Built from the acceptance gate's own table, not retyped. A list stated twice
 * drifts, and the version a board member reads is the one that would be wrong.
 */
function acceptedFormats(): string {
  const labels = Object.values(ACCEPTED_FORMAT_LABELS)
  const last = labels[labels.length - 1]

  return `${labels.slice(0, -1).join(', ')}, and ${last}`
}

/** Derived from the constant the gate enforces, for the same reason. */
function sizeLimit(): string {
  return `${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB`
}

const REJECTION_MESSAGES: Readonly<Record<RejectionReason, string>> = Object.freeze({
  'unsupported-type': `Accepted formats are ${acceptedFormats()}.`,
  'too-large': `Files are accepted up to ${sizeLimit()}.`,
  empty: 'This file is empty. Check that it saved before uploading it.',
  unreadable: UNREADABLE_MESSAGE,
})

export function uploadFeedback(outcome: IngestOutcome): UploadFeedback {
  switch (outcome.outcome) {
    case 'accepted':
      return { status: 'Added', message: null, offerReplacement: false }

    case 'already-held':
      // AC2 is explicit: told it was already held, not that it failed. Nothing
      // went wrong, so nothing here reads like something did, and there is
      // nothing to replace.
      return {
        status: 'Already on record',
        message: 'These are the same contents as a document already held. Nothing was added.',
        offerReplacement: false,
      }

    case 'rejected':
      return {
        status: 'Not added',
        message: REJECTION_MESSAGES[outcome.reason],
        offerReplacement: true,
      }

    case 'failed':
      // Not the file's fault, and the copy must not suggest it was. This is the
      // one outcome that is worth simply trying again.
      return {
        status: 'Not saved',
        message: 'This file could not be stored just now. Try uploading it again.',
        offerReplacement: true,
      }
  }
}
