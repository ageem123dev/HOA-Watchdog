import type { ColorToken } from './tokens'

/**
 * Every token pairing this product uses for text.
 *
 * The list is explicit rather than derived from every possible combination:
 * measuring the cartesian product would report failures for pairings nobody
 * uses, and a gate that cries wolf is a gate someone deletes. Adding a pairing
 * here is how a colour combination becomes usable for text, and there is no
 * other way — `text-pairings.test.ts` measures each one and fails below 4.5:1.
 */

export interface TextPairing {
  readonly foreground: ColorToken
  readonly ground: ColorToken
  /** Where this pairing appears, so a failure names a real screen. */
  readonly usage: string
}

/** WCAG 2.2 SC 1.4.3 Contrast (Minimum), normal text. */
export const MINIMUM_TEXT_CONTRAST = 4.5

export const TEXT_PAIRINGS: readonly TextPairing[] = [
  { foreground: 'ink', ground: 'stone', usage: 'Body text and headings on the page ground' },
  { foreground: 'ink', ground: 'stone-raised', usage: 'Text on a raised plane — sheets, panels' },
  { foreground: 'ink-muted', ground: 'stone', usage: 'Labels and evidence sub-lines' },
  { foreground: 'ink-muted', ground: 'stone-raised', usage: 'Labels on a raised plane' },
  { foreground: 'on-ink', ground: 'ink', usage: 'Text on the masthead and inverted surfaces' },
  {
    foreground: 'ink',
    ground: 'on-ink',
    usage: 'Typed text in a form field, whose ground is white rather than the sheet',
  },
  { foreground: 'flag', ground: 'stone', usage: 'Error text and high-severity labels' },
  { foreground: 'flag', ground: 'stone-raised', usage: 'Error text on a raised plane' },
  { foreground: 'flag', ground: 'flag-tint', usage: 'Error text within a flag-tinted block' },
  { foreground: 'brass', ground: 'stone', usage: 'Medium-severity labels, register affordances' },
  { foreground: 'brass', ground: 'stone-raised', usage: 'Medium-severity labels on a raised plane' },
  { foreground: 'brass', ground: 'brass-tint', usage: 'Text within a brass-tinted block' },
  { foreground: 'affirm', ground: 'stone', usage: 'Reconciled and resolved state text' },
  { foreground: 'affirm', ground: 'stone-raised', usage: 'Reconciled state text on a raised plane' },
]

/** WCAG 2.2 SC 1.4.11 Non-text Contrast — user-interface component boundaries. */
export const MINIMUM_NON_TEXT_CONTRAST = 3

/**
 * Colours used to draw a control's boundary rather than its text. These identify
 * a component, so they answer to 1.4.11's 3:1 rather than 1.4.3's 4.5:1.
 */
export const NON_TEXT_PAIRINGS: readonly TextPairing[] = [
  {
    foreground: 'rule-strong',
    ground: 'stone-raised',
    usage: 'Input and control boundaries on a raised sheet',
  },
  { foreground: 'rule-strong', ground: 'stone', usage: 'Control boundaries on the page ground' },
]

/**
 * A conformance gap in the palette itself, recorded rather than silently
 * tolerated or unilaterally "fixed".
 *
 * DESIGN.md §Components specifies `rule-strong` as the hairline border for
 * controls. Measured, it is **2.13:1 on stone and 2.40:1 on stone-raised** —
 * below SC 1.4.11's 3:1 floor for the visual information that identifies a user
 * interface component. The white field ground does not rescue it either: white
 * against stone-raised is about 1.07:1, so the border is doing essentially all
 * the work of saying "this is an input".
 *
 * This cannot be fixed from code without either changing a token (which would
 * break parity with DESIGN.md) or ignoring the component specification. It is a
 * design decision and is flagged for one.
 *
 * The measured values are pinned below. If the palette changes, the pin fails
 * and whoever changed it must come back here and delete the exception — which is
 * the point: an exception nobody is forced to revisit becomes permanent.
 */
export const KNOWN_NON_TEXT_GAPS: readonly {
  foreground: ColorToken
  ground: ColorToken
  measured: number
  reason: string
}[] = [
  {
    foreground: 'rule-strong',
    ground: 'stone',
    measured: 2.13,
    reason:
      'DESIGN.md specifies rule-strong for control boundaries; it falls short of SC 1.4.11. Needs a design decision, not a code change.',
  },
  {
    foreground: 'rule-strong',
    ground: 'stone-raised',
    measured: 2.4,
    reason:
      'As above, on a raised sheet — the ground the sign-in form actually uses.',
  },
]

/**
 * Rejected at design time and kept here so the rejection is enforced rather than
 * remembered. DESIGN.md records that the direction's original brass measured
 * ≈2.9:1 against stone and "was **rejected for text and indicator use**".
 * Without a test, a future contributor finds a prettier brass in a mockup and
 * reinstates it, believing the darker value was an oversight.
 */
export const REJECTED_TEXT_COLORS: readonly { hex: string; reason: string }[] = [
  {
    hex: '#A47E3B',
    reason:
      "The direction's original brass. Measures about 2.9:1 on stone — below the 4.5:1 floor — and survives only as brass-tint, which may never carry meaning alone.",
  },
]
