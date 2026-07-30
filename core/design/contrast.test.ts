import { describe, expect, it } from 'vitest'
import { contrastRatio, parseHexColor, relativeLuminance } from './contrast'

describe('parseHexColor', () => {
  it('parses a six-digit hex colour', () => {
    expect(parseHexColor('#14213D')).toEqual({ r: 0x14, g: 0x21, b: 0x3d })
  })

  it('parses a three-digit shorthand by doubling each digit', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(parseHexColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc })
  })

  it('accepts a colour without the leading hash', () => {
    expect(parseHexColor('14213D')).toEqual(parseHexColor('#14213D'))
  })

  it('is case-insensitive', () => {
    expect(parseHexColor('#e5e5e0')).toEqual(parseHexColor('#E5E5E0'))
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseHexColor('  #E5E5E0  ')).toEqual(parseHexColor('#E5E5E0'))
  })

  it.each([
    ['empty', ''],
    ['a named colour', 'rebeccapurple'],
    ['a four-digit value', '#abcd'],
    ['a five-digit value', '#abcde'],
    ['a seven-digit value', '#abcdef0'],
    ['a non-hex digit', '#gggggg'],
    ['an rgb() function', 'rgb(20, 33, 61)'],
  ])('rejects %s rather than returning a plausible colour', (_label, value) => {
    expect(() => parseHexColor(value)).toThrow(TypeError)
  })

  it('rejects a non-string', () => {
    expect(() => parseHexColor(null as never)).toThrow(TypeError)
  })
})

describe('relativeLuminance', () => {
  it('measures black as 0', () => {
    expect(relativeLuminance('#000000')).toBe(0)
  })

  it('measures white as 1', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10)
  })

  /**
   * The three primaries are the WCAG coefficients themselves at full intensity,
   * which pins the coefficients rather than merely exercising them.
   */
  it.each([
    ['#FF0000', 0.2126],
    ['#00FF00', 0.7152],
    ['#0000FF', 0.0722],
  ])('measures %s as its channel coefficient', (hex, expected) => {
    expect(relativeLuminance(hex)).toBeCloseTo(expected, 10)
  })

  /**
   * Below the 0.03928 threshold the linear branch applies. #050505 is 5/255 =
   * 0.0196, which is under it, so the result is 0.0196/12.92 across all three
   * channels. A implementation that used the power curve everywhere passes every
   * other test in this file and fails this one.
   */
  it('uses the linear branch for very dark channels', () => {
    const expected = 5 / 255 / 12.92

    expect(relativeLuminance('#050505')).toBeCloseTo(expected, 12)
  })

  it('is monotonic — a lighter grey has greater luminance', () => {
    expect(relativeLuminance('#888888')).toBeGreaterThan(relativeLuminance('#333333'))
    expect(relativeLuminance('#CCCCCC')).toBeGreaterThan(relativeLuminance('#888888'))
  })
})

describe('contrastRatio', () => {
  it('measures black on white as 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 10)
  })

  it('measures a colour against itself as 1:1', () => {
    expect(contrastRatio('#14213D', '#14213D')).toBeCloseTo(1, 10)
  })

  it('is symmetric — argument order cannot change the answer', () => {
    expect(contrastRatio('#14213D', '#E5E5E0')).toBeCloseTo(
      contrastRatio('#E5E5E0', '#14213D'),
      12,
    )
  })

  /**
   * Cross-check against a figure derived by hand rather than by this module.
   * Mid grey #767676 on white is the canonical example of a colour that just
   * clears 4.5:1 — it is the standard illustration of the AA threshold.
   */
  it('cross-check: #767676 on white sits just above the 4.5:1 AA threshold', () => {
    const ratio = contrastRatio('#767676', '#FFFFFF')

    expect(ratio).toBeGreaterThanOrEqual(4.5)
    expect(ratio).toBeLessThan(4.6)
  })

  it('cross-check: one step lighter falls below the threshold', () => {
    expect(contrastRatio('#777777', '#FFFFFF')).toBeLessThan(4.5)
  })

  it('never reports less than 1', () => {
    for (const hex of ['#000000', '#FFFFFF', '#14213D', '#6E5426']) {
      expect(contrastRatio(hex, hex)).toBeGreaterThanOrEqual(1)
    }
  })

  it('propagates a malformed colour rather than measuring it as black', () => {
    expect(() => contrastRatio('not-a-colour', '#FFFFFF')).toThrow(TypeError)
  })
})
