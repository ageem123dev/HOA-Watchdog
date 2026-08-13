/**
 * What the dashboard is allowed to hold.
 *
 * Types and prose, so what can be checked is the shape of the declarations —
 * and here the shape carries the two arguments this story turns on:
 *
 * - **The surface that lists findings cannot act on them.** `finding.ts` splits
 *   raising from reviewing so a detector cannot sign off its own work; the same
 *   split applies to reading. A page holding one object that both lists the
 *   queue and empties it is one refactor from a dashboard that clears itself.
 * - **The rows and their total arrive together.** The dashboard is a bounded
 *   queue over an unbounded register, so a caller who could obtain the rows
 *   without the count could show twenty and let a board member believe that was
 *   all of them.
 *
 * The helper is `core/ports/declared-members.ts`, which has its own tests.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { declaredMembers } from './declared-members'

const HERE = dirname(fileURLToPath(import.meta.url))
const findingSource = readFileSync(join(HERE, 'finding-reader.ts'), 'utf8')
const documentSource = readFileSync(join(HERE, 'checked-documents.ts'), 'utf8')

describe('the FindingReader port', () => {
  it('declares exactly the two reads a surface needs', () => {
    // Reading the queue and reading one finding are the same *capability* —
    // both are reads of the register — so they sit on one port. The split this
    // file exists to defend is read from write, and it is asserted below.
    expect(declaredMembers(findingSource, 'FindingReader')).toEqual([
      'unreviewed(limit: number): Promise<UnreviewedQueue>',
      'byId(id: string): Promise<FindingDetail | null>',
    ])
  })

  it('answers with nothing for any finding that does not exist', () => {
    // `| null` rather than a throw, and it is a contract rather than a style.
    // "No such finding" is an ordinary outcome on a surface reached by a link
    // somebody kept — story 4.8 sends those links — and it has to be
    // distinguishable from a finding that exists and has been reviewed. A
    // rejection would merge the two at the call site.
    //
    // **Written as a property over every member, not as a substring of the
    // list.** The previous version asserted the joined list *contained* one
    // exact signature, which the exact-list assertion above already implies —
    // it could not fail unless that one did too. This version survives the
    // list legitimately changing: add a `latest(): Promise<FindingDetail>` and
    // update the array above, and this still refuses it. Raised by CodeRabbit,
    // and it is the same argument the `cannot review` test below already makes
    // for itself.
    const returningOne = declaredMembers(findingSource, 'FindingReader').filter((member) =>
      member.includes('FindingDetail'),
    )

    expect(returningOne.length).toBeGreaterThan(0)
    for (const member of returningOne) {
      expect(member).toMatch(/Promise<FindingDetail \| null>/)
    }
  })

  it('cannot review, raise, or remove anything', () => {
    // Not a restatement of the assertion above. That one pins the exact line;
    // this names *what the list being one long buys* — so an edit adding
    // `markReviewed` here has to argue with a test that says what it costs.
    const members = declaredMembers(findingSource, 'FindingReader').join(' ')

    // Anchored on word boundaries, because the bare substring `review` is
    // inside `unreviewed` — the one member this port is *supposed* to have. An
    // unanchored pattern here fails against the correct design, which is how a
    // test gets loosened until it forbids nothing at all.
    //
    // `remove` and `clear` are here because the first version of this list left
    // them out while the test's own name promised them, so `removeFinding` would
    // have passed the guard against removal. `clear` is EXPERIENCE.md's word:
    // "Nothing is ever deleted or cleared by disagreement."
    expect(members).not.toMatch(/\b(mark|review|raise|remove|clear|delete|dismiss|resolve)/i)
  })

  it('hands back the rows and their total as one value', () => {
    // Failure mode 2. `unreviewed` returns a queue rather than an array, so
    // there is no shape in which a caller holds the rows and not the count.
    // A page that renders a bounded list under a figure block reading "37"
    // must be able to say which of those two numbers it is showing.
    expect(declaredMembers(findingSource, 'UnreviewedQueue')).toEqual([
      'readonly findings: readonly FindingRecord[]',
      'readonly total: number',
    ])
  })

  it('carries the lifecycle on the detail, and only on the detail', () => {
    // The queue returns unreviewed findings by definition, so a `reviewed`
    // field on `FindingRecord` would be a field that is always null on the one
    // surface that reads it — and a surface that starts trusting it there would
    // be trusting an accident. The detail is the only read that can see a
    // reviewed finding, so it is the only shape that describes one.
    expect(declaredMembers(findingSource, 'FindingRecord').join(' ')).not.toMatch(/reviewed/i)
    expect(declaredMembers(findingSource, 'FindingDetail')).toEqual([
      'readonly reviewed: Reviewed | null',
    ])
  })

  it('names who reviewed it and allows them to be nameless', () => {
    // `board_member.display_name` is nullable, so a reviewed finding whose
    // reviewer never had a name still has to render. Saying what is known beats
    // inventing a name on the one surface that answers "which human".
    expect(declaredMembers(findingSource, 'Reviewed')).toEqual([
      'readonly by: string | null',
      'readonly on: string',
    ])
  })

  it('carries evidence as unknown, so nothing can read it carelessly', () => {
    // Failure mode 3, and AC6 made structural rather than remembered. Migration
    // 021 constrains the column to a JSON object, so `Record<string, unknown>`
    // would be true of every row this code has ever written — and would still
    // let a view reach for `.kind` on a finding raised by a detector that never
    // had one. `unknown` makes that a compile error instead of a blank row on
    // the board's dashboard.
    expect(declaredMembers(findingSource, 'FindingRecord')).toContain(
      'readonly evidence: unknown',
    )
  })
})

describe('the CheckedDocuments port', () => {
  it('answers what was checked, and nothing about findings', () => {
    // Failure mode 4. UX-DR24's count is about documents, so it is read through
    // a port named for documents. Hung off the finding reader it would be a
    // number nobody owns, of the kind that drifts without anything noticing.
    // The exact list is the whole assertion. A `not.toMatch(/finding/i)` sat
    // beside it and could not fail: `toEqual` had already pinned every member,
    // so nothing named for a finding could be present for it to catch. A guard
    // that proves nothing, which is this project's most-repaired defect —
    // raised by CodeRabbit, and correctly.
    expect(declaredMembers(documentSource, 'CheckedDocuments')).toEqual([
      'checked(): Promise<DocumentsChecked>',
    ])
  })

  it('carries the date the most recent one arrived, and allows it to be absent', () => {
    // `null` is the before-first-upload case, which AC7 makes a distinct empty
    // state. A port that could not express it would force the adapter to
    // invent a date, and the figure block would carry an "as of" that no
    // document supports.
    expect(declaredMembers(documentSource, 'DocumentsChecked')).toEqual([
      'readonly count: number',
      'readonly latestUploadOn: string | null',
    ])
  })
})
