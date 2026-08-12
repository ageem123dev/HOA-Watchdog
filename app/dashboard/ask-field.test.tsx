// @vitest-environment jsdom

/**
 * The ask field — the way into the Oracle, and the most-read copy in the product.
 *
 * UX-DR7: "Persistent ask field on the dashboard — submitting navigates to the
 * Oracle with the question already sent, no intermediate empty state. Must not
 * overlay focusable content; reserves scroll padding if sticky."
 *
 * Two clauses are easy to satisfy on paper and miss in fact, so they are the
 * ones asserted hardest here: **where submitting goes** (AC2), and **what the
 * placeholder promises** (AC4). AD-5 fixes the catalog, so a question outside it
 * fails by construction rather than by accident — which makes the placeholder
 * the difference between a product that says what it does and one that
 * manufactures its own most common failure.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ALL_ENTRIES } from '@/catalog/registry'
import { AskField, ASK_PLACEHOLDER, NON_BLANK_PATTERN } from './ask-field'

afterEach(cleanup)

describe('AC2: submitting arrives at the Oracle with the question already sent', () => {
  it('is a GET form aimed at the Oracle', () => {
    // The whole mechanism, and the reason there is no client component here: the
    // browser navigates, the question is in the URL, and the Oracle renders with
    // it already asked. There is no second request that *could* produce the
    // intermediate empty state UX-DR7 forbids.
    render(<AskField />)
    const form = screen.getByRole('search') as HTMLFormElement

    expect(form.getAttribute('action')).toBe('/oracle')
    expect(form.getAttribute('method')).toBe('get')
  })

  it('names the field `q`, which is what the Oracle reads', () => {
    // Any other name renders the Oracle's empty state, which to a board member
    // looks exactly like the app losing their question.
    render(<AskField />)

    expect(screen.getByRole('searchbox').getAttribute('name')).toBe('q')
  })

  it('has a submit control, so the form is submittable without JavaScript', () => {
    render(<AskField />)
    const submit = screen.getByRole('button', { name: /ask/i })

    expect(submit.getAttribute('type')).toBe('submit')
  })
})

describe('AC5: an empty question does nothing', () => {
  // Asserted through the browser's own constraint validation rather than by
  // simulating a submit, because that is the mechanism: `required` and
  // `pattern` hold with JavaScript disabled, and jsdom implements both.
  // Renders once and reuses the field, so a test may check several values.
  // Rendering per call put two searchboxes in the document and `getByRole`
  // threw — which is a better failure than the alternative, where the second
  // render is silently ignored and the assertion passes against the first.
  function validityOf(...values: string[]): boolean[] {
    render(<AskField />)
    const input = screen.getByRole('searchbox') as HTMLInputElement

    return values.map((value) => {
      input.value = value

      return input.checkValidity()
    })
  }

  it('refuses an empty question', () => {
    expect(validityOf('')).toEqual([false])
  })

  it('refuses a question that is only spaces', () => {
    // `required` alone accepts this, and it would navigate to `/oracle?q=%20`,
    // where the Oracle trims it back to empty and renders its empty state — a
    // submission that appears to have worked and did nothing.
    expect(validityOf('   ')).toEqual([false])
  })

  it('accepts a real question', () => {
    // The positive control, in the same breath. Story 3.5's lesson: an assertion
    // that something is refused cannot tell "correctly refused" from "refuses
    // everything", and a field that rejected all input would pass both tests
    // above.
    expect(validityOf('What does 4B owe for 2026?')).toEqual([true])
  })

  it('refuses a pasted tab or non-breaking space', () => {
    // Neither can be typed into a single-line input, but both arrive by paste —
    // an NBSP every time somebody copies from a document or a web page.
    //
    // The first version of this field used `.*[^ ].*` to avoid writing a
    // backslash, and that excludes only U+0020: both of these passed validation
    // and navigated to an Oracle that trimmed the question back to empty and
    // rendered its empty state. A submission that appears to have worked and did
    // nothing is the exact thing AC5 forbids. Raised by Argus, which also
    // predicted a server crash — that part was wrong, `questionFrom` trims them
    // and the page returns its empty state before `askOracle` is reached.
    expect(validityOf('\t', '\u00a0')).toEqual([false, false])
  })

  it('renders the pattern to the DOM uncorrupted', () => {
    // The reason a backslash felt worth dodging: `\S` has twice arrived on this
    // project with the backslash eaten, and a corrupted pattern still compiles
    // and silently matches nothing — invisible in a diff and in a green suite.
    //
    // The answer is to read the attribute back rather than to weaken the
    // pattern. Compared against a literal, not against the exported constant:
    // comparing the constant to itself would move both sides together and pass
    // while every question in the product was validated by `.*S.*`.
    render(<AskField />)

    expect(screen.getByRole('searchbox').getAttribute('pattern')).toBe('.*\\S.*')
    expect(NON_BLANK_PATTERN).toBe('.*\\S.*')
  })
})

describe('AC4: the placeholder promises only what the catalog serves', () => {
  it('was written for exactly the catalog that exists', () => {
    // The pin AC4 asks for. The copy names what `dues_status@1` can answer and
    // nothing else; the UX spec's own example of the failure it prevents lists
    // four capabilities, and this catalog holds one. When an entry is added or
    // removed this fails, and whoever changed the catalog revisits the copy
    // rather than shipping a placeholder that has quietly outgrown it.
    expect(ALL_ENTRIES.map((entry) => entry.id)).toEqual(['dues_status'])
  })

  it('offers a question the catalog can actually answer', () => {
    // One unit, one year — the two things `dues_status@1` is scoped to.
    render(<AskField />)

    expect(screen.getByRole('searchbox').getAttribute('placeholder')).toBe(ASK_PLACEHOLDER)
    expect(ASK_PLACEHOLDER).toMatch(/\bowe/i)
    expect(ASK_PLACEHOLDER).toMatch(/\d{4}/)
  })

  it('promises nothing the catalog cannot serve', () => {
    // The specific over-promises the UX spec warns about. Three of these four
    // are the spec's own example copy, and every one of them would be a lie the
    // first time somebody tried it.
    for (const absent of [/payment history/i, /vendor/i, /invoice/i, /anything/i]) {
      expect(ASK_PLACEHOLDER).not.toMatch(absent)
    }
  })
})

describe('AC6 and AC3: keyboard, focus and layout', () => {
  it('gives the input a real label, not just a placeholder', () => {
    // A placeholder vanishes the moment somebody types, and a screen reader is
    // then reading an unnamed field. `getByLabelText` fails unless the
    // association actually resolves.
    render(<AskField />)

    expect(screen.getByLabelText(/ask/i)).toBe(screen.getByRole('searchbox'))
  })

  it('is submittable by keyboard alone, by being a real form', () => {
    // AC6. Asserted as *what these elements are* rather than by firing a keypress
    // — jsdom does not perform implicit form submission, so a `keyDown` test
    // would prove nothing and would pass equally against a div with an onClick,
    // which is the thing this forbids. Story 3.6b learned this on the query
    // disclosure.
    //
    // The association is the mechanism: an input inside its form submits on
    // Enter, and a submit button activates on Enter and Space. An input placed
    // outside the form (or pointed at it by `form=` incorrectly) looks identical
    // on screen and is unreachable by keyboard submission.
    render(<AskField />)
    const form = screen.getByRole('search')
    const input = screen.getByRole('searchbox') as HTMLInputElement
    const submit = screen.getByRole('button', { name: /ask/i }) as HTMLButtonElement

    expect(input.form).toBe(form)
    expect(submit.form).toBe(form)
  })

  it('does not override the focus ring the base stylesheet provides', () => {
    // UX-DR9: never removed, never colour-only. `:focus-visible` is global in
    // `BASE_CSS`, so the only way this surface breaks it is locally.
    render(<AskField />)

    expect((screen.getByRole('searchbox') as HTMLElement).style.outline).toBe('')
    expect((screen.getByRole('button', { name: /ask/i }) as HTMLElement).style.outline).toBe('')
  })

  it('meets the 24x24 minimum on both dimensions', () => {
    // Both. Story 3.6b shipped with only the height pinned and needed a review
    // round to catch it.
    render(<AskField />)

    for (const control of [screen.getByRole('searchbox'), screen.getByRole('button', { name: /ask/i })]) {
      const style = (control as HTMLElement).style
      expect(Number.parseInt(style.minHeight, 10)).toBeGreaterThanOrEqual(24)
      expect(Number.parseInt(style.minWidth, 10)).toBeGreaterThanOrEqual(24)
    }
  })

  it('does not position itself over the page', () => {
    // AC3 and WCAG 2.4.11. This story ships the field in flow rather than
    // sticky: a sticky element that covers a link is a link nobody can click,
    // and it is invisible in a screenshot taken at the top of the page. If it
    // ever becomes sticky, this test fails and whoever made it sticky owes the
    // scroll padding the criterion requires.
    render(<AskField />)
    const form = screen.getByRole('search') as HTMLElement

    expect(['', 'static']).toContain(form.style.position)
  })
})
