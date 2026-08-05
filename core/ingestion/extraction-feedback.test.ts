/**
 * The words the treasurer reads while a document is being extracted.
 *
 * Two rules drive almost every test here. **UX-DR12, verbatim: partial
 * extraction is never displayed under any state** — so nothing may carry a
 * figure, a vendor name or a running count. And an outage is not the document's
 * fault, so its copy must ask the treasurer for nothing.
 */

import { describe, expect, it } from 'vitest'

import { EXTRACTION_OUTCOMES, type ExtractionOutcome } from './extract-document'
import { extractionFeedback } from './extraction-feedback'

const DOCUMENT_ID = '018f3a2b-0000-7000-8000-0000000000aa'

const outcomeOf = (kind: (typeof EXTRACTION_OUTCOMES)[number]): ExtractionOutcome =>
  kind === 'read'
    ? { outcome: 'read', documentId: DOCUMENT_ID, records: 3 }
    : ({ outcome: kind, documentId: DOCUMENT_ID } as ExtractionOutcome)

describe('extractionFeedback', () => {
  it('has an outcome vocabulary to test against', () => {
    // Without this the `it.each` below would generate zero tests and report
    // success — the empty-table failure this project has already shipped once.
    expect(EXTRACTION_OUTCOMES.length).toBe(6)
  })

  describe('every outcome is answerable', () => {
    it.each([...EXTRACTION_OUTCOMES])('answers for %s', (kind) => {
      const feedback = extractionFeedback(outcomeOf(kind))

      expect(feedback.status.trim()).not.toBe('')
    })

    it('throws for an outcome nothing handles, rather than rendering a blank', () => {
      expect(() =>
        extractionFeedback({ outcome: 'invented' } as unknown as ExtractionOutcome),
      ).toThrow(TypeError)
    })
  })

  describe('partial extraction is never displayed (UX-DR12)', () => {
    it.each([...EXTRACTION_OUTCOMES])('shows no figure or count for %s', (kind) => {
      // A record count reads as a result the treasurer can check, and there is
      // nowhere to check it. More importantly, a *running* count would be a
      // half-read set displayed — exactly what the validator refuses to produce.
      const feedback = extractionFeedback(outcomeOf(kind))
      const rendered = `${feedback.status} ${feedback.message ?? ''}`

      expect(rendered).not.toMatch(/\d/)
    })

    it('says nothing about how many records were read, even on success', () => {
      const feedback = extractionFeedback({
        outcome: 'read',
        documentId: DOCUMENT_ID,
        records: 42,
      })

      expect(`${feedback.status} ${feedback.message ?? ''}`).not.toContain('42')
    })
  })

  describe('the staged name while it runs', () => {
    it('is not settled while in progress, so the surface keeps watching', () => {
      expect(extractionFeedback(outcomeOf('in-progress')).settled).toBe(false)
    })

    it.each(['read', 'unreadable', 'provider-unavailable', 'not-found', 'no-provider-path'] as const)(
      'is settled for %s',
      (kind) => {
        expect(extractionFeedback(outcomeOf(kind)).settled).toBe(true)
      },
    )

    it('names the stage rather than describing a mechanism', () => {
      // "Reading", not "polling" or "calling the extraction provider". The
      // treasurer is told what is happening to their document, not what the
      // system is doing about it.
      const feedback = extractionFeedback(outcomeOf('in-progress'))

      expect(feedback.status).toBe('Reading')
      expect(`${feedback.status} ${feedback.message}`).not.toMatch(
        /provider|poll|queue|request|api|token/i,
      )
    })
  })

  describe('an outage asks the treasurer for nothing', () => {
    const outage = () => extractionFeedback(outcomeOf('provider-unavailable'))

    it('is marked retryable', () => {
      expect(outage().retryable).toBe(true)
    })

    it('does not blame the document', () => {
      // The mistake 1.5b shipped and had to undo: copy that sends a treasurer to
      // fix a document that was never the problem.
      expect(outage().message).not.toMatch(/clearer scan|could not be read reliably|spreadsheet/i)
    })

    it('asks for no action', () => {
      expect(outage().message).not.toMatch(/try again|upload|retry|refresh|check/i)
    })

    it('reads differently from the unreadable case', () => {
      // Both are "no figures yet". If they render the same, the distinction the
      // whole story is built around never reaches the person it is for.
      expect(outage().status).not.toBe(extractionFeedback(outcomeOf('unreadable')).status)
      expect(outage().message).not.toBe(extractionFeedback(outcomeOf('unreadable')).message)
    })
  })

  describe('the unreadable case', () => {
    it('is not marked retryable, because retrying the same bytes cannot help', () => {
      expect(extractionFeedback(outcomeOf('unreadable')).retryable).toBe(false)
    })

    it('says what would help instead', () => {
      expect(extractionFeedback(outcomeOf('unreadable')).message).toMatch(/clearer scan|spreadsheet/i)
    })
  })

  describe('a document already read by the deterministic path', () => {
    it('reads as done rather than as an error', () => {
      // A CSV is parsed at upload. Asking to extract it is a caller mistake, and
      // the treasurer should never see a consequence of one.
      const feedback = extractionFeedback(outcomeOf('no-provider-path'))

      expect(feedback.status).toBe(extractionFeedback(outcomeOf('read')).status)
      expect(feedback.settled).toBe(true)
    })
  })
})
