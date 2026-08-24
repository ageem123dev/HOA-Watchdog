/**
 * The written upload contract agrees with the code that enforces it.
 *
 * AC3, and the whole reason this story is more than prose: **drift is the entire
 * failure mode.** Every number and every vocabulary in `upload-contract.md` is
 * already a constant somewhere in `core/`, and a document that restates one is a
 * second place for it to be true. This file makes the second place fail loudly
 * instead of quietly.
 *
 * The README's own history is the argument. It described a Supabase project four
 * weeks after Supabase was removed, and named three gates where there are five —
 * both true when written, neither true when read, and nothing anywhere failed.
 *
 * **Vocabularies are asserted exhaustively, never with `toContain`.** A document
 * listing four of five document kinds passes a containment check for each of the
 * four it does list. That is the shape this project has now deleted a dozen
 * times, and it is exactly the shape a documentation test invites.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  ACCEPTED_CONTENT_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_FILES_PER_UPLOAD,
  MAX_UPLOAD_BATCH_BYTES,
  REJECTION_REASONS,
} from '../core/ingestion/acceptance'
import {
  AMOUNT_PATTERN,
  DOCUMENT_KINDS,
  DOCUMENT_NUMBER_MAX_LENGTH,
  UNIT_REFERENCE_MAX_LENGTH,
  VENDOR_NAME_MAX_LENGTH,
} from '../core/extraction/record'
import { OPTIONAL_HEADERS, REQUIRED_HEADERS, TABULAR_PROBLEMS } from '../core/extraction/tabular'
import { MAX_ASSESSMENT_YEAR, ROLL_HEADERS } from '../core/extraction/roll'
import { BILLING_CYCLES } from '../core/assessment/billing-cycle'
import { HOLD_REASONS } from '../core/payment/resolve-line'
import { MAX_WORKBOOK_CELLS } from '../adapters/extraction/workbook-sheetjs'

const here = dirname(fileURLToPath(import.meta.url))
const contract = readFileSync(join(here, 'upload-contract.md'), 'utf8')

/** Every backticked token in the document, which is how it names a value. */
const quoted = (): ReadonlySet<string> =>
  new Set([...contract.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!))

