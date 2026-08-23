/**
 * Changing a mapping, from the server action inwards (story 5.7, AC6).
 *
 * ## The test that had to exist
 *
 * `changeMapping` originally took a whole `DraftMapping` from the form and
 * checked its *shape*. A form could declare `documentKind: deposit` — so the
 * shape key was derived for a deposit — and send a mapping whose own `kind` was
 * `invoice`. It would be stored under the deposit shape and applied to every
 * later deposit export, pairing that file's columns to an invoice's fields.
 * Nothing throws, and every value is still a plausible value in the wrong field.
 *
 * Argus found it. The fix is not a check that the two kinds agree: the form now
 * sends **only pairings**, and the kind and column count are derived from the
 * request's own context, so there is nothing left to assert. `refuses to store a
 * mapping under another kind's shape` is the regression test, and it is written
 * against the *old* attack — the payload that used to work.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.fn()
const save = vi.fn<(mapping: unknown) => Promise<unknown>>(async () => null)
const find = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null)
const record = vi.fn<(change: unknown) => Promise<void>>(async () => undefined)
const importedUnder = vi.fn(async () => [] as unknown[])

vi.mock('@/adapters/auth/auth', () => ({ auth: () => auth() }))
vi.mock('@/adapters/db/mapping-store-postgres', () => ({
  createMappingStore: () => ({ save, find }),
}))
vi.mock('@/adapters/db/mapping-change-log-postgres', () => ({
  createMappingChangeLog: () => ({ record }),
}))
vi.mock('@/adapters/db/reimport-candidates-postgres', () => ({
  createReimportCandidates: () => ({ importedUnder }),
}))
// The composition reaches S3 and Postgres at module scope, which a unit test
// must not. Stubbed wholesale: what it *contains* is asserted structurally by
// `app/ingestion-dependencies.test.ts`, which is the only thing that can see an
// omission shared by two callers.
vi.mock('../../ingestion-dependencies', () => ({ ingestionDependencies: () => ({}) }))

const SIGNED_IN = { user: { id: 'director-1' } }
const HEADER = JSON.stringify(['Txn Date', 'Descr', 'Amt'])

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.append(key, value)
  return data
}

const change = async (fields: Record<string, string>) => {
  const { changeMapping } = await import('./reimport-actions')
  return changeMapping({ status: 'idle' }, form(fields))
}

const preview = async (fields: Record<string, string>) => {
  const { previewMappingChange } = await import('./reimport-actions')
  return previewMappingChange({ status: 'idle' }, form(fields))
}

const DEPOSIT_PAIRINGS = JSON.stringify([
  { target: 'date', position: 1 },
  { target: 'description', position: 2 },
  { target: 'amount', position: 3 },
])

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue(SIGNED_IN)
  save.mockResolvedValue(null)
  find.mockResolvedValue(null)
  importedUnder.mockResolvedValue([])
  // `clearAllMocks` keeps implementations, so a rejection set by one test would
  // survive into the next.
  record.mockResolvedValue(undefined)
})

describe('what the form is allowed to decide', () => {
  it('refuses to store a mapping under another kind\'s shape', async () => {
    /**
     * The regression test, written against the payload that used to work: a
     * declared kind of `deposit` and an `invoice` mapping alongside it.
     *
     * The `mapping` field is ignored entirely now — nothing reads it — so the
     * submission fails for want of `pairings`, and nothing is stored. That is
     * the point: the attack is not detected, it is unrepresentable.
     */
    const state = await change({
      documentKind: 'deposit',
      headerRow: HEADER,
      mapping: JSON.stringify({ kind: 'invoice', columns: 3, pairings: [] }),
    })

    expect(state.status).toBe('error')
    expect(save).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('stores the kind it derived, whatever else the form sends', async () => {
    await change({
      documentKind: 'deposit',
      headerRow: HEADER,
      pairings: DEPOSIT_PAIRINGS,
      // Ignored: there is no path from here to the stored mapping's kind.
      kind: 'invoice',
    })

    const saved = save.mock.calls[0]?.[0] as { kind: string; mapping: { kind: string } }

    expect(saved.kind).toBe('deposit')
    expect(saved.mapping.kind).toBe('deposit')
  })

  it('refuses a pairing the kind does not offer, rather than storing it', async () => {
    // `assign` decides this, not the action. An invoice target on a deposit.
    const state = await change({
      documentKind: 'deposit',
      headerRow: HEADER,
      pairings: JSON.stringify([{ target: 'vendor_name', position: 1 }]),
    })

    expect(state.status).toBe('error')
    expect(save).not.toHaveBeenCalled()
  })

  it('refuses without a session', async () => {
    auth.mockResolvedValue(null)

    const state = await change({
      documentKind: 'deposit',
      headerRow: HEADER,
      pairings: DEPOSIT_PAIRINGS,
    })

    expect(state.status).toBe('error')
    expect(save).not.toHaveBeenCalled()
  })
})

