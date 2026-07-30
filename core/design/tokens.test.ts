import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
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

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  cwd: dirname(fileURLToPath(import.meta.url)),
  encoding: 'utf8',
}).trim()

const DESIGN_MD = join(
  REPO_ROOT,
  '_bmad-output/planning-artifacts/ux-designs/ux-HOA-Treasurer-Assistant-2026-07-30/DESIGN.md',
)

/**
 * Reads one block of the DESIGN.md frontmatter — `colors:`, `rounded:` and so
 * on — as `token -> value`. Deliberately a small local parser rather than a YAML
 * dependency: the frontmatter is a flat map of quoted scalars, and adding a
 * parser to the project to read one file it already owns is not a trade worth
 * making.
 */
function designBlock(name: string): Record<string, string> {
  const source = readFileSync(DESIGN_MD, 'utf8')
  const lines = source.split(/\r?\n/)

  const start = lines.findIndex((line) => line === `${name}:`)
  if (start === -1) throw new Error(`DESIGN.md has no "${name}:" block`)

  const entries: Record<string, string> = {}
  for (const line of lines.slice(start + 1)) {
    // A non-indented line ends the block.
    if (!/^\s/.test(line)) break
    const match = /^\s+([A-Za-z0-9-]+):\s*(.*)$/.exec(line)
    if (match === null) continue

    const [, token, rawValue = ''] = match
    if (token === undefined) continue
    entries[token] = rawValue.trim().replace(/^'(.*)'$/, '$1')
  }

  return entries
}

describe('parity with DESIGN.md', () => {
  it('reads the DESIGN.md frontmatter at all, so this suite cannot pass vacuously', () => {
    expect(Object.keys(designBlock('colors')).length).toBeGreaterThan(0)
  })

  it('carries exactly the colour tokens DESIGN.md declares, with the same values', () => {
    expect(colors).toEqual(designBlock('colors'))
  })

  it('carries exactly the typography tokens DESIGN.md declares', () => {
    expect(typography).toEqual(designBlock('typography'))
  })

  it('carries exactly the corner radii DESIGN.md declares', () => {
    expect(rounded).toEqual(designBlock('rounded'))
  })

  it('carries exactly the spacing steps DESIGN.md declares', () => {
    expect(spacing).toEqual(designBlock('spacing'))
  })

  /**
   * The component block is the one place the module deliberately differs:
   * DESIGN.md writes the focus ring as one descriptive string
   * (`'2px solid #14213D, 2px offset'`) because it is prose for a designer, while
   * the code needs the width and offset separately and takes its colour from the
   * `ink` token. Everything else must match exactly.
   */
  it('carries the measurable component tokens DESIGN.md declares', () => {
    const design = designBlock('components')

    expect(components['margin-tick-width']).toBe(design['margin-tick-width'])
    expect(components['rule-hairline']).toBe(design['rule-hairline'])
    expect(components['rule-heading']).toBe(design['rule-heading'])
  })

  it('derives the focus ring from the same values DESIGN.md states in prose', () => {
    const stated = designBlock('components')['focus-ring'] ?? ''

    expect(stated).toContain(components['focus-ring-width'])
    expect(stated).toContain(components['focus-ring-offset'])
    expect(stated.toUpperCase()).toContain(colors.ink)
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

  it('introduces no prefers-color-scheme handling anywhere in the application', () => {
    // `git grep` exits 1 when it matches nothing, which is the passing case
    // here, and non-zero exits throw. Anything other than "no matches" is a real
    // failure and must not be swallowed into a green test.
    let matches = ''
    try {
      matches = execFileSync(
        'git',
        ['grep', '-l', '--', 'prefers-color-scheme', 'app', 'core', 'adapters'],
        { cwd: REPO_ROOT, encoding: 'utf8' },
      ).trim()
    } catch (error) {
      const { status } = error as { status?: number }
      if (status !== 1) throw error
    }

    expect(matches).toBe('')
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

  it('gives every custom property a unique name', () => {
    const names = tokenCustomProperties().map(([name]) => name)

    expect(new Set(names).size).toBe(names.length)
  })

  it('renders a :root block containing every token, so none can fail to reach the DOM', () => {
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
