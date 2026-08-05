'use client'

import { useEffect, useState } from 'react'

import type { ExtractionOutcome } from '@/core/ingestion/extract-document'
import { extractionFeedback } from '@/core/ingestion/extraction-feedback'

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

export function ExtractionStatus({ documentId }: { readonly documentId: string }) {
  const [outcome, setOutcome] = useState<ExtractionOutcome | null>(null)

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const ask = async (): Promise<void> => {
      attempts += 1

      try {
        const response = await fetch(`/api/documents/${documentId}/extract`, { method: 'POST' })
        const body = (await response.json()) as ExtractionOutcome

        // The unmount check is after the await, not before it: a component that
        // sets state on a response that arrived after it left the page is the
        // classic React leak.
        if (cancelled) return

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

  const feedback = outcome === null ? null : extractionFeedback(outcome)

  return (
    /*
      The region is always present and only its contents change. A live region
      added at the same moment as its content is announced unreliably — the same
      reasoning as the results table this sits inside.
    */
    <span role="status" aria-live="polite" style={styles.region}>
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
