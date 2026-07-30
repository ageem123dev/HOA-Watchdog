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
}`

/** Everything the document needs: the token definitions, then the base rules. */
export function applicationStylesheet(): string {
  return `${rootCustomPropertiesCss()}\n\n${BASE_CSS}`
}