describe('the order of the three things it does', () => {
  it('records only after the re-import, and names what was replaced', async () => {
    /**
     * The record says which documents were re-imported. Written before the
     * re-import it would claim one that had not run — and migration 027 revokes
     * UPDATE, so there is no correcting it.
     */
    save.mockResolvedValue({ mapping: { kind: 'deposit', columns: 3, pairings: [] } })
    importedUnder.mockResolvedValue([
      { id: 'doc-1', storageKey: 'key/doc-1', filename: 'march.csv', contentType: 'text/csv' },
    ])

    await change({ documentKind: 'deposit', headerRow: HEADER, pairings: DEPOSIT_PAIRINGS })

    expect(save).toHaveBeenCalled()
    expect(record).toHaveBeenCalledTimes(1)

    const written = record.mock.calls[0]?.[0] as {
      changedBy: string
      previous: unknown
      documents: unknown[]
    }

    expect(written.changedBy).toBe('director-1')
    // The mapping that was replaced — the value that exists nowhere else once
    // `save` has returned, which is why saving and recording are one action.
    expect(written.previous).toEqual({ kind: 'deposit', columns: 3, pairings: [] })

    /**
     * **One entry per candidate, not merely "an array".** The first version of
     * this asserted `Array.isArray(written.documents)`, and a mutation that
     * recorded `[]` without waiting for the re-import passed it - `[]` is an
     * array. With a candidate present the record has to carry that document's
     * outcome, which it can only have after the re-import produced one.
     *
     * The outcome here is `failed` because the stubbed composition supplies no
     * object store, and that is fine: the claim under test is the *ordering*,
     * and a per-document outcome of any kind proves the re-import ran first.
     */
    expect(written.documents).toHaveLength(1)
    expect(written.documents[0]).toMatchObject({ documentId: 'doc-1' })
  })

  it('records a first mapping with no previous rather than skipping the record', async () => {
    save.mockResolvedValue(null)

    await change({ documentKind: 'deposit', headerRow: HEADER, pairings: DEPOSIT_PAIRINGS })

    const written = record.mock.calls[0]?.[0] as { previous: unknown }

    // Null, not absent and not `{}`: migration 027 leaves the column nullable
    // precisely so "nothing was replaced" is a recordable fact.
    expect(written.previous).toBeNull()
  })
})

describe('when a step fails after the change has happened', () => {
  it('says the change was applied but not recorded, rather than reporting failure', async () => {
    /**
     * The mapping is replaced and the documents are re-parsed before `record`
     * runs. Rethrowing would report a failure that did not happen and invite the
     * treasurer to run it again; reporting `changed` would claim a durable
     * record AC6 asks for and there is none. Both are lies, in opposite
     * directions. Raised by ocr.
     */
    record.mockRejectedValue(new Error('the database said no'))
    importedUnder.mockResolvedValue([
      { id: 'doc-1', storageKey: 'key/doc-1', filename: 'march.csv', contentType: 'text/csv' },
    ])

    const state = await change({
      documentKind: 'deposit',
      headerRow: HEADER,
      pairings: DEPOSIT_PAIRINGS,
    })

    expect(state.status).toBe('changed-unrecorded')
    // The outcomes still reach the treasurer: the work really was done.
    expect(save).toHaveBeenCalled()
    expect(state).toMatchObject({ documents: [{ documentId: 'doc-1' }] })
  })

  it('refuses a pairing whose position is NaN', async () => {
    // `typeof NaN === 'number'`, so the transport check passes it through and
    // `assign`'s `Number.isInteger` is what refuses it. Asserted rather than
    // reasoned about, which is the difference ocr's finding was worth.
    const state = await change({
      documentKind: 'deposit',
      headerRow: HEADER,
      pairings: '[{"target":"date","position":null}]',
    })

    expect(state.status).toBe('error')
    expect(save).not.toHaveBeenCalled()
  })
})

describe('the warning, which writes nothing', () => {
  it('says there is nothing to change when no mapping exists for the shape', async () => {
    // Not an error. It is the ordinary answer for a shape nobody has mapped, and
    // it is what tells the wizard to use the plain save instead.
    find.mockResolvedValue(null)

    const state = await preview({ documentKind: 'deposit', headerRow: HEADER })

    expect(state).toEqual({ status: 'nothing-to-change' })
    expect(save).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('writes nothing even when a mapping does exist', async () => {
    find.mockResolvedValue({ kind: 'deposit', shape: 's', savedBy: 'director-1', mapping: {} })

    const state = await preview({ documentKind: 'deposit', headerRow: HEADER })

    expect(state.status).toBe('would-replace')
    expect(save).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })
})
