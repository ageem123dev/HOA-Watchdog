/**
 * The unit reference, as the provider is asked for it.
 *
 * A scanned deposit slip goes through the model rather than the tabular reader,
 * and a field absent from the response schema is a field the provider will
 * never return — structured output answers the schema it was given, not the
 * one the record type wishes it had.
 *
 * Read out of the module source rather than out of a live call: the schema is
 * built by a private function, and the alternative is a network round trip in
 * a unit test. The bound and the nullability are asserted against the same
 * constants the record declares, so a change to either has to change both.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { UNIT_REFERENCE_MAX_LENGTH } from '../../core/extraction/record'
import { createGeminiExtractor } from './extractor-gemini'

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'extractor-gemini.ts'),
  'utf8',
)

/** The `unitReference` property declaration, whitespace collapsed. */
const declaration = (): string => {
  const start = source.indexOf('unitReference:')
  if (start === -1) return ''

  // To the end of the property's own object literal, which is where its `}`
  // closes -- not the first `}` in the file after it.
  let depth = 0
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1).replace(/\s+/g, ' ')
    }
  }
  return ''
}

describe('asking the provider for a unit reference', () => {
  it('declares the field at all', () => {
    // The gap story 2.4 left: the record carried the field, the validator
    // accepted it, and nothing ever asked a provider to fill it in.
    expect(declaration()).not.toBe('')
  })

  it('bounds it by the same constant the record does', () => {
    // Not a repeated literal. `64` written here by hand drifts the first time
    // the column widens, and the provider would return values the record then
    // refuses -- a whole document lost to a number in two places.
    expect(declaration()).toContain(`maxLength: UNIT_REFERENCE_MAX_LENGTH`)
    expect(UNIT_REFERENCE_MAX_LENGTH).toBe(64)
  })

  it('lets the provider say a line names no unit', () => {
    // Most documents have none. Without `nullable`, a schema-obeying provider
    // must invent a string for every invoice it reads.
    expect(declaration()).toContain('nullable: true')
  })

  it('does not make it a required property', () => {
    // `required` is exactly the two columns migration 006 declares `not null`.
    // Adding this one would refuse every non-deposit the provider reads.
    const required = /required: \[([^\]]*)\]/.exec(source.replace(/\s+/g, ' '))
    expect(required?.[1]).not.toContain('unitReference')
  })
})

describe('a deposit the provider read', () => {
  const ENV = Object.freeze({
    GEMINI_API_KEY: 'test-key-do-not-log-me',
    GEMINI_OCR_MODEL: 'gemini-3.1-flash-lite',
  })

  const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 deposit slip %%EOF')

  /** A provider reply carrying one deposit line that names a unit. */
  const reply = JSON.stringify({
    candidates: [
      {
        content: {
          parts: [
            {
              text: JSON.stringify({
                records: [
                  {
                    documentKind: 'deposit',
                    vendorName: null,
                    documentNumber: null,
                    issuedOn: '2026-03-01',
                    totalAmount: '250.00',
                    currency: 'USD',
                    unitReference: '4B',
                  },
                ],
              }),
            },
          ],
        },
      },
    ],
  })

  it('keeps the unit the provider named, rather than dropping it on the way in', async () => {
    // Declaring the field in the schema is only half of it. This is the half
    // that would still be missing if `validate` were handed a rebuilt object
    // listing the fields by hand -- exactly how story 2.4's repository came to
    // be selecting and inserting a column it never mapped.
    const extractor = createGeminiExtractor({
      env: ENV,
      fetch: vi.fn(async () => new Response(reply, { status: 200 })),
    })

    const result = await extractor.extract({ bytes: PDF_BYTES, mediaType: 'application/pdf' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.records[0]!.unitReference).toBe('4B')
  })

  it('ignores a unit the provider attached to something that is not a deposit', async () => {
    // Raised by review. `validate` refuses `unitReference` on any kind but
    // `deposit`, and this adapter turns *any* validation failure into `null` --
    // which the caller reports as `unreadable`. So a provider hallucinating a
    // unit on an invoice does not lose the field, it loses **the whole
    // document**, and the treasurer is told their scan is bad.
    //
    // The same shape as the three defects story 2.4 found: the schema refusing
    // something the pipeline can still produce. The tabular reader already
    // ignores the column on a non-deposit; this makes the two producers agree.
    const invoice = JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  records: [
                    {
                      documentKind: 'invoice',
                      vendorName: 'Acme Plumbing',
                      documentNumber: 'INV-1',
                      issuedOn: '2026-03-01',
                      totalAmount: '250.00',
                      currency: 'USD',
                      unitReference: '4B',
                    },
                  ],
                }),
              },
            ],
          },
        },
      ],
    })

    const extractor = createGeminiExtractor({
      env: ENV,
      fetch: vi.fn(async () => new Response(invoice, { status: 200 })),
    })

    const result = await extractor.extract({ bytes: PDF_BYTES, mediaType: 'application/pdf' })

    // Read, not refused.
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.records[0]!.documentKind).toBe('invoice')
    // Dropped, not carried: a unit means nothing on an invoice.
    expect(result.records[0]!.unitReference).toBeNull()
  })

  it('still keeps the unit on a deposit while dropping it elsewhere', async () => {
    // The discriminator. A fix that nulled the field unconditionally would pass
    // the test above and silently undo the whole story.
    const extractor = createGeminiExtractor({
      env: ENV,
      fetch: vi.fn(async () => new Response(reply, { status: 200 })),
    })

    const result = await extractor.extract({ bytes: PDF_BYTES, mediaType: 'application/pdf' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.records[0]!.unitReference).toBe('4B')
  })
})
