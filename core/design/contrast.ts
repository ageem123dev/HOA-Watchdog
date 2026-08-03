/**
 * WCAG 2.x contrast measurement.
 *
 * Pure: no imports, no I/O. The formula is implemented exactly as the
 * specification defines it rather than approximated — every contrast assertion
 * in this project rests on it, and an approximation here would weaken all of
 * them silently, in the direction of passing.
 *
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

const SHORT_HEX = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i
const LONG_HEX = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

/** The sRGB companding threshold and coefficients, per the WCAG definition. */
const TRANSFER_THRESHOLD = 0.03928
const LOW_DIVISOR = 12.92
const HIGH_OFFSET = 0.055
const HIGH_DIVISOR = 1.055
const HIGH_EXPONENT = 2.4

const LUMINANCE_COEFFICIENTS = { r: 0.2126, g: 0.7152, b: 0.0722 } as const

/** Added to both terms of the ratio, per the specification. */
const RATIO_OFFSET = 0.05

export function parseHexColor(hex: string): Rgb {
  if (typeof hex !== 'string') {
    throw new TypeError('parseHexColor expects a hex colour string')
  }

  const trimmed = hex.trim()
  const short = SHORT_HEX.exec(trimmed)
  if (short) {
    const [, r, g, b] = short
    return {
      r: Number.parseInt(`${r}${r}`, 16),
      g: Number.parseInt(`${g}${g}`, 16),
      b: Number.parseInt(`${b}${b}`, 16),
    }
  }

  const long = LONG_HEX.exec(trimmed)
  if (long === null) {
    // Deliberately a throw rather than a default. A malformed colour that
    // returned black would measure a plausible ratio against a light ground and
    // pass a gate nobody actually verified.
    throw new TypeError(`Not a hex colour: ${JSON.stringify(hex)}`)
  }

  const [, r, g, b] = long
  return {
    r: Number.parseInt(r as string, 16),
    g: Number.parseInt(g as string, 16),
    b: Number.parseInt(b as string, 16),
  }
}

function channelLuminance(value8Bit: number): number {
  const channel = value8Bit / 255
  return channel <= TRANSFER_THRESHOLD
    ? channel / LOW_DIVISOR
    : ((channel + HIGH_OFFSET) / HIGH_DIVISOR) ** HIGH_EXPONENT
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex)

  return (
    LUMINANCE_COEFFICIENTS.r * channelLuminance(r) +
    LUMINANCE_COEFFICIENTS.g * channelLuminance(g) +
    LUMINANCE_COEFFICIENTS.b * channelLuminance(b)
  )
}

/**
 * Symmetric by construction — the lighter colour always takes the numerator, so
 * argument order cannot change the answer.
 */
export function contrastRatio(a: string, b: string): number {
  const luminanceA = relativeLuminance(a)
  const luminanceB = relativeLuminance(b)

  const lighter = Math.max(luminanceA, luminanceB)
  const darker = Math.min(luminanceA, luminanceB)

  return (lighter + RATIO_OFFSET) / (darker + RATIO_OFFSET)
}
