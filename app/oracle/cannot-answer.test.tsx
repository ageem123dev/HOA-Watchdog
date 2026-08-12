// @vitest-environment jsdom

/**
 * Three failure states, asserted as three.
 *
 * AC6 exists because the obvious test — "some failure text appeared" — passes
 * against a surface that renders the same apology for all three, which is
 * precisely the defect this story was written to fix. So every state asserts its
 * own copy **and** the absence of the other two.
 *
 * The distinction is not decorative. A treasurer told "no data" goes looking for
 * a bookkeeping problem that does not exist. A treasurer told "we're down" waits
 * for a recovery that is not coming. Only one of those sentences is ever true.
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { suggestedQuestion } from '@/catalog/suggested-question'
import { AnswerRefused, NoCatalogMatch, ServiceUnavailable } from './cannot-answer'

const QUESTION = 'How much did we spend on landscaping last spring?'

afterEach(cleanup)

/** Copy fragments unique to each state, used to prove the others are absent. */
const RECORDS_ARE_FINE = /nothing is missing from them/i
const VALIDATOR_REFUSED = /back with the records/i
const SYSTEM_FAILED = /couldn.{0,3}t reach the records/i

describe('AC1: no catalog match blames the question, never the records', () => {
  it('says it cannot look that up, and that nothing is missing', () => {
    // The distinction is the entire criterion. "I have no data on that" and "I
    // cannot be asked that" send a reader to completely different places, and
    // only the second one is true.
    render(<NoCatalogMatch question={QUESTION} />)

    expect(screen.getByText(RECORDS_ARE_FINE)).toBeTruthy()
  })

  it('is not the other two states', () => {
    render(<NoCatalogMatch question={QUESTION} />)

    expect(screen.queryByText(VALIDATOR_REFUSED)).toBeNull()
    expect(screen.queryByText(SYSTEM_FAILED)).toBeNull()
  })

  it('keeps the question on screen', () => {
    render(<NoCatalogMatch question={QUESTION} />)

    expect(screen.getByRole('heading', { name: QUESTION })).toBeTruthy()
  })
})

describe('AC2: the offer is a single action, and it comes from the catalog', () => {
  it('offers a question the catalog can answer, as one link', () => {
    const suggestion = suggestedQuestion()!

    render(<NoCatalogMatch question={QUESTION} />)
    const offer = screen.getByRole('link', { name: suggestion.text })

    // The link *asks* it — a URL, because story 3.6c made the question a search
    // parameter. A sentence telling somebody what to type is not an action.
    expect(offer.getAttribute('href')).toBe(`/oracle?q=${encodeURIComponent(suggestion.text)}`)
  })

  it('offers the catalog question rather than echoing the unanswerable one', () => {
    // The failure this guards: an offer built from the question that just
    // failed, which sends the reader straight back into the same wall.
    render(<NoCatalogMatch question={QUESTION} />)

    expect(screen.queryByRole('link', { name: QUESTION })).toBeNull()
  })

  it('does not promise what the catalog cannot serve', () => {
    // The UX spec's own example names four capabilities; this catalog holds one.
    // Copy written from that example is wrong three times out of four and looks
    // entirely reasonable in review.
    const { container } = render(<NoCatalogMatch question={QUESTION} />)

    for (const absent of [/payment history/i, /vendor total/i, /invoice comparison/i]) {
      expect(container.textContent).not.toMatch(absent)
    }
  })
})

describe('AC4: a refused answer is the system working, and says so', () => {
  it('explains that the check did its job', () => {
    // AD-7 as amended. This is the guarantee the product rests on, visible for
    // once — not an outage, and not "there is no answer".
    render(<AnswerRefused question={QUESTION} />)

    expect(screen.getByText(VALIDATOR_REFUSED)).toBeTruthy()
  })

  it('is not the other two states', () => {
    render(<AnswerRefused question={QUESTION} />)

    expect(screen.queryByText(RECORDS_ARE_FINE)).toBeNull()
    expect(screen.queryByText(SYSTEM_FAILED)).toBeNull()
  })

  it('lets the reader ask again, which is the retry AD-7 now specifies', () => {
    // The retry is the reader's because an automatic one would re-run the
    // catalog entry and write a second query_log row for one question — the
    // reason AD-7 was amended on 2026-08-12.
    render(<AnswerRefused question={QUESTION} />)

    expect(screen.getByRole('link', { name: /ask again/i }).getAttribute('href')).toBe(
      `/oracle?q=${encodeURIComponent(QUESTION)}`,
    )
  })
})

describe('AC3: service unavailable is its own surface, with the question and a retry', () => {
  it('says the fault is on the system side', () => {
    render(<ServiceUnavailable question={QUESTION} />)

    expect(screen.getByText(SYSTEM_FAILED)).toBeTruthy()
  })

  it('is not the other two states', () => {
    render(<ServiceUnavailable question={QUESTION} />)

    expect(screen.queryByText(RECORDS_ARE_FINE)).toBeNull()
    expect(screen.queryByText(VALIDATOR_REFUSED)).toBeNull()
  })

  it('retries this question, not a blank one', () => {
    // UX-DR18: "question retained on screen, retry offered". A retry that lands
    // on an empty Oracle makes the reader type it again, which is the second
    // submit UX-DR7 spent a whole story removing.
    render(<ServiceUnavailable question={QUESTION} />)

    expect(screen.getByRole('link', { name: /try again/i }).getAttribute('href')).toBe(
      `/oracle?q=${encodeURIComponent(QUESTION)}`,
    )
  })

  it('encodes a question carrying characters that would truncate a URL', () => {
    // `&` ends a query parameter and `#` starts a fragment. Un-encoded, the
    // retry silently asks a shorter question than the one that failed.
    const awkward = 'What did A&B Landscaping charge? #3'

    render(<ServiceUnavailable question={awkward} />)
    const href = screen.getByRole('link', { name: /try again/i }).getAttribute('href')!

    expect(new URL(href, 'https://example.test').searchParams.get('q')).toBe(awkward)
  })
})

describe('AC5: no partial answer, in any state', () => {
  it.each([
    ['no catalog match', <NoCatalogMatch key="n" question={QUESTION} />],
    ['refused', <AnswerRefused key="r" question={QUESTION} />],
    ['unavailable', <ServiceUnavailable key="u" question={QUESTION} />],
  ])('%s renders no evidence table', (_label, element) => {
    // "Never present a partial answer." A half-filled table reads as an answer
    // that is still loading, which is the state story 1.5d shipped and which
    // never resolves.
    render(element)

    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('AC7: the actions are real controls', () => {
  it.each([
    ['refused', <AnswerRefused key="r" question={QUESTION} />, /ask again/i],
    ['unavailable', <ServiceUnavailable key="u" question={QUESTION} />, /try again/i],
  ])('%s offers a keyboard-reachable link at a usable size', (_label, element, name) => {
    // Asserted as *what the element is*, per story 3.6b: jsdom does not
    // translate Enter into activation, so a keypress test would pass equally
    // against a div with an onClick — the thing this forbids. An anchor with an
    // href is focusable and activatable for free.
    render(element)
    const action = screen.getByRole('link', { name }) as HTMLElement

    expect(action.tagName).toBe('A')
    expect(action.getAttribute('href')).toBeTruthy()
    expect(Number.parseInt(action.style.minHeight, 10)).toBeGreaterThanOrEqual(24)
    expect(Number.parseInt(action.style.minWidth, 10)).toBeGreaterThanOrEqual(24)
    // The ring is global in BASE_CSS; the only way to break it is locally.
    expect(action.style.outline).toBe('')
  })
})
