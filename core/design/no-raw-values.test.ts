/**
 * AC1's second clause: "no component defines a color or type value outside the
 * token set."
 *
 * A token set nobody is obliged to use is a suggestion. This scans the files a
 * developer writes and fails on a raw colour or font-family literal, so the only
 * way to style something is through a custom property — which means through
 * `core/design/tokens.ts`, which is measured for contrast.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: dirname(fileURLToPath(import.meta.url)),
  encoding: 'utf8',
}).trim()

/**
 * The application surfaces. `core/design/` is deliberately excluded — it is
 * where the literals are *supposed* to live, and it is the one place they are
 * measured.
 */
const SCANNED_PATHSPECS = ['app/**/*.tsx', 'app/**/*.ts', 'app/**/*.css']

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\bcolor-mix\(/

/**
 * A font-family declaration whose value begins with a letter rather than
 * `var(`. The trailing `[A-Za-z]` matters: without it the optional whitespace
 * backtracks past the lookahead and the pattern flags `var(--type-sans)` as a
 * raw literal — which is exactly the false positive this test caught on itself.
 */
const RAW_FONT_FAMILY = /(?:font-family|fontFamily)\s*:\s*(?:['"`]\s*)?(?!var\()[A-Za-z]/

interface Offence {
  readonly file: string
  readonly line: number
  readonly text: string
  readonly kind: 'colour' | 'font'
}

function scannedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '--', ...SCANNED_PATHSPECS], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  return output.split('\0').filter((path) => path.length > 0)
}

function findOffences(files: readonly string[]): Offence[] {
  const offences: Offence[] = []

  for (const file of files) {
    const lines = readFileSync(join(REPO_ROOT, file), 'utf8').split(/\r?\n/)

    lines.forEach((text, index) => {
      const entry = { file, line: index + 1, text: text.trim() }
      if (RAW_COLOR.test(text)) offences.push({ ...entry, kind: 'colour' })
      else if (RAW_FONT_FAMILY.test(text)) offences.push({ ...entry, kind: 'font' })
    })
  }

  return offences
}

describe('no raw styling values outside the token set', () => {
  it('scans at least one file, so a pathspec typo cannot pass as compliance', () => {
    expect(scannedFiles().length).toBeGreaterThan(0)
  })

  it('finds no raw colour or font literal in the application surfaces', () => {
    const offences = findOffences(scannedFiles())

    const report = offences
      .map((o) => `  ${o.file}:${o.line} (${o.kind}) ${o.text}`)
      .join('\n')

    expect(
      offences,
      offences.length === 0
        ? ''
        : `Raw styling values must come from core/design/tokens.ts via a custom property:\n${report}`,
    ).toEqual([])
  })

  /**
   * The scanner's own failure mode is a broken pattern that matches nothing and
   * therefore passes forever. These prove it still bites, without needing to
   * write an offending file into the repository.
   */
  it.each([
    ['a hex colour', "  background: '#14213D',", 'colour'],
    ['a short hex colour', '  color: #fff;', 'colour'],
    ['an rgb() colour', '  color: rgb(20, 33, 61);', 'colour'],
    ['an rgba() colour', '  color: rgba(20, 33, 61, 0.5);', 'colour'],
    ['an hsl() colour', '  color: hsl(220, 51%, 15%);', 'colour'],
    ['a CSS font-family literal', '  font-family: Georgia, serif;', 'font'],
    ['a JSX fontFamily literal', "  fontFamily: 'Georgia, serif',", 'font'],
  ])('still detects %s', (_label, line, kind) => {
    const detected = kind === 'colour' ? RAW_COLOR.test(line) : RAW_FONT_FAMILY.test(line)

    expect(detected).toBe(true)
  })

  it.each([
    ['a colour custom property', "  background: 'var(--color-stone)',"],
    ['a CSS font-family custom property', '  font-family: var(--type-sans);'],
    ['a JSX fontFamily custom property', "  fontFamily: 'var(--type-serif)',"],
    ['an unrelated line', '  minHeight: 44,'],
  ])('does not flag %s', (_label, line) => {
    expect(RAW_COLOR.test(line) || RAW_FONT_FAMILY.test(line)).toBe(false)
  })
})
