// @vitest-environment jsdom

/**
 * The unreviewed findings list (UX-DR2, UX-DR4, UX-DR24).
 *
 * The rules being asserted are the ones that make this surface trustworthy
 * rather than merely present:
 *
 * - **A tick never carries meaning alone.** Every row states its severity in
 *   words, and a reader who perceives no colour loses nothing.
 * - **Reassurance always carries a count.** "Nothing needs your attention" is
 *   only allowed beside the number of documents that were checked.
 * - **The list never claims to be the register.** When it shows a window, it
 *   says so.
 *
 * Story 4.6 added the navigation, at the moment it built the destination —
 * **and every assertion above it still passes unchanged**, which is what AC1
 * asks for. The row's shape did not move to accommodate the link; the link was
 * wrapped around the shape.
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { findingRoute } from '@/core/auth/route-policy'
import type { DashboardView } from '@/core/findings/dashboard-view'
import type { FindingRow } from '@/core/findings/finding-view'
import { FindingsList } from './findings-list'

afterEach(cleanup)

function row(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    id: 'finding-1',
    severity: 'needs-review',
    severityLabel: 'Needs review',
    title: 'Possible duplicate invoice — Coastal Landscaping',
    evidenceLine: '1 of 3 invoices on this upload matches an earlier one on amount and date.',
    amount: '$1,450.00',
    raisedOn: '2026-04-14',
    ...overrides,
  }
}

function findings(rows: readonly FindingRow[], total = rows.length): DashboardView {
  return { kind: 'findings', rows, total, documentsChecked: 14, asOf: null }
}

describe('a finding row', () => {
  it('shows the title, the evidence line and the amount', () => {
    render(<FindingsList view={findings([row()])} />)

    expect(screen.getByText('Possible duplicate invoice — Coastal Landscaping')).toBeDefined()
    expect(screen.getByText(/1 of 3 invoices on this upload matches/)).toBeDefined()
    expect(screen.getByText('$1,450.00')).toBeDefined()
  })

  it('states its severity in words, not only in colour', () => {
    // **UX-DR2, and the clause that matters most.** "Never the sole carrier of
    // meaning" fails silently: the page looks right to whoever built it and
    // says nothing to a reader who does not perceive the colour.
    render(<FindingsList view={findings([row()])} />)

    expect(screen.getByText('Needs review')).toBeDefined()
  })

  it('never says HIGH or MED', () => {
    // DESIGN.md forbids both by name. Asserted rather than assumed, because
    // they are what a severity enum turns into when someone renders it directly.
    render(
      <FindingsList
        view={findings([
          row(),
          row({ id: 'finding-2', severity: 'worth-checking', severityLabel: 'Worth checking' }),
        ])}
      />,
    )

    expect(screen.queryByText(/\b(HIGH|MED|MEDIUM|LOW)\b/)).toBeNull()
  })

  it('draws its tick from the severity tokens', () => {
    // The colour half of UX-DR2. `core/design/no-raw-values.test.ts` already
    // forbids a raw hex here, so what is left to check is that the *right*
    // token is used — a tick that is always brass is a tick that says nothing.
    render(
      <FindingsList
        view={findings([
          row(),
          row({ id: 'finding-2', severity: 'worth-checking', severityLabel: 'Worth checking' }),
        ])}
      />,
    )

    const items = screen.getAllByRole('listitem')
    const styles = items.map((item) => item.querySelector('[aria-hidden]')?.getAttribute('style'))

    expect(styles[0]).toContain('--color-flag')
    expect(styles[1]).toContain('--color-brass')
  })

  it('hides the tick from the accessibility tree, because the words carry it', () => {
    // The other side of the same rule. Announcing the bar as well would read
    // the severity twice to a screen-reader user and once to everyone else.
    render(<FindingsList view={findings([row()])} />)

    const item = screen.getByRole('listitem')

    expect(item.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('sets the amount right-aligned and tabular', () => {
    // DESIGN.md: "[tick] [title + evidence line] [amount]", numerics tabular
    // and right-aligned. A money column that does not line up is one nobody can
    // scan, which is the only reason it is a column.
    render(<FindingsList view={findings([row()])} />)

    const amount = screen.getByText('$1,450.00').getAttribute('style')

    expect(amount).toContain('right')
    expect(amount).toContain('tabular-nums')
  })

  it('shows nothing at all where the record supports no amount', () => {
    // **AC5.** The row must not fall back to `$0.00`, `—`, `NaN` or a bare
    // currency mark. Each of those is a figure a board member could act on,
    // manufactured from a record that has none.
    render(<FindingsList view={findings([row({ amount: null })])} />)

    const item = screen.getByRole('listitem')

    expect(item.textContent).not.toMatch(/\$/)
    expect(item.textContent).not.toMatch(/NaN|null|undefined/)
  })

  it('renders a row whose evidence line could not be built', () => {
    // AC6 reaching the surface. The row degrades to title and severity rather
    // than disappearing or throwing.
    render(<FindingsList view={findings([row({ evidenceLine: null, amount: null })])} />)

    expect(screen.getByText('Possible duplicate invoice — Coastal Landscaping')).toBeDefined()
    expect(screen.getByRole('listitem')).toBeDefined()
  })

  it('renders a vendor name as text, whatever characters it contains', () => {
    // **AD-8 and AC10.** Extracted strings are escaped on output, never
    // interpolated. This fails against `dangerouslySetInnerHTML` and passes
    // against ordinary JSX, which is the distinction worth pinning.
    const hostile = 'Coastal <script>alert(1)</script> Landscaping'

    render(<FindingsList view={findings([row({ title: hostile })])} />)

    expect(screen.getByText(hostile)).toBeDefined()
    expect(document.querySelector('script')).toBeNull()
  })

  it('shows the date the finding was noticed', () => {
    // **EXPERIENCE.md, State Patterns: "Findings show their detection date."**
    // Found by the acceptance-criteria audit rather than by a test — the date
    // was read by the adapter, carried by the port, carried by the view, and
    // then never rendered. A queue whose entries have no date cannot be aged by
    // the person reading it, which is most of what a queue is for.
    render(<FindingsList view={findings([row()])} />)

    expect(screen.getByText(/2026-04-14/)).toBeDefined()
  })

  it('marks that date up as a date', () => {
    // A `<time>` with a machine-readable value, so the row is legible to a
    // screen reader and to anything that reads the page rather than looks at it.
    render(<FindingsList view={findings([row()])} />)

    const when = screen.getByRole('listitem').querySelector('time')

    expect(when?.getAttribute('datetime')).toBe('2026-04-14')
  })

  it('keeps the order it was given', () => {
    const rows = [row({ id: 'a', title: 'First' }), row({ id: 'b', title: 'Second' })]

    render(<FindingsList view={findings(rows)} />)

    const titles = screen.getAllByRole('listitem').map((item) => item.textContent)

    expect(titles[0]).toContain('First')
    expect(titles[1]).toContain('Second')
  })

  it('is a real list, so a screen reader can say how long it is', () => {
    render(<FindingsList view={findings([row(), row({ id: 'finding-2' })])} />)

    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('AC1: the whole row is the click target, and only the row', () => {
  it('takes the reader to that finding', () => {
    render(<FindingsList view={findings([row({ id: 'finding-7' })])} />)

    expect(screen.getByRole('link').getAttribute('href')).toBe(findingRoute('finding-7'))
  })

  it('has exactly one link per row, so the amount is not a separate target', () => {
    // **UX-DR4's clause worth asserting rather than assuming.** A second link
    // around the money would be a second tab stop with no separate meaning, and
    // it is the one a hurried reader's cursor is nearest to — so a mis-click
    // near the figure would do something a mis-click near the text does not.
    render(
      <FindingsList
        view={findings([
          row({ id: 'a', amount: '$1,450.00' }),
          row({ id: 'b', amount: null }),
        ])}
      />,
    )

    for (const item of screen.getAllByRole('listitem')) {
      expect(within(item).getAllByRole('link')).toHaveLength(1)
    }
  })

  it('puts the whole row inside the link, so a click anywhere on it navigates', () => {
    render(<FindingsList view={findings([row({ id: 'finding-7', amount: '$1,450.00' })])} />)

    const link = screen.getByRole('link')

    // The tick, the words, the evidence line, the date and the amount — the
    // click target is the row, not a phrase inside it.
    expect(link.textContent).toMatch(/Needs review/)
    expect(link.textContent).toMatch(/Possible duplicate invoice/)
    expect(link.textContent).toMatch(/\$1,450\.00/)
    expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(link.querySelector('time')).not.toBeNull()
  })

  it('encodes the id rather than pasting it into the path', () => {
    // Story 4.8 will send these links by email, and a route built by
    // concatenation from a value nobody encoded is one `../` from elsewhere.
    render(<FindingsList view={findings([row({ id: 'a/../b' })])} />)

    expect(screen.getByRole('link').getAttribute('href')).toBe('/findings/a%2F..%2Fb')
  })

  it('does not read as twenty separate destinations', () => {
    // An unstyled anchor renders the whole row in link blue and underlines it.
    render(<FindingsList view={findings([row()])} />)

    const link = screen.getByRole('link') as HTMLElement

    expect(link.style.textDecoration).toBe('none')
    expect(link.style.color).toBe('inherit')
  })
})

describe('what the list says about itself', () => {
  it('says how many need review', () => {
    render(<FindingsList view={findings([row(), row({ id: 'b' })])} />)

    expect(screen.getByText(/2 findings need review/i)).toBeDefined()
  })

  it('says so when it is showing only part of the queue', () => {
    // **The reason the port returns rows and total together.** Twenty rows
    // under a heading that says twenty, while thirty-seven are outstanding, is
    // a board member reasonably believing they have seen everything.
    render(<FindingsList view={findings([row(), row({ id: 'b' })], 37)} />)

    expect(screen.getByText(/37 findings need review/i)).toBeDefined()
    expect(screen.getByText(/showing the 2 most recent/i)).toBeDefined()
  })

  it('does not claim to be showing a window when it is showing all of them', () => {
    render(<FindingsList view={findings([row(), row({ id: 'b' })])} />)

    expect(screen.queryByText(/showing the/i)).toBeNull()
  })

  it('uses the singular for one finding', () => {
    render(<FindingsList view={findings([row()])} />)

    expect(screen.getByText(/1 finding needs review/i)).toBeDefined()
  })
})

describe('the two empty states', () => {
  it('says nothing has been checked before anything has been read', () => {
    render(<FindingsList view={{ kind: 'nothing-checked' }} />)

    expect(screen.getByText(/nothing has been checked yet/i)).toBeDefined()
  })

  it('offers the one action that helps, when nothing has been checked', () => {
    // EXPERIENCE.md: "Empty — nothing uploaded yet: single clear action." The
    // dashboard is not useful until something is uploaded and should say so.
    render(<FindingsList view={{ kind: 'nothing-checked' }} />)

    expect(screen.getByRole('link', { name: /upload/i }).getAttribute('href')).toBe('/upload')
  })

  it('never reassures in that state', () => {
    // The state exists precisely because "nothing needs your attention" would
    // be true here and would be read as an all-clear over records nobody has
    // looked at.
    render(<FindingsList view={{ kind: 'nothing-checked' }} />)

    expect(screen.queryByText(/nothing needs your attention/i)).toBeNull()
    expect(screen.queryByText(/all clear|you're all set|looks good/i)).toBeNull()
  })

  it('reassures only alongside the count of what was checked', () => {
    // **UX-DR24.** Both halves in one assertion pair, because the rule is not
    // "say something affirmative" — it is that the affirmation is worthless
    // without the denominator.
    render(<FindingsList view={{ kind: 'nothing-to-review', documentsChecked: 14, asOf: null }} />)

    expect(screen.getByText(/nothing needs your attention/i)).toBeDefined()
    expect(screen.getByText(/14 documents checked/i)).toBeDefined()
  })

  it('uses the singular for one document', () => {
    render(<FindingsList view={{ kind: 'nothing-to-review', documentsChecked: 1, asOf: null }} />)

    expect(screen.getByText(/1 document checked/i)).toBeDefined()
  })

  it('never says all clear', () => {
    // UX-DR24's named anti-pattern, and it is named because it is the phrase
    // everyone reaches for. The count is the whole content of the claim.
    render(<FindingsList view={{ kind: 'nothing-to-review', documentsChecked: 14, asOf: null }} />)

    expect(screen.queryByText(/all clear/i)).toBeNull()
  })
})
