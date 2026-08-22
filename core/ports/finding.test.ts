/**
 * What the finding ports are allowed to express.
 *
 * Types and prose, so there is no behaviour to run except the two errors. What
 * can be checked is the shape of the declarations, and here the shape carries
 * three separate arguments:
 *
 * - **There is no way to make a finding go away.** AD-13's register is fiduciary
 *   evidence; a method that removed one would be a method that hid one.
 * - **A detector cannot raise a finding pre-reviewed.** `FindingObservation` is
 *   what a detector supplies, and every field of the lifecycle is absent from it.
 * - **Raising and reviewing are two capabilities, not two methods.** A holder of
 *   the register cannot record that a human read something, because the register
 *   does not declare it.
 *
 * The helper is `core/ports/declared-members.ts`, which has its own tests for
 * the six member forms that escaped earlier name-matching versions. Nothing here
 * re-tests it.
 */

import { readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { AlreadyReviewedError, FindingNotFoundError } from './finding'
import { declaredMembers } from './declared-members'
import { specifiersIn as sharedSpecifiersIn } from './module-specifiers'

const HERE = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(HERE, 'finding.ts'), 'utf8')

describe('the FindingRegister port', () => {
  it('declares exactly the one creation path AD-13 allows', () => {
    // AD-13: "Exactly one component owns creation of each derived entity; a
    // second write path for the same entity is a violation." One method is how
    // that is expressed in a type — a second one here would be the violation,
    // declared.
    expect(declaredMembers(source, 'FindingRegister')).toEqual([
      'raise(observation: FindingObservation): Promise<RaisedFinding>',
    ])
  })

  it('cannot record a review, because that is a different capability', () => {
    // Not a restatement of the assertion above. That one pins the exact line;
    // this one names *why* the list is one long, so a future edit that adds
    // `markReviewed` here has to argue with a test that says what it costs:
    // anything holding the register would then be able to sign off its own
    // findings.
    expect(declaredMembers(source, 'FindingRegister').join(' ')).not.toMatch(/review/i)
  })
})

describe('neither port can make a finding go away', () => {
  /**
   * The register is evidence, and this is the assertion that keeps it so.
   *
   * Checked across **both** interfaces rather than one, because the capability
   * only has to exist somewhere to be reachable — a `dismiss` on the reviewer
   * would be exactly as fatal as one on the register, and a test that looked
   * only at the register would pass while it shipped.
   *
   * The words are the ones a well-meaning refactor reaches for. A board member
   * who could delete a finding could delete the one about themselves.
   */
  it.each(['dismiss', 'delete', 'remove', 'discard', 'archive', 'close', 'hide', 'suppress'])(
    'declares no %s capability',
    (verb) => {
      const members = [
        ...declaredMembers(source, 'FindingRegister'),
        ...declaredMembers(source, 'FindingReviewer'),
      ].join(' ')

      expect(members).not.toMatch(new RegExp(verb, 'i'))
    },
  )

  it('says in the file why the method is absent', () => {
    // The comment is the part a future reader acts on. A port that merely
    // *lacks* a method looks like an oversight, and the natural fix for an
    // oversight is to add it; one that argues the method away is a decision
    // somebody has to overturn on purpose.
    expect(source).toMatch(/dismiss/i)
  })
})

describe('what a detector may supply', () => {
  it('is the finding and nothing about its life', () => {
    // No `state`, no `reviewedBy`, no `reviewedAt`, and no `raisedAt`. A
    // detector that could set any of them could raise a finding already marked
    // reviewed — which is dismissal with the paperwork filled in — or backdate
    // one out of the window an auditor is looking at.
    // `documentId` joined them in 5.1 and is deliberately here rather than
    // absent: it names the run that surfaced the finding, which is how the
    // adapter reads an association without resolving through `subjectId` --
    // untyped as a foreign key on purpose. It says nothing about the finding's
    // lifecycle, so the rule this case guards is intact.
    expect(declaredMembers(source, 'FindingObservation')).toEqual([
      'readonly findingType: string',
      'readonly subjectId: string',
      'readonly documentId: string',
      'readonly period: FindingPeriod',
      'readonly evidence: Readonly<Record<string, unknown>>',
    ])
  })

  it('names both ends of the period', () => {
    // Both bounds required by the type, matching `finding_period_is_bounded` in
    // migration 021. An open-ended period is a window that grows with the date
    // it is read on.
    expect(declaredMembers(source, 'FindingPeriod')).toEqual([
      'readonly from: string',
      'readonly until: string',
    ])
  })
})

