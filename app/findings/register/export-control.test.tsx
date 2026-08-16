// @vitest-environment jsdom

/**
 * The export control (AC4, AC8).
 *
 * ## Why this is a component with state, and not the link the access log uses
 *
 * `app/access-log/page.tsx` exports with a plain anchor, and that anchor cannot
 * have an in-progress state at all: the browser navigates and the page never
 * learns what happened. EXPERIENCE.md requires the register's export to show
 * *"named progress, count stated, control disabled during"* — so this one runs
 * the request itself.
 *
 * ## The fetch is a prop, for the reason story 4.6 made its write a prop
 *
 * "The control is disabled **during**" is the whole of AC8, and it can only be
 * asserted while the request is in flight. A component that reached for `fetch`
 * itself would leave the interesting half of its own acceptance criterion
 * unassertable.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ExportControl, REQUEST_TIMEOUT_MS } from './export-control'

afterEach(cleanup)

afterEach(() => {
  // `restoreAllMocks`, not `clearAllMocks`. These tests replace globals —
  // `fetch`, `URL.createObjectURL`, `URL.revokeObjectURL` — and clearing only
  // forgets the calls, leaving the replacement in place for whatever runs next.
  // Raised by CodeRabbit.
  vi.restoreAllMocks()
})

/** A fetch whose completion the test decides. */
function deferred() {
  let settle: (value: Blob) => void = () => {}
  let fail: (reason: Error) => void = () => {}
  const pending = new Promise<Blob>((resolve, reject) => {
    settle = resolve
    fail = reject
  })

  return { pending, settle: (blob = new Blob(['csv'])) => settle(blob), fail }
}

function draw(
  download: () => Promise<Blob> = vi.fn(async () => new Blob(['csv'])),
  total = 17,
) {
  const view = render(
    <ExportControl total={total} href="/findings/register/export" download={download} />,
  )

  return { ...view, download }
}

const control = () => screen.getByRole('button', { name: /export/i })

describe('AC4: it states what it will produce before producing it', () => {
  it('names the count and the format', () => {
    draw(undefined, 17)

    expect(control().textContent).toBe('Export 17 reviewed findings as CSV')
  })

  it('uses the singular for one finding', () => {
    draw(undefined, 1)

    expect(control().textContent).toBe('Export 1 reviewed finding as CSV')
  })

  it('is never a bare Export', () => {
    // UX-DR8 forbids it by name: a control that does not say what it produces
    // is one a board member has to press to find out.
    draw()

    expect(control().textContent).not.toBe('Export')
  })

  it('offers nothing to export when the register is empty', () => {
    // "Export 0 reviewed findings as CSV" is a control that produces an empty
    // file and calls it a board packet.
    draw(undefined, 0)

    expect(screen.queryByRole('button', { name: /export/i })).toBeNull()
  })

  it('meets the minimum target size UX-DR8 sets', () => {
    draw()

    const style = control().getAttribute('style') ?? ''

    expect(style).toMatch(/min-height/)
    expect(style).toMatch(/min-width/)
  })
})

describe('AC8: the in-progress state is named, counted, and disables the control', () => {
  it('names what it is doing, with the count, while it runs', async () => {
    const held = deferred()
    draw(vi.fn(() => held.pending))

    fireEvent.click(control())

    expect(screen.getByRole('status').textContent).toBe('Exporting 17 reviewed findings…')

    await act(async () => {
      held.settle()
    })
  })

  it('disables the control while the request is in flight', async () => {
    // **Asserted mid-request.** After it completes, a re-enabled control looks
    // identical to one that was never disabled.
    const held = deferred()
    draw(vi.fn(() => held.pending))

    fireEvent.click(control())

    expect((control() as HTMLButtonElement).disabled).toBe(true)

    await act(async () => {
      held.settle()
    })
  })

  it('cannot be made to start a second export', async () => {
    const held = deferred()
    const { download } = draw(vi.fn(() => held.pending))

    fireEvent.click(control())
    fireEvent.click(control())
    fireEvent.click(control())

    expect(download).toHaveBeenCalledTimes(1)

    await act(async () => {
      held.settle()
    })
  })

  it('cannot be made to start a second export before it has re-rendered', async () => {
    // **The case `disabled` cannot cover.** Between the click and the re-render
    // that disables the control, the attribute is still absent — so three
    // clicks dispatched inside one batch all reach the handler against a live
    // button. `fireEvent` flushes a render between calls and so never gets
    // there; batching them inside one `act` does.
    //
    // Written because the sensitivity check found the re-entrancy guard had no
    // test behind it, and a guard with no test is a guess.
    const held = deferred()
    const { download } = draw(vi.fn(() => held.pending))
    const button = control()

    await act(async () => {
      button.click()
      button.click()
      button.click()
    })

    expect(download).toHaveBeenCalledTimes(1)

    await act(async () => {
      held.settle()
    })
  })

  it('re-enables once the file has been produced', async () => {
    const held = deferred()
    draw(vi.fn(() => held.pending))

    fireEvent.click(control())
    await act(async () => {
      held.settle()
    })

    expect((control() as HTMLButtonElement).disabled).toBe(false)
  })

  it('says nothing before anything has been asked for', () => {
    draw()

    expect(screen.queryByRole('status')?.textContent ?? '').toBe('')
  })
})

