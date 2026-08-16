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
  href,
  download = () => fetchCsv(href),
  filename = 'reviewed-findings.csv',
}: {
  readonly total: number
  /** Where the file comes from. A string, because this crosses the server boundary. */
  readonly href: string
  /**
   * How the file is fetched.
   *
   * Defaulted rather than required, and that is the whole reason this prop
   * exists: a bound function cannot be passed from a server component to a
   * client one, so the page hands over a URL and the component knows how to
   * ask for it. Tests hand over the request itself, because "the control is
   * disabled *during*" can only be asserted while one is in flight.
   */
  readonly download?: () => Promise<Blob>
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
 * Ask the route for the file.
 *
 * A non-OK response is a failure, not a file. Without the check the body of an
 * error page is downloaded as `reviewed-findings.csv` — a board packet
 * containing an HTML error, which is worse than no download at all because it
 * looks like one that worked.
 */
async function fetchCsv(href: string): Promise<Blob> {
  const response = await fetch(href)

  if (!response.ok) {
    throw new Error(`the register export answered ${response.status}`)
  }

  return response.blob()
}

/**
 * How long the object URL is left alive after the click.
 *
 * It has to outlive the click, and only just. Named because it is a judgement
 * about somebody else's event loop rather than a derivation.
 */
const HANDOVER_MS = 1_000

/**
 * Hand the file to the browser.
 *
 * The object URL pins the blob in memory until it is revoked, so a board member
 * exporting repeatedly through an afternoon would otherwise accumulate every
 * copy — but **revoking it synchronously after `click()` aborts the download**
 * in browsers that process the click asynchronously, which Firefox and Safari
 * do. The failure is the silent kind: the control reports success and either no
 * file arrives or an empty one does.
 *
 * So the revoke is deferred just past the handover. Raised by Argus, and the
 * first version of this function had it exactly wrong.
 */
function save(file: Blob, filename: string): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')

  link.href = url
  link.download = filename

  // **In the document before it is clicked.** Firefox has historically ignored
  // a programmatic click on a detached anchor, which fails the way this whole
  // control is written against: silently, with the board member told the export
  // ran. Removed straight after, so the page is left as it was found. Raised by
  // CodeRabbit.
  document.body.append(link)
  link.click()
  link.remove()

  setTimeout(() => URL.revokeObjectURL(url), HANDOVER_MS)
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
