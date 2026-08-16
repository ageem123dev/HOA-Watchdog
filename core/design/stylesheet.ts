import { rootCustomPropertiesCss } from './tokens'

/**
 * The application's base stylesheet, composed from the token set.
 *
 * It lives here rather than inside the layout component so it can be asserted
 * against directly. A test that only checks the string a generator returns
 * proves nothing about what the document contains; this module is the thing the
 * layout actually renders, so testing it tests what ships.
 */

export const BASE_CSS = `*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--color-stone);
  color: var(--color-ink);
  font-family: var(--type-sans);
  font-size: var(--type-scale-body);
  line-height: 1.5;
}

/*
 * Focus is never invisible. The ink ring reads on stone and stone-raised
 * grounds; on an ink ground it would vanish, which DESIGN.md calls "a
 * conformance failure, not a cosmetic one".
 *
 * The inversion applies to direct children of an ink ground rather than to every
 * descendant. A descendant selector would follow the cascade into a nested panel
 * that re-establishes a stone ground and paint a white ring on a near-white
 * surface — white on stone measures 1.26:1 — which is the very failure this rule
 * exists to prevent. A nested region that changes the ground back carries
 * .on-stone and gets the ink ring again.
 */
:focus-visible {
  outline: var(--component-focus-ring-width) solid var(--color-ink);
  outline-offset: var(--component-focus-ring-offset);
}

.on-ink {
  background: var(--color-ink);
  color: var(--color-on-ink);
}

.on-ink:focus-visible,
.on-ink > :focus-visible {
  outline-color: var(--color-on-ink);
}

.on-stone:focus-visible,
.on-stone > :focus-visible {
  outline-color: var(--color-ink);
}

/*
 * Evidence tables reflow; they do not scroll (UX-DR22's companion rule).
 *
 * EXPERIENCE.md is unambiguous: "evidence tables reflow to stacked label/value
 * groups, one record per group, figures still tabular. They do not scroll
 * horizontally -- a table that scrolls sideways in a meeting is a table nobody
 * reads." Story 4.6 shipped a horizontal scroller on the finding detail's table,
 * which is that rule broken; story 4.7 owns the responsive treatment for both
 * surfaces and removes it.
 *
 * The header row is hidden rather than deleted, and each cell names its own
 * column from data-column. A stacked cell with no label is a figure with
 * nothing saying what it is, which on a page about money is worse than the
 * table it replaced -- and the label has to come from the markup, because CSS
 * cannot reach the <th> above it.
 *
 * 48rem rather than pixels, so the breakpoint follows a reader's text size.
 * The rule belongs to the same accessibility floor that requires row heights to
 * flex for user text spacing.
 */
@media (max-width: 48rem) {
  .evidence-table,
  .evidence-table tbody,
  .evidence-table tr,
  .evidence-table td {
    display: block;
  }

  /*
   * Hidden from sight, kept for assistive technology -- the table still has a
   * header row, and removing it would strip the association a screen reader
   * uses to announce each cell.
   */
  .evidence-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    padding: 0;
    overflow: hidden;
    /* clip is deprecated and still the only thing some older engines honour. */
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .evidence-table tr {
    padding: var(--space-row) 0;
    border-bottom: var(--component-rule-hairline) solid var(--color-rule-strong);
  }

  .evidence-table td {
    display: grid;
    grid-template-columns: 40% 1fr;
    gap: var(--space-row);
    padding: var(--space-base) 0;
    border: 0;
    text-align: left;
  }

  .evidence-table td::before {
    content: attr(data-column);
    font-family: var(--type-sans);
    font-size: var(--type-scale-label);
    letter-spacing: var(--type-tracking-label);
    text-transform: uppercase;
    color: var(--color-ink-muted);
  }

  /* Still tabular, which EXPERIENCE.md asks for by name. */
  .evidence-table td[data-numeric='true'] {
    font-variant-numeric: tabular-nums;
  }
}

/*
 * Print (UX-DR22).
 *
 * "Some directors read the board packet on paper; the register and finding
 * detail carry a print treatment." One stylesheet for both, which is why story
 * 4.6 deferred its half here rather than growing a second one.
 *
 * What goes: everything that only works on a screen. A button on paper is a
 * rectangle a director cannot press, and the search form is a box they cannot
 * type into -- both are noise between them and the record.
 *
 * What stays: the findings, the figures, the evidence tables, and who reviewed
 * what and when. That is the document. A print stylesheet that hid those would
 * produce a board packet with nothing in it, which is why the tests assert what
 * survives as well as what does not.
 */
@media print {
  /*
   * **The tokens are redefined, not just the body.** Every surface here styles
   * inline with var(--color-ink) and friends, and an inline style beats any
   * rule in this sheet -- so setting colours on body alone left the printed
   * page using the screen palette, and a print treatment that only appeared to
   * work is worse than none. Redefining the custom properties reaches the
   * inline styles, because that is where they are resolved. Raised by
   * CodeRabbit.
   *
   * Ink to black and every ground to white: toner is the constraint on paper,
   * and the stone ground exists to be easy on a screen.
   */
  :root {
    --color-ink: #000;
    --color-ink-muted: #333;
    --color-stone: #fff;
    --color-stone-raised: #fff;
    --color-on-ink: #000;
    --color-rule-strong: #767676;
    --color-brass: #333;
    --color-flag: #000;
  }

  body {
    background: #fff;
    color: #000;
  }

  button,
  form,
  nav {
    display: none;
  }

  /*
   * A link is text on paper. The href is not something a director can follow,
   * and an underlined blue row reads as an unfinished document.
   */
  a {
    color: inherit;
    text-decoration: none;
  }

  /*
   * Rows are not split across a page break. A finding whose amount landed on
   * the next sheet is one an auditor has to reassemble by hand.
   */
  tr,
  li {
    break-inside: avoid;
  }
}`

/** Everything the document needs: the token definitions, then the base rules. */
export function applicationStylesheet(): string {
  return `${rootCustomPropertiesCss()}\n\n${BASE_CSS}`
}
