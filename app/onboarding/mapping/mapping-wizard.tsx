'use client'

import { useActionState } from 'react'

import { DOCUMENT_KINDS, type DocumentKind } from '@/core/extraction/record'
import { TABULAR_CONTENT_TYPES } from '@/core/extraction/rectangle'
import { readSample } from './actions'
import { ColumnPairing } from './column-pairing'
import { EMPTY_SAMPLE_STATE, type SampleState } from './sample-state'

/**
 * The mapping step: take a sample, then pair its columns with the importer's.
 *
 * **This component is why story 5.3 withheld the action.** An action with
 * nothing rendering it is the shape that shipped broken in 5.2 — `actions.ts`
 * required a field the form never sent, and every gate was green because
 * nothing rendered the form and looked at what it submits. `mapping-wizard.test.tsx`
 * asserts the control *names*, since a name is what reaches `formData.get(...)`.
 */

/** What a treasurer calls each kind — the same words `app/upload` uses. */
const KIND_LABELS: Readonly<Record<DocumentKind, string>> = {
  assessment_roll: 'Assessment roll — units, holders and what they owe',
  deposit: 'Deposits — payments against units',
  invoice: 'Invoices',
  statement: 'Bank statement',
  other: 'Something else',
}

/**
 * Extensions **as well as** media types.
 *
 * A file picker matches `accept` against both, and inconsistently: Windows
 * commonly reports a `.csv` as `application/vnd.ms-excel`, and some browsers
 * report nothing at all for an unregistered type. On media types alone a
 * treasurer can find their own export greyed out in the picker they were sent
 * to. The extensions only widen what is *offerable* — `readSample` still
 * canonicalises and validates the content type server-side and refuses what it
 * cannot read. Raised by CodeRabbit.
 */
const SAMPLE_ACCEPT = [...TABULAR_CONTENT_TYPES, '.csv', '.xls', '.xlsx'].join(',')

export interface MappingWizardProps {
  /** For tests, and for a step that resumes; the form drives it otherwise. */
  readonly initialState?: SampleState
}

export function MappingWizard({ initialState = EMPTY_SAMPLE_STATE }: MappingWizardProps) {
  const [state, submit, pending] = useActionState<SampleState, FormData>(readSample, initialState)

  return (
    <>
      <form action={submit} style={styles.form}>
        <label style={styles.label}>
          <span>Which import are you setting up?</span>
          {/*
            **The treasurer's declaration, not the file's.** A sample still says
            nothing about what it is — story 5.3 is explicit that the mapping is
            what a kind is *for*. This asks which import is being configured,
            because the importer's field list depends on it.

            No option is pre-selected, for story 5.2's reason: a default puts the
            decision back where it was, made by omission.
          */}
          <select name="documentKind" defaultValue="" required>
            <option value="" disabled>
              Choose one
            </option>
            {DOCUMENT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.label}>
          <span>A sample export, with its heading row</span>
          {/*
            `accept` comes from the reader's own list, so a format added there is
            one the picker offers rather than one a treasurer discovers is
            refused.
          */}
          <input name="sample" type="file" accept={SAMPLE_ACCEPT} required />
        </label>

        <p style={styles.note}>
          Only the headings are read. Nothing is stored, and this file is not added to your
          documents.
        </p>

        <button type="submit" disabled={pending}>
          {pending ? 'Reading…' : 'Read the headings'}
        </button>
      </form>

      {state.status === 'error' && (
        <p role="alert" style={styles.error}>
          {state.error}
        </p>
      )}

      {state.status === 'read' && (
        <ColumnPairing kind={state.kind} headings={state.headings} problems={state.problems} />
      )}
    </>
  )
}

const styles = {
  form: { display: 'flex', flexDirection: 'column', gap: 'var(--space-block)' },
  label: { display: 'flex', flexDirection: 'column', gap: 'var(--space-inline)' },
  note: { margin: 0, color: 'var(--color-ink-muted)' },
  error: { margin: 0 },
} satisfies Record<string, React.CSSProperties>
