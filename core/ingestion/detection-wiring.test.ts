/**
 * That duplicate detection is actually connected, and what it does when it fails.
 *
 * `runDetection` treats missing collaborators as "do nothing", which is
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
import type { DuesReader } from '../ports/dues-reader'
import type { InvoiceReader } from '../ports/invoice-reader'
import { runDetection } from './run-detection'

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

  it('passes a dues reader', () => {
    // Story 4.4's detector reads through its own port. A call site wiring only
    // the invoice reader now gets two detectors out of three and nothing fails,
    // which is exactly the invisible gap this file exists for.
    expect(source).toMatch(/dues:\s*createDuesReader\(\)/)
    expect(source).toContain("from '@/adapters/db/dues-reader-postgres'")
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
    await expect(runDetection('d-1', {})).resolves.toBeNull()
  })

  it('does nothing when only one of the two is supplied', async () => {
    // Half-wired is not partly working. A reader with no register can find
    // duplicates and record none of them.
    const invoices = { invoicesOn: vi.fn(), priorCandidates: vi.fn() } as unknown as InvoiceReader

    await expect(runDetection('d-1', { invoices })).resolves.toBeNull()
    expect(invoices.invoicesOn).not.toHaveBeenCalled()
  })

  it('does nothing when there is a register but nothing to read with', async () => {
    const findings = { raise: vi.fn() } as unknown as FindingRegister

    await expect(runDetection('d-1', { findings })).resolves.toBeNull()
    expect(findings.raise).not.toHaveBeenCalled()
  })
})

describe('a missing reader silences its own detector and no other', () => {
  /**
   * **Why this is per detector rather than all-or-nothing.**
   *
   * Until story 4.4 there was one reader, so "no reader means do nothing" was
   * the same sentence either way. With two, an all-or-nothing gate would mean a
   * caller wiring only the reader it has gets *no detection at all* — the
   * invisible gap this file exists for, produced by the check written to
   * prevent it. Neither of these two cases fails loudly; only these tests do.
   */
  const register = (): FindingRegister => ({
    raise: vi.fn(async () => ({ id: 'f-1', wasAlreadyKnown: false })),
  })

  const emptyInvoices = (): InvoiceReader => ({
    invoicesOn: vi.fn(async () => []),
    priorCandidates: vi.fn(async () => []),
    trailingInvoices: vi.fn(async () => []),
  })

  const emptyDues = (): DuesReader => ({
    evaluationDateFor: vi.fn(async () => '2026-04-01'),
    duesForDocument: vi.fn(async () => []),
  })

  it('runs the invoice detectors with no dues reader', async () => {
    const invoices = emptyInvoices()

    const outcome = await runDetection('d-1', { invoices, findings: register() })

    expect(outcome).toMatchObject({
      duplicates: { raised: 0 },
      spikes: { raised: 0 },
      dues: null,
    })
    expect(invoices.invoicesOn).toHaveBeenCalled()
  })

  it('runs dues detection with no invoice reader, and reports no failure for it', async () => {
    const dues = emptyDues()
    const onError = vi.fn()

    const outcome = await runDetection('d-1', { dues, findings: register(), onError })

    expect(outcome).toMatchObject({
      duplicates: null,
      spikes: null,
      dues: { raised: 0 },
    })
    expect(dues.duesForDocument).toHaveBeenCalled()

    // **`onError` is what makes the gate worth having.** Without it, running an
    // unwired detector anyway looks identical from the outcome — it throws on
    // the absent reader, `attempt` catches it, and the field is `null` either
    // way. What differs is that every upload would report two detector failures
    // that never happened. A mutation removing the gate survived until this
    // line existed.
    expect(onError).not.toHaveBeenCalled()
  })

  it('runs all three when everything is wired', async () => {
    const outcome = await runDetection('d-1', {
      invoices: emptyInvoices(),
      dues: emptyDues(),
      findings: register(),
    })

    expect(outcome).toMatchObject({
      duplicates: { raised: 0 },
      spikes: { raised: 0 },
      dues: { raised: 0 },
    })
  })
})

describe('the ingest path reports errors with its own vocabulary', () => {
  it('rewraps onError so a filename is not logged as a document id', () => {
    // `ingest`'s `onError` takes a **filename**; `extract-document`'s takes a
    // document id. Both are strings, so passing `deps` straight through
    // type-checks and logs a uuid under the label `filename`.
    //
    // The first version of this test asserted the two lines separately and
    // **passed with the rewrap removed**, because `deps.onError?.(error,
    // filename)` already appears twice in this file's catch blocks. Raised by
    // CodeRabbit. The assertion now reads the argument object itself, so the
    // pre-existing lines cannot satisfy it.
    const source = read('core/ingestion/ingest.ts')
    const call = /runDetection\(recorded\.id, \{[\s\S]*?\}\)/.exec(source)

    expect(call, 'the detection call should pass an explicit object').not.toBeNull()
    expect(call![0]).toContain('onError:')
    expect(call![0]).toContain('filename')
    expect(call![0]).not.toMatch(/onError:\s*deps\.onError\s*[,}]/)
  })
})