describe('what raising one gives back', () => {
  it('says whether the finding was already known', () => {
    // The field story 4.8 needs and cannot compute for itself. Mailing an alert
    // on every raise would emit a second alert for a finding already raised,
    // which is the sentence AD-13 forbids — the no-op would hold in the table
    // and fail in the inbox.
    expect(declaredMembers(source, 'RaisedFinding')).toEqual([
      'readonly id: string',
      'readonly wasAlreadyKnown: boolean',
    ])
  })
})

describe('epic 4 does not depend on epic 3', () => {
  /**
   * AC7, asserted rather than assumed.
   *
   * The project lead confirmed on 2026-08-12 that detection is deterministic:
   * SQL identifies the finding, templated prose describes it, and no reasoning
   * model is involved in FR-6, FR-7 or FR-8. SM-2's claim that *100%* of
   * mathematically exact duplicates are flagged is only falsifiable while that
   * stays true — a model in the path turns a measurable claim into a hopeful one.
   *
   * Scoped to the two production files this story ships, which is what can
   * honestly be checked today: there is no detector yet. When 4.2 adds one, this
   * list grows with it.
   *
   * Every form that loads a module, not just `from '…'` — the six shapes
   * `boundary.test.ts` found escaping its first version.
   */
  const REPO_ROOT = join(HERE, '..', '..')

  const PORT = join(REPO_ROOT, 'core', 'ports', 'finding.ts')
  const ADAPTER = join(REPO_ROOT, 'adapters', 'db', 'finding-postgres.ts')

  /**
   * Resolved to paths, never matched as text.
   *
   * `'core/answer'` as a substring is exactly the check that misses
   * `'../answer/grounded-answer'` — which is how this import would actually be
   * spelled from `core/ports/`. `boundary.test.ts` resolves for the same reason,
   * and this file's first version did not.
   */
  const MODEL_PATH = [
    { directory: join(REPO_ROOT, 'core', 'answer'), why: 'grounded answers are epic 3' },
    { directory: join(REPO_ROOT, 'adapters', 'agent'), why: 'the chat client is the model' },
    { directory: join(REPO_ROOT, 'catalog'), why: 'the catalog is the model-driven path' },
  ] as const

  /** Bare package specifiers that are a model however they are reached. */
  const MODEL_PACKAGES = ['gemini', 'anthropic', 'openai']

  /**
   * Every module specifier in `text`, **with comments blanked first**.
   *
   * The blanking is not tidiness. Without it this file's own prose — *"dismissed"
   * is indistinguishable from "hidden by whoever did not want it seen"* —
   * matches `from '…'`, and the port reports one import when it has none. That
   * mattered because the "did we read any imports at all?" control below was
   * satisfied by that sentence: the guard written to stop a vacuous pass was
   * itself passing on a comment. Raised by CodeRabbit.
   *
   * **Now `module-specifiers.ts`'s**, shared with the three other structural
   * guards rather than copied into each. The copies had already drifted — this
   * one matched only `'` and `"` while `sole-data-path.test.ts` had been widened
   * to backticks — and a guard one revision behind reports clean on exactly the
   * import the widening was for.
   */
  const specifiersIn = sharedSpecifiersIn

  /**
   * The specifiers in `text` that reach the model path, resolved from `from`.
   *
   * `@/` is the tsconfig alias for the repo root, so it is a relative import
   * wearing a different hat and has to resolve the same way.
   */
  function modelPathImports(text: string, from: string): string[] {
    const specifiers = specifiersIn(text)

    const resolved = specifiers.map((specifier) =>
      specifier.startsWith('.')
        ? resolve(dirname(from), specifier)
        : specifier.startsWith('@/')
          ? resolve(REPO_ROOT, specifier.slice(2))
          : specifier,
    )

    const reachesDirectory = resolved.filter((target) =>
      MODEL_PATH.some(({ directory }) => target === directory || target.startsWith(`${directory}${sep}`)),
    )
    const reachesPackage = specifiers.filter((specifier) =>
      MODEL_PACKAGES.some((name) => specifier.toLowerCase().includes(name)),
    )

    return [...reachesDirectory, ...reachesPackage]
  }

  /**
   * The control, and it is a planted violation rather than a count.
   *
   * A count of "did we find any imports" is what a comment can satisfy. What
   * cannot be faked is the scanner finding something that is really there, in
   * each spelling a model dependency could arrive in — the shape
   * `boundary.test.ts` adopted after five member forms escaped its first
   * version.
   */
  it.each([
    ['a relative import', "import '../answer/grounded-answer'"],
    ['an aliased import', "import { chat } from '@/adapters/agent/chat-client'"],
    ['a require', "const entries = require('../../catalog/entries')"],
    ['a dynamic import', "await import('@/core/answer/grounded-answer')"],
    ['a model package', "import { GoogleGenAI } from '@google/gemini'"],
  ])('sees a model dependency arriving as %s', (_label, line) => {
    expect(modelPathImports(line, PORT)).toHaveLength(1)
  })

  it('does not mistake prose for an import', () => {
    // The defect itself, kept as a case. This sentence is really in the port.
    const prose = '/** "dismissed" is indistinguishable from "hidden by whoever did not want it seen". */'

    expect(specifiersIn(prose)).toEqual([])
  })

  it('the port imports nothing at all', () => {
    // Stronger than "nothing on the model path", and true: `finding.ts` is types
    // and two error classes. Asserting the empty set means a future edit that
    // adds *any* dependency to this port has to come through this test, which is
    // the right place to argue about it.
    expect(specifiersIn(readFileSync(PORT, 'utf8'))).toEqual([])
  })

  /**
   * Story 4.2's production files, added because this test's own comment asked
   * for it: *"When 4.2 adds one, this list grows with it."* A detector is the
   * component the independence matters most for — SM-2 claims 100% of exact
   * duplicates are flagged, and a reasoning model cannot be held to a number.
   */
  const DETECTOR = [
    'core/detection/invoice-number.ts',
    'core/detection/duplicate-invoice.ts',
    'core/detection/detect-duplicates.ts',
    'core/ingestion/run-detection.ts',
    'core/ports/invoice-reader.ts',
    'adapters/db/invoice-reader-postgres.ts',
    // Story 4.3's vendor-spike half. The independence matters at least as much
    // here: the epic's claim is that an invoice is compared against a *computed*
    // trailing average, and a model asked to judge whether a bill "looks high"
    // is a different product with the same screen.
    'core/detection/vendor-spike.ts',
    'core/detection/detect-vendor-spikes.ts',
    'core/detection/detection-run.ts',
    // Story 4.4's dues half. The independence argument is sharpest here: this
    // detector's findings name a person, and a model asked whether someone
    // "seems behind on their dues" is a different product with the same screen.
    'core/detection/dues-shortfall.ts',
    'core/detection/detect-dues-shortfalls.ts',
    'core/ports/dues-reader.ts',
    'adapters/db/dues-reader-postgres.ts',
  ]

  it.each(DETECTOR)('%s reaches nothing on the model path', (file) => {
    const path = join(REPO_ROOT, file)

    expect(modelPathImports(readFileSync(path, 'utf8'), path)).toEqual([])
  })

  it('the adapter reaches nothing on the model path', () => {
    const text = readFileSync(ADAPTER, 'utf8')

    // A real control now: this file genuinely imports, and the count is taken
    // after comments are blanked.
    expect(specifiersIn(text).length).toBeGreaterThan(0)
    expect(modelPathImports(text, ADAPTER)).toEqual([])
  })
})

