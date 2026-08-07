/**
 * The write port, asserted the way story 1.6c's review taught: allow-lists.
 *
 * Types have no runtime presence and Vitest does not type-check, so `npm run
 * build` proves the positive shape and this proves the negatives — that the port
 * declares these two operations and no third, and that its outcome type can say
 * "already resolved" without anybody throwing.
 *
 * Deny-lists were tried on the sibling port and failed open twice in one review:
 * `archive()` was on no list of forbidden names and `storage_key` was not the
 * string `storagekey`. Naming what may exist rejects the rest by construction.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PORT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'vendor-resolution.ts')

/** An unreadable file becomes empty text, so its absence fails a named assertion. */
function portSource(): string {
  try {
    return readFileSync(PORT_PATH, 'utf8')
  } catch {
    return ''
  }
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function declaredMethods(source: string): string[] {
  return [...stripComments(source).matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1] ?? '')
}

/** String-literal members of a discriminated union — `outcome: 'created'` and friends. */
function declaredOutcomes(source: string): string[] {
  return [...stripComments(source).matchAll(/outcome:\s*'([a-z-]+)'/g)].map((m) => m[1] ?? '').sort()
}

describe('the vendor resolution port', () => {
  it('declares confirmAsNew', () => {
    // First, so the exact-set assertions below cannot be satisfied by an empty
    // or missing file.
    expect(declaredMethods(portSource())).toContain('confirmAsNew')
  })

  it('declares exactly two operations', () => {
    // A1. Two methods rather than one with an optional vendor id: an optional id
    // is precisely how "here are some candidates" becomes "resolved to the first
    // one", which is the failure `VendorDirectory`'s header describes and the
    // whole of epic story 1.6 exists to prevent.
    expect(declaredMethods(portSource()).sort()).toEqual(['confirmAsNew', 'matchToExisting'])
  })

  it('can say a resolution already happened without throwing', () => {
    // B1 and AC5. Two treasurers, or one with two tabs, is an ordinary race and
    // not a fault. Modelled as a thrown error, every caller has to catch it to
    // render an expected outcome, and the one that forgets shows a crash.
    expect(declaredOutcomes(portSource())).toContain('already-resolved')
  })

  it('distinguishes creating a vendor from matching one', () => {
    // B3 and AC2. If both endings are the same value the surface cannot tell a
    // treasurer which happened, and "no vendor is created" becomes unobservable.
    const outcomes = declaredOutcomes(portSource())

    expect(outcomes).toContain('created')
    expect(outcomes).toContain('matched')
  })

  it('declares no outcome beyond those three', () => {
    // An allow-list again. A fourth variant added later without a test is how
    // the surface acquires a case it renders as nothing at all.
    expect(declaredOutcomes(portSource())).toEqual(['already-resolved', 'created', 'matched'])
  })

  it('strips comments without eating declarations', () => {
    // The control for the instrument. Story 1.6c shipped two versions of this
    // control that tested nothing: single-line comments never match either
    // regex, so the assertions passed with stripping disabled entirely. A block
    // comment whose inner lines begin with identifiers is what exercises it.
    const sample = [
      '/*',
      '  archive(): Promise<void>',
      "  outcome: 'invented'",
      '*/',
      '  confirmAsNew(): void',
      "  readonly outcome: 'created'",
    ].join('\n')

    expect(declaredMethods(sample)).toEqual(['confirmAsNew'])
    expect(declaredOutcomes(sample)).toEqual(['created'])
  })
})
