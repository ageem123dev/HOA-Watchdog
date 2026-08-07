import { describe, expect, it } from 'vitest'

import { resolutionMessage } from './resolution-message'

describe('what the queue says after a resolution', () => {
  it('says a new vendor was recorded', () => {
    expect(resolutionMessage('created')).toMatch(/new vendor/i)
  })

  it('says a match was recorded', () => {
    expect(resolutionMessage('matched')).toMatch(/matched/i)
  })

  it('distinguishes somebody else having answered from a failure', () => {
    // AC5. "Already resolved" must not read as an error, and must not read as
    // "you did that" either.
    const message = resolutionMessage('already-resolved')

    expect(message).toMatch(/already answered/i)
    expect(message).not.toMatch(/error|failed|could not/i)
  })

  it('says a refusal could not be recorded', () => {
    expect(resolutionMessage('refused')).toMatch(/could not be recorded/i)
  })

  it('says nothing when there is no outcome', () => {
    expect(resolutionMessage(undefined)).toBeNull()
  })

  it('says nothing for a value somebody typed into the URL', () => {
    // The parameter comes from a query string. Echoing an unrecognised value
    // would put arbitrary text on the page above the association's records.
    expect(resolutionMessage('<script>alert(1)</script>')).toBeNull()
    expect(resolutionMessage('deleted-everything')).toBeNull()
  })
})
