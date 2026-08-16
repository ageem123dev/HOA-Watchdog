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

import { ExportControl } from './export-control'

afterEach(cleanup)

afterEach(() => {
  vi.clearAllMocks()
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

    expect(fetching).toHaveBeenCalledWith('/findings/register/export')
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
    expect(fetching).toHaveBeenCalledWith('/findings/register/export?search=Coastal')
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