describe('when detection fails', () => {
  const failing = (): { invoices: InvoiceReader; findings: FindingRegister } => ({
    invoices: {
      invoicesOn: vi.fn(async () => {
        throw new Error('the database went away')
      }),
      priorCandidates: vi.fn(async () => []),
      trailingInvoices: vi.fn(async () => []),
    },
    findings: { raise: vi.fn() } as unknown as FindingRegister,
  })

  it('reports the cause and lets the ingestion stand', async () => {
    // The document really was read, and its records really are stored. Throwing
    // here would report a success as a failure — and the caller's retry would
    // find the document already settled and change nothing, so the upload would
    // look broken and be fine.
    const onError = vi.fn()

    await expect(runDetection('d-1', { ...failing(), onError })).resolves.toEqual({
      duplicates: null,
      spikes: null,
      dues: null,
    })
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'd-1')
  })

  it('swallows the failure even with nobody listening', async () => {
    // `onError` is optional everywhere else on this path; an absent listener
    // must not turn a swallowed failure into a thrown one.
    await expect(runDetection('d-1', failing())).resolves.toBeDefined()
  })

  it('keeps the original cause rather than replacing it', async () => {
    // The wrapper names the detector; it must not swallow what actually broke.
    const onError = vi.fn()

    await runDetection('d-1', { ...failing(), onError })

    expect(onError.mock.calls[0]![0]).toMatchObject({
      cause: expect.objectContaining({ message: 'the database went away' }),
    })
  })
})

describe('one failing detector does not stop the other', () => {
  /**
   * A reader that answers everything except the one method named.
   *
   * The two detectors overlap on `invoicesOn` and diverge after it, so failing
   * `priorCandidates` fails duplicate detection alone and failing
   * `trailingInvoices` fails spike detection alone. That is what makes the
   * isolation testable at all.
   */
  function readerBreaking(method: 'priorCandidates' | 'trailingInvoices'): InvoiceReader {
    const invoice = {
      extractionId: 'e-1',
      documentId: 'd-1',
      vendorName: 'Acme Plumbing',
      documentNumber: 'INV-1',
      issuedOn: '2026-06-14',
      amount: '130.00',
      documentUploadedAt: '2026-06-20',
    }
    // The two queries ask different questions, so they get different answers:
    // a duplicate is the same bill at the same amount, and a trailing window is
    // the cheaper history that makes this bill stand out. One set of priors
    // cannot serve both — the first version of this fake tried, and duplicate
    // detection correctly found nothing.
    const duplicate = { ...invoice, extractionId: 'p0', documentId: 'd-p0' }
    const history = ['p1', 'p2', 'p3'].map((id) => ({
      ...invoice,
      extractionId: id,
      documentId: `d-${id}`,
      issuedOn: '2026-03-01',
      amount: '100.00',
      documentUploadedAt: '2026-03-05',
    }))
    const broken = async (): Promise<never> => {
      throw new Error(`${method} went away`)
    }

    return {
      invoicesOn: vi.fn(async () => [invoice]),
      priorCandidates:
        method === 'priorCandidates' ? vi.fn(broken) : vi.fn(async () => [duplicate]),
      trailingInvoices:
        method === 'trailingInvoices' ? vi.fn(broken) : vi.fn(async () => history),
    }
  }

  it.each([
    { broken: 'priorCandidates', survives: 'spikes', lost: 'duplicates', named: 'duplicate-invoice' },
    { broken: 'trailingInvoices', survives: 'duplicates', lost: 'spikes', named: 'vendor-spike' },
  ] as const)(
    'still runs $survives detection when $broken fails',
    async ({ broken, survives, lost, named }) => {
      // **The decision this story had to make.** A vendor-spike query that
      // times out is no reason to skip the check for an invoice you may have
      // paid already. Both detectors see the same invoice above the same
      // priors, so each half raises something on its own.
      const onError = vi.fn()

      const outcome = await runDetection('d-1', {
        invoices: readerBreaking(broken),
        findings: { raise: vi.fn(async () => ({ id: 'f-1', wasAlreadyKnown: false })) },
        onError,
      })

      expect(outcome![lost]).toBeNull()
      expect(outcome![survives]).toMatchObject({ raised: 1 })

      // Named, because "detection failed for document d-1" tells an operator
      // nothing about which half to re-run.
      expect(onError).toHaveBeenCalledTimes(1)
      expect(onError.mock.calls[0]![0]).toMatchObject({ message: `${named} detection failed` })
    },
  )

  it('survives an error listener that throws on the way out', async () => {
    // **Reporting the failure must not become the failure.** `onError` is
    // caller-supplied — `ingest.ts` wraps its own, and a logger with a broken
    // transport is an ordinary thing to have. Thrown from inside the catch it
    // escapes `attempt` entirely, which costs both promises this file makes:
    // the second detector never runs, and the exception reaches the ingestion
    // path, so a document that really was read gets reported as failed.
    //
    // Raised by CodeRabbit. The shape predates this story — 4.2's catch called
    // `onError` the same way — but the isolation it breaks is new, which is
    // what makes it worth fixing here rather than noting.
    const onError = vi.fn(() => {
      throw new Error('the log stream went away')
    })

    const outcome = await runDetection('d-1', {
      invoices: readerBreaking('priorCandidates'),
      findings: { raise: vi.fn(async () => ({ id: 'f-1', wasAlreadyKnown: false })) },
      onError,
    })

    expect(onError).toHaveBeenCalled()
    expect(outcome!.duplicates).toBeNull()
    expect(outcome!.spikes).toMatchObject({ raised: 1 })
  })
})
