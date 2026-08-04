/**
 * The application's upload limits and the transport's must agree.
 *
 * They are declared in two files that have no reason to know about each other —
 * `core/ingestion/acceptance.ts` and `next.config.ts` — and the consequence of
 * them disagreeing is not a failed build or a caught exception. It is a board
 * member selecting the statement they were asked for and being told nothing
 * useful, because the framework refused the request before any application code
 * ran.
 *
 * That is exactly what shipped in the first draft of this story: a stated 25 MiB
 * limit sitting behind an unstated 1 MB one.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MAX_DOCUMENT_BYTES,
  MAX_FILES_PER_UPLOAD,
  MAX_UPLOAD_BATCH_BYTES,
} from './acceptance'

/** Parses the `'52mb'` form Next.js accepts. */
function parseByteSize(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(value.trim())

  expect(match, `unrecognised body size limit: ${value}`).not.toBeNull()

  const units: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  }

  return Number(match![1]) * units[match![2].toLowerCase()]!
}

function configuredBodySizeLimit(): number {
  const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8')
  const declared = /bodySizeLimit:\s*'([^']+)'/.exec(config)

  expect(
    declared,
    'next.config.ts no longer sets serverActions.bodySizeLimit — the Next.js default is 1 MB, ' +
      'which is smaller than a single supported document',
  ).not.toBeNull()

  return parseByteSize(declared![1]!)
}

describe('upload limits', () => {
  it('parses a size the way Next.js does, so this test is measuring something', () => {
    expect(parseByteSize('52mb')).toBe(52 * 1024 * 1024)
    expect(parseByteSize('1mb')).toBe(1024 * 1024)
  })

  it('lets a single document at the stated limit through the transport', () => {
    expect(configuredBodySizeLimit()).toBeGreaterThanOrEqual(MAX_DOCUMENT_BYTES)
  })

  it('lets a full batch at the stated limit through the transport', () => {
    expect(configuredBodySizeLimit()).toBeGreaterThanOrEqual(MAX_UPLOAD_BATCH_BYTES)
  })

  it('leaves headroom for multipart overhead above the batch limit', () => {
    // The body carries boundaries, filenames and headers as well as bytes.
    // Sitting exactly on the limit means a batch at the limit is refused.
    expect(configuredBodySizeLimit()).toBeGreaterThan(MAX_UPLOAD_BATCH_BYTES)
  })

  it('admits at least two documents in one submission', () => {
    expect(MAX_UPLOAD_BATCH_BYTES).toBeGreaterThanOrEqual(2 * MAX_DOCUMENT_BYTES)
  })

  it('caps the file count as well as the byte count', () => {
    // A thousand tiny files is the same memory problem in a different shape.
    expect(MAX_FILES_PER_UPLOAD).toBeGreaterThan(1)
    expect(MAX_FILES_PER_UPLOAD).toBeLessThanOrEqual(100)
  })
})
