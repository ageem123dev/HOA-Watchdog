/**
 * The register's copy, and which of its three states applies (AC1, AC2, AC3, AC7).
 *
 * ## Two empty screens, not one
 *
 * `rows.length === 0` is true for an untouched register *and* for a search that
 * matched nothing, and they owe a board member opposite sentences: one says
 * findings arrive here after review, the other says this search found none.
 * A surface branching on the row count tells somebody who searched for a vendor
 * that nothing has ever been reviewed — reassurance about the whole record, in
 * answer to a question about one vendor. `core/findings/dashboard-view.ts` was
 * built against the same shape of mistake and this mirrors it.
 *
 * ## The copy is cross-checked, not restated
 *
 * This is the *fourth* surface to describe a finding. The assertions below
 * compare against `toFindingRow` and `reviewMessage` rather than against
 * literals chosen here, so they fail when the surfaces drift apart rather than
 * when somebody rewords a fixture.
 */

import { describe, expect, it } from 'vitest'

import type { FindingDetail, ReviewedRegister } from '@/core/ports/finding-reader'
import { toFindingRow } from './finding-view'
import { toRegisterView } from './register-view'
import { reviewMessage } from './review'

function finding(overrides: Partial<FindingDetail> = {}): FindingDetail {
  return {
    id: 'finding-1',
    findingType: 'possible_duplicate_invoice',
    subjectId: 'document-1',
    period: { from: '2026-04-01', until: '2026-05-01' },
    evidence: {
      invoicesChecked: 3,
      pairs: [{ reason: 'same-amount-and-date', vendorName: 'Coastal Landscaping', amount: '1450.00' }],
    },
    raisedOn: '2026-04-14',
    reviewed: { by: 'R. Mbeki', on: '2026-04-20' },
    ...overrides,
  }
}

function register(
  findings: readonly FindingDetail[] = [finding()],
  total = findings.length,
): ReviewedRegister {
  return { findings, total }
}

describe('the three states are told apart', () => {
  it('says nothing has been reviewed yet when the register is empty', () => {
    const view = toRegisterView(register([], 0), undefined)

    expect(view.kind).toBe('nothing-reviewed')
  })

  it('says a search found nothing, which is a different state entirely', () => {
    // **The defect this exists to prevent.** Both have zero rows; only one of
    // them is about the whole record.
    const view = toRegisterView(register([], 0), 'Coastal')

    expect(view.kind).toBe('no-matches')
  })

  it('names the search back, so the reader knows what found nothing', () => {
    const view = toRegisterView(register([], 0), 'Coastal')

    expect(view.kind === 'no-matches' && view.search).toBe('Coastal')
  })

  it('never reassures somebody who was searching', () => {
    // Reassurance about the whole record, in answer to a question about one
    // vendor, is the worst available answer here.
    const view = toRegisterView(register([], 0), 'Coastal')

    expect(view.kind).not.toBe('nothing-reviewed')
  })

  it.each([undefined, '', '   '])('treats a search of %o as no search at all', (search) => {
    // A blank box submits on every press of the button. The state is "the
    // register is empty", not "no matches for three spaces".
    expect(toRegisterView(register([], 0), search).kind).toBe('nothing-reviewed')
  })

  it('shows the rows when there are any', () => {
    expect(toRegisterView(register()).kind).toBe('entries')
  })

  it('shows rows even when a search is applied, rather than falling to a no-match state', () => {
    expect(toRegisterView(register(), 'Coastal').kind).toBe('entries')
  })
})

describe('a register entry says the same things the other surfaces say', () => {
  it('carries the row copy verbatim, rather than a fourth wording of it', () => {
    // Cross-check against the existing implementation. A literal here would
    // pass while the dashboard and the register drifted apart, which is the
    // whole defect.
    const record = finding()
    const view = toRegisterView(register([record]))
    const row = toFindingRow(record)

    expect(view.kind === 'entries' && view.entries[0]?.row).toEqual(row)
  })

  it('attributes the review in the words the detail page uses', () => {
    const record = finding({ reviewed: { by: 'R. Mbeki', on: '2026-04-20' } })
    const view = toRegisterView(register([record]))

    expect(view.kind === 'entries' && view.entries[0]?.reviewed).toEqual(
      reviewMessage({ outcome: 'already-reviewed', by: 'R. Mbeki', on: '2026-04-20' }),
    )
  })

  it('says what is known when the reviewer had no display name', () => {
    const record = finding({ reviewed: { by: null, on: '2026-04-20' } })
    const view = toRegisterView(register([record]))
    const entry = view.kind === 'entries' ? view.entries[0] : undefined

    expect(entry?.reviewed?.text).toBe('Already reviewed on 2026-04-20.')
    expect(entry?.reviewed?.text).not.toMatch(/null|undefined/i)
  })

  it('does not invent an attribution for a row that arrived without one', () => {
    // The port permits `reviewed: null` on the type, and a register row should
    // never be the place that discovers it by printing "null".
    const view = toRegisterView(register([finding({ reviewed: null })]))
    const entry = view.kind === 'entries' ? view.entries[0] : undefined

    expect(entry?.reviewed).toBeNull()

    // The second assertion here used to run `/null"|"undefined/` over
    // `JSON.stringify(view)`, which cannot fail: the absent review serialises
    // as `"reviewed":null` and matches neither alternative. It passed for the
    // correct output and for the regression alike. What it was reaching for is
    // that no *rendered* string in the row says "null" — so that is what it
    // asserts, over the copy a board member actually reads. Raised by
    // CodeRabbit.
    const copy = Object.entries(entry?.row ?? {}).filter(
      ([, value]) => typeof value === 'string',
    )

    // A loop over an empty list passes without asserting anything, and this
    // project has shipped that shape before.
    expect(copy.length, 'no row copy was examined').toBeGreaterThan(0)

    for (const [field, value] of copy) {
      expect(value, `the ${field} a board member reads`).not.toMatch(/\b(null|undefined)\b/i)
    }
  })

  it('keeps the order the register gave them', () => {
    const first = finding({ id: 'a' })
    const second = finding({ id: 'b' })
    const view = toRegisterView(register([first, second]))

    expect(view.kind === 'entries' && view.entries.map((entry) => entry.row.id)).toEqual(['a', 'b'])
  })
})

