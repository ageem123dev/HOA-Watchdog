'use client'

import { useCallback, useRef, useState } from 'react'

import { counted } from '@/core/findings/evidence'

/**
 * The board-packet export (AC4, AC8).
 *
 * ## It states what it will produce, before producing it
 *
 * UX-DR8, which forbids a bare "Export" by name. A control that does not say
 * what it makes is one a board member has to press to find out, and the thing
 * it makes here is handed to an auditor.
 *
 * **The count is the register's total, not the page's rows.** The file holds
 * every finding matching the current search, so a control naming the rows on
 * screen would promise a smaller document than it delivers.
 *
 * ## Why this is a component and not the link the access log uses
 *
 * `app/access-log/page.tsx` exports with a plain anchor. An anchor cannot have
 * an in-progress state at all — the browser navigates and the page never learns
 * what happened — and EXPERIENCE.md requires this one to show *"named progress,
 * count stated, control disabled during"*. So it runs the request itself and
 * turns the result into a download.
 *
 * The request is a **prop**, for the reason story 4.6 made its write a prop:
 * "disabled *during*" can only be asserted while the request is in flight, and a
 * component reaching for `fetch` itself would leave the interesting half of its
 * own acceptance criterion unassertable.
 */

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'exporting' }
  | { readonly kind: 'failed' }

export function ExportControl({
  total,
  download,
  filename = 'reviewed-findings.csv',
}: {
  readonly total: number
  readonly download: () => Promise<Blob>
  readonly filename?: string
}) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  // A ref rather than state, because the guard has to hold within a single
  // event loop turn: three clicks in one tick all read the same rendered
  // `state` and all pass, where the ref is already set by the first.
  const running = useRef(false)

  const start = useCallback(() => {
    if (running.current) return
    running.current = true
    setState({ kind: 'exporting' })

    void (async () => {
      try {
        const file = await download()

        save(file, filename)
        setState({ kind: 'idle' })
      } catch {
        // A throw and a rejection mean the same thing to a board member: no
        // file was produced. Never reported as success, and never silently —
        // a control that returns to idle with nothing downloaded looks exactly
        // like one that worked.
        setState({ kind: 'failed' })
      } finally {
        running.current = false
      }
    })()
  }, [download, filename])

  // "Export 0 reviewed findings as CSV" is a control that produces an empty
  // file and calls it a board packet. There is nothing here to hand anyone.
  if (total === 0) return null

  const findings = counted(total, 'reviewed finding')

  return (
    <div style={styles.block}>
      {/*
        One region, present from the first render, so a change to its text is an
        announcement rather than a new region appearing — which assistive
        technology is not obliged to read. Empty until something has happened.
      */}
      <p role="status" style={styles.status}>
        {state.kind === 'exporting'
          ? `Exporting ${findings}…`
          : state.kind === 'failed'
            ? 'The register could not be reached. No file was produced.'
            : ''}
      </p>

      <button
        type="button"
        onClick={start}
        disabled={state.kind === 'exporting'}
        style={styles.control}
      >
        Export {findings} as CSV
      </button>
    </div>
  )
}

/**
 * Hand the file to the browser.
 *
 * The object URL is revoked immediately after the click: it pins the blob in
 * memory until it is, and a board member exporting repeatedly through an
 * afternoon would accumulate every copy.
 */
function save(file: Blob, filename: string): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.click()

  URL.revokeObjectURL(url)
}

const styles = {
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-base)',
    alignItems: 'flex-start',
  },
  status: {
    margin: 0,
    fontFamily: 'var(--type-sans)',
    fontSize: 'var(--type-scale-label)',
    color: 'var(--color-ink-muted)',
  },
  // Records action, not a call to action — never a filled button. The minimum
  // target is UX-DR8's own: export controls are "otherwise small by nature", so
  // the floor is stated here rather than left to the text's width.
  control: {
    font: 'inherit',
    color: 'var(--color-ink)',
    background: 'transparent',
    border: 'var(--component-rule-hairline) solid var(--color-rule-strong)',
    borderRadius: 'var(--radius-none)',
    padding: 'var(--space-row)',
    minHeight: '44px',
    minWidth: '24px',
    cursor: 'pointer',
  },
} as const
