/**
 * What a treasurer reads after an upload.
 *
 * The copy lives in `core/` for the same reason sign-in's does: a React
 * component is an awkward place to assert that a sentence still matches the PRD,
 * and a function is not.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  ACCEPTED_FORMAT_LABELS,
  MAX_DOCUMENT_BYTES,
  REJECTION_REASONS,
  type RejectionReason,
} from './acceptance'
import { UNREADABLE_MESSAGE } from '../extraction/validate'
import type { IngestOutcome } from './ingest'
import { uploadFeedback } from './upload-feedback'

const rejected = (reason: RejectionReason): IngestOutcome => ({
  filename: 'statement.pdf',
  outcome: 'rejected',
  reason,
})

const ALL_OUTCOMES: IngestOutcome[] = [
  { filename: 'a.pdf', outcome: 'read', documentId: 'doc-1' },
  { filename: 'a.pdf', outcome: 'stored-not-read', documentId: 'doc-1' },
  { filename: 'a.pdf', outcome: 'unreadable', documentId: 'doc-1' },
  { filename: 'a.pdf', outcome: 'already-held', documentId: 'doc-1' },
  { filename: 'a.pdf', outcome: 'failed' },
  ...REJECTION_REASONS.map((reason) => rejected(reason)),
]

describe('uploadFeedback', () => {
  describe('the figures-not-stored case', () => {
    const stored = () =>
      uploadFeedback({ filename: 'ledger.csv', outcome: 'figures-not-stored', documentId: 'doc-1' })

    it('does not tell the treasurer the file was not saved', () => {
      // The exact wrong instruction: the bytes and the document row are durable
      // by the time this outcome is possible.
      expect(stored().message).not.toMatch(/not saved|could not be stored|upload(ing)? it again/i)
    })

    it('says the document is saved', () => {
      expect(stored().message).toMatch(/saved/i)
    })

    it('offers no replacement, because nothing is wrong with the file', () => {
      expect(stored().offerReplacement).toBe(false)
    })

    it('does not blame the file the way the unreadable copy does', () => {
      expect(stored().message).not.toMatch(/unreadable|clearer scan|could not be read/i)
    })
  })

  describe('the unreadable case (AC4)', () => {
    /**
     * The expected sentence is read out of the PRD rather than restated here.
     * A copy of the copy is exactly the thing that drifts, and "verbatim" is a
     * claim only a comparison against the source can make.
     */
    const prdSentence = (): string => {
      const prd = readFileSync(join(process.cwd(), 'docs', 'prd', 'prd.md'), 'utf8')
      const quoted = /displays:\s*\*"([^"]+)"\*/.exec(prd)

      expect(quoted, 'FR-1 no longer states its unreadable-file copy in the expected form').not.toBeNull()

      const sentence = quoted?.[1]
      expect(sentence, 'FR-1 states no sentence between the quotes').toBeDefined()

      return sentence!
    }

    it('uses the PRD sentence exactly', () => {
      expect(uploadFeedback(rejected('unreadable')).message).toBe(prdSentence())
    })

    it('is quoting a real sentence, not an empty match', () => {
      // Without this, a regex that matched an empty group would make the test
      // above compare '' to '' and pass.
      expect(prdSentence().length).toBeGreaterThan(40)
      expect(prdSentence()).toContain('password protected')
    })

    it('offers a path to replace the file', () => {
      expect(uploadFeedback(rejected('unreadable')).offerReplacement).toBe(true)
    })
  })

  describe('the rejection messages (AC3)', () => {
    it('states every accepted format when the type is wrong', () => {
      // Built from the same table the gate enforces, so the treasurer is never
      // told PNG is fine when it is not, nor left unaware of a format that is.
      const { message } = uploadFeedback(rejected('unsupported-type'))

      for (const label of Object.values(ACCEPTED_FORMAT_LABELS)) {
        expect(message).toContain(label)
      }
    })

    it('states the limit as a fact when the file is too large', () => {
      const megabytes = MAX_DOCUMENT_BYTES / (1024 * 1024)

      expect(uploadFeedback(rejected('too-large')).message).toContain(String(megabytes))
    })

    it('says plainly that an empty file is empty', () => {
      expect(uploadFeedback(rejected('empty')).message).toMatch(/empty/i)
    })

    it('offers a replacement path for every rejection', () => {
      for (const reason of REJECTION_REASONS) {
        expect(uploadFeedback(rejected(reason)).offerReplacement).toBe(true)
      }
    })
  })

  describe('a document already held (AC2)', () => {
    // Called inside each test, not at describe scope: a describe body runs at
    // collection time, so a throw there is a collection failure that reports
    // "no tests" rather than a red.
    const feedback = () =>
      uploadFeedback({ filename: 'a.pdf', outcome: 'already-held', documentId: 'doc-1' })

    it('is not phrased as a failure', () => {
      // AC2 is explicit: the treasurer is told it was already held, not that it
      // failed. Nothing went wrong here.
      const { status, message } = feedback()

      expect(`${status} ${message}`).not.toMatch(
        /fail|error|problem|could ?n[o']t|unable|invalid|reject/i,
      )
    })

    it('says the document is already on record', () => {
      expect(feedback().message).toMatch(/already/i)
    })

    it('does not ask for a replacement, since nothing needs replacing', () => {
      expect(feedback().offerReplacement).toBe(false)
    })
  })

  describe('a document that was read', () => {
    it('reports it plainly and asks for nothing further', () => {
      const feedback = uploadFeedback({
        filename: 'a.pdf',
        outcome: 'read',
        documentId: 'doc-1',
      })

      expect(feedback.status).toBeTruthy()
      expect(feedback.offerReplacement).toBe(false)
    })
  })

  describe('a file that could not be saved', () => {
    const feedback = () => uploadFeedback({ filename: 'a.pdf', outcome: 'failed' })

    it('does not blame the file, because the file was fine', () => {
      expect(feedback().message).not.toMatch(/reject|unsupported|invalid|too large|unreadable/i)
    })

    it('says to try again, since this one is retryable', () => {
      expect(feedback().message).toMatch(/again/i)
      expect(feedback().offerReplacement).toBe(true)
    })
  })

  describe('a document held but not yet read', () => {
    const feedback = () =>
      uploadFeedback({ filename: 'a.pdf', outcome: 'stored-not-read', documentId: 'doc-1' })

    it('says it is held, so nothing suggests the figures are in', () => {
      expect(feedback().message).toMatch(/held|kept|stored/i)
    })

    it('does not read as a failure, because nothing failed', () => {
      const { status, message } = feedback()

      expect(`${status} ${message}`).not.toMatch(/fail|error|problem|could ?n[o']t|invalid|reject/i)
    })

    it('asks for no replacement, since the file is fine and kept', () => {
      expect(feedback().offerReplacement).toBe(false)
    })
  })

  describe('a document that could not be read', () => {
    const feedback = () =>
      uploadFeedback({ filename: 'a.csv', outcome: 'unreadable', documentId: 'doc-1' })

    it('uses the sentence the extraction layer owns, not a second copy of it', () => {
      // Two copies of a user-facing sentence drift, and the version a treasurer
      // reads is the one that would be wrong.
      expect(feedback().message).toBe(UNREADABLE_MESSAGE)
    })

    it('is distinct from the copy for a file that would not open', () => {
      const openFailure = uploadFeedback({
        filename: 'a.pdf',
        outcome: 'rejected',
        reason: 'unreadable',
      })

      expect(feedback().message).not.toBe(openFailure.message)
    })

    it('offers a path to supply a better export', () => {
      expect(feedback().offerReplacement).toBe(true)
    })
  })

  describe('coverage of the whole outcome set', () => {
    it('has copy for every outcome the service can produce', () => {
      // A new reason added to the closed set without copy here is a blank row in
      // front of a volunteer, which is why this enumerates rather than samples.
      expect(ALL_OUTCOMES).toHaveLength(9)

      for (const outcome of ALL_OUTCOMES) {
        const feedback = uploadFeedback(outcome)

        expect(feedback.status, `no status for ${outcome.outcome}`).toBeTruthy()
        expect(typeof feedback.offerReplacement).toBe('boolean')
      }
    })

    it('gives every outcome except the plain success something to read', () => {
      for (const outcome of ALL_OUTCOMES.filter((o) => o.outcome !== 'read')) {
        expect(uploadFeedback(outcome).message, `no message for ${outcome.outcome}`).toBeTruthy()
      }
    })

    it('never apologises, per the voice in EXPERIENCE.md', () => {
      for (const outcome of ALL_OUTCOMES) {
        const feedback = uploadFeedback(outcome)

        expect(`${feedback.status} ${feedback.message ?? ''}`).not.toMatch(/sorry|apolog|oops/i)
      }
    })

    it('keeps every status short enough to sit in a row beside a filename', () => {
      for (const outcome of ALL_OUTCOMES) {
        expect(uploadFeedback(outcome).status.length).toBeLessThanOrEqual(24)
      }
    })
  })
})
