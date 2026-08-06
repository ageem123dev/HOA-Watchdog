/**
 * The queue port is a type declaration, and types have no runtime presence —
 * Vitest does not type-check, so nothing an ordinary test does can observe it.
 *
 * Two instruments cover it between them. `npm run build` proves the *positive*
 * shape: the adapter and the view model consume these fields, so a wrong or
 * missing one fails the build. This file proves the *negative* one, which no
 * compiler will ever check for us — that the port declares nothing capable of
 * changing what is waiting, and hands out neither the normalised name nor a
 * storage key.
 *
 * Reading source text is a blunt instrument and it has misfired here before: a
 * migration test in story 1.6a matched the migration's own comment rather than
 * its SQL, and passed for a reason that had nothing to do with the schema.
 * Comments are stripped first, and `strips comments without eating declarations`
 * is the control proving the stripping neither under- nor over-reaches.
 *
 * The assertions are **allow-lists**. A deny-list of forbidden names was tried
 * first and review found it failed open in two ways: `archive()` is on nobody's
 * list of mutators, and `storage_key` is not the string `storagekey`. Naming
 * what may exist rejects everything else by construction — the same argument
 * that removed the CI path filter from `.gitlab-ci.yml`.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PORT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'quarantine-queue.ts')

/**
 * An unreadable file becomes empty text rather than a thrown error, so an
 * absent or emptied port fails `declares held` — a visible assertion naming the
 * behaviour — instead of erroring out of every case at once. "The file vanished"
 * and "the file lost a method" should not be told apart by the reader of a
 * stack trace.
 */
function portSource(): string {
  try {
    return readFileSync(PORT_PATH, 'utf8')
  } catch {
    return ''
  }
}

/**
 * Block comments first, then line comments. Order matters: a `//` inside a
 * block comment would otherwise truncate the line and leave the block's closing
 * delimiter behind for the block pass to miss.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Lines of the form `name(` — a method declaration in an interface body. */
function declaredMethods(source: string): string[] {
  return [...stripComments(source).matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1] ?? '')
}

/** Lines of the form `readonly name:` or `name?:` — a property declaration. */
function declaredFields(source: string): { name: string; optional: boolean }[] {
  return [
    ...stripComments(source).matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??):/gm),
  ].map((m) => ({ name: m[1] ?? '', optional: m[2] === '?' }))
}

describe('the quarantine queue port', () => {
  it('declares held', () => {
    // First, and deliberately so: an empty file satisfies every other assertion
    // here. This is what stops "declares exactly one method" being true because
    // there is nothing there at all.
    expect(declaredMethods(portSource())).toContain('held')
  })

  it('declares exactly one method, and it is held', () => {
    // AC3's second clause. Confirming a vendor is story 1.6d's to record, and
    // the way that survives contact with a codebase is that this port cannot
    // express it — so a later caller cannot quietly reach for a method that was
    // never declared.
    expect(declaredMethods(portSource())).toEqual(['held'])
  })

  it('declares exactly the three fields a treasurer needs', () => {
    // Subsumes the two named checks it replaced. `normalisedName` is a
    // comparison key of no use to a human (migration 010) and a storage key may
    // not reach any caller (AD-10); neither can appear in a set asserted to be
    // exactly these three, in any casing.
    const fields = declaredFields(portSource())
      .map((f) => f.name)
      .sort()

    expect(fields).toEqual(['documentId', 'extractedName', 'filename'])
  })

  it('rejects the additions a deny-list let through', () => {
    // The control for the allow-lists, using the two cases review named. Both
    // passed against the deny-list version: `archive` was on no forbidden list,
    // and `storage_key` did not equal `storagekey`.
    const sneaky = [
      'export interface HeldItem {',
      '  readonly documentId: string',
      '  readonly filename: string',
      '  readonly extractedName: string',
      '  readonly storage_key: string',
      '}',
      'export interface QuarantineQueue {',
      '  held(): Promise<readonly HeldItem[]>',
      '  archive(): Promise<void>',
      '}',
    ].join('\n')

    expect(declaredMethods(sneaky)).not.toEqual(['held'])
    expect(
      declaredFields(sneaky)
        .map((f) => f.name)
        .sort(),
    ).not.toEqual(['documentId', 'extractedName', 'filename'])
  })

  it('strips comments without eating declarations', () => {
    // The control for the instrument itself, and the second attempt at it. The
    // first used single-line comments -- `// archive() belongs to 1.6d` -- which
    // proved nothing: both regexes anchor at `^\s*` followed by an identifier,
    // so a line beginning `//` never matches whether it is stripped or not. The
    // test passed with stripping disabled entirely.
    //
    // A *block* comment is what exercises it, because its inner lines do begin
    // with an identifier and would be picked up verbatim.
    const sample = [
      '/*',
      '  archive(): Promise<void>',
      '  readonly storage_key: string',
      '*/',
      '  held(): void',
      '  readonly documentId: string',
    ].join('\n')

    expect(declaredMethods(sample)).toEqual(['held'])
    expect(declaredFields(sample).map((f) => f.name)).toEqual(['documentId'])
  })

  it('declares no optional field', () => {
    // Every column behind this type is `not null`. An optional field would have
    // the surface render `undefined` for something the database guarantees is
    // there, and the compiler would agree with it.
    const optional = declaredFields(portSource()).filter((f) => f.optional)

    expect(optional.map((f) => f.name)).toEqual([])
  })
})
