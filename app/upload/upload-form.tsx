'use client'

import { useActionState } from 'react'

import { ACCEPTED_CONTENT_TYPES } from '@/core/ingestion/acceptance'
import { uploadFeedback } from '@/core/ingestion/upload-feedback'
import { uploadDocuments } from './actions'
import { EMPTY_UPLOAD_STATE, type UploadState } from './upload-state'

/**
 * The upload surface's three states from UX-DR12 that belong to this story —
 * added, refused as unsupported or oversized, refused as unreadable — plus AC2's
 * "already held" and the retryable "not saved".
 *
 * Every word rendered here comes from `core/ingestion/upload-feedback.ts`, which
 * is tested against the PRD. Nothing on this page phrases an outcome itself.
 */
export function UploadForm() {
  const [state, submit, pending] = useActionState<UploadState, FormData>(
    uploadDocuments,
    EMPTY_UPLOAD_STATE,
  )

  return (
    <>
      <form action={submit} style={styles.form}>
        <label htmlFor="documents" style={styles.label}>
          Documents
        </label>
        <input
          id="documents"
          name="documents"
          type="file"
          multiple
          accept={ACCEPTED_CONTENT_TYPES.join(',')}
          style={styles.field}
        />
        <button type="submit" style={styles.control} disabled={pending}>
          {pending ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {state.error !== null ? (
        <p role="alert" style={styles.requestError}>
          {state.error}
        </p>
      ) : null}

      {/*
        A polite live region around the results, not merely a caption.

        The table is inserted after the response, and an inserted table
        announces nothing — so a screen reader user submits an upload and hears
        silence, which means the entire point of this page goes unreported. The
        region is always in the document and only its contents change, because a
        live region added at the same moment as its content is announced
        unreliably.
      */}
      <div role="status" aria-live="polite" style={styles.results}>
        {state.outcomes.length > 0 ? (
          <table style={styles.table}>
            <caption style={styles.caption}>
              {state.outcomes.length} file{state.outcomes.length === 1 ? '' : 's'} submitted
            </caption>
            <thead>
              <tr>
                <th scope="col" style={styles.columnHeading}>
                  File
                </th>
                <th scope="col" style={styles.columnHeading}>
                  Outcome
                </th>
              </tr>
            </thead>
            <tbody>
              {state.outcomes.map((outcome, index) => {
                const feedback = uploadFeedback(outcome)

                return (
                  <tr key={`${outcome.filename}-${index}`} style={styles.row}>
                    <td style={styles.cell}>{outcome.filename}</td>
                    <td style={styles.cell}>
                      <span style={styles.status}>{feedback.status}</span>
                      {feedback.message !== null ? (
                        <span style={styles.detail}>{feedback.message}</span>
                      ) : null}
                      {feedback.offerReplacement ? (
                        <span style={styles.detail}>
                          Choose a replacement above and upload again.
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : null}
      </div>
    </>
  )
}

const styles = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-row)',
    alignItems: 'flex-start',
  },
  label: {
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
  },
  field: { font: 'inherit', maxWidth: '100%' },
  // Records action, not a call to action — never a filled button.
  control: {
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'transparent',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
    cursor: 'pointer',
  },
  requestError: {
    margin: 0,
    borderInlineStart: 'var(--component-margin-tick-width) solid var(--color-flag)',
    paddingInlineStart: 'var(--space-row)',
  },
  results: { width: '100%' },
  table: { borderCollapse: 'collapse', width: '100%', textAlign: 'start' },
  caption: {
    textAlign: 'start',
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
    paddingBlockEnd: 'var(--space-row)',
  },
  columnHeading: {
    textAlign: 'start',
    fontSize: 'var(--type-scale-label)',
    letterSpacing: 'var(--type-tracking-label)',
    textTransform: 'uppercase',
    color: 'var(--color-ink-muted)',
    fontWeight: 400,
    borderBlockEnd: 'var(--component-rule-heading) solid var(--color-rule-strong)',
    paddingBlock: 'var(--space-row)',
  },
  row: { borderBlockEnd: 'var(--component-rule-hairline) solid var(--color-rule-strong)' },
  cell: { paddingBlock: 'var(--space-row)', verticalAlign: 'top' },
  status: { display: 'block' },
  detail: { display: 'block', color: 'var(--color-ink-muted)' },
} satisfies Record<string, React.CSSProperties>
