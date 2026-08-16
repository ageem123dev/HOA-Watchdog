/**
 * The message that arrives uninvited, and the two things it must never do.
 *
 * **It must not carry structure it did not intend.** AD-8 binds FR-8: extracted
 * values are data, never instructions. A vendor name lifted off a scanned
 * invoice goes into a subject line, and a subject line is where header injection
 * actually lands. The message is plain text so there is no markup to escape
 * into — that is the argument for the format, not an excuse to skip the
 * control-character rule.
 *
 * **It must not claim more than the system knows.** UX-DR23 forbids implying
 * certainty the system lacks, and NFR-2 underneath it means the system holds no
 * payment credential and can stop nothing. The negative assertions here are as
 * load-bearing as the positive ones: a test that checks what the copy *says*
 * passes against copy that also says something false.
 *
 * ## The title and the sentence are asserted against the other two surfaces
 *
 * Not against literals this file chose. Three surfaces describe one finding —
 * the dashboard row, the detail page and this — and `finding-view.ts` exists so
 * they cannot disagree. Asserting against `toFindingRow` and `toFindingDetail`
 * means a legitimate wording change updates all three together, and drift fails
 * here rather than in a board packet.
 */

import { describe, expect, it } from 'vitest'

import { findingRoute, isPublicRoute } from '../auth/route-policy'
import type { FindingDetail } from '../ports/finding-reader'
import { oneLine, toAlertEmail } from './alert-email'
import { toFindingDetail } from './detail-view'
import { POSSIBLE_DUPLICATE_INVOICE, toFindingRow } from './finding-view'

const BASE = 'https://watchdog.example.test'

const duplicate = (overrides: Partial<FindingDetail> = {}): FindingDetail => ({
  id: '0199a0f0-0000-7000-8000-000000000001',
  findingType: POSSIBLE_DUPLICATE_INVOICE,
  subjectId: '0199a0f0-0000-7000-8000-0000000000ff',
  period: { from: '2026-03-01', until: '2026-04-01' },
  evidence: {
    invoicesChecked: 12,
    pairs: [
      {
        vendorName: 'Coastal Landscaping',
        amount: '1240.00',
        issuedOn: '2026-03-04',
        matchReason: 'exact',
      },
    ],
  },
  raisedOn: '2026-03-11',
  reviewed: null,
  ...overrides,
})

describe('a value that came off a document cannot carry structure', () => {
  it('keeps an ordinary name exactly as it is', () => {
    expect(oneLine(`Coast${String.fromCodePoint(0x0b)}al`, 200)).toBe('Coast al')
  })

  /**
   * Every hostile input is built from an explicit code point rather than typed
   * as a literal.
   *
   * Not a style choice. A raw control byte in a source file is invisible in a
   * diff, survives review, and has reached this repository's source three times
   * -- most recently as a backspace inside a regex, which compiled fine and
   * matched nothing. `docs/no-control-characters.test.ts` exists for that defect
   * and reads markdown only, so it would not see one here.
   *
   * Written this way the fixture also says what it is testing: `0x85` is NEL,
   * which is a line break to more parsers than anyone expects.
   */
  const hostilePoints: readonly (readonly [string, readonly number[]])[] = [
    ['a line separator', [0x2028]],
    ['a paragraph separator', [0x2029]],
    ['a next-line control', [0x85]],
    ['a vertical tab', [0x0b]],
    ['a form feed', [0x0c]],
    ['a null byte', [0x00]],
    ['a delete', [0x7f]],
    ['a shift-out', [0x0e]],
    ['an escape', [0x1b]],
    ['a carriage return and newline', [0x0d, 0x0a]],
    ['a bare newline', [0x0a]],
    ['a bare carriage return', [0x0d]],
  ]

  it.each([
    ...hostilePoints.map(
      ([name, points]) =>
        [
          name,
          `Coastal${String.fromCodePoint(...points)}Bcc: attacker@example.test`,
        ] as const,
    ),
  ])('flattens %s', (_name, hostile) => {
    const flattened = oneLine(hostile, 200)

    // Asserted by code point rather than by eye: several of these are invisible
    // in a diff, and one of them is how this exact defect reached source three
    // times in this repository.
    for (const character of flattened) {
      const point = character.codePointAt(0)!
      expect(point).not.toBe(0x2028)
      expect(point).not.toBe(0x2029)
      // C0 except nothing — a single line has no business holding any of them —
      // plus DEL and the whole C1 block, which contains NEL.
      expect(point < 0x20 || (point >= 0x7f && point <= 0x9f)).toBe(false)
    }

    // The text survives; only the structure is removed. Dropping the tail
    // instead would hide a real vendor name from the board member who needs it.
    expect(flattened).toContain('Coastal')
    expect(flattened).toContain('attacker@example.test')
  })

  it('does not eat the character after a control', () => {
    // A strip written as a regex over "control plus one" would silently delete a
    // letter of a real name, and nothing downstream would ever report it.
    expect(oneLine(`Coast${String.fromCodePoint(0x00)}al`, 200)).toBe('Coast al')
  })

  it('collapses a tab so the label and value layout survives', () => {
    expect(oneLine('Coastal\tLandscaping', 200)).toBe('Coastal Landscaping')
  })

  it('trims, so a padded value does not look misaligned', () => {
    expect(oneLine('   Coastal Landscaping   ', 200)).toBe('Coastal Landscaping')
  })

  it('answers with nothing for a value that is only padding', () => {
    // Distinct from a value that is present. The caller drops the line rather
    // than printing a label with nothing after it.
    expect(oneLine('   \t  ', 200)).toBe('')
    expect(oneLine('', 200)).toBe('')
  })

  it('caps an oversized value and makes the truncation visible', () => {
    const capped = oneLine('x'.repeat(500), 40)

    expect(capped.length).toBeLessThanOrEqual(40)
    // Visible, because a sentence that stops mid-word without saying so reads as
    // a bug in the record rather than as a limit on the message.
    expect(capped.endsWith('…')).toBe(true)
  })

  it('does not split a surrogate pair at the cap', () => {
    // Slicing UTF-16 code units mid-pair yields a lone surrogate, which is not a
    // character and renders as a replacement box in the one place a board member
    // is reading a vendor's name.
    // **An even cap, so the cut lands mid-pair.** With an odd one the slice
    // boundary falls between two emoji and a code-unit implementation produces
    // no lone surrogate at all -- the test passes against the bug it exists to
    // catch. The first version of this test had exactly that defect, and the
    // sensitivity pass is what found it.
    const astral = '😀'.repeat(20)
    const capped = oneLine(astral, 12)

    // Code points, not code units. The cap counts characters a human sees, and
    // an emoji is one of those and two of the other -- asserting `.length` here
    // would be asserting the unit the implementation must *not* cut on.
    expect([...capped].length).toBeLessThanOrEqual(12)
    expect([...capped].every((character) => character.codePointAt(0)! !== 0xfffd)).toBe(true)
    expect(/[\uD800-\uDFFF]/.test(capped.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))).toBe(false)
  })
})

