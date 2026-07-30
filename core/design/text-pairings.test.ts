/**
 * The automated contrast check AC3 requires.
 *
 * This is the only acceptance criterion in the visual foundation that can fail
 * silently in production: a colour that looks fine on the implementer's monitor
 * and measures 3.8:1 is a conformance failure nobody notices until an audit.
 * Weakening or deleting this file removes the only thing standing between the
 * token set and that outcome.
 */

import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'
import {
  MINIMUM_TEXT_CONTRAST,
  REJECTED_TEXT_COLORS,
  TEXT_PAIRINGS,
  type TextPairing,
} from './text-pairings'
import { colors, type ColorToken } from './tokens'

const describePairing = (pairing: TextPairing) =>
  `${pairing.foreground} on ${pairing.ground}`

describe('declared text pairings', () => {
  it('is not empty — an empty list would make this gate vacuous', () => {
    expect(TEXT_PAIRINGS.length).toBeGreaterThan(0)
  })

  it('names only real tokens', () => {
    for (const pairing of TEXT_PAIRINGS) {
      expect(colors, describePairing(pairing)).toHaveProperty(pairing.foreground)
      expect(colors, describePairing(pairing)).toHaveProperty(pairing.ground)
    }
  })

  it('declares no pairing twice', () => {
    const keys = TEXT_PAIRINGS.map(describePairing)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('says where each pairing is used, so a failure names a real screen', () => {
    for (const pairing of TEXT_PAIRINGS) {
      expect(pairing.usage.length, describePairing(pairing)).toBeGreaterThan(0)
    }
  })

  /**
   * Coverage against vacuity from the other direction: every colour DESIGN.md
   * assigns to text must appear as a foreground somewhere. A token that is used
   * for text but never declared here is measured by nothing.
   */
  it('covers every colour token that carries text', () => {
    const textColors: ColorToken[] = ['ink', 'ink-muted', 'on-ink', 'flag', 'brass', 'affirm']
    const declared = new Set(TEXT_PAIRINGS.map((pairing) => pairing.foreground))

    for (const token of textColors) {
      expect(declared, `${token} is used for text but has no declared pairing`).toContain(token)
    }
  })
})

describe('contrast floor', () => {
  it.each(TEXT_PAIRINGS.map((pairing) => [describePairing(pairing), pairing] as const))(
    '%s meets the 4.5:1 minimum',
    (_label, pairing) => {
      const ratio = contrastRatio(colors[pairing.foreground], colors[pairing.ground])

      expect(
        ratio,
        `${describePairing(pairing)} (${pairing.usage}) measures ${ratio.toFixed(2)}:1, below the ${MINIMUM_TEXT_CONTRAST}:1 floor`,
      ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
    },
  )

  /**
   * Pins the measured ratios for the three colours DESIGN.md calls out, so a
   * token edit that changes them turns this red rather than sliding past.
   *
   * These are the *measured* values, and two of them differ from the figures
   * DESIGN.md states under §Colors ("ink ≈ 12.4:1, flag ≈ 7.9:1, brass ≈ 5.2:1"):
   *
   *   ink   on stone — stated 12.4, measured 12.64
   *   flag  on stone — stated  7.9, measured  6.54   <- materially off
   *   brass on stone — stated  5.2, measured  5.62
   *
   * The implementation here was verified against known WCAG values and by hand
   * for `flag` specifically (see contrast.test.ts), so the measurements are the
   * trustworthy side. All three still clear the 4.5:1 floor, so the design holds
   * — but the document's stated figure for `flag` should be corrected, and until
   * it is, this comment is the record of the divergence.
   */
  it('pins the measured ratios for the colours DESIGN.md calls out', () => {
    expect(contrastRatio(colors.ink, colors.stone)).toBeCloseTo(12.64, 1)
    expect(contrastRatio(colors.flag, colors.stone)).toBeCloseTo(6.54, 1)
    expect(contrastRatio(colors.brass, colors.stone)).toBeCloseTo(5.62, 1)
  })
})

describe('rejected text colours', () => {
  it.each(REJECTED_TEXT_COLORS.map((entry) => [entry.hex, entry] as const))(
    '%s stays below the floor on stone, so its rejection is enforced rather than remembered',
    (hex, entry) => {
      expect(contrastRatio(hex, colors.stone)).toBeLessThan(MINIMUM_TEXT_CONTRAST)
      expect(entry.reason.length).toBeGreaterThan(0)
    },
  )

  it('is not reachable through the token set', () => {
    const rejected = new Set(REJECTED_TEXT_COLORS.map((entry) => entry.hex.toUpperCase()))

    for (const [token, value] of Object.entries(colors)) {
      expect(rejected, `${token} reinstates a rejected colour`).not.toContain(value.toUpperCase())
    }
  })
})