/** The body of a named section, up to the next heading of any level. */
const section = (title: string): string => {
  const at = contract.indexOf(title)
  expect(at, `upload-contract.md has no section titled ${title}`).toBeGreaterThan(-1)

  const rest = contract.slice(at + title.length)
  const next = rest.search(/\n#{2,3} /)
  return next === -1 ? rest : rest.slice(0, next)
}

/**
 * The backticked codes in one column of a section's table.
 *
 * Read out of the document rather than matched against a pattern, which is the
 * second version of this helper. The first took a regex describing the family
 * and reported tokens matching it that were not members — and every call site
 * built that regex from the member list itself, so the stray set was empty by
 * construction and an invented `receipt` kind passed. A control test covered the
 * mechanism and every real call was shaped so it could never fire.
 *
 * Comparing against what the document actually tabulates has no such hole: a row
 * the code does not know is a code the document listed and cannot justify.
 */
const tabulated = (title: string, column = 1): string[] => {
  // Everything after the `| --- |` separator is a data row. The first version
  // skipped rows whose first cell began with a capital, meaning to skip the
  // header — and dropped every row of the Formats table, whose codes are PDF,
  // PNG and JPG. A filter that guesses at the header is a filter that silently
  // empties a table.
  const lines = [...section(title).matchAll(/^\|(.+)\|\s*$/gm)].map((row) =>
    row[1]!.split('|').map((cell) => cell.trim()),
  )
  const separator = lines.findIndex((cells) => /^-{3,}$/.test(cells[0]!))
  const rows = separator === -1 ? [] : lines.slice(separator + 1)

  // Column 1 is a code; later columns may be prose naming several codes. Return
  // the backticked code when there is one and the raw cell otherwise, so a
  // relation column ("Used by") can be read as well as a code column.
  // A cell that is exactly one backticked token is a code; anything else is
  // prose that may name several. Returning the code for the first and the raw
  // text for the second lets one helper read both a code column and a relation
  // column ("Used by"), which is what the roll-header check needs.
  return rows.map((cells) => {
    const cell = (cells[column - 1] ?? '').trim()
    const only = /^`([^`]+)`$/.exec(cell)
    return only ? only[1]! : cell
  })
}

/**
 * The document tabulates this vocabulary exactly: every member, and no row the
 * code does not have.
 */
const statesExactly = (members: readonly string[], title: string, column = 1): void => {
  const listed = tabulated(title, column).filter((code) => code !== '')

  expect(listed.length, `no table rows found under "${title}"`).toBeGreaterThan(0)

  const missing = members.filter((member) => !listed.includes(member))
  expect(missing, `absent from "${title}": ${missing.join(', ')}`).toEqual([])

  const strays = listed.filter((code) => !members.includes(code))
  expect(strays, `listed under "${title}" but not in the code: ${strays.join(', ')}`).toEqual([])
}

describe('the written contract states the limits the code enforces', () => {
  it('states the per-file size limit in the units a reader thinks in', () => {
    // 25 MiB, not 26214400. A reader comparing their file against a byte count
    // is a reader the document failed.
    expect(contract).toContain(`${MAX_DOCUMENT_BYTES / 1024 / 1024} MiB`)
  })

  it('states the per-batch size limit', () => {
    expect(contract).toContain(`${MAX_UPLOAD_BATCH_BYTES / 1024 / 1024} MiB`)
  })

  it('states how many files one upload may carry', () => {
    expect(contract).toContain(String(MAX_FILES_PER_UPLOAD))
  })

  it('states the workbook cell ceiling', () => {
    // Written with separators, as the source writes it: 500_000 unformatted is
    // a number a reader miscounts.
    expect(contract).toContain(MAX_WORKBOOK_CELLS.toLocaleString('en-US'))
  })

  it('states the latest assessment year a roll may name', () => {
    expect(contract).toContain(String(MAX_ASSESSMENT_YEAR))
  })

  it('states the three text bounds that refuse a row', () => {
    for (const bound of [
      VENDOR_NAME_MAX_LENGTH,
      DOCUMENT_NUMBER_MAX_LENGTH,
      UNIT_REFERENCE_MAX_LENGTH,
    ]) {
      expect(contract).toContain(String(bound))
    }
  })

  it('states the amount pattern as the code spells it', () => {
    // The pattern itself, not a paraphrase. "up to two decimal places" is a
    // description; `^-?\d{1,12}(\.\d{1,2})?$` is the rule, and story 2.4 lost a
    // provider call to a paraphrase of it that dropped its backslashes.
    expect(contract).toContain(AMOUNT_PATTERN)
  })
})

describe('the written contract states the vocabularies exhaustively', () => {
  it('names every content type it accepts, and no others', () => {
    statesExactly([...ACCEPTED_CONTENT_TYPES], '## Formats', 2)
  })

  it('names every document kind, and no others', () => {
    statesExactly([...DOCUMENT_KINDS], '### Document kinds')
  })

  it('names every required header, and no others', () => {
    statesExactly([...REQUIRED_HEADERS], '### Required columns')
  })

  it('names every optional header, and no others', () => {
    // `unit`, `cycle` and `year` reached this list in stories 2.5 and 2.7. A
    // contract written before either and never re-derived would pass a
    // containment check on the three it did know.
    statesExactly([...OPTIONAL_HEADERS], '### Optional columns')
  })

  it('documents exactly the roll-only columns the code declares', () => {
    // The first version asserted each roll header appeared *somewhere* in the
    // optional-columns table, which passes if the document drops the roll
    // relation entirely or attaches a header to the wrong kind. Raised by
    // review: a guard must fail when the guarded thing regresses.
    //
    // The documented relation is the "Used by" column, so read that. A row is
    // roll-only when it names `assessment_roll` and nothing else -- which is
    // what `ROLL_HEADERS` means, and is why `unit` (shared with `deposit`) must
    // not appear in this set.
    const codes = tabulated('### Optional columns', 1)
    const usedBy = tabulated('### Optional columns', 2)

    const rollOnly = codes.filter((_code, index) => {
      const audience = usedBy[index] ?? ''
      return audience.includes('assessment_roll') && !audience.includes('deposit')
    })

    expect(new Set(rollOnly)).toEqual(new Set(ROLL_HEADERS))
  })

  it('names every reason a file is refused outright, and no others', () => {
    statesExactly([...REJECTION_REASONS], '## Why a file is refused')
  })

  it('names every reason a table cannot be read, and no others', () => {
    statesExactly([...TABULAR_PROBLEMS], '## Why a table cannot be read')
  })

  it('names every reason a payment is held, and no others', () => {
    statesExactly([...HOLD_REASONS], '## Deposits: what happens to each line')
  })

  it('names every billing cycle, and no others', () => {
    // The shape admits `_`, which the first version did not. That omission is
    // how this page shipped two cycles where the code has three: the value was
    // derived with a grep whose character class excluded the underscore, so
    // `six_monthly` was invisible to the derivation *and* would have been
    // invisible to the stray check meant to catch it.
    statesExactly([...BILLING_CYCLES], '## Billing cycles')
  })
})

describe('the test itself', () => {
  it('reads a document with content in it', () => {
    // The control. If the file were missing or empty every `toContain` above
    // would fail loudly, but `statesExactly` on an empty document reports only
    // its missing members — which reads like a documentation gap rather than a
    // broken instrument.
    expect(contract.length).toBeGreaterThan(2000)
    expect(quoted().size).toBeGreaterThan(20)
  })

  it('reads real rows out of a real table', () => {
    // The control for the instrument. If `tabulated` returned nothing, every
    // "no strays" half below would pass vacuously — which is precisely how the
    // first version of this helper let an invented `receipt` kind through.
    // Compared as a set: the order rows appear in is a presentation choice, and
    // asserting it would make reordering the page a test failure.
    expect(tabulated('### Document kinds').sort()).toEqual([...DOCUMENT_KINDS].sort())
  })

  it('would notice a vocabulary member the document dropped', () => {
    // The message, not merely a throw. A bare `toThrow()` also passes when the
    // section is missing or the helper crashes -- it cannot tell "the guard
    // fired" from "the guard broke". Raised by review.
    expect(() => statesExactly(['a-kind-no-document-lists'], '### Document kinds')).toThrow(
      /absent from "### Document kinds": a-kind-no-document-lists/,
    )
  })

  it('would notice a row the code does not have', () => {
    // The direction the first version could never fail in: the document lists
    // five kinds, so a vocabulary of one must report the rest as strays -- and
    // the message must say so, or this passes on any unrelated failure.
    expect(() => statesExactly(['invoice'], '### Document kinds')).toThrow(
      /listed under "### Document kinds" but not in the code: .*statement/,
    )
  })
})

describe('the order it describes is the order the system enforces (story 5.8)', () => {
  /**
   * This section spent two epics telling the reader the order was "worth
   * following". Story 5.8 made it a refusal: a deposit upload is rejected until
   * an assessment roll has created units.
   *
   * A contract that still reads as advice after that is wrong in the direction
   * that matters -- it understates the system, so a reader plans around a
   * sequence the product will not accept and finds out at the upload.
   */
  const order = () => section('## Order matters on a fresh install')

  it('does not describe the order as optional', () => {
    expect(order()).not.toMatch(/worth following/i)
  })

  it('says a deposit upload is refused without units', () => {
    /**
     * Tied to all three of deposit, refusal and units in one match. `/refus/i`
     * alone was satisfied by this section's *other* uses of the word - including
     * the sentence explaining that refusing the roll would make the situation
     * permanent - so it would have passed against a document that never said
     * deposits are refused. Raised by CodeRabbit.
     */
    expect(order()).toMatch(/deposit upload is \*\*refused\*\* while the association holds\s+no units/i)
  })

  it('is reading the section it claims to read', () => {
    /**
     * The control. Both assertions above would pass against an empty string --
     * the negative one silently, which is the direction that hides a defect.
     *
     * `section()` is the file's own helper and stops at the next heading. The
     * first version of this sliced 1500 characters from `indexOf`, which is a
     * second answer to "where does a section end" and would have run into the
     * next section as soon as this one grew. Raised by ocr.
     */
    expect(order().length).toBeGreaterThan(0)
    expect(order()).not.toContain('## Billing cycles')
  })
})
