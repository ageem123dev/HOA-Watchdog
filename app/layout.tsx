import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { rootCustomPropertiesCss } from '@/core/design/tokens'

export const metadata: Metadata = {
  title: 'Fiduciary Watchdog',
  description: 'Financial records for a condominium association board.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/**
 * Base rules built on the token set. Generated from `core/design/tokens.ts`
 * rather than hand-written alongside it — two lists of the same values is the
 * drift the visual foundation exists to prevent.
 */
const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }

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
 * conformance failure, not a cosmetic one". Any element establishing an ink
 * ground carries .on-ink, and the ring inverts within it.
 */
:focus-visible {
  outline: var(--component-focus-ring-width) solid var(--color-ink);
  outline-offset: var(--component-focus-ring-offset);
}

.on-ink {
  background: var(--color-ink);
  color: var(--color-on-ink);
}

.on-ink :focus-visible,
.on-ink:focus-visible {
  outline-color: var(--color-on-ink);
}

/* Money is the most-read content on every screen. */
.figure {
  font-family: var(--type-serif);
  font-variant-numeric: tabular-nums;
}
`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <style>{`${rootCustomPropertiesCss()}\n${BASE_CSS}`}</style>
        {children}
      </body>
    </html>
  )
}
