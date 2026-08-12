/**
 * That duplicate detection is actually connected, and what it does when it fails.
 *
 * `runDuplicateDetection` treats missing collaborators as "do nothing", which is
 * how every caller written before story 4.2 keeps working. That default is a real
 * gap rather than a neutral one: an invoice is read, stored, and **never compared
 * against what came before**, and nothing fails. It is the shape
 * `payment-wiring.test.ts` was written for, one epic later.
 *
 * The call sites are read as source for the same reason that file gives: a route
 * handler needs a session, a database and an object store before it runs a line,
 * and the question here is narrower than any of that — does the wiring exist.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { FindingRegister } from '../ports/finding'
import type { InvoiceReader } from '../ports/invoice-reader'
import { runDuplicateDetection } from './run-detection'

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

const CALL_SITES = [
  {
    what: 'the upload action, the path an invoice CSV takes',
    path: 'app/upload/actions.ts',
  },
  {
    what: 'the extract route, the path a scanned invoice takes',
    path: 'app/api/documents/[id]/extract/route.ts',
  },
] as const

describe.each(CALL_SITES)('$what', ({ path }) => {
  const source = read(path)

  it('passes an invoice reader', () => {
    expect(source).toMatch(/invoices:\s*createInvoiceReader\(\)/)
  })

  it('passes a finding register', () => {
    expect(source).toMatch(/findings:\s*createFindingRegister\(\)/)
  })

  it('imports them from the adapters rather than building its own', () => {
    // A hand-rolled reader here would be a second component that owns creating
    // findings, which AD-13 calls a violation in as many words.
    expect(source).toContain("from '@/adapters/db/invoice-reader-postgres'")
    expect(source).toContain("from '@/adapters/db/finding-postgres'")
  })
})

describe('when the collaborators are absent', () => {
  it('does nothing rather than failing the ingestion', async () => {
    // The many callers written before this story keep working, which is the
    // point — and the gap the source assertions above exist to close.
    await expect(runDuplicateDetection('d-1', {})).resolves.toBeNull()
  })

  it('does nothing when only one of the two is supplied', async () => {
    // Half-wired is not partly working. A reader with no register can find
    // duplicates and record none of them.
    const invoices = { invoicesOn: vi.fn(), priorCandidates: vi.fn() } as unknown as InvoiceReader

    await expect(runDuplicateDetection('d-1', { invoices })).resolves.toBeNull()
    expect(invoices.invoicesOn).not.toHaveBeenCalled()
  })
})

describe('when detection fails', () => {
  const failing = (): { invoices: InvoiceReader; findings: FindingRegister } => ({
    invoices: {
      invoicesOn: vi.fn(async () => {
        throw new Error('the database went away')
      }),
      priorCandidates: vi.fn(async () => []),
    },
    findings: { raise: vi.fn() } as unknown as FindingRegister,
  })

  it('reports the cause and lets the ingestion stand', async () => {
    // The document really was read, and its records really are stored. Throwing
    // here would report a success as a failure — and the caller's retry would
    // find the document already settled and change nothing, so the upload would
    // look broken and be fine.
    const onError = vi.fn()

    await expect(runDuplicateDetection('d-1', { ...failing(), onError })).resolves.toBeNull()
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'd-1')
  })

  it('swallows the failure even with nobody listening', async () => {
    // `onError` is optional everywhere else on this path; an absent listener
    // must not turn a swallowed failure into a thrown one.
    await expect(runDuplicateDetection('d-1', failing())).resolves.toBeNull()
  })
})