describe('the errors a reviewer can meet', () => {
  it('names the finding that was already reviewed', () => {
    // "This finding was already reviewed" is not something a board member can
    // act on when a page has shown them twelve. Both errors carry the id for the
    // same reason `StaleExtractionClaimError` does.
    const error = new AlreadyReviewedError('019ff70e-d6b6-762c-9026-bd311b7b2cf7')

    expect(error.message).toContain('019ff70e-d6b6-762c-9026-bd311b7b2cf7')
    expect(error.name).toBe('AlreadyReviewedError')
    expect(error.findingId).toBe('019ff70e-d6b6-762c-9026-bd311b7b2cf7')
  })

  it('is distinguishable from a finding that does not exist', () => {
    // Two failures a surface must not merge: "somebody got here first" is
    // ordinary and the page should show the existing review, while "no such
    // finding" means the id came from somewhere it should not have. A single
    // error type would make the second look like the first.
    const missing = new FindingNotFoundError('019ff70e-d6b6-762c-9026-bd311b7b2cf7')

    expect(missing).not.toBeInstanceOf(AlreadyReviewedError)
    expect(missing.name).toBe('FindingNotFoundError')
    expect(missing.message).toContain('019ff70e-d6b6-762c-9026-bd311b7b2cf7')
  })
})
