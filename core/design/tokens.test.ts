import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  THEME,
  colors,
  components,
  customPropertyName,
  rootCustomPropertiesCss,
  rounded,
  spacing,
  tokenCustomProperties,
  typography,
} from './tokens'

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
const DESIGN_MD = join(
  REPO_ROOT,
  '_bmad-output/planning-artifacts/ux-designs/ux-HOA-Treasurer-Assistant-2026-07-30/DESIGN.md',
)

/** The lines between the opening and closing `---` fences, and nothing else. */
function frontmatterLines(): string[] {
  const lines = readFileSync(DESIGN_MD, 'utf8').split(/\r?\n/)

  if (lines[0] !== '---') throw new Error('DESIGN.md does not open with a frontmatter fence')
  const close = lines.indexOf('---', 1)
  if (close === -1) throw new Error('DESIGN.md frontmatter is not closed')

  return lines.slice(1, close)
}

/**
 * Reads one block of the DESIGN.md frontmatter as `token -> value`.
 *
 * Bounded to the frontmatter deliberately: an unbounded search would happily
 * parse a ```yaml sample in the prose — an entirely ordinary edit to a design
 * document — and the anti-vacuity guard below would pass on it.
 *
 * A small local parser rather than a YAML dependency: the block is a flat map of
 * quoted scalars, and adding a parser to read one file the project already owns
 * is not a trade worth making. It is strict about what it does not understand.
 */
function designBlock(name: string): Record<string, string> {
  const lines = frontmatterLines()

  const start = lines.findIndex((line) => line === `${name}:`)
  if (start === -1) throw new Error(`DESIGN.md frontmatter has no "${name}:" block`)

  const entries: Record<string, string> = {}
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue
    // A non-indented line starts the next top-level key.
    if (!/^\s/.test(line)) break

    const match = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match === null) {
      throw new Error(`DESIGN.md "${name}:" block has a line this parser does not understand: ${line}`)
    }

    const [, token, rawValue = ''] = match
    if (token === undefined) continue

    if (rawValue.trim() === '') {
      throw new Error(`DESIGN.md "${name}.${token}" is a nested map, which this parser cannot read`)
    }

    entries[token] = unquote(rawValue)
  }

  return entries
}

/** Strips a trailing comment and either quote style. */
function unquote(rawValue: string): string {
  const value = rawValue.trim()

  const quoted = /^(['"])(.*)\1(?:\s+#.*)?$/.exec(value)
  if (quoted) return quoted[2] as string

  return value.replace(/\s+#.*$/, '')
}

describe('the DESIGN.md reader', () => {
  it('reads the frontmatter at all, so this suite cannot pass vacuously', () => {
    expect(Object.keys(designBlock('colors')).length).toBeGreaterThan(0)
  })

  it('reads only the frontmatter, not a YAML sample in the prose', () => {
    const body = readFileSync(DESIGN_MD, 'utf8').split(/\r?\n/).slice(frontmatterLines().length + 2)

    expect(body.join('\n')).not.toBe('')
    expect(frontmatterLines().some((line) => line.startsWith('# '))).toBe(false)
  })

  it('rejects a block it does not understand rather than returning a partial map', () => {
    expect(() => designBlock('not-a-block')).toThrow(/no "not-a-block:" block/)
  })
})

describe('parity with DESIGN.md', () => {
  it.each([
    ['colors', colors],
    ['typography', typography],
    ['rounded', rounded],
    ['spacing', spacing],
  ])('carries exactly the %s tokens DESIGN.md declares, with the same values', (block, actual) => {
    expect(actual).toEqual(designBlock(block))
  })

  /**
   * The one block where the code deliberately differs: DESIGN.md writes the
   * focus ring as a single descriptive string for a designer, while the code
   * needs width and offset separately and takes the colour from the ink token.
   * Compared in both directions anyway — this is precisely the block where a
   * one-directional check would let DESIGN.md grow a token the code never gets.
   */
  it('carries every measurable component token DESIGN.md declares', () => {
    const design = designBlock('components')
    const derived = ['focus-ring']

    expect(Object.keys(design).sort()).toEqual(
      [...Object.keys(components).filter((key) => !key.startsWith('focus-ring')), ...derived].sort(),
    )

    for (const [token, value] of Object.entries(design)) {
      if (derived.includes(token)) continue
      expect(components, token).toHaveProperty(token, value)
    }
  })

  it('derives the focus ring from the values DESIGN.md states in prose', () => {
    const stated = designBlock('components')['focus-ring'] ?? ''

    // Asserted positionally, not by containment: while width and offset are both
    // "2px", two `toContain` checks are indistinguishable and would not notice
    // them being swapped or one being wrong-but-equal to the other.
    expect(stated).toMatch(
      new RegExp(`^${components['focus-ring-width']} solid ${colors.ink}, ${components['focus-ring-offset']} offset$`, 'i'),
    )
  })
})

describe('theme', () => {
  it('is light, and is the only theme', () => {
    expect(THEME).toBe('light')
  })

  it('records the light-only decision in DESIGN.md rather than only in code', () => {
    const source = readFileSync(DESIGN_MD, 'utf8')

    expect(source).toContain('Light-only for the pilot')
    expect(source).toContain('This is a decision, not an omission')
  })

  /**
   * Scans the shipped surfaces for actual theme handling. Scoped to `app/` and
   * `adapters/`, which is where CSS and runtime behaviour live — an earlier
   * version also scanned `core/` and matched this project's own prose about the
   * decision, turning the guard red against its own documentation.
   */
  it('ships no prefers-color-scheme handling in any surface', () => {
    const offenders: string[] = []

    const walk = (directory: string): void => {
      for (const item of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, item.name)
        if (item.isDirectory()) walk(path)
        else if (/\.(tsx?|css)$/.test(item.name) && readFileSync(path, 'utf8').includes('prefers-color-scheme')) {
          offenders.push(path)
        }
      }
    }

    walk(join(REPO_ROOT, 'app'))
    walk(join(REPO_ROOT, 'adapters'))

    expect(offenders).toEqual([])
  })
})

describe('custom properties', () => {
  it('emits one custom property per token', () => {
    const tokenCount =
      Object.keys(colors).length +
      Object.keys(typography).length +
      Object.keys(rounded).length +
      Object.keys(spacing).length +
      Object.keys(components).length

    expect(tokenCustomProperties()).toHaveLength(tokenCount)
  })

  it('names them by group, so a property says which vocabulary it belongs to', () => {
    expect(customPropertyName('color', 'ink')).toBe('--color-ink')

    const names = tokenCustomProperties().map(([name]) => name)
    expect(names).toContain('--color-ink')
    expect(names).toContain('--type-scale-body')
    expect(names).toContain('--space-row')
    expect(names).toContain('--radius-none')
    expect(names).toContain('--component-rule-hairline')
  })

  it('renders a :root block containing every token', () => {
    const css = rootCustomPropertiesCss()

    expect(css.startsWith(':root {')).toBe(true)
    for (const [name, value] of tokenCustomProperties()) {
      expect(css).toContain(`${name}: ${value};`)
    }
  })

  it('leaves no value empty', () => {
    for (const [name, value] of tokenCustomProperties()) {
      expect(value, name).not.toBe('')
    }
  })
})
