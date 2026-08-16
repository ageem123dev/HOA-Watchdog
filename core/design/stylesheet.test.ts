import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from './contrast'
import { BASE_CSS, applicationStylesheet } from './stylesheet'
import { MINIMUM_TEXT_CONTRAST } from './text-pairings'
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

/**
 * Print and reflow (story 4.7, AC9 and AC10).
 *
 * UX-DR22 asks for a print treatment on the register **and** the finding
 * detail, and story 4.6's AC10 deferred it here so the two would share one
 * stylesheet rather than grow two. This is that stylesheet.
 *
 * ## What is asserted, and what cannot be
 *
 * jsdom does not evaluate media queries, so no test here can prove a rule
 * *applied* on paper or at a phone width. What can be proven is that the rules
 * exist, that they name the right things, and — the half that actually rots —
 * that the markup carries the hooks they select on. The component tests assert
 * that side; this asserts this one.
 *
 * Every assertion below is about what is **hidden** as much as what survives. A
 * print stylesheet that hides nothing passes any check for what it keeps.
 */
describe('AC9: the print treatment', () => {
  const printBlock = (): string => {
    const css = applicationStylesheet()
    const at = css.indexOf('@media print')

    expect(at, 'there is no print treatment at all').toBeGreaterThan(-1)

    // From the at-rule to the closing brace of its block. Crude, and adequate:
    // the block is the last thing in the sheet and nothing nests inside it.
    return css.slice(at)
  }

  it('exists', () => {
    expect(applicationStylesheet()).toContain('@media print')
  })

  it.each([
    ['buttons, which do nothing on paper', 'button'],
    ['the search form', 'form'],
    ['navigation', 'nav'],
  ])('hides %s', (_name, selector) => {
    const block = printBlock()

    expect(block).toMatch(new RegExp(`${selector}[^{]*\\{[^}]*display:\\s*none`))
  })

  it('keeps the record itself, rather than hiding everything', () => {
    // The failure mode opposite to the one above: a stylesheet that hid the
    // tables would produce a board packet with no findings in it.
    const block = printBlock()

    expect(block).not.toMatch(/(^|[\s,])table[^{]*\{[^}]*display:\s*none/)
    expect(block).not.toMatch(/(^|[\s,])dl[^{]*\{[^}]*display:\s*none/)
  })

  it('drops the ink ground, so a page is not printed as a solid block', () => {
    expect(printBlock()).toMatch(/background:\s*(#fff|white|transparent)/)
  })

  it('shows a link as text rather than as a live affordance', () => {
    // A register row is a link. On paper the underline is noise, and the URL is
    // not something a director can click.
    expect(printBlock()).toMatch(/a\b[^{]*\{[^}]*text-decoration:\s*none/)
  })

  /**
   * What `.on-ink` actually resolves to once the print block has had its say.
   *
   * Resolved rather than string-matched, because the defect this guards was
   * invisible in the source: the print block set `--color-ink` and
   * `--color-on-ink` to the same black, and `.on-ink` takes one for its ground
   * and the other for its text. Neither declaration looked wrong on its own.
   *
   * So this walks the cascade the browser walks — the base rule's `var()`s
   * against the print tokens, then any print override on top — and it fails
   * for *either* regression: blackening the token again, or dropping the
   * override that inverts the band.
   */
  const printedOnInk = (): { ground: string; text: string } => {
    const block = printBlock()

    const token = (name: string): string => {
      const found = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(block)

      expect(found, `the print block does not redefine --color-${name}`).not.toBeNull()
      return found?.[1] ?? ''
    }

    // The base rule is what applies when the print block says nothing.
    let ground = token('ink')
    let text = token('on-ink')

    const override = /\.on-ink\s*\{([^}]*)\}/.exec(block)
    if (override) {
      const declaration = (property: string): string | undefined =>
        new RegExp(`${property}:\\s*(#[0-9a-fA-F]{3,6})`).exec(override[1] ?? '')?.[1]

      ground = declaration('background') ?? ground
      text = declaration('color') ?? text
    }

    return { ground, text }
  }

  it('keeps content on an ink ground readable on paper', () => {
    // The whole point of the print treatment is a document somebody reads. A
    // masthead printing black on black is not a styling blemish — it is a
    // missing part of the board packet. Raised by CodeRabbit.
    const { ground, text } = printedOnInk()

    expect(contrastRatio(ground, text)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })

  it('spends no toner on a solid band where the screen had an ink ground', () => {
    // The paired half of the rule above: white text on a black band satisfies
    // contrast and still empties a cartridge across every printed page.
    expect(printedOnInk().ground).toMatch(/^#(fff|ffffff)$/i)
  })

  it('leaves --color-on-ink meaning the light one', () => {
    // It is used as a *ground* too — the sign-in field takes it for its
    // background with `--color-ink` as its text — so this is not reducible to
    // the `.on-ink` override above.
    const found = /--color-on-ink:\s*(#[0-9a-fA-F]{3,6})/.exec(printBlock())

    expect(contrastRatio(found?.[1] ?? '#000', '#000')).toBeGreaterThanOrEqual(
      MINIMUM_TEXT_CONTRAST,
    )
  })
})

describe('AC10: evidence tables reflow rather than scrolling sideways', () => {
  const reflowBlock = (): string => {
    const css = applicationStylesheet()
    const at = css.indexOf('@media (max-width:')

    expect(at, 'there is no narrow-viewport treatment').toBeGreaterThan(-1)

    return css.slice(at, css.indexOf('@media print') === -1 ? undefined : css.indexOf('@media print'))
  }

  it('has a narrow-viewport block at the breakpoint EXPERIENCE.md names', () => {
    // "Below 48rem" — stated in rem so it follows a reader's text size, which
    // is the point of the rule it belongs to.
    expect(applicationStylesheet()).toContain('@media (max-width: 48rem)')
  })

  it('turns the evidence table into stacked groups', () => {
    const block = reflowBlock()

    expect(block).toMatch(/\.evidence-table[^{]*\{[^}]*display:\s*block/)
  })

  it('labels each value with its column, since the header row is gone', () => {
    // A stacked cell with no label is a figure with nothing saying what it is,
    // which on a page about money is worse than the table it replaced.
    const block = reflowBlock()

    expect(block).toContain('attr(data-column)')
  })

  it('keeps figures tabular, which EXPERIENCE.md asks for by name', () => {
    expect(reflowBlock()).toMatch(/font-variant-numeric:\s*tabular-nums/)
  })

  it('introduces no horizontal scroller of its own', () => {
    // The stylesheet's half of the rule. **The half that mattered was inline**
    // — story 4.6 put the scroller in a component style, not here — so the
    // assertion that actually guards EXPERIENCE.md lives in
    // `app/findings/[id]/detail-panel.test.tsx`, against the rendered markup.
    const rules = applicationStylesheet().replace(/\/\*[\s\S]*?\*\//g, '')

    expect(rules).not.toMatch(/overflow-x:\s*(auto|scroll)/)
  })
})
