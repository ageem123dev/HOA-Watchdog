/**
 * The automated contrast check AC3 requires.
 *
 * This is the only acceptance criterion in the visual foundation that can fail
 * silently in production: a colour that looks fine on the implementer's monitor
 * and measures 3.8:1 is a conformance failure nobody notices until an audit.
 * Weakening or deleting this file removes the only thing standing between the
 * token set and that outcome.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'
import {
  KNOWN_NON_TEXT_GAPS,
  MINIMUM_NON_TEXT_CONTRAST,
  MINIMUM_TEXT_CONTRAST,
  NON_TEXT_PAIRINGS,
  REJECTED_TEXT_COLORS,
  TEXT_PAIRINGS,
  type TextPairing,
} from './text-pairings'
import { colors, type ColorToken } from './tokens'

const describePairing = (pairing: TextPairing) =>
  `${pairing.foreground} on ${pairing.ground}`

function repoRoot(): string {
  let directory = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      readFileSync(join(directory, 'package.json'), 'utf8')
      return directory
    } catch {
      directory = resolve(directory, '..')
    }
  }
  throw new Error('Could not locate the repository root from this test file')
}

/** Every `--color-*` token actually referenced by an application surface. */
function colorTokensUsedInSurfaces(): Set<string> {
  const used = new Set<string>()

  const walk = (directory: string): void => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) {
        walk(path)
        continue
      }
      if (!/\.(tsx?|css)$/.test(item.name)) continue

      for (const match of readFileSync(path, 'utf8').matchAll(/var\(--color-([a-z-]+)\)/g)) {
        if (match[1] !== undefined) used.add(match[1])
      }
    }
  }

  walk(join(repoRoot(), 'app'))
  return used
}

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

  /**
   * The gate measures what is *declared*; the screens render what is *used*.
   * Nothing connected the two until this test, which is how `ink on on-ink` —
   * live on the only interactive surface in the product — went unmeasured.
   *
   * It is a coarse link: it proves every colour a surface references appears
   * somewhere in the list, not that each rendered foreground/ground combination
   * was measured. That would need a style graph. It does catch the case that
   * matters most: a colour reaching a screen without the gate knowing it exists.
   */
  it('declares every colour token the application surfaces actually reference', () => {
    const used = colorTokensUsedInSurfaces()
    const declared = new Set(
      [...TEXT_PAIRINGS, ...NON_TEXT_PAIRINGS].flatMap(
        (pairing) => [pairing.foreground, pairing.ground] as string[],
      ),
    )

    expect(used.size, 'no --color-* references found; the scan is looking in the wrong place').toBeGreaterThan(0)

    for (const token of used) {
      expect(
        declared,
        `--color-${token} is used by a surface but appears in no declared pairing, so its contrast is measured by nothing`,
      ).toContain(token)
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

  /**
   * The gate is binary at 4.5, so the tightest pairing is where the build goes
   * from green to red with no warning. Pinning it makes any narrowing visible as
   * a deliberate change rather than a surprise — and names which pairing is
   * carrying the least headroom.
   *
   * It is `ink-muted` on `stone` at 4.71:1, used by every label and eyebrow —
   * and notably the one pairing DESIGN.md's own "Contrast obligations"
   * paragraph does not measure.
   */
  it('pins the pairing with the least headroom, so narrowing it is a visible decision', () => {
    const measured = TEXT_PAIRINGS.map((pairing) => ({
      pairing: describePairing(pairing),
      ratio: contrastRatio(colors[pairing.foreground], colors[pairing.ground]),
    })).sort((a, b) => a.ratio - b.ratio)

    const tightest = measured[0]

    expect(tightest?.pairing).toBe('ink-muted on stone')
    expect(tightest?.ratio).toBeCloseTo(4.71, 1)
  })
})

describe('non-text contrast (SC 1.4.11)', () => {
  const isKnownGap = (pairing: TextPairing) =>
    KNOWN_NON_TEXT_GAPS.some(
      (gap) => gap.foreground === pairing.foreground && gap.ground === pairing.ground,
    )

  it.each(NON_TEXT_PAIRINGS.map((pairing) => [describePairing(pairing), pairing] as const))(
    '%s meets the 3:1 boundary minimum, or is a recorded gap',
    (_label, pairing) => {
      if (isKnownGap(pairing)) return

      const ratio = contrastRatio(colors[pairing.foreground], colors[pairing.ground])
      expect(
        ratio,
        `${describePairing(pairing)} (${pairing.usage}) measures ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(MINIMUM_NON_TEXT_CONTRAST)
    },
  )

  /**
   * Pins each recorded gap at its measured value. If the palette changes, this
   * fails and whoever changed it must come back and delete the exception — an
   * exception nobody is forced to revisit becomes permanent.
   */
  it.each(KNOWN_NON_TEXT_GAPS.map((gap) => [`${gap.foreground} on ${gap.ground}`, gap] as const))(
    '%s is still the recorded shortfall, not silently resolved or silently worsened',
    (_label, gap) => {
      const ratio = contrastRatio(colors[gap.foreground], colors[gap.ground])

      expect(ratio).toBeCloseTo(gap.measured, 1)
      expect(ratio).toBeLessThan(MINIMUM_NON_TEXT_CONTRAST)
      expect(gap.reason.length).toBeGreaterThan(0)
    },
  )

  it('records every gap it exempts, so none is exempted without a reason', () => {
    for (const gap of KNOWN_NON_TEXT_GAPS) {
      expect(
        NON_TEXT_PAIRINGS.some(
          (pairing) => pairing.foreground === gap.foreground && pairing.ground === gap.ground,
        ),
        `${gap.foreground} on ${gap.ground} is exempted but never declared`,
      ).toBe(true)
    }
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