describe('what the surface is allowed to claim about size', () => {
  it('carries the total, which is what the export states', () => {
    // AC4: the export control names the count of what will be in the file, and
    // that is every match — not the page the reader happens to be looking at.
    const view = toRegisterView(register([finding()], 37))

    expect(view.kind === 'entries' && view.total).toBe(37)
  })

  it('knows when it is showing only part of the register', () => {
    const view = toRegisterView(register([finding()], 37))

    expect(view.kind === 'entries' && view.showingAll).toBe(false)
  })

  it('knows when it is showing all of it', () => {
    const view = toRegisterView(register([finding()], 1))

    expect(view.kind === 'entries' && view.showingAll).toBe(true)
  })

  it('does not present zero rows over a non-zero total as an ordinary state', () => {
    // A contradiction: the register says 37 match and handed back none. It is
    // not "nothing reviewed" and not "no matches" — reporting it as either
    // would tell a board member something the record does not support. The
    // dashboard hit the same disagreement and Argus raised it there.
    expect(() => toRegisterView(register([], 37))).toThrow(RangeError)
  })
})

describe('what arrives from outside the type system', () => {
  // `search` comes off a URL and the register comes off a port. Both are typed,
  // and both have a caller that can be wrong: `?search=a&search=b` hands Next.js
  // an **array**, and a port implementation is free to omit a field the type
  // says is `| null`. `core/auth/route-policy.ts` defends its own typed
  // parameters for the same reason — it sits behind a URL too. Raised by Argus.

  it.each([
    ['an array, as a repeated query parameter gives', ['Coastal', 'Harbour']],
    ['a number', 7],
    ['null', null],
    ['an object', { search: 'Coastal' }],
  ])('treats a search that arrived as %s as no search at all', (_name, search) => {
    // Not a throw. This is a read-only surface reached by a URL people edit and
    // share, and an error page because somebody repeated a parameter is a worse
    // answer than the unfiltered register. `app/access-log/filter.ts` makes the
    // same call for a malformed limit.
    const view = toRegisterView(register([], 0), search as never)

    expect(view.kind).toBe('nothing-reviewed')
  })

  it('still renders when a row arrives with no review field at all', () => {
    // `undefined` is not `null`, so a strict check falls through to reading
    // `.by` off nothing. The port's type forbids it; a register row is the
    // wrong place to find out that a port disagreed.
    const view = toRegisterView(register([finding({ reviewed: undefined as never })]))
    const entry = view.kind === 'entries' ? view.entries[0] : undefined

    expect(entry?.reviewed).toBeNull()
  })

  it('refuses a register holding more rows than it says it has', () => {
    // The mirror of the contradiction above, and refused for the same reason:
    // a register reporting fewer matches than it handed back cannot state its
    // own size, and this is the surface an auditor is handed. Unreachable
    // through the adapter — `count(*) over ()` cannot be smaller than the rows
    // it counted — which is why it is a refusal rather than a repair.
    expect(() => toRegisterView(register([finding(), finding({ id: 'b' })], 1))).toThrow(RangeError)
  })

  it.each([
    ['not a number at all', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['fractional', 2.5],
  ])('refuses a total that is %s', (_name, total) => {
    // **These slip past both guards above rather than tripping them.**
    // `NaN > 0` is false and `rows > NaN` is false, so a non-finite total
    // satisfies every contradiction check and arrives at the page as the
    // figure printed beside a board member's findings. Raised by Argus.
    expect(() => toRegisterView(register([finding()], total))).toThrow(RangeError)
  })
})

describe('the search text is carried, not interpreted', () => {
  it('passes a hostile string through unaltered', () => {
    // Escaped here as well as by React, it would reach the page double-escaped
    // and the reader would see markup instead of what they typed.
    const hostile = '<script>alert(1)</script>'
    const view = toRegisterView(register([], 0), hostile)

    expect(view.kind === 'no-matches' && view.search).toBe(hostile)
  })

  it('trims what it echoes, so the quotes around it are not padded', () => {
    const view = toRegisterView(register([], 0), '  Coastal  ')

    expect(view.kind === 'no-matches' && view.search).toBe('Coastal')
  })
})
