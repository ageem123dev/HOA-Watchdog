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
    // list.** The first version asserted the joined list *contained* one exact
    // signature, which the exact-list assertion above already implies — it
    // could not fail unless that one did too. This survives the list
    // legitimately changing: add a `latest(): Promise<FindingDetail>` and
    // update the array above, and this still refuses it. Raised by CodeRabbit,
    // and it is the same argument the `cannot review` test below makes for
    // itself.
    //
    // **Matched on the return type, not on the whole declaration.** The second
    // version filtered on any member *mentioning* `FindingDetail`, which is a
    // different claim from the one the variable's name makes: it would have
    // failed a member that merely took one as a parameter, and a
    // `Promise<readonly FindingDetail[]>` that legitimately answers `[]` rather
    // than null. A test that refuses a correct design is as broken as one that
    // admits a wrong one. Also raised by CodeRabbit, in the fix for its own
    // previous finding.
    // **The text after the last colon**, which is the return type of a method
    // (`byId(id: string): T`) and of a property alike (`readonly latest: T`).
    // Slicing on `'): '` instead — the previous version — found nothing in a
    // property, so a `readonly latest: Promise<FindingDetail>` was dropped
    // before the assertion ever saw it. `declared-members.ts` returns *lines*
    // precisely because a function-typed property is how a capability sneaks
    // onto a port; its own header records five review rounds finding five such
    // forms. Raised by Argus.
    //
    // Bounded, deliberately: a return type containing its own colon would
    // confuse this, and none exists here. `declared-members.ts` refuses to grow
    // into a type parser for the same reason, and the exact-list assertion
    // above is what pins the signatures.
    const returnTypeOf = (member: string): string => {
      const line = member.replace(/[;,]\s*$/, '')

      // **The last colon, then the arrow inside what that leaves — in that
      // order.** The colon gets the return type of a method
      // (`byId(id: string): T`) and of a plain property (`latest: T`) alike.
      // The arrow then unwraps a function-typed property, whose own parameters
      // carry colons that would otherwise win: `latest: (id: string) => T`
      // reduced to `string) => T`, which failed the union check and rejected a
      // correct design.
      //
      // Doing the arrow first instead — the previous version — reaches for a
      // *parameter's* arrow on a method taking a callback
      // (`find(cb: (f: T) => boolean): Promise<…>`), which is the same
      // false-positive one level further out. Both raised by CodeRabbit.
      const last = (line.split(':').pop() ?? '').trim()

      return last.includes('=>') ? (last.split('=>').pop() ?? '').trim() : last
    }

    // **No member is optional, and that is checked before anything else.** A
    // `byId?:` adds `undefined` to whatever follows the colon, so the union
    // check below would read `FindingDetail | null` and call it exact while the
    // caller could still be handed a third thing. Asserted on the name side of
    // the colon, where the `?` actually lives, rather than threaded through the
    // parsing. Raised by Argus.
    const optional = declaredMembers(findingSource, 'FindingReader').filter((member) =>
      /\?\s*[:(]/.test(member),
    )
    expect(optional, 'an optional member admits undefined').toEqual([])

    // A list of them, in either spelling. Excluded on purpose: a list answers
    // "none" with `[]` and owes nobody a null. `Array<…>` and `ReadonlyArray<…>`
    // join `T[]` here because leaving them out made this reject a correct
    // design rather than admit a wrong one — the same false-positive direction
    // as the arrow above. Raised by CodeRabbit, having been skipped once on the
    // grounds that this codebase spells lists `readonly T[]`; it still does,
    // and the exclusion is a line of regex.
    const isList = /\b(?:Readonly)?Array<\s*FindingDetail\b|\bFindingDetail\[\]/

    // Anything handing back a single detail, however the union is ordered and
    // whether or not it is awaited.
    const returningOne = declaredMembers(findingSource, 'FindingReader')
      .map((member) => ({ member, returns: returnTypeOf(member) }))
      .filter(({ returns }) => /\bFindingDetail\b/.test(returns) && !isList.test(returns))

    expect(returningOne.length).toBeGreaterThan(0)

    for (const { member, returns } of returningOne) {
      // **The union is exactly these two.** Asserting only that `| null` is in
      // there somewhere lets `Promise<FindingDetail | null | undefined>` pass,
      // and `undefined` is the second absent-value this port exists to not
      // have — "no such finding" would then arrive in two spellings and every
      // caller would have to handle both. Raised by Argus.
      const union = returns
        .replace(/^Promise<\s*/, '')
        .replace(/>\s*$/, '')
        .split('|')
        .map((part) => part.trim())
        .sort()

      expect(union, member).toEqual(['FindingDetail', 'null'])
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
    // **Split at camelCase boundaries first**, because `\b` does not find one
    // inside an identifier: `autoResolve` and `bulkDelete` both walked straight
    // past this guard, which is the whole defect it exists to prevent wearing
    // the casing convention every method here uses. Splitting first keeps the
    // `unreviewed` exemption intact — there is still no boundary before
    // `review` inside it. Raised by Argus.
    const asWords = members
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      // And inside an acronym run, so `IDRemove` splits before `Remove`.
      .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')

    expect(asWords).not.toMatch(/\b(mark|review|raise|remove|clear|delete|dismiss|resolve)/i)
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
