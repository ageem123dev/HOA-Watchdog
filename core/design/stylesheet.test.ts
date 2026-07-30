import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BASE_CSS, applicationStylesheet } from './stylesheet'
import { tokenCustomProperties } from './tokens'

/**
 * Walks up to the directory holding package.json. Deliberately not
 * `execFileSync('git', …)`: shelling out at module scope makes this file — and
 * therefore an acceptance gate — fail to import anywhere git is absent or `.git`
 * is missing, such as a Docker stage that copies only source.
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

const LAYOUT = join(repoRoot(), 'app/layout.tsx')

describe('the stylesheet the application ships', () => {
  it('defines every token as a custom property', () => {
    const css = applicationStylesheet()

    for (const [name, value] of tokenCustomProperties()) {
      expect(css, `${name} never reaches the document`).toContain(`${name}: ${value};`)
    }
  })

  it('opens with the :root block, so the definitions precede their use', () => {
    expect(applicationStylesheet().trimStart().startsWith(':root {')).toBe(true)
  })

  it('sets the page ground and body type from tokens rather than from literals', () => {
    expect(BASE_CSS).toContain('background: var(--color-stone);')
    expect(BASE_CSS).toContain('color: var(--color-ink);')
    expect(BASE_CSS).toContain('font-family: var(--type-sans);')
    expect(BASE_CSS).toContain('font-size: var(--type-scale-body);')
  })
})

describe('focus ring', () => {
  it('gives every focusable element an ink ring built from the token widths', () => {
    expect(BASE_CSS).toContain(
      'outline: var(--component-focus-ring-width) solid var(--color-ink);',
    )
    expect(BASE_CSS).toContain('outline-offset: var(--component-focus-ring-offset);')
  })

  it('inverts to the on-ink ring for elements on an ink ground', () => {
    expect(BASE_CSS).toContain('.on-ink:focus-visible')
    expect(BASE_CSS).toContain('.on-ink > :focus-visible')
    expect(BASE_CSS).toContain('outline-color: var(--color-on-ink);')
  })

  /**
   * A descendant selector would follow the cascade into a nested panel that
   * re-establishes a stone ground, painting a white ring on a near-white surface
   * — 1.26:1, invisible. The rule must not use one.
   */
  it('does not invert for every descendant, only for elements on the ink ground itself', () => {
    expect(BASE_CSS).not.toMatch(/\.on-ink\s+:focus-visible/)
  })

  it('offers a reset so a nested stone ground gets the ink ring back', () => {
    expect(BASE_CSS).toContain('.on-stone > :focus-visible')
  })

  it('never removes the outline', () => {
    expect(BASE_CSS).not.toMatch(/outline\s*:\s*(none|0)/)
  })
})

/**
 * The stylesheet is only worth anything if the document actually carries it.
 * These read the layout source, because a unit test of a string join proves
 * nothing about what a browser receives — deleting the <style> element would
 * otherwise leave every test green and every screen unstyled.
 */
describe('the layout renders it', () => {
  const layout = readFileSync(LAYOUT, 'utf8')

  it('renders the composed stylesheet into the document', () => {
    expect(layout).toContain('applicationStylesheet()')
    expect(layout).toMatch(/<style[^>]*>/)
  })

  it('hoists it with a precedence so it lands in <head> rather than <body>', () => {
    expect(layout).toContain('precedence=')
  })

  it('composes no styling of its own, so the token module stays the only source', () => {
    expect(layout).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
