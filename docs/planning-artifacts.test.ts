/**
 * The planning artifacts carry their amendments.
 *
 * AC5, and the clause that needs a test rather than a promise: **withdrawn
 * claims are not deleted.** A control register that quietly loses a row reads as
 * a register that never had it, and the difference is invisible to a reader.
 *
 * So this asserts two things at once — that the amendment is present, and that
 * the original claim is still there beside it. Either alone would pass for the
 * wrong document: the amendment alone would pass for a register that deleted the
 * row it was explaining, and the claim alone is the stale state this story
 * exists to correct.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(
  root,
  '_bmad-output/planning-artifacts/architecture/architecture-HOA-Treasurer-Assistant-2026-07-29',
)

// Read as latin1: these are hand-authored HTML with non-UTF-8 bytes, and the
// assertions below are all ASCII. Decoding strictly would fail on the file
// rather than on its content.
const read = (file: string): string => readFileSync(join(artifacts, file), 'latin1')

const spine = read('ARCHITECTURE-SPINE.md')
const walkthrough = read('architecture-walkthrough.html')
const security = read('security-posture.html')

describe('the walkthrough counts what the spine actually declares', () => {
  it('names as many decisions as the spine has', () => {
    // Derived, not transcribed. The count was "Fifteen" while the spine held
    // sixteen, and the only reason anyone would notice is by counting.
    const declared = new Set(
      [...spine.matchAll(/^#+ *(AD-\d+)/gm)].map((match) => match[1]!),
    )
    const words: Record<number, string> = {
      14: 'Fourteen',
      15: 'Fifteen',
      16: 'Sixteen',
      17: 'Seventeen',
      18: 'Eighteen',
    }
    const expected = words[declared.size]
    expect(expected, `no word for ${declared.size} decisions`).toBeDefined()

    expect(walkthrough).toContain(`${expected} decisions`)
    expect(walkthrough).toContain(`${expected} invariants`)
  })

  it('says which components are not built', () => {
    // The deck is present-tense throughout and roughly half of it is unbuilt.
    // A reader cannot tell which half without this.
    expect(walkthrough).toContain('Not built:')
    for (const unbuilt of ['Oracle', 'watchdog', 'CrewAI']) {
      expect(walkthrough).toContain(unbuilt)
    }
  })

  it('records the amendment rather than silently correcting', () => {
    expect(walkthrough).toContain('Amended 2026-08-09')
  })
})

describe('the security posture keeps the rows whose evidence was withdrawn', () => {
  it('still states both controls', () => {
    // The claims themselves, unchanged. This is the half that a deletion would
    // remove, and the half a reader of a control register is entitled to.
    expect(security).toContain('Secret inventory across all deploy units')
    expect(security).toContain('CI diff check on published catalog versions')
  })

  it('marks their evidence as withdrawn, with a date and a reason', () => {
    const amendments = security.match(/Evidence amended 2026-08-09/g) ?? []
    expect(amendments).toHaveLength(2)
    expect(security).toContain('2026-08-07')
  })

  it('does not leave a CI claim standing unqualified', () => {
    // Every mention of CI as evidence must sit beside its withdrawal. Counting
    // is what makes that checkable: a third row citing CI, added later, fails
    // here rather than quietly asserting a control nothing enforces.
    const citations = security.match(/CI (?:check|diff check)/g) ?? []
    expect(citations).toHaveLength(2)
  })
})

describe('the board explainer was checked, and needed nothing', () => {
  it('still makes the claim it exists to make, and that claim is still true', () => {
    // Deliberately not edited. Its subject is the air-gap — that this system
    // cannot move money — and that is intact and enforced by
    // `core/security/nfr2-guard.test.ts`. Editing it to show work would have
    // been the wrong instinct; asserting the claim it rests on is the right one.
    const explainer = read('board-explainer.html')
    expect(explainer).toContain('cannot move')
  })
})
