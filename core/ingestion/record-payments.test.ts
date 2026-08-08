/**
 * Turning a read deposit into payments, in one place, because ingestion
 * finishes in two.
 *
 * The same argument `hold-unknown-vendors.ts` makes for quarantine, and for the
 * same reason: a scan finishes in `extract-document.ts` on a later request, a
 * spreadsheet finishes in `ingest.ts` at upload time, and AC1 is about a deposit
 * being *ingested* rather than about which parser read it. A rule living in only
 * one of them would make "upload the deposits as CSV" a way to record money
 * against nobody — and CSV is the format the pilot actually uses.
 */

import { describe, expect, it, vi } from 'vitest'

import type { ExtractionRecord } from '../extraction/record'
import type { ResolvedLine } from '../payment/resolve-line'
import type { PaymentRepository } from '../ports/payment-repository'
import type { UnitDirectory } from '../ports/unit-directory'
import { recordPayments, unstorableUnitReference } from './record-payments'

const deposit = (over: Partial<ExtractionRecord> = {}): ExtractionRecord => ({
  documentKind: 'deposit',
  vendorName: null,
  documentNumber: null,
  issuedOn: '2026-03-01',
  totalAmount: '250.00',
  currency: 'USD',
  unitReference: '4B',
  ...over,
})

const invoice = (over: Partial<ExtractionRecord> = {}): ExtractionRecord => ({
  documentKind: 'invoice',
  vendorName: 'Acme Plumbing',
  documentNumber: 'INV-1',
  issuedOn: '2026-03-01',
  totalAmount: '250.00',
  currency: 'USD',
  unitReference: null,
  ...over,
})

/** A directory answering from a fixed reference-to-unit map. */
const directoryOf = (answers: Record<string, string>) => {
  const unitIdsFor = vi.fn(async (references: readonly string[]) => {
    const found = new Map<string, string>()
    for (const reference of references) {
      const id = answers[reference]
      if (id !== undefined) found.set(reference, id)
    }
    return found as ReadonlyMap<string, string>
  })

  return {
    directory: { unitIdsFor } as unknown as UnitDirectory,
    unitIdsFor,
  }
}

const repository = () => {
  // Typed by the port's own signature rather than inferred from a zero-argument
  // implementation: inferred, `replace.mock.calls[0]` is a tuple of length 0 and
  // an assertion about the third argument is a type error rather than a test.
  const replace =
    vi.fn<
      (
        documentId: string,
        lines: readonly ResolvedLine[],
        fence?: { readonly token: string },
      ) => Promise<void>
    >(async () => undefined)

  return { payments: { replace } as unknown as PaymentRepository, replace }
}

/** The lines a call wrote, or a failure if it wrote nothing. */
const written = (replace: ReturnType<typeof vi.fn>): readonly ResolvedLine[] => {
  expect(replace).toHaveBeenCalledTimes(1)
  return replace.mock.calls[0]![1] as readonly ResolvedLine[]
}

const DOCUMENT = 'doc-1'

