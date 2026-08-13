'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { REVIEW_UNDO_WINDOW_MS, reviewMessage, type ReviewOutcome } from '@/core/findings/review'

/**
 * Marking a finding reviewed — the only action in the pilot (AC3, AC4, AC5).
 *
 * ## The write is held, not undone
 *
 * EXPERIENCE.md requires a misclick to be correctable without database access;
 * migration 021 makes a review permanent in a trigger and revokes `delete`. The
 * two only conflict if the write happens first, so it does not: pressing the
 * control starts a window, and nothing is issued until the window closes. The
 * undo cancels a write that never happened.
 *
 * ## An interrupted window records nothing, deliberately
 *
 * Unmounting clears the timer and issues nothing — no `beforeunload`, no
 * fire-on-unmount, no attempt to rescue the write. That is the conservative
 * direction: an unreviewed finding stays in a queue somebody looks at again,
 * where a review recorded by accident permanently names a board member as having
 * read something they did not. **The recoverable failure is the one to choose**,
 * and the tempting rescue is precisely what AC4 forbids.
 *
 * ## Nothing here animates
 *
 * The subtask asks for no countdown under `prefers-reduced-motion`. There is no
 * countdown under anything: a rule enforced by the absence of the mechanism
 * cannot be dropped by a later layout change, where a rule enforced by a media
 * query can. The window is a delay, not a spectacle.
 */

/**
 * `sending` exists because the window closing and the register answering are
 * two moments, not one.
 *
 * Everything between them is time in which the write has gone and cannot be
 * recalled. A control that stayed `held` across it would keep offering to stop
 * a write already dispatched — and a board member who took the offer would see
 * the control reset, then see the page flip to "Moved to register.", having
 * recorded under their name a review they explicitly cancelled. Raised by Argus;
 * it is the defect AC5 is written against, one moment earlier than the obvious
 * reading of it.
 */
type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'held' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'settled'; readonly outcome: ReviewOutcome }

export function ReviewControl({
  findingId,
  markReviewed,
}: {
  readonly findingId: string
  readonly markReviewed: (findingId: string) => Promise<ReviewOutcome>
}) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  // A ref rather than state: clearing it must not schedule a render, and the
  // cleanup below has to see the current handle rather than the one captured
  // when the effect that armed it ran.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Which attempt the surface is currently narrating.
   *
   * Bumped by `cancel`, which is the one thing every interruption goes through
   * — undo, a change of finding, unmount. An in-flight write compares the
   * generation it was dispatched under against this one, and stays quiet if
   * they differ.
   *
   * **A counter rather than the finding's id**, because it is only ever written
   * from an event handler or an effect cleanup. Writing a ref during render is
   * a concurrent-mode violation: React may discard that render, leaving the ref
   * ahead of the state it was meant to describe. Raised by Argus.
   */
  const generation = useRef(0)

  const cancel = useCallback(() => {
    // Before the clear, so an interruption invalidates a write already in
    // flight as surely as it cancels one still waiting.
    generation.current += 1

    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  /** The finding this control is currently about, so a change can be noticed. */
  const [shownFor, setShownFor] = useState(findingId)

  // **Reset during render, not in an effect.** Unmounting is not the only
  // interruption: Next.js reuses this component across `/findings/a` →
  // `/findings/b` — same type, same position, new props — so the surface has to
  // return to `idle` itself. Doing that in an effect resets it *after* the
  // browser has painted, so the new finding shows the previous one's "Moved to
  // register." for a frame. Adjusting state during render is React's documented
  // way to do this, and unlike a ref write it is safe when a render is
  // discarded. Raised by Argus.
  if (shownFor !== findingId) {
    setShownFor(findingId)
    setState({ kind: 'idle' })
  }

  // **The whole of AC4**, and `findingId` is in the dependencies for the same
  // reuse reason: the cleanup has to run on a change of finding, not only on
  // unmount, or the timer fires holding the id of the finding the reader left.
  useEffect(() => cancel, [cancel, findingId])

  const hold = useCallback(() => {
    cancel()
    setState({ kind: 'held' })

    timer.current = setTimeout(() => {
      timer.current = null

      // Read here rather than at click time: `cancel` ran on the way in, so the
      // generation this attempt belongs to is the one current when it fires.
      const attempt = generation.current

      // **Before the call, not after it.** This is what closes the undo at the
      // moment the write becomes irrevocable rather than at the moment the
      // register gets round to answering.
      setState({ kind: 'sending' })

      // The only place the write is issued. `void` because the timer callback
      // cannot await, and the outcome is carried into state rather than thrown
      // away — a surface that issued the write and ignored the answer would say
      // the finding moved whatever the register replied.
      void (async () => {
        let outcome: ReviewOutcome

        try {
          outcome = await markReviewed(findingId)
        } catch {
          // A throw and a rejection reach here identically, and both mean the
          // same thing to a board member: the register did not answer, so
          // nothing is known to have been recorded. It is never reported as
          // success, and never as a different failure than it is.
          outcome = { outcome: 'failed' }
        }

        // **The answer is only reported to the attempt that asked.** Cancelling
        // the timer covers the held window and nothing past it: once the write
        // is away it cannot be recalled, and its answer arrives against
        // whatever is on screen by then. Without this, marking one finding and
        // moving straight to the next puts "Moved to register." on a finding
        // nobody has opened. The write itself stands — it was correct — and it
        // is simply not narrated on the wrong page. Raised by Argus.
        if (generation.current !== attempt) return

        setState({ kind: 'settled', outcome })
      })()
    }, REVIEW_UNDO_WINDOW_MS)
  }, [cancel, findingId, markReviewed])

  const undo = useCallback(() => {
    cancel()
    setState({ kind: 'idle' })
  }, [cancel])

  const message = state.kind === 'settled' ? reviewMessage(state.outcome) : null

  return (
    <div style={styles.block}>
      {/*
        **UX-DR20.** One region, present from the first render, so a change to
        its text is an announcement rather than a new region appearing — which
        assistive technology is not obliged to read. Empty until something has
        happened, because an empty region announces nothing.

        The undo lives *inside* it on purpose: "Moved to register — Undo" is
        what a screen-reader user needs to hear, where "Moved to register"
        alone leaves them to discover that the offer exists.
      */}
      <p role="status" style={styles.status}>
        {state.kind === 'held' ? (
          <>
            <span>Moved to register — </span>
            <button type="button" onClick={undo} style={styles.control}>
              Undo
            </button>
          </>
        ) : state.kind === 'sending' ? (
          // Present tense, and no claim. The register may still refuse this,
          // and saying "Moved to register." here would be the page claiming
          // more than it has done — the rule AC5 states.
          'Recording…'
        ) : (
          (message?.text ?? '')
        )}
      </p>

      {/*
        Offered when nothing has been recorded and pressing again could change
        the answer. Absent in the held state, so a double-click cannot start a
        second window; absent once anything has been recorded, so there is no
        control that would call `markReviewed` a second time — which is the call
        migration 021's trigger refuses and AC5 exists to forbid.
      */}
      {state.kind === 'idle' || (message !== null && message.canRetry) ? (
        <button type="button" onClick={hold} style={styles.control}>
          Mark reviewed
        </button>
      ) : null}
    </div>
  )
}

const styles = {
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-row)',
    alignItems: 'flex-start',
  },
  status: { margin: 0, color: 'var(--color-ink)' },
  // Records action, not a call to action — never a filled button. The 44px
  // minimum is the touch target every control in `app/` carries.
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
} as const
