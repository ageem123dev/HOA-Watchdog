// @vitest-environment jsdom

/**
 * The held write (AC3, AC4, AC5) — the only action in the pilot.
 *
 * ## Every negative here is asserted on the spy, and that is the point
 *
 * AC3 is explicit about it: *"asserted by the write port never being called, not
 * by reading the row back, because a test that reads the row back passes against
 * an implementation that wrote and then failed to write again."* The action is a
 * prop for exactly this reason — a control that reached for the server action
 * itself would leave "nothing was written" unassertable, and a test that cannot
 * fail is worse than no test because it reports on something.
 *
 * ## What would this look like if the refusal did not happen?
 *
 * The question story 4.5 left behind, asked of the two refusal tests. If undo
 * did nothing at all, `mark` would be called after the window elapses and
 * `not.toHaveBeenCalled()` fails. If unmount left the timer running, the same.
 * Both bite, and the sensitivity check in the story's notes confirms it against
 * a deliberately broken control rather than against this paragraph.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REVIEW_UNDO_WINDOW_MS } from '@/core/findings/review'
import type { ReviewOutcome } from '@/core/findings/review'
import { ReviewControl } from './review-control'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function recorded(): ReviewOutcome {
  return { outcome: 'recorded' }
}

function draw(mark: (findingId: string) => Promise<ReviewOutcome> = vi.fn(async () => recorded())) {
  const view = render(<ReviewControl findingId="finding-1" markReviewed={mark} />)
  return { ...view, mark }
}

/** Advance past the window and let the action's promise settle. */
async function closeTheWindow() {
  await act(async () => {
    vi.advanceTimersByTime(REVIEW_UNDO_WINDOW_MS)
  })
}

/** Advance to just before the window closes. */
async function almostCloseTheWindow() {
  await act(async () => {
    vi.advanceTimersByTime(REVIEW_UNDO_WINDOW_MS - 1)
  })
}

function markReviewed() {
  fireEvent.click(screen.getByRole('button', { name: /mark reviewed/i }))
}

function undo() {
  fireEvent.click(screen.getByRole('button', { name: /undo/i }))
}

describe('AC3: the write is held, and the undo cancels one that never happened', () => {
  it('issues nothing when the control is merely rendered', () => {
    const { mark } = draw()

    expect(mark).not.toHaveBeenCalled()
  })

  it('issues nothing at the moment of the click', () => {
    const { mark } = draw()

    markReviewed()

    expect(mark).not.toHaveBeenCalled()
  })

  it('issues nothing while the window is still open', async () => {
    const { mark } = draw()

    markReviewed()
    await almostCloseTheWindow()

    expect(mark).not.toHaveBeenCalled()
  })

  it('issues the write once the window closes', async () => {
    const { mark } = draw()

    markReviewed()
    await closeTheWindow()

    expect(mark).toHaveBeenCalledTimes(1)
    expect(mark).toHaveBeenCalledWith('finding-1')
  })

  it('issues nothing at all when undone inside the window', async () => {
    const { mark } = draw()

    markReviewed()
    undo()
    await closeTheWindow()

    expect(mark).not.toHaveBeenCalled()
  })

  it('issues nothing when undone twice', async () => {
    const { mark } = draw()

    markReviewed()
    undo()
    // The second press lands on a control that is gone; this asserts the state
    // machine does not resurrect a cancelled window.
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()
    await closeTheWindow()

    expect(mark).not.toHaveBeenCalled()
  })

  it('offers the action again after an undo, because nothing was recorded', async () => {
    const { mark } = draw()

    markReviewed()
    undo()

    expect(screen.queryByRole('button', { name: /mark reviewed/i })).not.toBeNull()

    markReviewed()
    await closeTheWindow()

    expect(mark).toHaveBeenCalledTimes(1)
  })

  it('starts one window however many times the control is pressed', async () => {
    const { mark } = draw()

    markReviewed()
    // The control is replaced by the pending copy, so a second press cannot
    // reach it. A double-click that started two windows would write twice, and
    // the second write is the one migration 021 refuses.
    expect(screen.queryByRole('button', { name: /mark reviewed/i })).toBeNull()
    await closeTheWindow()

    expect(mark).toHaveBeenCalledTimes(1)
  })
})