describe('recording payments from a read document', () => {
  it('stores a deposit line against the unit it names', async () => {
    const { directory } = directoryOf({ '4B': 'unit-4b' })
    const { payments, replace } = repository()

    await recordPayments(DOCUMENT, [deposit()], { units: directory, payments })

    expect(replace).toHaveBeenCalledWith(
      DOCUMENT,
      [{ kind: 'attributed', unitId: 'unit-4b', paidOn: '2026-03-01', amount: '250.00' }],
      undefined,
    )
  })

  it('holds a line naming a unit nobody has recorded', async () => {
    // AD-8's shape: nothing is attributed on a guess, and nothing here can
    // create the unit to make the problem go away.
    const { directory } = directoryOf({})
    const { payments, replace } = repository()

    await recordPayments(DOCUMENT, [deposit({ unitReference: '9Z' })], {
      units: directory,
      payments,
    })

    expect(written(replace)).toEqual([
      {
        kind: 'held',
        unitReference: '9Z',
        paidOn: '2026-03-01',
        amount: '250.00',
        reason: 'unknown-unit',
      },
    ])
  })

  it('matches a reference the roll spells differently', async () => {
    // The re-keying: the directory answered for the raw string, and `resolveLine`
    // looks up the folded one. This is the test that fails if the two are wired
    // to different keys.
    const { directory } = directoryOf({ '  4b ': 'unit-4b' })
    const { payments, replace } = repository()

    await recordPayments(DOCUMENT, [deposit({ unitReference: '  4b ' })], {
      units: directory,
      payments,
    })

    expect(written(replace)[0]).toMatchObject({ kind: 'attributed', unitId: 'unit-4b' })
  })

  it('writes nothing at all for a document that is not a deposit', async () => {
    // AC3. Not "writes an empty set" — `replace` refuses one, and reaching it
    // would turn every invoice upload into a failure.
    const { directory } = directoryOf({ '4B': 'unit-4b' })
    const { payments, replace } = repository()

    await recordPayments(DOCUMENT, [invoice(), invoice()], { units: directory, payments })

    expect(replace).not.toHaveBeenCalled()
  })

  it('asks the directory nothing for a document with no deposit lines', async () => {
    const { directory, unitIdsFor } = directoryOf({})
    const { payments } = repository()

    await recordPayments(DOCUMENT, [invoice()], { units: directory, payments })

    expect(unitIdsFor).not.toHaveBeenCalled()
  })

  it('stores a deposit whose every line was held', async () => {
    // An ordinary outcome, not a failure: an unfamiliar reference format or a
    // new roll. The document was still read, and the held lines are the record
    // of what arrived.
    const { directory } = directoryOf({})
    const { payments, replace } = repository()

    await recordPayments(DOCUMENT, [deposit({ unitReference: '9Z' })], {
      units: directory,
      payments,
    })

    expect(replace).toHaveBeenCalledTimes(1)
    expect(written(replace)[0]!.kind).toBe('held')
  })

  it('asks for every reference in the document at once', async () => {
    // One question for the document. A CSV bank feed is hundreds of lines.
    const { directory, unitIdsFor } = directoryOf({ '4B': 'unit-4b', '5C': 'unit-5c' })
    const { payments } = repository()

    await recordPayments(
      DOCUMENT,
      [deposit(), deposit({ unitReference: '5C' }), deposit({ unitReference: '4B' })],
      { units: directory, payments },
    )

    expect(unitIdsFor).toHaveBeenCalledTimes(1)
    expect(unitIdsFor.mock.calls[0]![0]).toEqual(['4B', '5C'])
  })

  it('holds both lines when two references fold together but name different units', async () => {
    // The failure mode the two-folding design creates, and the reason the
    // re-keying checks rather than assigns. JavaScript's `\s` matches U+3000 and
    // migration 011's character set does not, so `4　B` and `4 B` are one
    // key to core and two different units to the database.
    //
    // Last-write-wins would attribute both lines to whichever came second —
    // real money against the wrong unit, which is the one outcome this whole
    // story refuses. Held is the only honest answer.
    const { directory } = directoryOf({ '4　B': 'unit-wide', '4 B': 'unit-plain' })
    const { payments, replace } = repository()

    await recordPayments(
      DOCUMENT,
      [deposit({ unitReference: '4　B' }), deposit({ unitReference: '4 B' })],
      { units: directory, payments },
    )

    const lines = written(replace)
    expect(lines.map((line) => line.kind)).toEqual(['held', 'held'])
    expect(lines.every((line) => line.kind === 'held' && line.reason === 'unknown-unit')).toBe(true)
  })

  it('still attributes when two references fold together and name the same unit', async () => {
    // The other half. Folding two spellings onto one unit is the point of
    // folding; only a genuine disagreement is ambiguous.
    const { directory } = directoryOf({ '4B': 'unit-4b', '4b': 'unit-4b' })
    const { payments, replace } = repository()

    await recordPayments(
      DOCUMENT,
      [deposit({ unitReference: '4B' }), deposit({ unitReference: '4b' })],
      { units: directory, payments },
    )

    expect(written(replace).map((line) => line.kind)).toEqual(['attributed', 'attributed'])
  })

  it('holds a line with no reference at all rather than dropping it', async () => {
    // The money reached the bank either way. A payment the system silently
    // forgot is worse than one waiting for a human.
    const { directory } = directoryOf({})
    const { payments, replace } = repository()

    await recordPayments(DOCUMENT, [deposit({ unitReference: null })], {
      units: directory,
      payments,
    })

    expect(written(replace)[0]).toMatchObject({ kind: 'held', reason: 'missing-reference' })
  })

  it('holds a line whose amount or date the document did not carry', async () => {
    const { directory } = directoryOf({ '4B': 'unit-4b' })
    const { payments, replace } = repository()

    await recordPayments(
      DOCUMENT,
      [deposit({ totalAmount: null }), deposit({ issuedOn: null })],
      { units: directory, payments },
    )

    expect(written(replace).map((line) => line.kind === 'held' && line.reason)).toEqual([
      'missing-amount',
      'missing-date',
    ])
  })

  it('does nothing when the collaborators were not supplied', async () => {
    // How callers written before this story keep working. A real gap rather
    // than a neutral default, which is why both production call sites supply
    // them and a test asserts each does.
    await expect(recordPayments(DOCUMENT, [deposit()], {})).resolves.toBeUndefined()
  })

  it('reports a reference carrying a NUL as unstorable', () => {
    // Raised by review, and the fourth appearance of migration 017's shape:
    // `text` cannot hold a NUL, so this reaches the `held_payment` insert as a
    // parameter, raises 22021, and aborts the transaction -- taking every
    // payment in the document with it. `unitIdsFor` already refused to *send*
    // one; nothing stopped it being *stored*.
    //
    // `validate` does not catch it either: `checkText` refuses null, wrong
    // types, blank and too-long, and says nothing about control characters.
    expect(unstorableUnitReference([deposit({ unitReference: `4B\u0000` })])).toBe(true)
  })

  it('does not call an ordinary reference unstorable', () => {
    expect(unstorableUnitReference([deposit({ unitReference: '4B' })])).toBe(false)
    expect(unstorableUnitReference([deposit({ unitReference: null })])).toBe(false)
    expect(unstorableUnitReference([invoice()])).toBe(false)
  })

  it('checks every record, not only the first', () => {
    expect(
      unstorableUnitReference([deposit(), deposit({ unitReference: `5C\u0000` })]),
    ).toBe(true)
  })

  it('passes the extraction claim through to the write', async () => {
    // Raised on the merge request. Unfenced, a stale run's payments could
    // overwrite a fresher run's on a document already settled as `read` -- so
    // never polled again, and permanently half from each reading. The payment
    // write happens *before* the fenced extraction write, which is what left it
    // exposed.
    const { directory } = directoryOf({ '4B': 'unit-4b' })
    const { payments, replace } = repository()

    await recordPayments(DOCUMENT, [deposit()], { units: directory, payments }, { token: 'tok-1' })

    expect(replace.mock.calls[0]![2]).toEqual({ token: 'tok-1' })
  })

  it('writes without a fence when the caller has no claim', async () => {
    // The upload path reads a CSV synchronously inside the request that uploaded
    // it. There is no claim, and no second runner to race.
    const { directory } = directoryOf({ '4B': 'unit-4b' })
    const { payments, replace } = repository()

    await recordPayments(DOCUMENT, [deposit()], { units: directory, payments })

    expect(replace.mock.calls[0]![2]).toBeUndefined()
  })
})
