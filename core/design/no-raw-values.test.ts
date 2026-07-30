/**
 * AC1's second clause: "no component defines a color or type value outside the
 * token set."
 *
 * A token set nobody is obliged to use is a suggestion. This scans the files a
 * developer writes and fails on a raw colour or font-family value, so the only
 * way to style something is through a custom property — which means through
 * `core/design/tokens.ts`, which is measured for contrast.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Walks up to the directory holding package.json rather than shelling out to
 * git: a `git rev-parse` at module scope makes this acceptance gate fail to
 * import wherever git or `.git` is absent.
 */
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

const REPO_ROOT = repoRoot()
const SCANNED_ROOT = join(REPO_ROOT, 'app')
const SCANNED_EXTENSIONS = ['.tsx', '.ts', '.css']

/**
 * A colour value, recognised only where a value can appear — after a `:`.
 * Anchoring to the colon is what keeps `// see issue #1234`, `href="#section"`
 * and a CSS id selector `#row {` from being reported as colours; an unanchored
 * `#[0-9a-f]{3,8}` flags all three.
 */
const RAW_HEX_VALUE = /:\s*['"`]?#[0-9a-fA-F]{3,8}\b/

/** Colour functions are unambiguous wherever they appear. */
const RAW_COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\s*\(/

/**
 * Named CSS colours and system colours, again only in value position.
 * `transparent`, `currentColor` and `inherit` are deliberately permitted — they
 * carry no colour of their own and so cannot escape the token set.
 */
const NAMED_COLORS = [
  'aliceblue|antiquewhite|aqua|aquamarine|azure|beige|bisque|black|blanchedalmond|blue',
  'blueviolet|brown|burlywood|cadetblue|chartreuse|chocolate|coral|cornflowerblue|cornsilk',
  'crimson|cyan|darkblue|darkcyan|darkgoldenrod|darkgray|darkgreen|darkgrey|darkkhaki',
  'darkmagenta|darkolivegreen|darkorange|darkorchid|darkred|darksalmon|darkseagreen',
  'darkslateblue|darkslategray|darkslategrey|darkturquoise|darkviolet|deeppink|deepskyblue',
  'dimgray|dimgrey|dodgerblue|firebrick|floralwhite|forestgreen|fuchsia|gainsboro|ghostwhite',
  'gold|goldenrod|gray|green|greenyellow|grey|honeydew|hotpink|indianred|indigo|ivory|khaki',
  'lavender|lavenderblush|lawngreen|lemonchiffon|lightblue|lightcoral|lightcyan|lightgray',
  'lightgreen|lightgrey|lightpink|lightsalmon|lightseagreen|lightskyblue|lightslategray',
  'lightsteelblue|lightyellow|lime|limegreen|linen|magenta|maroon|mediumaquamarine',
  'mediumblue|mediumorchid|mediumpurple|mediumseagreen|mediumslateblue|mediumspringgreen',
  'mediumturquoise|mediumvioletred|midnightblue|mintcream|mistyrose|moccasin|navajowhite',
  'navy|oldlace|olive|olivedrab|orange|orangered|orchid|palegoldenrod|palegreen',
  'paleturquoise|palevioletred|papayawhip|peachpuff|peru|pink|plum|powderblue|purple',
  'rebeccapurple|red|rosybrown|royalblue|saddlebrown|salmon|sandybrown|seagreen|seashell',
  'sienna|silver|skyblue|slateblue|slategray|slategrey|snow|springgreen|steelblue|tan|teal',
  'thistle|tomato|turquoise|violet|wheat|white|whitesmoke|yellow|yellowgreen',
  'ButtonText|ButtonFace|Canvas|CanvasText|LinkText|Highlight|HighlightText|FieldText|Field',
].join('|')

const RAW_NAMED_COLOR = new RegExp(`:\\s*['"\`]?(?:${NAMED_COLORS})\\b`, 'i')

/**
 * A font family or `font` shorthand whose value is not a custom property. The
 * value is captured and tested separately rather than matched with a lookahead:
 * an inline `(?!var\\()` lets the preceding `\\s*` backtrack past it, which
 * flagged `fontFamily: 'var(--type-serif)'` as a raw literal on the first draft.
 */
const FONT_DECLARATION = /(?:font-family|fontFamily|font)\s*:\s*(.+)$/

function isRawFontValue(rawValue: string): boolean {
  const value = rawValue.trim().replace(/^['"`]/, '')
  if (value.startsWith('var(')) return false
  // Keyword values carry no family of their own.
  return !/^(inherit|initial|unset|revert|revert-layer)\b/.test(value)
}

interface Offence {
  readonly file: string
  readonly line: number
  readonly text: string
  readonly kind: 'colour' | 'font'
}

function scannedFiles(directory: string = SCANNED_ROOT): string[] {
  const found: string[] = []
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isDirectory()) found.push(...scannedFiles(path))
    else if (SCANNED_EXTENSIONS.some((extension) => item.name.endsWith(extension))) {
      found.push(path)
    }
  }
  return found
}

function offencesInLine(text: string): Offence['kind'][] {
  const kinds: Offence['kind'][] = []

  if (RAW_HEX_VALUE.test(text) || RAW_COLOR_FUNCTION.test(text) || RAW_NAMED_COLOR.test(text)) {
    kinds.push('colour')
  }

  const font = FONT_DECLARATION.exec(text)
  // Reported alongside a colour rather than instead of it: an `else if` hides the
  // second offence until the first is fixed, lengthening the fix/re-run cycle.
  if (font !== null && isRawFontValue(font[1] ?? '')) kinds.push('font')

  return kinds
}

function findOffences(files: readonly string[]): Offence[] {
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .flatMap((text, index) =>
        offencesInLine(text).map((kind) => ({
          file: relative(REPO_ROOT, file).split(sep).join('/'),
          line: index + 1,
          text: text.trim(),
          kind,
        })),
      ),
  )
}

describe('coverage of the scan', () => {
  it('scans every file under app/, including those at its top level', () => {
    const scanned = scannedFiles().map((path) => relative(REPO_ROOT, path).split(sep).join('/'))

    // The first version used a `app/**/*.tsx` git pathspec, which without :(glob)
    // requires a literal directory segment and therefore skipped app/layout.tsx —
    // the one file holding every CSS rule this story added.
    expect(scanned).toContain('app/layout.tsx')
    expect(scanned).toContain('app/page.tsx')
    expect(scanned).toContain('app/sign-in/page.tsx')
    expect(scanned).toContain('app/dashboard/page.tsx')
  })
})

describe('no raw styling values outside the token set', () => {
  it('finds no raw colour or font value in the application surfaces', () => {
    const offences = findOffences(scannedFiles())
    const report = offences.map((o) => `  ${o.file}:${o.line} (${o.kind}) ${o.text}`).join('\n')

    expect(
      offences,
      offences.length === 0
        ? ''
        : `Styling values must come from core/design/tokens.ts via a custom property:\n${report}`,
    ).toEqual([])
  })
})

/**
 * The scanner's own failure mode is a pattern that matches nothing and passes
 * forever. These prove each form is still detected without writing an offending
 * file into the repository.
 */
describe('the scanner still bites', () => {
  it.each([
    ['a hex colour in JSX', "  background: '#14213D',"],
    ['a short hex colour in CSS', '  color: #fff;'],
    ['an eight-digit hex colour', "  color: '#14213D80',"],
    ['an rgb() colour', '  color: rgb(20, 33, 61);'],
    ['an rgba() colour', '  color: rgba(20, 33, 61, 0.5);'],
    ['an hsl() colour', '  color: hsl(220, 51%, 15%);'],
    ['an oklch() colour', '  color: oklch(0.5 0.1 200);'],
    ['a lab() colour', '  color: lab(50% 20 -30);'],
    ['a hwb() colour', '  color: hwb(200 30% 40%);'],
    ['a color-mix()', '  color: color-mix(in srgb, red, blue);'],
    ['a named colour in CSS', '  color: white;'],
    ['a named colour in JSX', "  background: 'rebeccapurple',"],
    ['a system colour', "  color: 'ButtonText',"],
  ])('detects %s', (_label, line) => {
    expect(offencesInLine(line)).toContain('colour')
  })

  it.each([
    ['a CSS font-family literal', '  font-family: Georgia, serif;'],
    ['a JSX fontFamily literal', "  fontFamily: 'Georgia, serif',"],
    ['a quoted family name first', '  fontFamily: \'"Segoe UI", sans-serif\','],
    ['a stack beginning with a hyphen', '  font-family: -apple-system, sans-serif;'],
    ['a font shorthand', "  font: '600 1.5rem Georgia, serif',"],
  ])('detects %s', (_label, line) => {
    expect(offencesInLine(line)).toContain('font')
  })

  it('reports both offences on a line carrying a colour and a font', () => {
    expect(offencesInLine('  h1 { font-family: Georgia, serif; color: #14213D; }')).toEqual([
      'colour',
      'font',
    ])
  })
})

describe('the scanner does not cry wolf', () => {
  it.each([
    ['a colour custom property', "  background: 'var(--color-stone)',"],
    ['a CSS font-family custom property', '  font-family: var(--type-sans);'],
    ['a JSX fontFamily custom property', "  fontFamily: 'var(--type-serif)',"],
    ['a font shorthand keyword', "  font: 'inherit',"],
    ['transparent', "  background: 'transparent',"],
    ['currentColor', '  fill: currentColor;'],
    ['an unrelated numeric value', '  minHeight: 44,'],
    ['an issue reference in a comment', '  // See issue #1234 for the rationale'],
    ['a baseline commit reference', '  // baseline commit #137aea9'],
    ['an in-page anchor', '  <a href="#main-content">Skip to content</a>'],
    ['a CSS id selector', '#findings-row { border: 0; }'],
  ])('does not flag %s', (_label, line) => {
    expect(offencesInLine(line)).toEqual([])
  })
})