describe('AC4: an interrupted window records nothing', () => {
  it('writes nothing when the page is left during the window', async () => {
    const { mark, unmount } = draw()

    markReviewed()
    unmount()
    await closeTheWindow()

    expect(mark).not.toHaveBeenCalled()
  })

  it('leaves no timer behind to fire later', async () => {
    const { mark, unmount } = draw()

    markReviewed()
    unmount()

    // Far past the window. A cleared timer and a timer that merely has not
    // fired yet look identical at `WINDOW`; they do not look identical here.
    await act(async () => {
      vi.advanceTimersByTime(REVIEW_UNDO_WINDOW_MS * 100)
    })

    expect(mark).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('abandons a held write when the reader moves on to a different finding', async () => {
    // **Raised by Argus.** Unmounting is not the only interruption. Next.js
    // reuses the component across `/findings/a` → `/findings/b` — same type,
    // same position, new props — so the cleanup never runs, and the timer's
    // closure still holds the *old* id. It would record a review against the
    // finding the reader just left, and announce it on the one they are
    // looking at.
    const mark = vi.fn(async () => recorded())
    const { rerender } = render(<ReviewControl findingId="finding-1" markReviewed={mark} />)

    markReviewed()
    rerender(<ReviewControl findingId="finding-2" markReviewed={mark} />)
    await closeTheWindow()

    expect(mark).not.toHaveBeenCalled()
  })

  it('does not carry one finding’s outcome onto the next', async () => {
    const mark = vi.fn(async () => recorded())
    const { rerender } = render(<ReviewControl findingId="finding-1" markReviewed={mark} />)

    markReviewed()
    await closeTheWindow()
    expect(mark).toHaveBeenCalledTimes(1)

    rerender(<ReviewControl findingId="finding-2" markReviewed={mark} />)

    // The second finding is unreviewed, and the surface must say so — a
    // leftover "Moved to register." would tell a board member they had read
    // something they have not opened.
    expect(screen.getByRole('status').textContent ?? '').toBe('')
    expect(screen.queryByRole('button', { name: /mark reviewed/i })).not.toBeNull()
  })

  it('does not land one finding’s outcome on the next when the write is in flight', async () => {
    // **Raised by Argus, in the fix for its own previous finding.** Cancelling
    // the timer covers the `held` window and nothing after it: once the write
    // is away, its promise resolves against whatever the component is showing
    // by then. A reader who marks finding-1 and moves straight to finding-2
    // would see "Moved to register." on a finding nobody has opened.
    let land = () => {}
    const mark = vi.fn(
      () =>
        new Promise<ReviewOutcome>((resolve) => {
          land = () => resolve({ outcome: 'recorded' })
        }),
    )
    const { rerender } = render(<ReviewControl findingId="finding-1" markReviewed={mark} />)

    markReviewed()
    await closeTheWindow()
    expect(mark).toHaveBeenCalledTimes(1)

    rerender(<ReviewControl findingId="finding-2" markReviewed={mark} />)
    await act(async () => {
      land()
    })

    // finding-1 really was reviewed — the write went and is not recalled. What
    // must not happen is finding-2 reporting it.
    expect(screen.getByRole('status').textContent ?? '').toBe('')
    expect(screen.queryByRole('button', { name: /mark reviewed/i })).not.toBeNull()
  })

  it('does not reach for beforeunload to rescue the write', () => {
    // The rule AC4 states, asserted where it would be broken. A `beforeunload`
    // handler is the obvious way to "not lose" the review, and it is exactly
    // wrong: it would record a review a board member interrupted, which is the
    // failure that cannot be recovered from.
    const add = vi.spyOn(window, 'addEventListener')

    draw()
    markReviewed()

    const listened = add.mock.calls.map(([event]) => event)
    expect(listened).not.toContain('beforeunload')
    expect(listened).not.toContain('pagehide')
    expect(listened).not.toContain('unload')
  })
})

describe('AC5: the page never offers an undo for a write that has landed', () => {
  it('offers undo while the write is held', () => {
    draw()

    markReviewed()

    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeNull()
  })

  it('takes the undo away once the write lands', async () => {
    draw()

    markReviewed()
    await closeTheWindow()

    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()
  })

  it('offers no control at all once the review is recorded', async () => {
    draw()

    markReviewed()
    await closeTheWindow()

    // Not merely "no undo" — nothing that would call `markReviewed` a second
    // time either. The second call is the one that rejects.
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('takes the undo away when the write is dispatched, not when it comes back', async () => {
    // **Raised by Argus, and it is this AC's exact defect.** The window closing
    // and the register answering are two moments, and everything between them
    // is time in which the write has gone and the page was still offering to
    // stop it. A board member who pressed Undo there would watch the control
    // reset and then watch the page flip to "Moved to register." — having
    // recorded a review they explicitly cancelled, permanently, under their
    // name. AC5: "A surface still offering undo after the write is a lie a
    // board member would act on."
    let land = () => {}
    const mark = vi.fn(
      () =>
        new Promise<ReviewOutcome>((resolve) => {
          land = () => resolve({ outcome: 'recorded' })
        }),
    )

    draw(mark)
    markReviewed()
    await closeTheWindow()

    expect(mark).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull()

    await act(async () => {
      land()
    })

    expect(screen.getByRole('status').textContent ?? '').toMatch(/moved to register\.?$/i)
  })

  it('claims nothing while the register has not yet answered', async () => {
    let land = () => {}
    const mark = vi.fn(
      () =>
        new Promise<ReviewOutcome>((resolve) => {
          land = () => resolve({ outcome: 'recorded' })
        }),
    )

    draw(mark)
    markReviewed()
    await closeTheWindow()

    // In flight. The write may still be refused, so the past tense here would
    // be a claim the register has not agreed to.
    expect(screen.getByRole('status').textContent ?? '').not.toMatch(/moved to register/i)
    expect(screen.queryAllByRole('button')).toHaveLength(0)

    await act(async () => {
      land()
    })
  })

  it('speaks in the past tense once the write has landed', async () => {
    draw()

    markReviewed()
    await closeTheWindow()

    expect(screen.getByRole('status').textContent ?? '').toMatch(/moved to register\.?$/i)
  })

  it('does not claim the move in the past tense while the write is still held', () => {
    draw()

    markReviewed()

    // "Moved to register — Undo" is the pending copy: it says what will happen
    // and offers to stop it. The settled copy is the same sentence with the
    // offer removed, so the tense alone cannot distinguish them — the presence
    // of the undo is what does.
    expect(screen.getByRole('status').textContent ?? '').toMatch(/undo/i)
  })
})

describe('UX-DR20: the outcome is announced, not merely drawn', () => {
  it('puts the outcome in a live region', () => {
    draw()

    markReviewed()

    expect(screen.queryByRole('status')).not.toBeNull()
  })

  it('says nothing in the live region before anything has been done', () => {
    draw()

    expect(screen.queryByRole('status')?.textContent ?? '').toBe('')
  })
})

describe('the window is a delay, not a spectacle', () => {
  it('runs no animation or transition, so there is nothing for reduced motion to switch off', () => {
    const { container } = draw()

    markReviewed()

    // Asserted as the absence of the mechanism rather than as a media query
    // around it. A rule enforced by there being no animation cannot rot; a rule
    // enforced by a branch is one a later layout change quietly drops.
    for (const element of container.querySelectorAll<HTMLElement>('*')) {
      expect(element.style.animation).toBe('')
      expect(element.style.animationName).toBe('')
      expect(element.style.transition).toBe('')
    }
  })
})

describe('the surface never claims more than the register agreed to', () => {
  it('does not say the finding was moved when the write was refused', async () => {
    const { mark } = draw(vi.fn(async () => ({ outcome: 'failed' }) as ReviewOutcome))

    markReviewed()
    await closeTheWindow()

    expect(mark).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent ?? '').not.toMatch(/moved to register/i)
  })

  it('does not say the finding was moved when the write rejected', async () => {
    const { mark } = draw(
      vi.fn(async () => {
        throw new Error('the register is unreachable')
      }),
    )

    markReviewed()
    await closeTheWindow()

    expect(mark).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent ?? '').not.toMatch(/moved to register/i)
  })

  it('survives an action that throws before it returns a promise', async () => {
    const { mark } = draw(
      vi.fn(() => {
        throw new Error('thrown, not rejected')
      }) as unknown as (findingId: string) => Promise<ReviewOutcome>,
    )

    markReviewed()
    await closeTheWindow()

    expect(mark).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent ?? '').not.toMatch(/moved to register/i)
  })

  it('lets the reader try again when the register was merely unreachable', async () => {
    // `failed` is the one outcome worth a second attempt — the register was
    // unreachable, not the review refused. `already-reviewed` and `not-found`
    // are answers, and task 4 gives each of them its own sentence.
    draw(vi.fn(async () => ({ outcome: 'failed' }) as ReviewOutcome))

    markReviewed()
    await closeTheWindow()

    expect(screen.queryByRole('button', { name: /mark reviewed/i })).not.toBeNull()
  })
})
