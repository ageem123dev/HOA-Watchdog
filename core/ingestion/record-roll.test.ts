/**
 * When a roll is written, and when nothing is.
 *
 * Three behaviours, and two of them are refusals. `apply` refuses an empty list
 * by design, so reaching it for a document that stated no roll rows would turn
 * every invoice upload into a failure — which is the shape `recordPayments`
 * avoids by not calling `replace` for a document with no deposit lines.
 */

import { describe, expect, it, vi } from 'vitest'

import type { RollRow } from '../extraction/roll'
import type { RollRepository } from '../ports/roll-repository'
import { recordRoll } from './record-roll'

const ROW: RollRow = {
  unitNumber: '4B',
  holderName: 'Jane Smith',
  heldFrom: '2019-03-01',
  annualAmount: '3600.00',
  billingCycle: 'monthly',
  assessmentYear: 2026,
}

const spyRepository = () => {
  const apply = vi.fn<RollRepository['apply']>().mockResolvedValue(undefined)
  return { apply, repository: { apply } satisfies RollRepository }
}

describe('recording a roll', () => {
  it('hands every row to the repository, against the document that stated them', async () => {
    const { apply, repository } = spyRepository()

    await recordRoll('doc-1', [ROW], { rolls: repository })

    expect(apply).toHaveBeenCalledExactlyOnceWith('doc-1', [ROW])
  })

  it('passes the rows through unchanged, so the adapter sees what the reader read', async () => {
    const { apply, repository } = spyRepository()
    const second: RollRow = { ...ROW, unitNumber: '5C', assessmentYear: 2027 }

    await recordRoll('doc-1', [ROW, second], { rolls: repository })

    expect(apply.mock.calls[0]![1]).toEqual([ROW, second])
  })

  it('does nothing at all for a document that stated no roll rows', async () => {
    // Not "calls apply with an empty list". `apply` refuses one, so calling it
    // would make every invoice upload a failure.
    const { apply, repository } = spyRepository()

    await recordRoll('doc-1', [], { rolls: repository })

    expect(apply).not.toHaveBeenCalled()
  })

  it('does nothing when no repository is injected', async () => {
    // How callers written before this story keep working. A real gap rather
    // than a neutral default, which is why `roll-wiring.test.ts` exists.
    await expect(recordRoll('doc-1', [ROW], {})).resolves.toBeUndefined()
  })

  it('lets a failure escape, so ingestion can report figures-not-stored', async () => {
    // Propagated, not swallowed. `ingest` catches it and tells the treasurer
    // their figures were not saved; swallowing it here would report success for
    // a roll that wrote nothing.
    const failing: RollRepository = {
      apply: vi.fn<RollRepository['apply']>().mockRejectedValue(new Error('writer is down')),
    }

    await expect(recordRoll('doc-1', [ROW], { rolls: failing })).rejects.toThrow('writer is down')
  })
})
