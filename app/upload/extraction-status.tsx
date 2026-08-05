'use client'

import { useEffect, useState } from 'react'

import { EXTRACTION_OUTCOMES, type ExtractionOutcome } from '@/core/ingestion/extract-document'
import {
  EXTRACTION_STATUS_UNAVAILABLE,
  extractionFeedback,
  type ExtractionFeedback,
} from '@/core/ingestion/extraction-feedback'

/**
 * What is happening to a document the upload stored but did not read.
 *
 * Story 1.5c decided extraction is deferred, so the upload returns as soon as
 * the bytes are durable and this asks the follow-up endpoint what has become of
 * them. It stops as soon as the outcome settles — a poller that keeps asking
 * after the answer is final is just load.
 *
 * Every word comes from `core/ingestion/extraction-feedback.ts`. Nothing here
 * phrases an outcome, and nothing here has access to a figure to phrase one
 * with: the endpoint returns a state, never a record. **Partial extraction is
 * never displayed under any state** (UX-DR12) is therefore a property of what
 * this component can even see.
 */

/** Long enough not to hammer the endpoint, short enough to feel live. */
const POLL_INTERVAL_MS = 3_000

/**
 * A ceiling on attempts, so a document that never settles stops asking.
 *
 * Without it, a tab left open on a stuck document polls until it is closed.
 */
const MAX_ATTEMPTS = 40

/**
 * Is this parsed body actually an outcome?
 *
 * Checked against the exported vocabulary rather than for the presence of a
 * field, so a body carrying `outcome: "something-else"` is refused too. The
 * endpoint and this component are versioned together today; they will not
 * always be.
 */
function isOutcome(body: unknown): body is ExtractionOutcome {
  if (typeof body !== 'object' || body === null) return false

  const kind = (body as { outcome?: unknown }).outcome

  return (
    typeof kind === 'string' && (EXTRACTION_OUTCOMES as readonly string[]).includes(kind)
  )
}

/**
 * Statuses that will never become anything else by waiting.
 *
 * A refused request is not a slow one. 401 for an expired session and 400 for a
 * malformed id do not change on their own, so retrying them is 40 requests over
 * two minutes that all fail the same way.
 */
const PERMANENT_REFUSALS = new Set([400, 401, 403, 404, 405, 410, 422])

export function ExtractionStatus({ documentId }: { readonly documentId: string }) {
  const [outcome, setOutcome] = useState<ExtractionOutcome | null>(null)
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const ask = async (): Promise<void> => {
      attempts += 1

      try {
        const response = await fetch(
          `/api/documents/${encodeURIComponent(documentId)}/extract`,
          { method: 'POST' },
        )
        const body: unknown = await response.json()

        // The unmount check is after the await, not before it: a component that
        // sets state on a response that arrived after it left the page is the
        // classic React leak.
        if (cancelled) return

        // A 401 answers `{ error: 'unauthenticated' }` and a 400 answers
        // `{ error: 'not a document id' }`. Neither is an outcome, and putting
        // one into state crashed the page: the throw inside this try is caught
        // below, but the *render* then calls `extractionFeedback` on it where
        // nothing catches anything. Found in review.
        if (!response.ok || !isOutcome(body)) {
          // A refused request is not a slow one. Retrying a 401 changes nothing
          // and leaves the region reading "Waiting to be read", which tells the
          // treasurer their document is queued when it was never looked at.
          if (PERMANENT_REFUSALS.has(response.status)) {
            setRefused(true)
            return
          }

          // Anything else — a 5xx, or a 200 whose body is not an outcome — may
          // be a deploy in flight, so it is worth asking again.

          if (attempts < MAX_ATTEMPTS) timer = setTimeout(() => void ask(), POLL_INTERVAL_MS)
          return
        }

        setOutcome(body)

        if (!extractionFeedback(body).settled && attempts < MAX_ATTEMPTS) {
          timer = setTimeout(() => void ask(), POLL_INTERVAL_MS)
        }
      } catch {
        // A failed request says nothing about the document. Leaving the last
        // known state on screen is more honest than replacing it with an error
        // about our own connectivity — and the next attempt may well succeed.
        if (!cancelled && attempts < MAX_ATTEMPTS) {
          timer = setTimeout(() => void ask(), POLL_INTERVAL_MS)
        }
      }
    }

    void ask()

    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [documentId])

  const feedback: ExtractionFeedback | null = refused
    ? EXTRACTION_STATUS_UNAVAILABLE
    : outcome === null
      ? null
      : extractionFeedback(outcome)

  return (
    /*
      **No live region here.** `UploadForm` already wraps the whole results table
      in `role="status"`, and nesting one live region inside another lets a
      screen reader suppress, duplicate or over-broaden the announcement. This
      content is inside that region, so changes to it are announced by it.
      Raised in review.
    */
    <span style={styles.region}>
      {feedback === null ? (
        <span style={styles.status}>Waiting to be read</span>
      ) : (
        <>
          <span style={styles.status}>{feedback.status}</span>
          {feedback.message !== null ? (
            <span style={styles.detail}>{feedback.message}</span>
          ) : null}
        </>
      )}
    </span>
  )
}

// The same two tokens the results table already uses for this exact pair.
// Inventing a third pair here would give one surface two vocabularies for the
// same distinction, which is how a token set stops being one.
const styles = {
  region: { display: 'block' },
  status: { display: 'block' },
  detail: { display: 'block', color: 'var(--color-ink-muted)' },
} satisfies Record<string, React.CSSProperties>