describe('a failed export says so, rather than looking like a finished one', () => {
  it('reports the failure', async () => {
    const held = deferred()
    draw(vi.fn(() => held.pending))

    fireEvent.click(control())
    await act(async () => {
      held.fail(new Error('the register could not be reached'))
    })

    expect(screen.getByRole('status').textContent).toMatch(/could not/i)
  })

  it('does not claim a file was produced', async () => {
    const held = deferred()
    draw(vi.fn(() => held.pending))

    fireEvent.click(control())
    await act(async () => {
      held.fail(new Error('nope'))
    })

    expect(screen.getByRole('status').textContent).not.toMatch(/exported|downloaded/i)
  })

  it('lets the reader try again, because the register may simply have been busy', async () => {
    const held = deferred()
    draw(vi.fn(() => held.pending))

    fireEvent.click(control())
    await act(async () => {
      held.fail(new Error('nope'))
    })

    expect((control() as HTMLButtonElement).disabled).toBe(false)
  })

  it('treats a non-OK response as a failure, not as a file', async () => {
    // **Without this the error page is downloaded as the board packet.** A
    // 500's HTML body is a perfectly good blob, and a file named
    // reviewed-findings.csv containing an error page is worse than no download
    // at all, because it looks like one that worked.
    //
    // Exercises the *default* request — the one production uses — rather than
    // the injected one every test above hands in.
    const fetching = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('<html>error</html>', { status: 500 }))

    render(<ExportControl total={3} href="/findings/register/export" />)

    fireEvent.click(control())
    await act(async () => {})

    expect(fetching).toHaveBeenCalledWith(
      '/findings/register/export',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(screen.getByRole('status').textContent).toMatch(/could not/i)
  })

  it('asks the route the page pointed it at', async () => {
    const fetching = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('a,b', { status: 200 }))

    render(<ExportControl total={3} href="/findings/register/export?search=Coastal" />)

    fireEvent.click(control())
    await act(async () => {})

    // The search rides along, so what downloads is what was on screen.
    expect(fetching).toHaveBeenCalledWith(
      '/findings/register/export?search=Coastal',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('gives up on a route that never answers, rather than waiting forever', async () => {
    // **Waiting is the one state this control cannot leave on its own.** Every
    // other failure reaches the catch and says so; a request that never
    // settles leaves the button disabled and the status reading "Exporting…"
    // for as long as the page is open — no file, no failure, and no way to try
    // again. Raised by CodeRabbit.
    //
    // Asserted through the *default* request, because the deadline lives in
    // `fetchCsv` and an injected download would prove nothing about it.
    vi.useFakeTimers()

    try {
      // Never settles on its own — only the signal can end it.
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject((init.signal as AbortSignal).reason as Error)
            })
          }),
      )

      render(<ExportControl total={3} href="/findings/register/export" />)

      fireEvent.click(control())
      await act(async () => {})

      // Still waiting, and correctly so — the deadline has not passed.
      expect(screen.getByRole('status').textContent).toMatch(/exporting/i)
      expect((control() as HTMLButtonElement).disabled).toBe(true)

      // Just short of the deadline it is still correctly waiting, so this
      // cannot pass by the control having failed for some other reason before
      // the timer ever fired.
      await act(async () => {
        vi.advanceTimersByTime(REQUEST_TIMEOUT_MS - 1)
      })

      expect(screen.getByRole('status').textContent).toMatch(/exporting/i)

      await act(async () => {
        vi.advanceTimersByTime(1)
      })

      expect(screen.getByRole('status').textContent).toMatch(/could not/i)
      expect((control() as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not revoke the file before the browser has taken it', async () => {
    // **Revoking synchronously after `click()` aborts the download** in
    // browsers that process the click asynchronously — Firefox and Safari — and
    // the failure is silent: the control reports success and no file arrives,
    // or an empty one does. Raised by Argus.
    //
    // Asserted as *not yet revoked* at the moment the click returns, then
    // revoked once the timers run, because "it revokes eventually" holds for
    // the broken version too.
    vi.useFakeTimers()

    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:register')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    try {
      draw(vi.fn(async () => new Blob(['csv'])))

      fireEvent.click(control())
      await act(async () => {})

      expect(created).toHaveBeenCalled()
      expect(revoked).not.toHaveBeenCalled()

      await act(async () => {
        vi.runAllTimers()
      })

      expect(revoked).toHaveBeenCalledWith('blob:register')
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops the deadline as soon as the file arrives', async () => {
    // The docblock claims the timer is cleared rather than left to run the
    // full deadline out, and a claim in a comment that no test can falsify is
    // how this project has shipped guards that do nothing. A board member
    // exporting through an afternoon would otherwise leave a live timer per
    // export, each holding an abort for a request that finished long ago.
    //
    // **Matched by id, not by counting outstanding timers.** A count is the
    // obvious assertion and the wrong one: jsdom schedules a timer of its own
    // when the download anchor is clicked, so any total would encode that
    // accident alongside the deadline this is actually about.
    vi.useFakeTimers()

    const scheduled = new Map<number, number>()
    const realSetTimeout = globalThis.setTimeout
    const cleared: unknown[] = []

    vi.stubGlobal('setTimeout', ((handler: never, delay: number, ...rest: never[]) => {
      const id = (realSetTimeout as never as (...args: never[]) => number)(
        handler,
        delay as never,
        ...rest,
      )
      scheduled.set(id, delay)
      return id
    }) as never)
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation((id) => {
      cleared.push(id)
    })

    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:register')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('a,b', { status: 200 }))

    try {
      render(<ExportControl total={3} href="/findings/register/export" />)

      fireEvent.click(control())
      await act(async () => {})

      const deadlines = [...scheduled].filter(([, delay]) => delay === REQUEST_TIMEOUT_MS)

      // The premise, so this cannot pass by the deadline never being set.
      expect(deadlines, 'no export deadline was scheduled at all').toHaveLength(1)
      expect(cleared, 'the export deadline is still pending').toContain(deadlines[0]?.[0])
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })

  it('clicks an anchor that is in the document, and leaves none behind', async () => {
    // Firefox has historically ignored a programmatic click on a *detached*
    // anchor, and it fails the way this whole control is written against:
    // silently, with the board member told the export ran.
    //
    // Asserted at the moment of the click rather than after it, for the reason
    // the revocation test above is: "the anchor was appended at some point"
    // holds for the broken version too, because the removal makes the end
    // state identical either way. Raised by CodeRabbit.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:register')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    let attachedWhenClicked: boolean | undefined

    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      attachedWhenClicked = this.isConnected
    })

    draw(vi.fn(async () => new Blob(['csv'])))

    fireEvent.click(control())
    await act(async () => {})

    expect(attachedWhenClicked, 'the anchor was clicked while detached').toBe(true)
    expect(
      document.querySelectorAll('a[download]'),
      'a download anchor was left in the page',
    ).toHaveLength(0)
  })

  it('survives a download that throws before it returns a promise', async () => {
    draw(
      vi.fn(() => {
        throw new Error('thrown, not rejected')
      }) as unknown as () => Promise<Blob>,
    )

    fireEvent.click(control())
    await act(async () => {})

    expect(screen.getByRole('status').textContent).toMatch(/could not/i)
    expect((control() as HTMLButtonElement).disabled).toBe(false)
  })
})
