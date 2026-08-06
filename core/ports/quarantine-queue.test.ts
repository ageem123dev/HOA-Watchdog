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
 * Comments are stripped first, and `strips a forbidden word from a comment but
 * keeps a real declaration` is the control that proves the stripping neither
 * under- nor over-reaches.
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
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** Lines of the form `name(` — a method declaration in an interface body. */
function declaredMethods(source: string): string[] {
  return [...stripComments(source).matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1] ?? '')
}

/**
 * Every name the port declares, however it declares it.
 *
 * Fields and methods together, because the two forbidden names are forbidden as
 * *data*, not as a syntax. `storageKey(): string` hands out a storage key just
 * as effectively as `readonly storageKey: string`, and checking only fields let
 * both pass. Raised in review.
 */
function declaredNames(source: string): string[] {
  return [...declaredFields(source).map((f) => f.name), ...declaredMethods(source)].map((name) =>
    name.toLowerCase(),
  )
}

/** Lines of the form `readonly name:` or `name?:` — a property declaration. */
function declaredFields(source: string): { name: string; optional: boolean }[] {
  return [
    ...stripComments(source).matchAll(/^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??):/gm),
  ].map((m) => ({ name: m[1] ?? '', optional: m[2] === '?' }))
}

/**
 * Names that would mean this port can act on the queue rather than describe it.
 * `hold` is here too: writing belongs to `Quarantine`, and a second way in would
 * make two ports responsible for one invariant.
 */
const MUTATOR_NAMES = [
  'resolve',
  'dismiss',
  'clear',
  'delete',
  'remove',
  'create',
  'insert',
  'update',
  'write',
  'hold',
  'confirm',
  'match',
  'set',
]

describe('the quarantine queue port', () => {
  it('declares held', () => {
    // First, and deliberately so: every other assertion below is satisfied by an
    // empty file. This one is what stops "no mutators" being true because there
    // is nothing there at all.
    expect(declaredMethods(portSource())).toContain('held')
  })

  it('declares no method that could change what is waiting', () => {
    // AC3's second clause. A treasurer's decision is story 1.6d's to record, and
    // the way that survives is that this port cannot express it -- so a later
    // caller cannot quietly reach for one.
    const mutators = declaredMethods(portSource()).filter((name) =>
      MUTATOR_NAMES.includes(name.toLowerCase()),
    )

    expect(mutators).toEqual([])
  })

  it('strips a forbidden word from a comment but keeps a real declaration', () => {
    // The control for the instrument itself. Without it, a stripper that deleted
    // everything would make `declares no mutator` pass forever, and one that
    // deleted nothing would fail this file's own prose.
    const sample = ['// resolve() belongs to story 1.6d', '/* clear() does too */', '  held(): void']

    const methods = declaredMethods(sample.join('\n'))

    expect(methods).toEqual(['held'])
  })

  it('does not hand out the normalised name', () => {
    // Migration 010: the folded form is a comparison key and no use to a human.
    // AC1 asks for the name as the document said it, and a type that offers both
    // invites a surface to show the wrong one.
    const names = declaredNames(portSource())

    expect(names).not.toContain('normalisedname')
    expect(names).not.toContain('normalizedname')
  })

  it('does not hand out a storage key', () => {
    // AD-10: no caller may receive a storage key. The adapter joins `document`
    // for its filename and the key sits on the same row, one careless `select *`
    // away.
    const names = declaredNames(portSource())

    expect(names).not.toContain('storagekey')
  })

  it('sees a forbidden name declared as a method, not only as a field', () => {
    // The control for the fix above. Checking fields alone, both cases passed
    // against a port that handed out a storage key through a method — a guard
    // that proves nothing, which is the defect shape this project keeps meeting.
    const leaky = ['export interface HeldItem {', '  storageKey(): string', '}']

    expect(declaredNames(leaky.join('\n'))).toContain('storagekey')
  })

  it('declares no optional field', () => {
    // Every column behind this type is `not null`. An optional field would have
    // the surface render `undefined` for something the database guarantees is
    // there, and the compiler would agree with it.
    const optional = declaredFields(portSource()).filter((f) => f.optional)

    expect(optional.map((f) => f.name)).toEqual([])
  })
})
