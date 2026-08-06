// @vitest-environment jsdom

/**
 * The harness itself, asserted rather than assumed.
 *
 * Three things have to be true before any component test means anything, and
 * each of them fails silently:
 *
 * - `.tsx` files are collected at all. Until this story the `include` glob was
 *   `**\/*.test.ts`, so a component test would have been picked up by nothing —
 *   and a file that never runs looks exactly like a file that ran and passed.
 * - The jsdom docblock at the top of a file actually switches the environment.
 *   The project default is `node`, where `document` is undefined.
 * - JSX is transformed. `tsconfig.json` sets `"jsx": "react-jsx"`, so esbuild
 *   handles it without `@vitejs/plugin-react` — which is a claim worth checking
 *   once rather than discovering halfway through a surface.
 *
 * This file is the receipt for all three. It is deliberately not about the
 * quarantine queue: if it lived beside the surface, deleting the surface would
 * delete the evidence that the harness works.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

function Greeting({ name }: { name: string }) {
  return <p>Hello, {name}</p>
}

describe('the rendering harness', () => {
  it('runs in jsdom, where a document exists', () => {
    expect(typeof document).toBe('object')
  })

  it('transforms JSX and renders it', () => {
    render(<Greeting name="treasurer" />)

    expect(screen.getByText('Hello, treasurer')).toBeDefined()
  })

  it('fails a query for text that was never rendered', () => {
    // Without this, `getByText` returning something for everything would make
    // every rendering assertion in this project vacuous.
    render(<Greeting name="treasurer" />)

    expect(() => screen.getByText('Hello, nobody')).toThrow()
  })
})