describe('the message a board member receives', () => {
  it('takes its title from the row rather than writing a second one', () => {
    // Cross-check against the other surface, not against a literal. A wording
    // change that is legitimate updates both; one that is drift fails here.
    const finding = duplicate()
    const email = toAlertEmail(finding, BASE)

    expect(email.subject).toContain(toFindingRow(finding).title)
  })

  it('carries the detail page sentence verbatim', () => {
    const finding = duplicate()
    const email = toAlertEmail(finding, BASE)
    const summary = toFindingDetail(finding).summary

    expect(summary).not.toBeNull()
    expect(email.text).toContain(summary!)
  })

  it('links to the finding absolutely, at the route the application owns', () => {
    const finding = duplicate()
    const email = toAlertEmail(finding, BASE)

    // Built from `findingRoute`, never re-spelled. A second spelling of the
    // detail path is a dead link discovered by the person the alert was for.
    const expected = new URL(findingRoute(finding.id), BASE).toString()

    expect(email.text).toContain(expected)
    expect(() => new URL(expected)).not.toThrow()
  })

  it('links to a route that is closed, so an old link lands on sign-in', () => {
    // The other half of AC4, asserted rather than assumed. The destination
    // names a vendor, an amount and a unit, so it must not be public -- and a
    // director opening a week-old email on a phone signs in and is returned
    // there, which is the already-reviewed state EXPERIENCE.md requires.
    //
    // `PUBLIC_ROUTES` is an allow-list, so this holds by the route's absence
    // from it. Checked here as well as in `route-policy.test.ts` because this is
    // the story that starts mailing the link out.
    expect(isPublicRoute(findingRoute('0199a0f0-0000-7000-8000-000000000001'))).toBe(false)
  })

  it('gives one link whether or not the base URL ends in a slash', () => {
    const finding = duplicate()

    const withSlash = toAlertEmail(finding, 'https://watchdog.example.test/')
    const without = toAlertEmail(finding, 'https://watchdog.example.test')

    expect(withSlash.text).toBe(without.text)
    expect(withSlash.text).not.toContain('//findings')
  })

  it('states the figures the detector recorded', () => {
    const email = toAlertEmail(duplicate(), BASE)

    expect(email.text).toContain('12')
  })

  it('says why it arrived, because there is no unsubscribe', () => {
    // Every board member receives every finding — decided rather than defaulted
    // into. A director who cannot tell this from spam is one who stops reading
    // the warnings, which is the same outcome as never sending them.
    const email = toAlertEmail(duplicate(), BASE)

    expect(email.text.toLowerCase()).toContain('every board member')
  })

  it('never claims an action the system cannot take', () => {
    // NFR-2: the system holds no payment credential and can stop nothing. This
    // is the negative that matters most, because the positive assertions above
    // all pass against copy that *also* says something false.
    const email = toAlertEmail(duplicate(), BASE)
    const whole = `${email.subject}\n${email.text}`.toLowerCase()

    for (const forbidden of [
      'blocked',
      'we have held',
      'on hold',
      'stopped',
      'cancelled',
      'canceled',
      'flagged to',
      'approved',
      'we paid',
      'prevented',
      'frozen',
    ]) {
      expect(whole).not.toContain(forbidden)
    }
  })

  it('does not upgrade a possible duplicate into a certainty', () => {
    // UX-DR23. The detector is exact and the claim still is not: an association
    // can legitimately pay one vendor the same amount on the same day.
    const email = toAlertEmail(duplicate(), BASE)
    const whole = `${email.subject}\n${email.text}`.toLowerCase()

    expect(whole).toContain('possible')
    expect(whole).not.toContain('you paid this twice')
    expect(whole).not.toContain('duplicate payment confirmed')
  })

  it('flattens a vendor name that tries to forge a header', () => {
    const email = toAlertEmail(
      duplicate({
        evidence: {
          invoicesChecked: 1,
          pairs: [
            {
              vendorName: 'Coastal\r\nBcc: attacker@example.test',
              amount: '1240.00',
              issuedOn: '2026-03-04',
              matchReason: 'exact',
            },
          ],
        },
      }),
      BASE,
    )

    expect(email.subject).not.toMatch(/[\r\n]/)
    expect(email.subject.split(/\r?\n/)).toHaveLength(1)
  })

  it('still names and links a finding whose type it does not recognise', () => {
    // `evidence` is jsonb written by whichever detector version ran. A mailer
    // that throws on one unfamiliar row never sends the nineteen good ones
    // behind it in the loop — the failure is not the plain message, it is the
    // silence.
    const finding = duplicate({ findingType: 'vendor_paid_before_approval', evidence: {} })

    const email = toAlertEmail(finding, BASE)

    expect(email.subject.length).toBeGreaterThan(0)
    expect(email.text).toContain(new URL(findingRoute(finding.id), BASE).toString())
  })

  it.each([
    ['a scalar', 42],
    ['an array', [1, 2, 3]],
    ['a string', 'not an object'],
    ['null', null],
  ])('does not throw on evidence that is %s', (_name, evidence) => {
    const finding = duplicate({ evidence })

    expect(() => toAlertEmail(finding, BASE)).not.toThrow()
  })

  it('leaves an absent figure absent rather than inventing a zero', () => {
    // `$0.00` received and "0 invoices checked" are each a statement the record
    // does not support, and the first is one a board member could act on.
    const email = toAlertEmail(duplicate({ evidence: { pairs: [] } }), BASE)

    expect(email.text).not.toContain('undefined')
    expect(email.text).not.toContain('null')
    expect(email.text).not.toMatch(/checked:\s*0\b/i)
  })

  it('omits a comparison block whose every record was unreadable', () => {
    // Reachable: `table()` returns null only when there are *no* rows, so a
    // stored pair that is present but holds nothing legible gives a row of all
    // nulls. The separator between rows is an empty string and survives the
    // null filter, so a naive block renders a caption with blank lines under it
    // -- a heading promising evidence that is not there. Raised by Argus.
    const email = toAlertEmail(duplicate({ evidence: { pairs: [{}, {}] } }), BASE)

    expect(email.text).not.toContain('The invoices that matched an earlier one')
    // And the message is still worth sending: it names the finding and links to
    // it, which is the whole point of degrading rather than throwing.
    expect(email.text).toContain('Open this finding:')
  })

  it('keeps a comparison block when some of its records are legible', () => {
    // The other side of the same rule. Dropping the block whenever *any* cell
    // is missing would be the over-correction, and it would hide real evidence.
    const email = toAlertEmail(
      duplicate({
        evidence: {
          pairs: [{}, { vendorName: 'Coastal Landscaping', amount: '1240.00' }],
        },
      }),
      BASE,
    )

    expect(email.text).toContain('The invoices that matched an earlier one')
    expect(email.text).toContain('Coastal Landscaping')
  })

  it('produces a subject that is one line whatever it was built from', () => {
    const email = toAlertEmail(duplicate(), BASE)

    expect(email.subject.split(/\r?\n/)).toHaveLength(1)
    expect(email.subject.trim()).toBe(email.subject)
  })
})
